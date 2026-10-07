using System.Globalization;
using System.Text.Json.Nodes;

namespace SecureKit.Api.Services;

internal static class JsonValues
{
    public static string? Text(JsonNode? value) => value is JsonValue v && v.TryGetValue<string>(out var text) ? text : null;
    public static double? Number(JsonNode? value)
    {
        if (value is not JsonValue v) return null;
        if (v.TryGetValue<double>(out var number)) return double.IsFinite(number) ? number : null;
        if (v.TryGetValue<int>(out var integer)) return integer;
        if (v.TryGetValue<long>(out var longInteger)) return longInteger;
        if (v.TryGetValue<decimal>(out var decimalNumber)) return (double)decimalNumber;
        return null;
    }
    public static bool Truthy(JsonNode? value) => value switch
    {
        null => false,
        JsonObject or JsonArray => true,
        JsonValue v when v.TryGetValue<bool>(out var b) => b,
        JsonValue v when v.TryGetValue<string>(out var s) => s.Length > 0,
        _ => Number(value) is { } n && n != 0
    };
    public static double Round(double value) => double.IsFinite(value) ? Math.Floor(value * 1000 + .5) / 1000 : 0;
    public static double Count(JsonNode? value) => Number(value) is > 0 and var n ? Math.Floor(n + .5) : 0;
    public static string Iso(DateTimeOffset value) => value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    public static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
    public static long Ttl(IConfiguration config, string environmentKey, string sectionKey, long fallback)
    {
        var raw = config[environmentKey] ?? config[sectionKey];
        return double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) && n > 0
            ? checked((long)Math.Floor(n * 1000 + .5)) : fallback;
    }
}
