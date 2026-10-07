using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

// Port of core/biometrics/keystrokeMetricEvents and keystrokeMetricStatistics.
public static class KeystrokeMetrics
{
    private sealed record Event(string? Key, string? Code, string Type, double T, double? Index, double? Location);
    private sealed record Pair(double Down, double Up);
    private static readonly HashSet<string> Modifiers = ["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock"];
    private static bool Space(Event e) => e.Key == " " || e.Code == "Space";
    private static bool Backspace(Event e) => e.Key == "Backspace" || e.Code == "Backspace";
    private static bool TextDown(Event e) => e.Type == "down" && !Space(e) && !Backspace(e) && e.Key != "Enter" && e.Code != "Enter" && (e.Key is null || e.Key.Length == 1);

    public static (JsonObject Metrics, List<string> Reasons) Compute(JsonObject sample)
    {
        if (sample["events"] is not null and not JsonArray) throw new InvalidOperationException("events must be an array.");
        var raw = sample["events"] as JsonArray ?? new JsonArray();
        var events = new List<Event>();
        foreach (var value in raw)
        {
            if (value is not JsonObject e) throw new InvalidOperationException("Invalid keystroke event.");
            var type = Text(e["type"]);
            var t = Number(e["t"]);
            var key = Text(e["key"]);
            if (type is not ("down" or "up") || t is null or < 0 || Truthy(e["isRepeat"]) || (key is not null && Modifiers.Contains(key))) continue;
            events.Add(new Event(key, Text(e["code"]), type, t.Value, Number(e["expectedIndex"]), Number(e["location"])));
        }
        events = events.OrderBy(e => e.T).ThenBy(e => e.Type == "down" ? 0 : 1).ToList();
        var queues = new Dictionary<string, Queue<double>>();
        var pairs = new List<Pair>();
        for (var i = 0; i < events.Count; i++)
        {
            var e = events[i];
            var index = e.Index is { } n && n == Math.Truncate(n) ? "idx:" + n.ToString(System.Globalization.CultureInfo.InvariantCulture) : "idx:auto:" + i;
            var token = (string.IsNullOrEmpty(e.Code) ? "code:none" : e.Code) + "|" + (string.IsNullOrEmpty(e.Key) ? "key:none" : e.Key) + "|" + index + "|" + e.Location;
            if (e.Type == "down")
            {
                if (!queues.TryGetValue(token, out var q)) queues[token] = q = new Queue<double>();
                q.Enqueue(e.T);
            }
            else if (queues.TryGetValue(token, out var q) && q.TryDequeue(out var down) && e.T >= down) pairs.Add(new Pair(down, e.T));
        }
        pairs = pairs.OrderBy(p => p.Down).ToList();
        var hold = pairs.Select(p => p.Up - p.Down).ToList();
        var dd = new List<double>(); var ud = new List<double>(); var uu = new List<double>();
        for (var i = 1; i < pairs.Count; i++)
        {
            if (pairs[i].Down - pairs[i - 1].Down >= 0) dd.Add(pairs[i].Down - pairs[i - 1].Down);
            if (pairs[i].Down - pairs[i - 1].Up >= 0) ud.Add(pairs[i].Down - pairs[i - 1].Up);
        }
        var ups = pairs.OrderBy(p => p.Up).ToArray();
        for (var i = 1; i < ups.Length; i++) uu.Add(ups[i].Up - ups[i - 1].Up);
        var pauses = new List<double>();
        for (var i = 0; i < events.Count; i++)
        {
            if (events[i].Type != "up" || !Space(events[i])) continue;
            var next = events.Skip(i + 1).FirstOrDefault(TextDown);
            if (next is not null && next.T >= events[i].T) pauses.Add(next.T - events[i].T);
        }
        var duration = events.Count < 2 ? 0 : Round(events[^1].T - events[0].T);
        var typed = Number(sample["typedLength"]) is > 0 and var length ? Math.Floor(length + .5) : Text(sample["expectedText"]) is { Length: > 0 } text ? text.Length : pairs.Count;
        var downs = events.Where(TextDown).ToList();
        var longPauses = downs.Zip(downs.Skip(1), (a, b) => b.T - a.T).Count(gap => gap > 700);
        var correction = events.Where(e => e.Type == "down" && Backspace(e)).Select(e => e.T).ToList();
        var bursts = 0; var previous = double.NegativeInfinity;
        foreach (var t in correction) { if (t - previous > 350) bursts++; previous = t; }
        var metrics = new JsonObject();
        var trimmed = false;
        foreach (var (prefix, values) in new[] { ("hold", hold), ("flight", ud.Count > 0 ? ud : dd), ("dd", dd), ("ud", ud), ("uu", uu), ("interWordPause", pauses) })
        {
            var sorted = values.Where(v => double.IsFinite(v) && v >= 0).Order().ToArray();
            var bucket = sorted;
            if (sorted.Length >= 10)
            {
                var start = (int)Math.Floor(sorted.Length * .05); var end = (int)Math.Ceiling(sorted.Length * .95);
                var slice = sorted[start..end];
                if (slice.Length >= 3) { bucket = slice; trimmed |= slice.Length != sorted.Length; }
            }
            var mean = bucket.Length == 0 ? 0 : bucket.Average();
            var std = bucket.Length < 2 ? 0 : Math.Sqrt(bucket.Average(v => (v - mean) * (v - mean)));
            var median = bucket.Length == 0 ? 0 : bucket.Length % 2 == 0 ? (bucket[bucket.Length / 2 - 1] + bucket[bucket.Length / 2]) / 2 : bucket[bucket.Length / 2];
            metrics[prefix + "MeanMs"] = Round(mean); metrics[prefix + "StdMs"] = Round(std); metrics[prefix + "MedianMs"] = Round(median);
        }
        metrics["typingSpeedCharsPerSec"] = duration > 0 ? Round(typed / (duration / 1000)) : 0;
        metrics["errorRate"] = typed > 0 ? Round(Math.Clamp(Count(sample["errorCount"]) / typed, 0, 1)) : 0;
        metrics["backspaceRate"] = typed > 0 ? Round(Math.Clamp(Count(sample["backspaceCount"]) / typed, 0, 1)) : 0;
        metrics["digraphCount"] = dd.Count; metrics["keystrokeCount"] = pairs.Count; metrics["eventCount"] = raw.Count;
        metrics["durationMs"] = duration;
        metrics["startDelayMs"] = Round((events.FirstOrDefault(TextDown) ?? events.FirstOrDefault(e => e.Type == "down"))?.T ?? 0);
        metrics["interWordPauseCount"] = pauses.Count;
        metrics["longPauseRate"] = downs.Count < 2 ? 0 : Round((double)longPauses / (downs.Count - 1));
        metrics["correctionBurstRate"] = typed <= 0 ? bursts : Round(Math.Clamp(bursts / typed, 0, 1));
        var reasons = new List<string>();
        if (trimmed) reasons.Add("OUTLIER_TRIMMED");
        if (Truthy(sample["imeCompositionUsed"])) reasons.Add("IME_COMPOSITION_DETECTED");
        if (pairs.Count < 3) reasons.Add("INSUFFICIENT_SAMPLES");
        if (dd.Count < 2 || ud.Count < 2) reasons.Add("LOW_DIGRAPH_COVERAGE");
        return (metrics, reasons);
    }
}
