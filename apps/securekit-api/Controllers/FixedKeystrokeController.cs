using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class FixedKeystrokeController(FixedKeystrokeStore store, IKeystrokePython python, TimeProvider clock) : ControllerBase
{
    private IActionResult Error(int status, string code, string message, object? details = null) => StatusCode(status, new ApiErrorResponse(new ApiError(code, message, details)));

    [HttpGet("/api/securekit/keystroke/status")]
    public async Task<IActionResult> Status()
    {
        string Query(string key) => Request.Query[key].Count == 1 ? Request.Query[key][0]?.Trim() ?? "" : "";
        var id = Query("userId"); var text = Query("textId");
        if (id.Length == 0 || text.Length == 0) return Error(400, "INVALID_REQUEST", "userId and textId are required.");
        await store.Gate.WaitAsync(HttpContext.RequestAborted);
        try
        {
            var hash = store.UserHash(id); var metadata = await store.ReadAsync(hash, text, true);
            var template = metadata is null ? null : await store.ReadAsync(hash, text);
            var registered = metadata is not null && template is not null;
            return Ok(new { ok = true, userId = id, textId = text, registered, template = registered ? new { expectedText = Text(metadata!["expectedText"]), sampleCount = Number(metadata["sampleCount"]), updatedAt = Number(metadata["updatedAt"]) } : null });
        }
        catch (Exception ex) { return Error(500, "INTERNAL_ERROR", "Failed to read fixed-text keystroke status.", ex.Message); }
        finally { store.Gate.Release(); }
    }

    [HttpPost("/api/securekit/keystroke/enroll")]
    public Task<IActionResult> Enroll([FromBody] JsonElement body) => Execute(body, true);
    [HttpPost("/api/securekit/keystroke/verify")]
    public Task<IActionResult> Verify([FromBody] JsonElement body) => Execute(body, false);

    private async Task<IActionResult> Execute(JsonElement body, bool enroll)
    {
        var (request, errors) = FixedKeystrokeParser.Parse(JsonNode.Parse(body.GetRawText()), enroll);
        if (errors.Count > 0) return Error(400, "INVALID_REQUEST", enroll ? "Invalid keystroke enroll request." : "Invalid keystroke verify request.", new { fieldErrors = errors });
        var token = HttpContext.RequestAborted;
        await store.Gate.WaitAsync(token);
        var callingPython = false;
        try
        {
            var id = Text(request["userId"])!; var textId = Text(request["textId"])!; var hash = store.UserHash(id);
            var template = enroll ? null : await store.ReadAsync(hash, textId);
            if (!enroll && template is null) return Ok(new { ok = true, decision = "reject", score = 0, dist = 9999, autoEnrolled = false, reason = "not_enrolled", metrics = new { count = 0, thresholdDist = 0, thresholdScore = 0, autoEnrollScore = 0 } });
            var expectedHash = enroll ? FixedKeystrokeStore.Hash(Text(request["expectedText"])!) : Text(template!["expectedTextHash"])!;
            if (!enroll && Text(request["expectedText"]) is { } expected && FixedKeystrokeStore.Hash(expected) != expectedHash) throw new KeystrokeFailure("TEXT_MISMATCH", "expectedText hash does not match the enrolled template.");
            var now = clock.GetUtcNow().ToUnixTimeMilliseconds(); var samples = new JsonArray();
            foreach (var s in enroll ? request["samples"]!.AsArray() : new JsonArray(request["sample"]!.DeepClone())) samples.Add(FixedKeystrokeValidation.Normalize(s!.AsObject(), textId, expectedHash, now));
            var opts = new JsonObject { ["stdFloorMs"] = 8, ["autoEnroll"] = !enroll && Truthy(request["autoEnroll"]), ["maxAgeMs"] = 120000, ["nowMs"] = now };
            if (!enroll) opts["minEnroll"] = 10;
            callingPython = true;
            var result = await python.RunAsync(new JsonObject { ["op"] = enroll ? "enroll" : "verify", ["template"] = template?.DeepClone(), ["samples"] = samples, ["opts"] = opts }, token);
            JsonObject BuildTemplate(JsonNode? raw)
            {
                if (raw is not JsonObject t || t["mean"] is not JsonArray mean || t["std"] is not JsonArray std || mean.Any(v => Number(v) is null) || std.Any(v => Number(v) is null)
                    || new[] { "dim", "count", "distThreshold", "scoreK", "autoEnrollScore", "scoreThreshold" }.Any(key => Number(t[key]) is null)) throw Protocol();
                var dim = Math.Floor(Number(t["dim"])!.Value + .5);
                if (dim <= 0 || dim != mean.Count || dim != std.Count || Number(t["count"]) < 1) throw Protocol();
                var next = new JsonObject { ["userIdHash"] = hash, ["textId"] = textId, ["expectedTextHash"] = expectedHash, ["updatedAt"] = now };
                foreach (var key in new[] { "dim", "count", "mean", "std", "distThreshold", "scoreK", "autoEnrollScore", "scoreThreshold" }) next[key] = t[key]!.DeepClone();
                next["dim"] = dim; next["count"] = Math.Floor(Number(t["count"])!.Value + .5);
                return next;
            }
            KeystrokeFailure Protocol() => new("PYTHON_PROTOCOL_ERROR", enroll ? "Unexpected python enroll output." : "Unexpected python verify output.");
            JsonObject Metadata(string expectedText, double count) => new() { ["userId"] = id, ["userIdHash"] = hash, ["textId"] = textId, ["expectedText"] = expectedText, ["expectedTextHash"] = expectedHash, ["sampleCount"] = count, ["updatedAt"] = now };
            if (enroll)
            {
                template = BuildTemplate(result["template"]);
                if (result["recommended"] is not JsonObject recommended || new[] { "distThreshold", "scoreThreshold", "autoEnrollScore" }.Any(k => Number(recommended[k]) is null)) throw Protocol();
                await store.SaveAsync(hash, textId, template, Metadata(Text(request["expectedText"])!, Number(template["count"])!.Value));
                return Ok(new { ok = true, enrolled = true, template = new { count = Number(template["count"]), dim = Number(template["dim"]) }, recommended = new { distThreshold = Number(recommended["distThreshold"]), scoreThreshold = Number(recommended["scoreThreshold"]), autoEnrollScore = Number(recommended["autoEnrollScore"]) } });
            }
            if (Text(result["decision"]) is not ("accept" or "reject") || Number(result["score"]) is null || Number(result["dist"]) is null || result["autoEnrolled"] is not JsonValue auto || !auto.TryGetValue<bool>(out var autoEnrolled)) throw Protocol();
            if (autoEnrolled && result["template"] is not null)
            {
                template = BuildTemplate(result["template"]);
                var metadata = await store.ReadAsync(hash, textId, true);
                var expectedText = Text(metadata?["expectedText"]) ?? Text(request["expectedText"]);
                await store.SaveAsync(hash, textId, template, expectedText is null ? null : Metadata(expectedText, Number(template["count"])!.Value));
            }
            var response = new JsonObject { ["ok"] = true, ["decision"] = result["decision"]!.DeepClone(), ["score"] = result["score"]!.DeepClone(), ["dist"] = result["dist"]!.DeepClone(), ["autoEnrolled"] = autoEnrolled,
                ["metrics"] = new JsonObject { ["count"] = template!["count"]!.DeepClone(), ["thresholdDist"] = template["distThreshold"]!.DeepClone(), ["thresholdScore"] = template["scoreThreshold"]!.DeepClone(), ["autoEnrollScore"] = template["autoEnrollScore"]!.DeepClone() } };
            if (Text(result["reason"]) is { } reason) response["reason"] = reason;
            return Ok(response);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (KeystrokeFailure ex) { return Error(callingPython ? 502 : 400, ex.Code, ex.Message, ex.Details); }
        catch (Exception ex) { return Error(500, "INTERNAL_ERROR", enroll ? "Failed to enroll fixed-text keystroke template." : "Failed to verify fixed-text keystroke sample.", ex.Message); }
        finally { store.Gate.Release(); }
    }
}
