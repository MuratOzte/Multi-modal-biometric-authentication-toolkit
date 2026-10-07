using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class ProfilesController(IProfileStorage storage, TimeProvider clock) : ControllerBase
{
    private string Now() => clock.GetUtcNow().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    [HttpPost("/consent")]
    public async Task<IActionResult> Consent([FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] JsonElement body)
    {
        var errors = Validate(body, "userId", "consentVersion");
        if (errors.Count > 0) return Validation("Invalid consent request.", errors);
        var id = body.GetProperty("userId").GetString()!.Trim();
        var version = body.GetProperty("consentVersion").GetString()!.Trim();
        var now = Now();
        try
        {
            await storage.AppendConsentAsync(new JsonObject { ["userId"] = id, ["consentVersion"] = version, ["grantedAt"] = now });
            return Ok(new { ok = true, userId = id, consentVersion = version, grantedAt = now });
        }
        catch (Exception ex) { return Failure("Failed to persist consent.", ex); }
    }

    [HttpGet("/user/{userId}/profiles")]
    public async Task<IActionResult> Profiles(string? userId)
    {
        userId = userId?.Trim() ?? "";
        if (userId.Length == 0) return Validation("Invalid user profile request.", new() { ["userId"] = "userId is required." });
        try
        {
            var profiles = await storage.GetProfilesAsync(userId) ?? new JsonObject
            {
                ["userId"] = userId, ["keystroke"] = null, ["faceReferenceImagePath"] = null,
                ["faceReferenceEnrolledAt"] = null, ["faceEmbedding"] = null, ["cardReferenceImagePath"] = null,
                ["cardReferenceEnrolledAt"] = null, ["voice"] = null, ["voiceEmbedding"] = null, ["updatedAt"] = Now()
            };
            return Ok(new { ok = true, profiles });
        }
        catch (Exception ex) { return Failure("Failed to read user profiles.", ex); }
    }

    [HttpDelete("/user/biometrics")]
    public async Task<IActionResult> Delete([FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] JsonElement body)
    {
        var errors = Validate(body, "userId");
        if (errors.Count > 0) return Validation("Invalid delete biometrics request.", errors);
        var id = body.GetProperty("userId").GetString()!.Trim();
        try
        {
            await storage.DeleteBiometricsAsync(id, Request.Query["deleteConsent"].Any(value => string.Equals(value, "true", StringComparison.OrdinalIgnoreCase)));
            return Ok(new { ok = true, userId = id });
        }
        catch (Exception ex) { return Failure("Failed to delete biometrics.", ex); }
    }

    private static Dictionary<string, string> Validate(JsonElement body, params string[] fields)
    {
        var errors = new Dictionary<string, string>();
        if (body.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
        { errors["body"] = "Request body must be an object."; return errors; }
        foreach (var field in fields)
            if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(field, out var value)
                || value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString())) errors[field] = $"{field} is required.";
        return errors;
    }
    private IActionResult Validation(string message, Dictionary<string, string> errors) => BadRequest(
        new ApiErrorResponse(new ApiError("VALIDATION_ERROR", message, new { fieldErrors = errors })));
    private IActionResult Failure(string message, Exception ex) => StatusCode(500,
        new ApiErrorResponse(new ApiError("INTERNAL_ERROR", message, ex.Message)));
}
