using System.Text.Json.Nodes;

namespace SecureKit.Api.Services;

internal static class NetworkVerification
{
    public static JsonNode? Field(JsonNode? node, string key) => (node as JsonObject)?[key];
    public static bool IsTrue(JsonNode? node) => node is JsonValue v && v.TryGetValue<bool>(out var b) && b;
    public static string? Country(JsonNode? node) => JsonValues.Text(node)?.Trim().ToUpperInvariant() is { Length: > 0 } value ? value : null;
    public static string? CountryCode(JsonObject check) => Country(check["ip_country_code"]) ?? Country(Field(Field(check["ip_info"], "location"), "country_code"));
    public static double? Offset(JsonObject? body)
    {
        foreach (var key in new[] { "clientOffsetMin", "clientTimeOffsetMinutes", "clientTimezoneOffset", "tzOffset", "clientOffset" })
            if (JsonValues.Number(body?[key]) is { } value) return value;
        return null;
    }
    public static JsonObject Network(JsonObject check, double? clientOffset, string ip)
    {
        var info = check["ip_info"];
        var security = Field(info, "security");
        var flags = new JsonObject();
        foreach (var name in new[] { "vpn", "proxy", "tor", "relay", "hosting", "mobile", "suspicious" }) flags[name] = IsTrue(Field(security, name));
        var offset = JsonValues.Number(Field(Field(info, "location"), "utc_offset_minutes"));
        double? drift = offset.HasValue && clientOffset.HasValue ? Math.Abs(clientOffset.Value - offset.Value) : null;
        var score = 1.0;
        var reasons = new List<string>();
        if (drift > 360) { score -= .5; reasons.Add("TIMEZONE_DRIFT_GT_6H"); }
        else if (drift > 180) { score -= .3; reasons.Add("TIMEZONE_DRIFT_GT_3H"); }
        else if (drift > 60) { score -= .1; reasons.Add("TIMEZONE_DRIFT_GT_1H"); }
        foreach (var (flag, penalty, reason) in new[] { ("vpn", .5, "VPN_DETECTED"), ("proxy", .3, "PROXY_DETECTED"), ("tor", .7, "TOR_DETECTED"), ("relay", .2, "RELAY_DETECTED") })
            if (IsTrue(flags[flag])) { score -= penalty; reasons.Add(reason); }
        score = Math.Clamp(score, 0, 1);
        var result = new JsonObject
        {
            ["ok"] = score >= .5, ["score"] = score, ["flags"] = flags, ["reasons"] = JsonValues.Strings(reasons),
            ["ipInfo"] = new JsonObject { ["ip"] = JsonValues.Text(Field(info, "ip"))?.Trim() is { Length: > 0 } value ? value : ip, ["countryCode"] = CountryCode(check), ["timezoneOffsetMin"] = offset, ["clientOffsetMin"] = clientOffset, ["driftMin"] = drift }
        };
        if (JsonValues.Truthy(info)) result["raw"] = info!.DeepClone();
        return result;
    }
    public static JsonObject Location(JsonObject check, IEnumerable<string>? countries)
    {
        var country = CountryCode(check);
        var allowedCountries = countries?.ToArray();
        var hasList = allowedCountries is { Length: > 0 };
        var allowed = !hasList || (country is not null && allowedCountries!.Contains(country));
        var reasons = new List<string>();
        if (hasList && country is null) reasons.Add("COUNTRY_UNKNOWN");
        if (!allowed) reasons.Add("COUNTRY_NOT_ALLOWED");
        return new JsonObject { ["ok"] = allowed, ["countryCode"] = country, ["allowed"] = allowed, ["reasons"] = JsonValues.Strings(reasons) };
    }
}
