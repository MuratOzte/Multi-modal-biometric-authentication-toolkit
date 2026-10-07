using System.Text.Json.Nodes;

namespace SecureKit.Api.Services;

public interface IProfileStorage
{
    Task<JsonObject?> GetProfilesAsync(string userId);
    Task AppendConsentAsync(JsonObject consent);
    Task DeleteBiometricsAsync(string userId, bool deleteConsent);
    Task SaveProfilesAsync(string userId, JsonObject profiles);
    Task<JsonObject?> GetLatestConsentAsync(string userId);
}

// Uses the Node adapter's { records: { userId: { profiles, consentLogs } } } file format.
// A single API process serializes read/modify/write operations; use separate files for parallel hosts.
public sealed class FileProfileStorage(IConfiguration configuration, IWebHostEnvironment environment) : IProfileStorage
{
    private readonly SemaphoreSlim gate = new(1, 1);
    public string FilePath { get; } = Path.GetFullPath(
        configuration["SECUREKIT_PROFILE_STORE"] ?? configuration["Storage:ProfileStorePath"]
        ?? Path.Combine(environment.ContentRootPath, ".securekit", "user-profiles.json"));

    public async Task<JsonObject?> GetProfilesAsync(string userId)
    {
        await gate.WaitAsync();
        try { return (await ReadAsync())["records"]?[userId]?["profiles"]?.DeepClone() as JsonObject; }
        finally { gate.Release(); }
    }

    public async Task<JsonObject?> GetLatestConsentAsync(string userId)
    {
        await gate.WaitAsync();
        try { return ((await ReadAsync())["records"]?[userId]?["consentLogs"] as JsonArray)?.LastOrDefault()?.DeepClone() as JsonObject; }
        finally { gate.Release(); }
    }

    public Task AppendConsentAsync(JsonObject consent) => UpdateAsync(payload =>
    {
        var records = (JsonObject)payload["records"]!;
        var id = consent["userId"]!.GetValue<string>();
        if (records[id] is not JsonObject) records[id] = new JsonObject { ["profiles"] = null, ["consentLogs"] = new JsonArray() };
        var record = (JsonObject)records[id]!;
        if (record["consentLogs"] is not JsonArray) record["consentLogs"] = new JsonArray();
        ((JsonArray)record["consentLogs"]!).Add(consent.DeepClone());
        return true;
    });

    public Task SaveProfilesAsync(string userId, JsonObject profiles) => UpdateAsync(payload =>
    {
        var records = (JsonObject)payload["records"]!;
        if (records[userId] is not JsonObject) records[userId] = new JsonObject { ["consentLogs"] = new JsonArray() };
        records[userId]!["profiles"] = profiles.DeepClone();
        return true;
    });

    public Task DeleteBiometricsAsync(string userId, bool deleteConsent) => UpdateAsync(payload =>
    {
        var records = (JsonObject)payload["records"]!;
        if (records[userId] is not JsonObject record) return false;
        record["profiles"] = null;
        if (deleteConsent) record["consentLogs"] = new JsonArray();
        if (record["consentLogs"] is not JsonArray logs || logs.Count == 0) records.Remove(userId);
        return true;
    });

    private async Task<JsonObject> ReadAsync()
    {
        try
        {
            var payload = JsonNode.Parse(await File.ReadAllTextAsync(FilePath)) as JsonObject;
            return payload?["records"] is JsonObject ? payload : new JsonObject { ["records"] = new JsonObject() };
        }
        catch (FileNotFoundException) { return new JsonObject { ["records"] = new JsonObject() }; }
        catch (DirectoryNotFoundException) { return new JsonObject { ["records"] = new JsonObject() }; }
    }

    private async Task UpdateAsync(Func<JsonObject, bool> mutate)
    {
        await gate.WaitAsync();
        string? temporary = null;
        try
        {
            var payload = await ReadAsync();
            if (!mutate(payload)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            temporary = FilePath + ".tmp-" + Guid.NewGuid().ToString("N");
            await File.WriteAllTextAsync(temporary, payload.ToJsonString());
            File.Move(temporary, FilePath, overwrite: true);
        }
        finally
        {
            try { if (temporary is not null && File.Exists(temporary)) File.Delete(temporary); }
            finally { gate.Release(); }
        }
    }
}
