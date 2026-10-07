using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public sealed class FixedKeystrokeStore(IConfiguration config, IWebHostEnvironment environment)
{
    public string Root { get; } = Path.GetFullPath(config["SECUREKIT_KEYSTROKE_STORE"] ?? config["Keystroke:StorePath"] ?? Path.Combine(environment.ContentRootPath, ".securekit", "keystroke"));
    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public string UserHash(string userId) => Hash(userId + (config["SECUREKIT_SERVER_SALT"] ?? config["Keystroke:ServerSalt"] ?? "securekit-dev-salt"));
    private string FilePath(string hash, string textId, bool metadata) => Path.Combine(Root, hash, Uri.EscapeDataString(textId).Replace("%21", "!").Replace("%27", "'").Replace("%28", "(").Replace("%29", ")").Replace("%2A", "*") + (metadata ? ".metadata.json" : ".json"));
    public async Task<JsonObject?> ReadAsync(string hash, string textId, bool metadata = false)
    {
        try
        {
            var obj = JsonNode.Parse(await File.ReadAllTextAsync(FilePath(hash, textId, metadata))) as JsonObject;
            if (obj is null) return null;
            foreach (var key in metadata ? new[] { "userId", "userIdHash", "textId", "expectedText", "expectedTextHash" } : new[] { "userIdHash", "textId", "expectedTextHash" }) if (Text(obj[key]) is null) return null;
            foreach (var key in metadata ? new[] { "sampleCount", "updatedAt" } : new[] { "dim", "count", "distThreshold", "scoreK", "autoEnrollScore", "scoreThreshold", "updatedAt" }) if (Number(obj[key]) is null) return null;
            foreach (var key in metadata ? new[] { "sampleCount" } : new[] { "dim", "count" }) if (Number(obj[key]) is { } n && n != Math.Truncate(n)) return null;
            if (!metadata) foreach (var key in new[] { "mean", "std" }) if (obj[key] is not JsonArray a || a.Any(v => Number(v) is null)) return null;
            return obj;
        }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }
    public async Task SaveAsync(string hash, string textId, JsonObject template, JsonObject? metadata)
    {
        await WriteAsync(FilePath(hash, textId, false), template);
        if (metadata is not null) await WriteAsync(FilePath(hash, textId, true), metadata);
    }
    private static async Task WriteAsync(string path, JsonObject value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!); var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try { await File.WriteAllTextAsync(temp, value.ToJsonString()); File.Move(temp, path, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    // Serializes enrollment and auto-enrollment transactions within this API process.
    public SemaphoreSlim Gate { get; } = new(1, 1);
}
