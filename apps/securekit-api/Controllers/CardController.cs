using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class CardController(CardOptions options, CardVerification service) : ControllerBase
{
    [HttpGet("/card/references")]
    public IActionResult References()
    {
        try { return Ok(service.List()); }
        catch (Exception) { return StatusCode(500, new ApiErrorResponse(new ApiError("INTERNAL_ERROR", "Card verification request failed."))); }
    }
    [HttpPost("/enroll/card/reference")]
    public Task<IActionResult> Enroll() => Execute(true);
    [HttpPost("/verify/card")]
    public Task<IActionResult> Verify() => Execute(false);

    private async Task<IActionResult> Execute(bool enroll)
    {
        try
        {
            if (HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
                limit.MaxRequestBodySize = options.MaxUploadBytes < long.MaxValue - 512 * 1024 ? options.MaxUploadBytes + 512 * 1024 : long.MaxValue;
            var fields = new JsonObject(); IFormFileCollection files = new FormFileCollection();
            if (Request.HasFormContentType)
            {
                IFormCollection form;
                try { form = await Request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = options.MaxUploadBytes, MemoryBufferThreshold = 64 * 1024 }, HttpContext.RequestAborted); }
                catch (InvalidDataException ex)
                {
                    if (ex.Message.Contains("body length limit", StringComparison.OrdinalIgnoreCase)) throw TooLarge();
                    throw new CardFailure("INVALID_REQUEST", "Malformed multipart form.");
                }
                foreach (var field in form) fields[field.Key] = field.Value.Count == 1 ? JsonValue.Create(field.Value[0]) : new JsonArray(field.Value.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
                files = form.Files; var count = 0;
                foreach (var file in files)
                {
                    if (++count > 1) throw new CardFailure("INVALID_REQUEST", "Too many files");
                    if (file.Name != (enroll ? "referenceImage" : "probeImage")) throw new CardFailure("INVALID_REQUEST", "Unexpected field");
                    if (file.ContentType is not ("image/jpeg" or "image/png" or "image/webp")) throw new CardFailure("INVALID_IMAGE_TYPE", $"Unsupported image type ({file.ContentType}).");
                    if (file.Length > options.MaxUploadBytes) throw TooLarge();
                }
            }
            else if (Request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true)
                fields = await JsonNode.ParseAsync(Request.Body, cancellationToken: HttpContext.RequestAborted) as JsonObject ?? new JsonObject();
            string? Text(string key)
            {
                if (fields[key] is null || JsonValues.Text(fields[key]) == "") return null;
                var value = JsonValues.Text(fields[key]) ?? throw new CardFailure("INVALID_REQUEST", $"{key} must be a string.");
                return value.Trim() is { Length: > 0 } text ? text : null;
            }
            if (enroll)
            {
                var user = Text("userId"); var file = files.GetFile("referenceImage") ?? throw new CardFailure("INVALID_REQUEST", "referenceImage is required.");
                return Ok(await service.EnrollAsync(user, file, HttpContext.RequestAborted));
            }
            double? threshold = null;
            if (fields["threshold"] is { } v && JsonValues.Text(v) != "")
            {
                threshold = JsonValues.Number(v);
                if (threshold is null && JsonValues.Text(v) is { } text)
                {
                    var trimmed = text.Trim();
                    if (trimmed.Length == 0) threshold = 0;
                    else if (trimmed.Length > 2 && trimmed[0] == '0' && "xXbBoO".Contains(trimmed[1]))
                    { try { threshold = Convert.ToInt64(trimmed[2..], char.ToLowerInvariant(trimmed[1]) switch { 'x' => 16, 'b' => 2, _ => 8 }); } catch (Exception ex) when (ex is FormatException or OverflowException or ArgumentException) { } }
                    else if (double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number)) threshold = number;
                }
                if (threshold is null) throw new CardFailure("INVALID_REQUEST", "threshold must be a finite number.");
            }
            var referenceId = Text("referenceId"); var userId = Text("userId")?.ToLowerInvariant();
            var probe = files.GetFile("probeImage") ?? throw new CardFailure("PROBE_REQUIRED", "probeImage is required.");
            return Ok(await service.VerifyAsync(userId, referenceId, probe, threshold, HttpContext.RequestAborted));
        }
        catch (CardFailure ex) { return StatusCode(ex.Status, new ApiErrorResponse(new ApiError(ex.Code, ex.Message, ex.Details))); }
        catch (BadHttpRequestException ex) when (ex.StatusCode == 413) { var failure = TooLarge(); return StatusCode(413, new ApiErrorResponse(new ApiError(failure.Code, failure.Message))); }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested) { throw; }
        catch (JsonException) { return BadRequest(new ApiErrorResponse(new ApiError("INVALID_REQUEST", "Invalid request body."))); }
        catch (Exception) { return StatusCode(500, new ApiErrorResponse(new ApiError("INTERNAL_ERROR", "Card verification request failed."))); }
    }
    private CardFailure TooLarge() => new("IMAGE_TOO_LARGE", $"Uploaded image exceeds maximum size ({options.MaxUploadBytes} bytes).", 413);
}
