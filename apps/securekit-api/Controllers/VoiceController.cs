using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class VoiceController(VoiceOptions options, VoiceVerification service) : ControllerBase
{
    [HttpPost("/enroll/voice")]
    public Task<IActionResult> Enroll() => Execute(true);
    [HttpPost("/verify/voice")]
    public Task<IActionResult> Verify() => Execute(false);

    private async Task<IActionResult> Execute(bool enroll)
    {
        try
        {
            if (HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
                limit.MaxRequestBodySize = options.MaxUploadBytes <= long.MaxValue - 512 * 1024 ? options.MaxUploadBytes + 512 * 1024 : long.MaxValue;
            var fields = new JsonObject(); IFormFile? audio = null;
            if (Request.HasFormContentType)
            {
                IFormCollection form;
                try { form = await Request.ReadFormAsync(new FormOptions { MultipartBodyLengthLimit = options.MaxUploadBytes, MemoryBufferThreshold = 64 * 1024 }, HttpContext.RequestAborted); }
                catch (InvalidDataException ex)
                {
                    if (ex.Message.Contains("body length limit", StringComparison.OrdinalIgnoreCase)) throw TooLarge();
                    throw new VoiceFailure("INVALID_REQUEST", "Malformed multipart form.");
                }
                foreach (var field in form) fields[field.Key] = field.Value.Count == 1 ? JsonValue.Create(field.Value[0]) : new JsonArray(field.Value.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
                var count = 0;
                foreach (var file in form.Files)
                {
                    if (++count > 1) throw new VoiceFailure("INVALID_REQUEST", "Too many files");
                    if (file.Name != "audioSample") throw new VoiceFailure("INVALID_REQUEST", "Unexpected field");
                    if (VoiceOptions.Extension(file.ContentType) is null) throw new VoiceFailure("INVALID_AUDIO_TYPE", $"Unsupported audio type ({file.ContentType}).");
                    if (file.Length > options.MaxUploadBytes) throw TooLarge();
                    audio = file;
                }
            }
            else if (Request.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) == true)
                fields = await JsonNode.ParseAsync(Request.Body, cancellationToken: HttpContext.RequestAborted) as JsonObject ?? new JsonObject();
            foreach (var key in enroll ? new[] { "transcriptThreshold", "minEnrollmentSamples" } : new[] { "matchThreshold", "stepUpThreshold", "denyThreshold", "transcriptThreshold", "profileUpdateAlpha" })
            {
                var value = fields[key]; if (value is null || JsonValues.Text(value) == "") { fields[key] = null; continue; }
                if (JsonValues.Number(value) is { } numeric) { fields[key] = numeric; continue; }
                if (JsonValues.Text(value) is { } text)
                {
                    if (string.IsNullOrWhiteSpace(text)) { fields[key] = 0; continue; }
                    var trimmed = text.Trim();
                    if (trimmed.Length > 2 && trimmed[0] == '0' && "xXbBoO".Contains(trimmed[1]))
                    {
                        try { fields[key] = Convert.ToInt64(trimmed[2..], char.ToLowerInvariant(trimmed[1]) switch { 'x' => 16, 'b' => 2, _ => 8 }); continue; }
                        catch (Exception ex) when (ex is FormatException or OverflowException or ArgumentException) { }
                    }
                    if (double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number)) { fields[key] = number; continue; }
                }
                throw new VoiceFailure("INVALID_REQUEST", $"{key} must be a finite number.");
            }
            if (!enroll && fields["updateProfileOnAllow"] is { } boolean && JsonValues.Text(boolean) != "")
            {
                if (boolean is JsonValue v && v.TryGetValue<bool>(out var b)) fields["updateProfileOnAllow"] = b;
                else fields["updateProfileOnAllow"] = JsonValues.Text(boolean)?.Trim().ToLowerInvariant() switch
                { "true" => true, "false" => false, _ => throw new VoiceFailure("INVALID_REQUEST", "Boolean fields must be true or false.") };
            }
            else fields["updateProfileOnAllow"] = null;
            return Ok(await service.ExecuteAsync(enroll, fields, audio, HttpContext.RequestAborted));
        }
        catch (VoiceFailure ex) { return StatusCode(ex.Status, new ApiErrorResponse(new ApiError(ex.Code, ex.Message, ex.Details))); }
        catch (BadHttpRequestException ex) when (ex.StatusCode == 413) { var failure = TooLarge(); return StatusCode(413, new ApiErrorResponse(new ApiError(failure.Code, failure.Message))); }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested) { throw; }
        catch (JsonException) { return BadRequest(new ApiErrorResponse(new ApiError("INVALID_REQUEST", "Invalid request body."))); }
        catch (Exception) { return StatusCode(500, new ApiErrorResponse(new ApiError("INTERNAL_ERROR", "Voice verification request failed."))); }
    }
    private VoiceFailure TooLarge() => new("AUDIO_TOO_LARGE", $"Uploaded audio exceeds maximum size ({options.MaxUploadBytes} bytes).", 413);
}
