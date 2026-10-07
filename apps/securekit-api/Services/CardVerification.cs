using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public sealed class CardVerification(CardOptions options, IProfileStorage storage, ICardPython python, TimeProvider clock)
{
    private readonly SemaphoreSlim enrollmentGate = new(1, 1);
    private static JsonObject Summary(string path)
    {
        var name = Path.GetFileName(path);
        return new JsonObject { ["id"] = name, ["fileName"] = name, ["imagePath"] = path,
            ["label"] = Regex.Replace(Regex.Replace(Path.GetFileNameWithoutExtension(name), "[_-]+", " "), @"\s+", " ").Trim() };
    }
    private JsonArray References()
    {
        Directory.CreateDirectory(options.ReferenceDirectory);
        return new JsonArray(Directory.EnumerateFiles(options.ReferenceDirectory)
            .Where(path => Path.GetExtension(path).ToLowerInvariant() is ".jpg" or ".jpeg" or ".png" or ".webp")
            .Where(path => new FileInfo(path).LinkTarget is null)
            .OrderBy(Path.GetFileName, StringComparer.Create(CultureInfo.GetCultureInfo("en-US"), false))
            .Select(path => (JsonNode)Summary(path)).ToArray());
    }
    public JsonObject List() => new() { ["ok"] = true, ["referenceDir"] = options.ReferenceDirectory, ["references"] = References() };

    public async Task<JsonObject> EnrollAsync(string? userId, IFormFile file, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(userId)) throw new CardFailure("INVALID_REQUEST", "userId is required.");
        userId = userId.Trim().ToLowerInvariant(); Validate(file, "referenceImage");
        await enrollmentGate.WaitAsync(token); string? next = null;
        try
        {
            Directory.CreateDirectory(options.UserReferenceDirectory);
            next = Path.Combine(options.UserReferenceDirectory, $"{Regex.Replace(userId, "[^a-zA-Z0-9_-]", "-")}-{clock.GetUtcNow().ToUnixTimeMilliseconds()}-{Guid.NewGuid()}{FaceOptions.Extension(file.ContentType)}");
            await Write(file, next, token);
            var existing = await storage.GetProfilesAsync(userId); var previous = Text(existing?["cardReferenceImagePath"]);
            var now = clock.GetUtcNow().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
            var profile = new JsonObject { ["userId"] = userId };
            foreach (var key in new[] { "keystroke", "faceReferenceImagePath", "faceReferenceEnrolledAt", "faceEmbedding", "voice", "voiceEmbedding" }) profile[key] = existing?[key]?.DeepClone();
            profile["cardReferenceImagePath"] = next; profile["cardReferenceEnrolledAt"] = now; profile["updatedAt"] = now;
            await storage.SaveProfilesAsync(userId, profile);
            if (previous is not null && previous != next && options.Allowed(previous, managedOnly: true)) File.Delete(previous);
            return new JsonObject { ["ok"] = true, ["userId"] = userId, ["reference"] = new JsonObject { ["imagePath"] = next, ["enrolledAt"] = now, ["source"] = "upload" } };
        }
        catch (OperationCanceledException) { if (next is not null) File.Delete(next); throw; }
        catch (Exception ex) { if (next is not null) File.Delete(next); throw new CardFailure("INTERNAL_ERROR", "Failed to persist enrolled card reference.", 500, ex.Message); }
        finally { enrollmentGate.Release(); }
    }

    public async Task<JsonObject> VerifyAsync(string? userId, string? referenceId, IFormFile probe, double? threshold, CancellationToken token)
    {
        Validate(probe, "probeImage");
        JsonArray selected;
        if (userId is not null)
        {
            var stored = Text((await storage.GetProfilesAsync(userId))?["cardReferenceImagePath"]);
            if (string.IsNullOrEmpty(stored)) throw new CardFailure("REFERENCE_NOT_FOUND", "No enrolled card reference found for user.", 404);
            var path = Path.GetFullPath(stored, options.RepositoryRoot);
            if (!options.Allowed(path)) throw new CardFailure("INVALID_REQUEST", "Stored card reference path is outside allowed directories.");
            if (!File.Exists(path)) throw new CardFailure("REFERENCE_NOT_FOUND", "Stored card reference was not found.", 404);
            selected = new JsonArray(Summary(path));
        }
        else
        {
            selected = References();
            if (selected.Count == 0) throw new CardFailure("REFERENCE_NOT_FOUND", $"No registered card references found in {options.ReferenceDirectory}.", 404);
            if (referenceId is not null)
            {
                selected = new JsonArray(selected.Where(r => Text(r?["id"]) == referenceId).Select(r => r!.DeepClone()).ToArray());
                if (selected.Count == 0) throw new CardFailure("REFERENCE_NOT_FOUND", $"Selected card reference ({referenceId}) was not found in {options.ReferenceDirectory}.", 404);
            }
        }
        Directory.CreateDirectory(options.TempRoot);
        var temp = Path.Combine(options.TempRoot, "securekit-card-" + Guid.NewGuid()); Directory.CreateDirectory(temp);
        try
        {
            var probePath = Path.Combine(temp, "probe-" + Guid.NewGuid() + FaceOptions.Extension(probe.ContentType)); await Write(probe, probePath, token);
            if (threshold is < 0 or > 1) throw new CardFailure("INVALID_REQUEST", "threshold must be a number between 0 and 1.");
            var referenceDir = options.ReferenceDirectory;
            if (userId is not null || referenceId is not null)
            {
                referenceDir = Path.Combine(temp, "references"); Directory.CreateDirectory(referenceDir);
                foreach (var reference in selected) File.Copy(Text(reference!["imagePath"])!, Path.Combine(referenceDir, Text(reference["fileName"])!));
            }
            var result = await python.RunAsync(new JsonObject { ["probeImagePath"] = probePath, ["referenceDir"] = referenceDir, ["threshold"] = threshold ?? options.Threshold }, token);
            if (Number(result["checkedCount"]) == 0) throw new CardFailure("REFERENCE_NOT_FOUND", referenceId is null
                ? $"No usable card references found in {options.ReferenceDirectory}."
                : $"Selected card reference ({referenceId}) could not be processed from {options.ReferenceDirectory}.", 404);
            return result;
        }
        catch (OperationCanceledException) { throw; }
        catch (CardFailure) { throw; }
        catch (Exception) { throw new CardFailure("INTERNAL_ERROR", "Card verification failed unexpectedly.", 500); }
        finally { Directory.Delete(temp, true); }
    }
    private void Validate(IFormFile file, string field)
    {
        if (file.Length <= 0) throw new CardFailure("INVALID_REQUEST", $"{field} is empty.");
        if (file.Length > options.MaxUploadBytes) throw new CardFailure("IMAGE_TOO_LARGE", $"{field} exceeds the maximum size of {options.MaxUploadBytes} bytes.", 413);
    }
    private static async Task Write(IFormFile file, string path, CancellationToken token)
    { await using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true); await file.CopyToAsync(output, token); }
}
