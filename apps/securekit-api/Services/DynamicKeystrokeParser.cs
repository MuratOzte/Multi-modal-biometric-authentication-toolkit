using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public static class DynamicKeystrokeParser
{
    public static (JsonObject Request, JsonObject Errors) Parse(JsonNode? body, bool verify)
    {
        var errors = new JsonObject(); var request = new JsonObject();
        if (body is not (JsonObject or JsonArray)) { errors["body"] = "Request body must be an object."; return (request, errors); }
        var obj = body as JsonObject ?? new JsonObject();
        var id = Text(obj["userId"])?.Trim();
        if (string.IsNullOrEmpty(id)) errors["userId"] = "userId is required.";
        request["userId"] = id;
        JsonArray Events(JsonNode? value, string path)
        {
            var result = new JsonArray();
            if (value is not JsonArray array || array.Count == 0) { errors[path] = path + " must be a non-empty array."; return result; }
            for (var i = 0; i < array.Count; i++)
            {
                var p = $"{path}[{i}]";
                if (array[i] is not (JsonObject or JsonArray)) { errors[p] = "Each event must be an object."; continue; }
                var e = array[i] as JsonObject ?? new JsonObject(); var next = new JsonObject();
                foreach (var key in new[] { "key", "code" })
                {
                    if (!e.ContainsKey(key)) continue;
                    var s = Text(e[key]);
                    if (s is null || (key == "code" ? s.Trim().Length : s.Length) == 0) errors[p + "." + key] = key + " must be a non-empty string when provided.";
                    else next[key] = key == "code" ? s.Trim() : s;
                }
                if (Text(e["type"]) is not ("down" or "up")) errors[p + ".type"] = "type must be 'down' or 'up'.";
                if (Number(e["t"]) is null) errors[p + ".t"] = "t must be a finite number.";
                next["type"] = e["type"]?.DeepClone(); next["t"] = e["t"]?.DeepClone();
                if (e.ContainsKey("isRepeat") && e["isRepeat"] is not JsonValue) errors[p + ".isRepeat"] = "isRepeat must be a boolean when provided.";
                else if (e.ContainsKey("isRepeat") && !(e["isRepeat"] as JsonValue)!.TryGetValue<bool>(out _)) errors[p + ".isRepeat"] = "isRepeat must be a boolean when provided.";
                else if (e.ContainsKey("isRepeat")) next["isRepeat"] = e["isRepeat"]?.DeepClone();
                foreach (var key in new[] { "location", "expectedIndex" })
                {
                    if (!e.ContainsKey(key)) continue;
                    if (Number(e[key]) is not { } n || (key == "expectedIndex" && n != Math.Truncate(n)))
                        errors[p + "." + key] = key + (key == "expectedIndex" ? " must be an integer when provided." : " must be a finite number when provided.");
                    else next[key] = n;
                }
                result.Add(next);
            }
            return result;
        }
        JsonObject Sample(JsonObject source, JsonArray events)
        {
            var s = new JsonObject { ["events"] = events };
            foreach (var key in new[] { "expectedText", "source" }) if (Text(source[key]) is { } t && (key != "source" || t is "legacy" or "collector_v1")) s[key] = t;
            foreach (var key in new[] { "typedLength", "errorCount", "backspaceCount", "ignoredEventCount" }) if (Number(source[key]) is { } n) s[key] = n;
            if (source["imeCompositionUsed"] is JsonValue v && v.TryGetValue<bool>(out var b)) s["imeCompositionUsed"] = b;
            return s;
        }
        if (verify && obj["sample"] is not (JsonObject or JsonArray)) { errors["sample"] = "sample is required and must be an object."; return (request, errors); }
        JsonObject? sample = null;
        if (obj.ContainsKey("sample"))
        {
            if (obj["sample"] is not (JsonObject or JsonArray)) errors["sample"] = "sample must be an object when provided.";
            else
            {
                var source = obj["sample"] as JsonObject ?? new JsonObject();
                var events = Events(source["events"], "sample.events");
                if (verify || source["events"] is JsonArray { Count: > 0 }) sample = Sample(source, events);
            }
        }
        if (!verify)
        {
            sample ??= Sample(obj, Events(obj["events"], "events"));
            var top = Sample(obj, new JsonArray());
            foreach (var key in new[] { "expectedText", "typedLength", "errorCount", "backspaceCount", "imeCompositionUsed" }) if (top.ContainsKey(key)) sample[key] = top[key]?.DeepClone();
        }
        string? Challenge(JsonObject source, string path)
        {
            if (!source.ContainsKey("challengeId")) return null;
            var c = Text(source["challengeId"])?.Trim();
            if (string.IsNullOrEmpty(c)) errors[path] = path + " must be a non-empty string when provided.";
            return c;
        }
        var challenge = Challenge(obj, "challengeId");
        if (verify)
        {
            var source = obj["sample"] as JsonObject ?? new JsonObject();
            var nested = Challenge(source, "sample.challengeId");
            if (!string.IsNullOrEmpty(challenge) && !string.IsNullOrEmpty(nested) && challenge != nested) errors["sample.challengeId"] = "sample.challengeId must match challengeId when both are provided.";
            challenge = string.IsNullOrEmpty(challenge) ? nested : challenge;
            if (string.IsNullOrEmpty(challenge)) errors["challengeId"] = "challengeId is required for verification.";
            if (string.IsNullOrEmpty(Text(source["expectedText"]))) errors["sample.expectedText"] = "sample.expectedText is required for verification.";
            if (obj.ContainsKey("policy") && obj["policy"] is not (JsonObject or JsonArray)) errors["policy"] = "policy must be an object when provided.";
            request["policy"] = (obj["policy"] as JsonObject)?.DeepClone() ?? new JsonObject();
            request["sessionId"] = Text(obj["sessionId"])?.Trim();
        }
        request["challengeId"] = challenge; request["sample"] = sample;
        return (request, errors);
    }
}
