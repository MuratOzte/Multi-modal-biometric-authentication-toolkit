using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public static class KeystrokeEnrollment
{
    public static JsonObject Build(string userId, JsonObject sample, JsonObject? existing, string now, int minRounds, int minKeys)
    {
        var (metrics, reasons) = KeystrokeMetrics.Compute(sample);
        var weight = Math.Max(1, Number(metrics["keystrokeCount"]) ?? 0);
        var oldWeight = Math.Max(0, Number(existing?["sampleCount"]) ?? 0);
        var merge = existing is not null && oldWeight > 0;
        var profile = merge ? existing!.DeepClone().AsObject() : new JsonObject { ["userId"] = userId, ["createdAt"] = now };
        profile["updatedAt"] = now;
        profile["sampleCount"] = oldWeight + weight;
        var rounds = merge ? (Number(existing!["sampleRoundCount"]) is > 0 and var r ? Math.Floor(r + .5) : 1) + 1 : 1;
        profile["sampleRoundCount"] = rounds;
        double Weighted(double? old, double value) => !merge || old is null ? Round(value) : Round((old.Value * oldWeight + value * weight) / (oldWeight + weight));
        void MeanStd(string meanKey, string stdKey, string sampleMean, string sampleStd, double fallbackMean, double fallbackStd)
        {
            var mean = Number(metrics[sampleMean]) ?? 0;
            var std = Number(metrics[sampleStd]) ?? 0;
            if (!merge) { profile[meanKey] = mean; profile[stdKey] = std; return; }
            var oldMean = Number(existing![meanKey]) ?? fallbackMean;
            var oldStd = Number(existing[stdKey]) ?? fallbackStd;
            var combined = (oldMean * oldWeight + mean * weight) / (oldWeight + weight);
            profile[meanKey] = Round(combined);
            profile[stdKey] = Round(Math.Sqrt(((Math.Pow(Math.Max(0, oldStd), 2) + Math.Pow(oldMean - combined, 2)) * oldWeight
                + (Math.Pow(Math.Max(0, std), 2) + Math.Pow(mean - combined, 2)) * weight) / (oldWeight + weight)));
        }
        foreach (var prefix in new[] { "hold", "flight", "dd", "ud", "uu" })
        {
            MeanStd(prefix + "MeanMs", prefix + "StdMs", prefix + "MeanMs", prefix + "StdMs", Number(existing?["flightMeanMs"]) ?? 0, Number(existing?["flightStdMs"]) ?? 0);
            profile[prefix + "MedianMs"] = Weighted(Number(existing?[prefix + "MedianMs"]), Number(metrics[prefix + "MedianMs"]) ?? 0);
        }
        profile["digraphCount"] = Math.Max(0, (merge ? Number(existing?["digraphCount"]) ?? 0 : 0) + (Number(metrics["digraphCount"]) ?? 0));
        profile["typingSpeedMean"] = Weighted(Number(existing?["typingSpeedMean"]), Number(metrics["typingSpeedCharsPerSec"]) ?? 0);
        profile["typingSpeedStd"] = Weighted(Number(existing?["typingSpeedStd"]), 0);
        MeanStd("startDelayMean", "startDelayStd", "startDelayMs", "unused", Number(metrics["startDelayMs"]) ?? 0, 0);
        MeanStd("interWordPauseMean", "interWordPauseStd", "interWordPauseMeanMs", "interWordPauseStdMs", Number(metrics["interWordPauseMeanMs"]) ?? 0, 0);
        foreach (var prefix in new[] { "errorRate", "backspaceRate", "longPauseRate", "correctionBurstRate" })
            profile[prefix + "Mean"] = Weighted(Number(existing?[prefix + "Mean"]), Number(metrics[prefix]) ?? 0);
        var keys = Math.Max(0, Math.Floor((Number(profile["sampleCount"]) ?? 0) + .5));
        var ready = rounds >= minRounds || keys >= minKeys;
        if (!ready) reasons.Add("INSUFFICIENT_SAMPLES");
        return new JsonObject { ["ok"] = true, ["profile"] = profile, ["sampleMetrics"] = metrics, ["reasons"] = Strings(reasons.Distinct()),
            ["enrollmentProgress"] = new JsonObject { ["roundsCompleted"] = rounds, ["roundsTarget"] = minRounds, ["roundsRemaining"] = Math.Max(0, minRounds - rounds),
                ["keystrokesCollected"] = keys, ["keystrokesTarget"] = minKeys, ["keystrokesRemaining"] = Math.Max(0, minKeys - keys), ["ready"] = ready } };
    }
}
