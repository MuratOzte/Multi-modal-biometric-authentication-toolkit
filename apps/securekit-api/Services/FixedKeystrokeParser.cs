using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public static class FixedKeystrokeParser
{
    public static (JsonObject Request, JsonObject Errors) Parse(JsonNode? body, bool enroll)
    {
        var errors = new JsonObject(); var request = new JsonObject();
        if (body is not (JsonObject or JsonArray)) { errors["body"] = "request body must be an object."; return (request, errors); }
        var obj = body as JsonObject ?? new JsonObject();
        foreach (var key in enroll ? new[] { "userId", "textId", "expectedText" } : new[] { "userId", "textId" })
        {
            var s = Text(obj[key])?.Trim();
            if (string.IsNullOrEmpty(s)) errors[key] = key + " is required and must be a non-empty string.";
            request[key] = s;
        }
        JsonObject? Sample(JsonNode? value, string p)
        {
            if (value is not (JsonObject or JsonArray)) { errors[p] = p + " must be an object."; return null; }
            var source = value as JsonObject ?? new JsonObject();
            var sample = new JsonObject { ["textId"] = Text(source["textId"])?.Trim(), ["text"] = Text(source["text"]) };
            if (string.IsNullOrEmpty(Text(sample["textId"]))) errors[p + ".textId"] = "textId is required.";
            if (string.IsNullOrEmpty(Text(sample["text"]))) errors[p + ".text"] = "text is required.";
            foreach (var key in new[] { "holdMs", "ddMs", "udMs" })
            {
                var path = p + "." + key; var values = new JsonArray();
                if (source[key] is not JsonArray a) errors[path] = path + " must be an array of numbers.";
                else for (var i = 0; i < a.Count; i++) { if (Number(a[i]) is not { } n) errors[$"{path}[{i}]"] = "must be a finite number."; else values.Add(n); }
                sample[key] = values;
            }
            if (source.ContainsKey("corrections"))
            {
                var cp = p + ".corrections";
                if (source["corrections"] is not (JsonObject or JsonArray)) errors[cp] = cp + " must be an object when provided.";
                else
                {
                    var c = source["corrections"] as JsonObject ?? new JsonObject();
                    if (c["events"] is not JsonArray) errors[cp + ".events"] = "events must be an array.";
                    else if (c["events"]!.AsArray().Count > 200) errors[cp + ".events"] = "events must contain at most 200 items.";
                    else
                    {
                        foreach (var key in new[] { "mismatchCount", "extraCount", "backspaceCount" })
                            if (Number(c[key]) is not { } n || n < 0 || n != Math.Truncate(n)) errors[cp + "." + key] = cp + "." + key + " must be a non-negative integer.";
                        var events = c["events"]!.AsArray(); var cleanEvents = new JsonArray();
                        for (var i = 0; i < events.Count; i++)
                        {
                            var ep = $"{cp}.events[{i}]";
                            if (events[i] is not (JsonObject or JsonArray)) { errors[ep] = ep + " must be an object."; continue; }
                            var e = events[i] as JsonObject ?? new JsonObject(); var type = Text(e["type"]); var clean = new JsonObject();
                            if (type is not ("mismatch" or "extra" or "backspace")) errors[ep + ".type"] = "type must be mismatch, extra, or backspace.";
                            if (Number(e["t"]) is null or < 0) errors[ep + ".t"] = "t must be a finite non-negative number.";
                            if (Number(e["index"]) is not { } index || index < 0 || index != Math.Truncate(index)) errors[ep + ".index"] = "index must be a non-negative integer.";
                            foreach (var key in new[] { "type", "t", "index" }) clean[key] = e[key]?.DeepClone();
                            foreach (var key in new[] { "key", "expected", "removed" })
                            {
                                if (e.ContainsKey(key) && Text(e[key]) is null) errors[ep + "." + key] = ep + "." + key + " must be a string when provided.";
                                if (Text(e[key]) is { } s) clean[key] = s;
                            }
                            if (type == "mismatch") foreach (var key in new[] { "key", "expected" }) if (Text(e[key]) is null) errors[ep + "." + key] = key + " is required for mismatch.";
                            if (type == "extra" && Text(e["key"]) is null) errors[ep + ".key"] = "key is required for extra.";
                            if (type == "backspace" && Text(e["removed"]) is null) errors[ep + ".removed"] = "removed is required for backspace.";
                            cleanEvents.Add(clean);
                        }
                        sample["corrections"] = new JsonObject { ["events"] = cleanEvents, ["mismatchCount"] = c["mismatchCount"]?.DeepClone(), ["extraCount"] = c["extraCount"]?.DeepClone(), ["backspaceCount"] = c["backspaceCount"]?.DeepClone() };
                    }
                }
            }
            if (source["meta"] is not (JsonObject or JsonArray)) { errors[p + ".meta"] = "meta is required and must be an object."; return null; }
            var meta = source["meta"] as JsonObject ?? new JsonObject(); var nextMeta = new JsonObject();
            foreach (var key in new[] { "timestamp", "durationMs" })
            {
                if (Number(meta[key]) is not { } n) errors[p + ".meta." + key] = key + " must be a finite number.";
                else nextMeta[key] = n;
            }
            if (meta.ContainsKey("invalid"))
            {
                if (meta["invalid"] is JsonValue v && v.TryGetValue<bool>(out var b)) nextMeta["invalid"] = b;
                else errors[p + ".meta.invalid"] = "invalid must be boolean when provided.";
            }
            if (meta.ContainsKey("invalidReason"))
            {
                if (Text(meta["invalidReason"]) is { } reason) nextMeta["invalidReason"] = reason;
                else errors[p + ".meta.invalidReason"] = "invalidReason must be string when provided.";
            }
            sample["meta"] = nextMeta;
            return sample;
        }
        if (enroll)
        {
            if (obj["samples"] is not JsonArray array || array.Count == 0) errors["samples"] = "samples must be a non-empty array.";
            else { var samples = new JsonArray(); for (var i = 0; i < array.Count; i++) samples.Add(Sample(array[i], $"samples[{i}]")); request["samples"] = samples; }
        }
        else
        {
            request["sample"] = Sample(obj["sample"], "sample");
            if (Text(obj["expectedText"]) is { Length: > 0 } text) request["expectedText"] = text;
            if (obj.ContainsKey("opts"))
            {
                if (obj["opts"] is not (JsonObject or JsonArray)) errors["opts"] = "opts must be an object when provided.";
                else if (obj["opts"] is JsonObject opts && opts.ContainsKey("autoEnroll"))
                {
                    if (opts["autoEnroll"] is JsonValue v && v.TryGetValue<bool>(out var b)) request["autoEnroll"] = b;
                    else errors["opts.autoEnroll"] = "autoEnroll must be boolean when provided.";
                }
            }
        }
        return (request, errors);
    }
}
