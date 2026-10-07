using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class FaceController(FaceOptions options, FaceVerification service) : ControllerBase
{
    [HttpPost("/enroll/face/reference")]
    public Task<IActionResult> Enroll() => Execute("enroll");
    [HttpPost("/verify/face")]
    public Task<IActionResult> Verify() => Execute("verify");
    [HttpPost("/verify/face-sliding")]
    public Task<IActionResult> Sliding() => Execute("sliding");

    private async Task<IActionResult> Execute(string operation)
    {
        var sliding = operation == "sliding"; var enroll = operation == "enroll";
        try
        {
            if (HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
                limit.MaxRequestBodySize = options.MaxUploadBytes <= (long.MaxValue - 512 * 1024) / 2 ? options.MaxUploadBytes * (sliding ? 1 : 2) + 512 * 1024 : long.MaxValue;
            var fields = new JsonObject(); IFormFileCollection files = new FormFileCollection();
            if (Request.HasFormContentType)
            {
                IFormCollection form;
                try { form = await Request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = options.MaxUploadBytes, MemoryBufferThreshold = 64 * 1024 }, Request.HttpContext.RequestAborted); }
                catch (InvalidDataException ex)
                {
                    if (ex.Message.Contains("body length limit", StringComparison.OrdinalIgnoreCase)) throw new FaceFailure("IMAGE_TOO_LARGE", $"Uploaded image exceeds maximum size ({options.MaxUploadBytes} bytes).", 413);
                    throw new FaceFailure("INVALID_REQUEST", "Malformed multipart form.");
                }
                foreach (var field in form) if (field.Value.Count == 1) fields[field.Key] = field.Value[0]; else fields[field.Key] = new JsonArray(field.Value.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
                files = form.Files;
                var seen = new HashSet<string>();
                var fileCount = 0;
                foreach (var file in files)
                {
                    if (++fileCount > (sliding ? 1 : 2)) throw new FaceFailure("INVALID_REQUEST", "Too many files");
                    var allowed = enroll ? file.Name == "referenceImage" : sliding ? file.Name == "probeImage" : file.Name is "probeImage" or "referenceImage";
                    if (!allowed || !seen.Add(file.Name)) throw new FaceFailure("INVALID_REQUEST", "Unexpected field");
                    if (file.ContentType is not ("image/jpeg" or "image/png" or "image/webp")) throw new FaceFailure("INVALID_IMAGE_TYPE", $"Unsupported image type ({file.ContentType}).");
                    if (file.Length > options.MaxUploadBytes) throw new FaceFailure("IMAGE_TOO_LARGE", $"Uploaded image exceeds maximum size ({options.MaxUploadBytes} bytes).", 413);
                }
            }
            else if (Request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true)
            {
                fields = await JsonNode.ParseAsync(Request.Body, cancellationToken: HttpContext.RequestAborted) as JsonObject ?? new JsonObject();
            }
            string? Text(string key) => JsonValues.Text(fields[key])?.Trim() is { Length: > 0 } value ? value : null;
            double? Number(string key)
            {
                var value = fields[key]; if (value is null || JsonValues.Text(value) == "") return null;
                if (JsonValues.Number(value) is { } numeric) return numeric;
                if (JsonValues.Text(value) is { } text)
                {
                    if (string.IsNullOrWhiteSpace(text)) return 0;
                    var trimmed = text.Trim();
                    if (trimmed.Length > 2 && trimmed.StartsWith("0", StringComparison.Ordinal) && "xXbBoO".Contains(trimmed[1]))
                    {
                        try { return Convert.ToInt64(trimmed[2..], char.ToLowerInvariant(trimmed[1]) switch { 'x' => 16, 'b' => 2, _ => 8 }); }
                        catch (Exception ex) when (ex is FormatException or OverflowException or ArgumentException) { }
                    }
                    if (double.TryParse(text.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number)) return number;
                }
                throw new FaceFailure("INVALID_REQUEST", $"{key} must be a finite number.");
            }
            var userId = Text("userId");
            if (enroll)
            {
                var reference = files.GetFile("referenceImage") ?? throw new FaceFailure("REFERENCE_REQUIRED", "referenceImage is required.");
                return Ok(await service.EnrollAsync(userId, reference, HttpContext.RequestAborted));
            }
            var threshold = Number("threshold");
            if (sliding)
            {
                var maxWindow = Number("maxWindow"); bool? update = null;
                if (fields["updateOnSuccess"] is { } v && JsonValues.Text(v) != "")
                {
                    update = v is JsonValue j && j.TryGetValue<bool>(out var boolean) ? boolean : JsonValues.Text(v)?.Trim().ToLowerInvariant() switch
                    { "true" or "1" => true, "false" or "0" => false, _ => throw new FaceFailure("INVALID_REQUEST", "updateOnSuccess must be a boolean.") };
                }
                if (userId is null) throw new FaceFailure("INVALID_REQUEST", "userId is required.");
                if (userId is "." or ".." || userId.IndexOfAny(['/', '\\', ':']) >= 0 || userId.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                    throw new FaceFailure("INVALID_REQUEST", "userId must be a single directory name.");
                var probe = files.GetFile("probeImage") ?? throw new FaceFailure("PROBE_REQUIRED", "probeImage is required.");
                return Ok(await service.SlidingAsync(userId, probe, threshold, maxWindow, update, HttpContext.RequestAborted));
            }
            var probeImage = files.GetFile("probeImage") ?? throw new FaceFailure("PROBE_REQUIRED", "probeImage is required.");
            return Ok(await service.VerifyAsync(userId, Text("referenceImagePath"), files.GetFile("referenceImage"), probeImage, threshold, HttpContext.RequestAborted));
        }
        catch (FaceFailure ex) { return StatusCode(ex.Status, new ApiErrorResponse(new ApiError(ex.Code, ex.Message, ex.Details))); }
        catch (BadHttpRequestException ex) when (ex.StatusCode == 413) { return StatusCode(413, new ApiErrorResponse(new ApiError("IMAGE_TOO_LARGE", $"Uploaded image exceeds maximum size ({options.MaxUploadBytes} bytes)."))); }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested) { throw; }
        catch (JsonException) { return BadRequest(new ApiErrorResponse(new ApiError("INVALID_REQUEST", "Invalid request body."))); }
        catch (Exception) { return StatusCode(500, new ApiErrorResponse(new ApiError("INTERNAL_ERROR", sliding ? "Face sliding window verification failed." : "Face verification request failed."))); }
    }
}
