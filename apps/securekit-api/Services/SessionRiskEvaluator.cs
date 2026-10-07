using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public sealed class SessionRiskEvaluator(SessionKeystrokeVerifier keystroke)
{
    public static JsonObject RequiredStep(string step)
    {
        var (title, instruction) = step switch {
            "network" => ("Network Check", "Complete network verification."), "location" => ("Location Check", "Complete location verification."),
            "keystroke" => ("Typing Check", "Type the shown text naturally."), "face" => ("Face Liveness", "Follow the on-screen liveness instructions."),
            "voice" => ("Voice Check", "Read the shown text clearly."), "object" => ("Object Check", "Show the requested object to the camera."),
            "passkey" => ("Passkey", "Confirm with your passkey."), _ => (null, (string?)null) };
        var result = new JsonObject { ["step"] = step };
        if (title is not null) result["ui"] = new JsonObject { ["title"] = title, ["instruction"] = instruction };
        return result;
    }

    public async Task<JsonObject> EvaluateAsync(SessionRecord record, string? userId, JsonObject? policy)
    {
        policy ??= new JsonObject();
        var allow = Number(policy["allowMaxRisk"]) ?? 30; var deny = Number(policy["denyMinRisk"]) ?? 85;
        var used = new JsonObject(); var reasons = new List<string>(); var risk = 0.0;
        var network = record.Signals["network"] as JsonObject;
        var location = record.Signals["location"] as JsonObject;
        var voice = record.Signals["voice"] as JsonObject;
        if (network is not null)
        {
            used["network"] = network.DeepClone();
            risk += (100 - Trust(Number(network["score"]) ?? 0)) * .7;
            if (network["flags"] is not JsonObject flags) throw new InvalidOperationException("network.flags is required.");
            foreach (var (flag, reason) in new[] { ("vpn", "VPN_DETECTED"), ("proxy", "PROXY_DETECTED"), ("tor", "TOR_DETECTED"), ("relay", "RELAY_DETECTED"), ("hosting", "HOSTING_DETECTED"), ("suspicious", "SUSPICIOUS_NETWORK") })
                if (Truthy(flags[flag])) reasons.Add(reason);
            reasons.AddRange(Reasons(network["reasons"]));
        }
        if (location is not null)
        {
            var normalized = (JsonObject)location.DeepClone();
            var country = Text(location["countryCode"])?.Trim().ToUpperInvariant();
            if (country?.Length == 0) country = null;
            var countries = policy["allowedCountries"] is JsonArray list ? list.Select(c => Text(c)?.Trim().ToUpperInvariant()).Where(c => !string.IsNullOrEmpty(c)).ToArray() : [];
            var locationReasons = location["reasons"] is null ? new List<string>() : Reasons(location["reasons"]).Distinct().ToList();
            var allowed = countries.Length == 0 || country is not null && countries.Contains(country);
            if (allowed) locationReasons.Remove("COUNTRY_NOT_ALLOWED"); else if (!locationReasons.Contains("COUNTRY_NOT_ALLOWED")) locationReasons.Add("COUNTRY_NOT_ALLOWED");
            normalized["countryCode"] = country; normalized["allowed"] = allowed; normalized["reasons"] = Strings(locationReasons);
            used["location"] = normalized;
            if (!allowed) { risk += 28; reasons.Add("COUNTRY_NOT_ALLOWED"); }
        }
        if (network is not null && Number(policy["minNetworkScore"]) is { } minimum)
        {
            var trust = Trust(Number(network["score"]) ?? 0); minimum = Trust(minimum);
            if (trust < minimum) { risk += (minimum - trust) * .5; reasons.Add("NETWORK_SCORE_BELOW_MIN"); }
        }
        if (Truthy(policy["treatVpnAsFailure"]) && network?["flags"] is JsonObject networkFlags && Truthy(networkFlags["vpn"]))
        { risk = Math.Max(risk, deny); reasons.Add("VPN_TREATED_AS_FAILURE"); }
        var score = Math.Clamp(Math.Floor(risk + .5), 0, 100);
        var decision = score <= allow ? "allow" : score >= deny ? "deny" : "step-up";
        var steps = new JsonArray();
        if (decision == "step-up")
        {
            if (policy["stepUpSteps"] is not null and not JsonArray) throw new InvalidOperationException("stepUpSteps must be an array.");
            var configured = policy["stepUpSteps"] is JsonArray configuredSteps ? configuredSteps.Select(s => Text(s) ?? "").Where(s => s is not ("network" or "location")).ToArray() : ["keystroke"];
            foreach (var step in configured.Length > 0 ? configured : ["keystroke"]) steps.Add(RequiredStep(step));
        }
        reasons.Add(decision switch { "allow" => "RISK_WITHIN_ALLOW_MAX", "deny" => "RISK_AT_OR_ABOVE_DENY_MIN", _ => "RISK_REQUIRES_STEP_UP" });
        var keyPolicy = policy["keystroke"] as JsonObject;
        if (Truthy(keyPolicy?["enabled"]) && record.Signals["keystroke"] is JsonObject sample)
        {
            if (string.IsNullOrEmpty(userId)) reasons.Add("USER_ID_REQUIRED");
            else
            {
                var signal = await keystroke.VerifyAsync(userId, sample, keyPolicy!);
                used["keystroke"] = signal;
                reasons.AddRange(Reasons(signal["reasons"]));
                if (Text(signal["decision"]) == "deny") { decision = "deny"; steps = new JsonArray(); reasons.Add("KEYSTROKE_DENY"); }
                else if (Text(signal["decision"]) == "step_up" && decision == "allow")
                { decision = "step-up"; steps = new JsonArray(RequiredStep("keystroke")); reasons.Add("KEYSTROKE_STEP_UP"); }
            }
        }
        if (voice is not null)
        {
            used["voice"] = voice.DeepClone();
            if (policy["voice"] is JsonObject voicePolicy && Truthy(voicePolicy["enabled"]))
            {
                reasons.AddRange(Reasons(voice["reasons"]));
                if (Text(voice["decision"]) == "deny") { decision = "deny"; steps = new JsonArray(); reasons.Add("VOICE_DENY"); }
                else if (Text(voice["decision"]) == "step_up" && decision == "allow")
                { decision = "step-up"; steps = new JsonArray(RequiredStep("voice")); reasons.Add("VOICE_STEP_UP"); }
            }
        }
        return new JsonObject { ["sessionId"] = record.SessionId, ["riskScore"] = score, ["decision"] = decision,
            ["requiredSteps"] = steps, ["reasons"] = Strings(reasons.Distinct()), ["signalsUsed"] = used };
    }
    private static double Trust(double value) => Math.Clamp(value is >= 0 and <= 1 ? value * 100 : value, 0, 100);
    private static IEnumerable<string> Reasons(JsonNode? node) => node is JsonArray array ? array.Select(n => Text(n) ?? throw new InvalidOperationException("Invalid signal reason.")) : throw new InvalidOperationException("Signal reasons must be an array.");
}
