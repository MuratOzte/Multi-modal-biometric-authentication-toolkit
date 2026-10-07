using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public sealed class KeystrokeFailure(string code, string message, object? details = null) : Exception(message)
{
    public string Code { get; } = code;
    public object? Details { get; } = details;
}

public static class FixedKeystrokeValidation
{
    public static JsonObject Normalize(JsonObject input, string textId, string hash, long now)
    {
        var sample = input.DeepClone().AsObject(); var meta = sample["meta"]!.AsObject();
        if (sample["corrections"] is JsonObject c)
            foreach (var (type, key) in new[] { ("mismatch", "mismatchCount"), ("extra", "extraCount"), ("backspace", "backspaceCount") })
                c[key] = c["events"]!.AsArray().Count(e => Text(e?["type"]) == type);
        void Fail(string code, string message, object? details = null) => throw new KeystrokeFailure(code, message, details);
        if (Truthy(meta["invalid"])) Fail("INVALID_SAMPLE", "sample meta.invalid flagged true.");
        if (Text(meta["invalidReason"])?.Contains("backspace", StringComparison.OrdinalIgnoreCase) == true) Fail("INVALID_SAMPLE", "sample marked invalid due to backspace usage.");
        if (Text(sample["textId"]) != textId) Fail("TEXT_ID_MISMATCH", "sample.textId does not match route textId.", new { sampleTextId = Text(sample["textId"]), expectedTextId = textId });
        if (FixedKeystrokeStore.Hash(Text(sample["text"])!) != hash) Fail("TEXT_MISMATCH", "sample.text does not match expected text hash.");
        var wordCount = Regex.Split(Text(sample["text"])!.Trim(), @"\s+").Count(s => s.Length > 0);
        if (wordCount < 3) Fail("OUT_OF_RANGE", "text must contain at least 3 words.", new { wordCount, minWordCount = 3 });
        var hold = sample["holdMs"]!.AsArray(); var dd = sample["ddMs"]!.AsArray(); var ud = sample["udMs"]!.AsArray();
        if (dd.Count != Math.Max(0, hold.Count - 1) || ud.Count != Math.Max(0, hold.Count - 1)) Fail("LENGTH_MISMATCH", "hold/dd/ud lengths are inconsistent.", new { holdLength = hold.Count, ddLength = dd.Count, udLength = ud.Count });
        if (hold.Count < 15 || hold.Count > 30) Fail("OUT_OF_RANGE", "hold length must be in [15, 30].", new { holdLength = hold.Count });
        var duration = Number(meta["durationMs"])!.Value;
        if (duration < 800 || duration > 20000) Fail("OUT_OF_RANGE", "meta.durationMs must be in [800, 20000].", new { durationMs = duration });
        var age = now - Number(meta["timestamp"])!.Value;
        if (age > 120000) Fail("REPLAY_REJECTED", "sample timestamp is too old.", new { ageMs = age, maxAgeMs = 120000 });
        if (age < -10000) Fail("REPLAY_REJECTED", "sample timestamp is too far in the future.", new { ageMs = age, maxFutureSkewMs = 10000 });
        if (hold.Any(v => Number(v) is null or < 0)) Fail("INVALID_SAMPLE", "holdMs must contain only finite non-negative numbers.");
        int Clamp(JsonArray a) { var count = 0; for (var i = 0; i < a.Count; i++) if (Number(a[i]) < 0) { a[i] = 0; count++; } return count; }
        var clampedDd = Clamp(dd); var clampedUd = Clamp(ud);
        var ddRatio = dd.Count > 0 ? (double)clampedDd / dd.Count : 0; var udRatio = ud.Count > 0 ? (double)clampedUd / ud.Count : 0;
        if (ddRatio > .2 || udRatio > 1) Fail("INVALID_SAMPLE", "too many negative dd/ud transitions were clamped.", new { clampedDd, ddLength = dd.Count, ddRatio, clampedUd, udLength = ud.Count, udRatio });
        return sample;
    }
}
