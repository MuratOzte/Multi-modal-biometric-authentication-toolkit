using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

// Apply the Node bridge's schema checks and omit worker-only id/duration fields.
public static class CardResult
{
    private static CardFailure Invalid() => new("PYTHON_OUTPUT_INVALID", "Invalid response received from card verification process.", 502);
    private static bool Boolean(JsonNode? value) => value is JsonValue v && v.TryGetValue<bool>(out var b) ? b : throw Invalid();
    private static string String(JsonNode? value) => Text(value) ?? throw Invalid();
    private static double Numeric(JsonNode? value) => Number(value) ?? throw Invalid();
    private static double Score(JsonNode? value, double min = 0) => Numeric(value) is var n && n >= min && n <= 1 ? n : throw Invalid();
    private static JsonNode? NullableString(JsonObject source, string key) => source.ContainsKey(key) && (source[key] is null || Text(source[key]) is not null) ? source[key]?.DeepClone() : throw Invalid();

    public static JsonObject Normalize(JsonObject raw)
    {
        if (raw["candidates"] is not JsonArray candidates) throw Invalid();
        var result = new JsonObject { ["ok"] = Boolean(raw["ok"]), ["matched"] = Boolean(raw["matched"]),
            ["threshold"] = Numeric(raw["threshold"]), ["checkedCount"] = Numeric(raw["checkedCount"]), ["reason"] = Text(raw["reason"]),
            ["bestMatch"] = raw["bestMatch"] is null ? null : Candidate(raw["bestMatch"]),
            ["candidates"] = new JsonArray(candidates.Select(c => (JsonNode)Candidate(c)).ToArray()),
            ["cardVerificationByClipOld"] = raw["cardVerificationByClipOld"] is JsonObject or JsonArray ? raw["cardVerificationByClipOld"]!.DeepClone() : null };
        foreach (var candidate in result["candidates"]!.AsArray().Concat(new[] { result["bestMatch"] }))
        {
            if (candidate is null || Boolean(candidate["quality"]!["ocrAvailable"])) continue;
            foreach (var key in new[] { "ocrErrorProbe", "ocrErrorReference" })
            {
                var detail = Text(candidate["quality"]![key]);
                var dependency = Regex.Match(detail ?? "", "no module named ['\"](paddleocr|paddle)['\"]", RegexOptions.IgnoreCase);
                if (dependency.Success) throw new CardFailure("PYTHON_PROCESS_ERROR", $"Python card OCR dependency is missing: {dependency.Groups[1].Value}. Install python/card_verification/requirements.txt in the selected Python environment or set CARD_PYTHON_BIN to an environment with PaddleOCR and PaddlePaddle.", 502, detail);
            }
        }
        if (!Boolean(result["ok"]) && Text(result["reason"]) is { Length: > 0 } reason)
            throw reason == "invalid_request" ? Invalid() : new CardFailure("PYTHON_PROCESS_ERROR", "Card verification process failed.", 502);
        return result;
    }
    private static JsonObject Candidate(JsonNode? node)
    {
        if (node is not JsonObject raw || raw["fields"] is not JsonObject fields || raw["quality"] is not JsonObject quality || raw["reasons"] is not JsonArray reasons) throw Invalid();
        var decision = String(raw["decision"]); if (decision is not ("same" or "different" or "uncertain")) throw Invalid();
        var path = String(raw["referenceImagePath"]); var name = String(raw["referenceFileName"]); if (path.Length == 0 || name.Length == 0) throw Invalid();
        var normalizedQuality = new JsonObject();
        foreach (var key in new[] { "cardDetectedProbe", "cardDetectedReference", "ocrAvailable", "ocrWeak" }) normalizedQuality[key] = Boolean(quality[key]);
        foreach (var key in new[] { "detectionConfidenceProbe", "detectionConfidenceReference" }) normalizedQuality[key] = Numeric(quality[key]);
        foreach (var key in new[] { "ocrErrorProbe", "ocrErrorReference" })
        { if (quality[key] is not null && Text(quality[key]) is null) throw Invalid(); normalizedQuality[key] = Text(quality[key]); }
        var result = new JsonObject { ["referenceImagePath"] = path, ["referenceFileName"] = name, ["decision"] = decision,
            ["overallScore"] = Score(raw["overallScore"]), ["contentScore"] = Score(raw["contentScore"]), ["visualScore"] = Score(raw["visualScore"]),
            ["reasons"] = new JsonArray(reasons.Select(r => (JsonNode)JsonValue.Create(String(r))!).ToArray()),
            ["fields"] = new JsonObject { ["probe"] = Fields(fields["probe"]), ["reference"] = Fields(fields["reference"]) },
            ["quality"] = normalizedQuality, ["matched"] = Boolean(raw["matched"]) };
        if (raw.ContainsKey("visualDetails"))
        {
            if (raw["visualDetails"] is not JsonObject visual || Text(visual["activeMethod"]) != "clip") throw Invalid();
            if (!visual.ContainsKey("clipScore") || !visual.ContainsKey("clipCosine")) throw Invalid();
            result["visualDetails"] = new JsonObject { ["activeMethod"] = "clip", ["clipScore"] = visual["clipScore"] is null ? null : Score(visual["clipScore"]),
                ["clipCosine"] = visual["clipCosine"] is null ? null : Score(visual["clipCosine"], -1), ["clipAvailable"] = Boolean(visual["clipAvailable"]),
                ["clipModel"] = NullableString(visual, "clipModel"), ["clipDevice"] = NullableString(visual, "clipDevice"), ["clipError"] = NullableString(visual, "clipError") };
        }
        return result;
    }
    private static JsonObject Fields(JsonNode? node)
    {
        if (node is not JsonObject raw) throw Invalid();
        var result = new JsonObject(); foreach (var key in new[] { "name", "studentNo", "cardNo", "validThru" }) result[key] = String(raw[key]);
        result["documentNo"] = Text(raw["documentNo"]) ?? ""; return result;
    }
}
