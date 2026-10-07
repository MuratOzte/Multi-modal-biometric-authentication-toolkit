using System.Globalization;
using System.Text.Json.Nodes;

namespace SecureKit.Api.Services;

public sealed class FileUserStore(IConfiguration configuration, IWebHostEnvironment environment)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly string filePath = Path.GetFullPath(configuration["SECUREKIT_USERS_FILE"]
        ?? configuration["Storage:UsersFilePath"] ?? Path.Combine(environment.ContentRootPath, ".securekit", "users.json"));

    public async Task<JsonArray> ListAsync()
    {
        await gate.WaitAsync();
        try
        {
            var users = await ReadAsync();
            var summaries = new JsonArray();
            foreach (var user in users)
            {
                var summary = new JsonObject { ["userId"] = user["id"]!.DeepClone() };
                foreach (var key in new[] { "createdAt", "updatedAt" })
                    if (user[key] is not null) summary[key] = user[key]!.DeepClone();
                summaries.Add(summary);
            }
            return summaries;
        }
        finally { gate.Release(); }
    }

    public async Task<bool> LoginAsync(string id, string password)
    {
        await gate.WaitAsync();
        try { return (await ReadAsync()).Any(user => JsonValues.Text(user["id"]) == id && JsonValues.Text(user["password"]) == password); }
        finally { gate.Release(); }
    }

    // Lookup and create share a lock, so parallel registrations cannot create duplicates.
    public async Task<string> RegisterAsync(string id, string password, string now)
    {
        await gate.WaitAsync();
        string? temporary = null;
        try
        {
            var users = await ReadAsync();
            var existing = users.FirstOrDefault(user => JsonValues.Text(user["id"]) == id);
            if (existing is not null) return JsonValues.Text(existing["password"]) == password ? "existing" : "conflict";
            users.Add(new JsonObject { ["id"] = id, ["password"] = password, ["createdAt"] = now, ["updatedAt"] = now });
            users.Sort((a, b) => CultureInfo.InvariantCulture.CompareInfo.Compare(JsonValues.Text(a["id"]), JsonValues.Text(b["id"]), CompareOptions.None));
            Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
            temporary = filePath + ".tmp-" + Guid.NewGuid().ToString("N");
            await File.WriteAllTextAsync(temporary, new JsonObject { ["users"] = new JsonArray(users.Select(u => (JsonNode)u).ToArray()) }.ToJsonString());
            File.Move(temporary, filePath, true);
            return "created";
        }
        finally
        {
            try { if (temporary is not null && File.Exists(temporary)) File.Delete(temporary); }
            finally { gate.Release(); }
        }
    }

    private async Task<List<JsonObject>> ReadAsync()
    {
        string raw;
        try { raw = await File.ReadAllTextAsync(filePath); }
        catch (FileNotFoundException) { return []; }
        catch (DirectoryNotFoundException) { return []; }
        var payload = JsonNode.Parse(raw) as JsonObject;
        var result = new List<JsonObject>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        if (payload?["users"] is not JsonArray users) return result;
        foreach (var value in users.OfType<JsonObject>())
        {
            var id = JsonValues.Text(value["id"])?.Trim().ToLowerInvariant();
            var password = JsonValues.Text(value["password"]);
            if (string.IsNullOrEmpty(id) || password is null || !seen.Add(id)) continue;
            var user = new JsonObject { ["id"] = id, ["password"] = password };
            foreach (var key in new[] { "createdAt", "updatedAt" })
                if (JsonValues.Text(value[key]) is { } text) user[key] = text;
            result.Add(user);
        }
        return result;
    }
}
