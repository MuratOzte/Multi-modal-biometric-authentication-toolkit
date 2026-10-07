using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public sealed class SessionKeystrokeVerifier(IProfileStorage storage, TimeProvider clock)
{
    private static readonly (string Sample, string Mean, string? Std, double Min, double Weight, double? Fixed)[] Features = [
        ("holdMeanMs", "holdMeanMs", "holdStdMs", 8, 1.2, null), ("flightMeanMs", "flightMeanMs", "flightStdMs", 8, 1, null),
        ("ddMeanMs", "ddMeanMs", "ddStdMs", 8, .8, null), ("udMeanMs", "udMeanMs", "udStdMs", 8, 1, null), ("uuMeanMs", "uuMeanMs", "uuStdMs", 8, .6, null),
        ("typingSpeedCharsPerSec", "typingSpeedMean", "typingSpeedStd", .3, .5, null), ("startDelayMs", "startDelayMean", "startDelayStd", 40, .7, null),
        ("interWordPauseMeanMs", "interWordPauseMean", "interWordPauseStd", 35, .8, null), ("errorRate", "errorRateMean", null, .05, .5, .08),
        ("backspaceRate", "backspaceRateMean", null, .05, .4, .1), ("longPauseRate", "longPauseRateMean", null, .03, .4, .08),
        ("correctionBurstRate", "correctionBurstRateMean", null, .03, .35, .08) ];

    public async Task<JsonObject> VerifyAsync(string userId, JsonObject sample, JsonObject policy)
        => (await VerifyWithProfileAsync(userId, sample, policy)).Signal;

    public async Task<(JsonObject Signal, JsonObject? Profile, bool ProfileUpdated)> VerifyWithProfileAsync(string userId, JsonObject sample, JsonObject policy)
    {
        var (metrics, reasons) = KeystrokeMetrics.Compute(sample);
        var allow = Math.Clamp(Number(policy["allowThreshold"]) ?? .77, .1, .99);
        var stepUp = Math.Clamp(Number(policy["stepUpThreshold"]) ?? .56, .05, allow);
        var deny = Math.Clamp(Number(policy["denyThreshold"]) ?? .36, 0, stepUp);
        var thresholds = new JsonObject { ["allowThreshold"] = allow, ["stepUpThreshold"] = stepUp, ["denyThreshold"] = deny };
        var profiles = await storage.GetProfilesAsync(userId);
        var profile = profiles?["keystroke"] as JsonObject;
        var profileUpdated = false;
        var distance = 10.0; var similarity = 0.0; var decision = "step_up";
        if (profile is null) reasons.Add("PROFILE_MISSING");
        else
        {
            var rounds = Rounds(profile);
            var minRounds = Positive(policy["minEnrollmentRounds"], 8);
            var minKeys = Positive(policy["minEnrollmentKeystrokes"], 120);
            var minDigraphs = Positive(policy["minDigraphCount"], 40);
            var ready = true;
            if (rounds < minRounds && (Number(profile["sampleCount"]) ?? 0) < minKeys) { reasons.Add("INSUFFICIENT_SAMPLES"); ready = false; }
            if ((Number(profile["digraphCount"]) ?? 0) < minDigraphs) { reasons.Add("LOW_DIGRAPH_COVERAGE"); ready = false; }
            double sum = 0, weight = 0; var used = 0;
            foreach (var feature in Features)
            {
                if (Number(profile[feature.Mean]) is not { } mean || Number(metrics[feature.Sample]) is not { } value) continue;
                var std = feature.Fixed ?? (feature.Std is null ? null : Number(profile[feature.Std]));
                var scale = std is null ? feature.Min : Math.Max(feature.Min, Math.Abs(std.Value));
                sum += Math.Pow(value - mean, 2) / Math.Pow(scale, 2) * feature.Weight; weight += feature.Weight; used++;
            }
            distance = used == 0 || weight <= 0 ? 10 : Math.Sqrt(sum / weight);
            similarity = double.IsFinite(distance) && distance >= 0 ? Math.Clamp(Math.Exp(-.9 * distance), 0, 1) : 0;
            decision = similarity >= allow ? "allow" : similarity < deny ? "deny" : "step_up";
            if (used < 3) reasons.Add("INSUFFICIENT_SAMPLES");
            if (distance > 2.2) reasons.Add("HIGH_DISTANCE");
            if (similarity < stepUp) reasons.Add("LOW_SIMILARITY");
            if (!ready && decision == "allow") decision = "step_up";
            if (decision == "allow" && (policy["updateProfileOnAllow"] is null || Truthy(policy["updateProfileOnAllow"])))
            {
                var now = Iso(clock.GetUtcNow());
                var next = Update(profile, metrics, policy, now);
                var updated = new JsonObject { ["userId"] = userId, ["keystroke"] = next, ["updatedAt"] = now };
                foreach (var key in new[] { "faceReferenceImagePath", "faceReferenceEnrolledAt", "faceEmbedding", "cardReferenceImagePath", "cardReferenceEnrolledAt", "voice", "voiceEmbedding" }) updated[key] = profiles?[key]?.DeepClone();
                await storage.SaveProfilesAsync(userId, updated);
                profile = next;
                profileUpdated = true;
            }
        }
        return (new JsonObject { ["similarityScore"] = Round(similarity), ["distance"] = Round(distance), ["decision"] = decision,
            ["reasons"] = Strings(reasons.Distinct()), ["sampleMetrics"] = metrics, ["thresholds"] = thresholds }, profile, profileUpdated);
    }
    private static double Positive(JsonNode? value, double fallback) => Number(value) is > 0 and var n ? Math.Floor(n + .5) : fallback;
    private static double Rounds(JsonObject profile) => Number(profile["sampleRoundCount"]) is > 0 and var n ? Math.Floor(n + .5) : (Number(profile["sampleCount"]) ?? 0) > 0 ? 1 : 0;
    private static JsonObject Update(JsonObject profile, JsonObject metrics, JsonObject policy, string now)
    {
        var next = (JsonObject)profile.DeepClone(); var alpha = Math.Clamp(Number(policy["profileUpdateAlpha"]) ?? .08, .01, .5);
        var oldWeight = Math.Max(1, Number(profile["sampleCount"]) ?? 0); var newWeight = Math.Max(1, Number(metrics["keystrokeCount"]) ?? 0);
        void Ema(string meanKey, string stdKey, string sampleKey, double fallbackMean, double fallbackStd)
        {
            var mean = Number(profile[meanKey]) ?? fallbackMean; var std = Number(profile[stdKey]) ?? fallbackStd; var value = Number(metrics[sampleKey]) ?? 0;
            next[meanKey] = Round(mean + alpha * (value - mean));
            next[stdKey] = Round(Math.Sqrt(Math.Max(0, (1 - alpha) * Math.Pow(Math.Max(0, std), 2) + alpha * Math.Pow(value - mean, 2))));
        }
        foreach (var prefix in new[] { "hold", "flight", "dd", "ud", "uu" })
        {
            Ema(prefix + "MeanMs", prefix + "StdMs", prefix + "MeanMs", Number(profile["flightMeanMs"]) ?? 0, Number(profile["flightStdMs"]) ?? 0);
            var sampleMedian = Number(metrics[prefix + "MedianMs"]) ?? 0;
            next[prefix + "MedianMs"] = Round(Number(profile[prefix + "MedianMs"]) is { } oldMedian ? (oldMedian * oldWeight + sampleMedian * newWeight) / (oldWeight + newWeight) : sampleMedian);
        }
        Ema("typingSpeedMean", "typingSpeedStd", "typingSpeedCharsPerSec", 0, 0);
        Ema("startDelayMean", "startDelayStd", "startDelayMs", Number(metrics["startDelayMs"]) ?? 0, 0);
        Ema("interWordPauseMean", "interWordPauseStd", "interWordPauseMeanMs", Number(metrics["interWordPauseMeanMs"]) ?? 0, 0);
        foreach (var prefix in new[] { "errorRate", "backspaceRate", "longPauseRate", "correctionBurstRate" })
        { var mean = Number(profile[prefix + "Mean"]) ?? 0; next[prefix + "Mean"] = Round(mean + alpha * ((Number(metrics[prefix]) ?? 0) - mean)); }
        next["updatedAt"] = now; next["sampleCount"] = oldWeight + newWeight; next["sampleRoundCount"] = Rounds(profile) + 1;
        next["digraphCount"] = Math.Max(0, (Number(profile["digraphCount"]) ?? 0) + (Number(metrics["digraphCount"]) ?? 0));
        return next;
    }
}
