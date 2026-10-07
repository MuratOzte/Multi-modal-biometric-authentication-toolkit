using System.Text.Json.Nodes;

namespace SecureKit.Api.Services;

public sealed record SessionRecord(string SessionId, long ExpiresAt, JsonObject Signals);

public sealed class SessionStore(TimeProvider clock, IConfiguration configuration)
{
    private readonly object gate = new();
    private readonly Dictionary<string, SessionRecord> records = new();
    public SessionRecord Start()
    {
        var record = new SessionRecord(Guid.NewGuid().ToString(), checked(clock.GetUtcNow().ToUnixTimeMilliseconds()
            + JsonValues.Ttl(configuration, "SESSION_TTL_SECONDS", "Session:TtlSeconds", 900_000)), new JsonObject());
        lock (gate) records[record.SessionId] = record;
        return record;
    }
    public (SessionRecord? Record, string? Error) Merge(string id, JsonObject? signals)
    {
        lock (gate)
        {
            if (!records.TryGetValue(id, out var record)) return (null, "SESSION_NOT_FOUND");
            if (record.ExpiresAt <= clock.GetUtcNow().ToUnixTimeMilliseconds())
            { records.Remove(id); return (null, "SESSION_EXPIRED"); }
            if (signals is not null)
                foreach (var key in new[] { "network", "location", "keystroke", "voice" })
                    if (signals[key] is JsonObject or JsonArray) record.Signals[key] = signals[key]!.DeepClone();
            return (record with { Signals = (JsonObject)record.Signals.DeepClone() }, null);
        }
    }
}
