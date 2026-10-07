using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class KeystrokeController(IProfileStorage storage, ChallengeStore challenges, SessionKeystrokeVerifier verifier, TimeProvider clock, IConfiguration config) : ControllerBase
{
    private IActionResult Error(int status, string code, string message, object? details = null) => StatusCode(status, new ApiErrorResponse(new ApiError(code, message, details)));
    private IActionResult Invalid(bool verify, JsonObject errors) => Error(400, "VALIDATION_ERROR", verify ? "Invalid keystroke verification request." : "Invalid keystroke enrollment request.", new { fieldErrors = errors });

    [HttpPost("/enroll/keystroke")]
    public async Task<IActionResult> Enroll([FromBody] JsonElement body)
    {
        var (request, errors) = DynamicKeystrokeParser.Parse(JsonNode.Parse(body.GetRawText()), false);
        if (errors.Count > 0) return Invalid(false, errors);
        try
        {
            var id = Text(request["userId"])!;
            if (await storage.GetLatestConsentAsync(id) is null) return Error(403, "CONSENT_REQUIRED", "Consent required before enrollment.");
            var existing = await storage.GetProfilesAsync(id); var now = Iso(clock.GetUtcNow());
            int Target(string env, string setting, int fallback) => double.TryParse(config[env] ?? config[setting], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) && n > 0 && n < int.MaxValue ? Math.Max(1, (int)Math.Floor(n + .5)) : fallback;
            var result = KeystrokeEnrollment.Build(id, request["sample"]!.AsObject(), existing?["keystroke"] as JsonObject, now,
                Target("KEYSTROKE_ENROLL_MIN_ROUNDS", "Keystroke:MinRounds", 10), Target("KEYSTROKE_ENROLL_MIN_KEYSTROKES", "Keystroke:MinKeystrokes", 160));
            var next = new JsonObject { ["userId"] = id, ["keystroke"] = result["profile"]!.DeepClone(), ["updatedAt"] = now };
            foreach (var key in new[] { "faceReferenceImagePath", "faceReferenceEnrolledAt", "faceEmbedding", "cardReferenceImagePath", "cardReferenceEnrolledAt", "voice", "voiceEmbedding" }) next[key] = existing?[key]?.DeepClone();
            await storage.SaveProfilesAsync(id, next);
            return Ok(result);
        }
        catch (Exception ex) { return Error(500, "INTERNAL_ERROR", "Failed to enroll keystroke profile.", ex.Message); }
    }

    [HttpPost("/verify/keystroke")]
    public async Task<IActionResult> Verify([FromBody] JsonElement body)
    {
        var (request, errors) = DynamicKeystrokeParser.Parse(JsonNode.Parse(body.GetRawText()), true);
        if (errors.Count > 0) return Invalid(true, errors);
        try
        {
            var (challenge, error) = challenges.Consume(Text(request["challengeId"])!);
            if (error is not null) return error switch
            {
                "CHALLENGE_NOT_FOUND" => Error(404, error, "Challenge was not found."),
                "CHALLENGE_EXPIRED" => Error(410, error, "Challenge has expired."),
                _ => Error(409, error, "Challenge has already been consumed.")
            };
            if (challenge!.Text != Text(request["sample"]!["expectedText"])) return Invalid(true, new JsonObject { ["sample.expectedText"] = "sample.expectedText must match the challenge text associated with challengeId." });
            if (challenge.SessionId is { } session && Text(request["sessionId"]) is { Length: > 0 } actual && session != actual) return Invalid(true, new JsonObject { ["sessionId"] = "sessionId must match the session assigned to this challenge." });
            var id = Text(request["userId"])!;
            var result = await verifier.VerifyWithProfileAsync(id, request["sample"]!.AsObject(), request["policy"]!.AsObject());
            var response = new JsonObject { ["ok"] = true, ["userId"] = id, ["profile"] = result.Profile?.DeepClone(), ["profileUpdated"] = result.ProfileUpdated,
                ["signalsUsed"] = new JsonObject { ["keystroke"] = result.Signal.DeepClone() } };
            foreach (var key in new[] { "similarityScore", "distance", "decision", "reasons", "sampleMetrics" }) response[key] = result.Signal[key]?.DeepClone();
            return Ok(response);
        }
        catch (Exception ex) { return Error(500, "INTERNAL_ERROR", "Failed to verify keystroke sample.", ex.Message); }
    }
}
