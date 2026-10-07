using System.Globalization;

namespace SecureKit.Api.Services;

public sealed record ChallengeRecord(string Id, string Text, string Lang, long ExpiresAtMs, string? SessionId, long? UsedAtMs = null);

public sealed class ChallengeStore(TimeProvider clock, IConfiguration configuration)
{
    private readonly object gate = new();
    private readonly Dictionary<string, ChallengeRecord> records = new();
    private static readonly string[] English = "silver garden puzzle window planet signal forest camera bridge winter market rocket stream thunder velvet ticket memory travel shadow motion breeze stable anchor fluent candle voyage harbor mirror pocket rescue copper meadow".Split(' ');
    private static readonly string[] Turkish = "sabah serin rüzgar yumuşak ışık sessiz yol ince yağmur uzak şehir sakin orman kıyı gölge umut denge kır iz söz adım güneş akşam duru nehir bulut kumsal kapı pencere toprak yıldız yankı".Split(' ');

    public ChallengeRecord Create(string lang, string length, int? wordCount, string? text, string? sessionId)
    {
        var raw = configuration["CHALLENGE_TTL_SECONDS"] ?? configuration["Challenge:TtlSeconds"];
        var ttl = double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)
            && double.IsFinite(seconds) && seconds > 0 ? Math.Floor(seconds * 1000 + .5) : 120_000;
        var record = new ChallengeRecord(Guid.NewGuid().ToString(), text ?? Generate(lang, length, wordCount), lang,
            checked(clock.GetUtcNow().ToUnixTimeMilliseconds() + (long)ttl), sessionId);
        lock (gate) records[record.Id] = record;
        return record;
    }

    public (ChallengeRecord? Record, string? Error) Consume(string id)
    {
        lock (gate)
        {
            if (!records.TryGetValue(id, out var record)) return (null, "CHALLENGE_NOT_FOUND");
            if (record.UsedAtMs is not null) return (null, "CHALLENGE_ALREADY_USED");
            var now = clock.GetUtcNow().ToUnixTimeMilliseconds();
            if (now > record.ExpiresAtMs)
            {
                records.Remove(id);
                return (null, "CHALLENGE_EXPIRED");
            }
            record = record with { UsedAtMs = now };
            records[id] = record;
            return (record, null);
        }
    }

    private static string Generate(string lang, string length, int? wordCount)
    {
        if (lang == "tr")
        {
            var words = new List<string>();
            var letters = 0;
            while (letters < 40)
            {
                var allowed = Turkish.Where(word => letters + word.Length <= 50).ToArray();
                var word = allowed[Random.Shared.Next(allowed.Length)];
                words.Add(word);
                letters += word.Length;
            }
            var sentence = string.Join(' ', words);
            return char.ToUpperInvariant(sentence[0]) + sentence[1..] + ".";
        }
        var (min, max) = length switch { "medium" => (10, 12), "long" => (16, 20), _ => (5, 7) };
        return string.Join(' ', Enumerable.Range(0, wordCount ?? Random.Shared.Next(min, max + 1))
            .Select(_ => English[Random.Shared.Next(English.Length)]));
    }
}
