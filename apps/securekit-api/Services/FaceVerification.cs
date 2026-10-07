using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public sealed class FaceVerification(FaceOptions options, IProfileStorage storage, IFacePython python, TimeProvider clock)
{
    private readonly SemaphoreSlim enrollmentGate = new(1, 1);

    public async Task<JsonObject> EnrollAsync(string? userId, IFormFile file, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(userId)) throw new FaceFailure("INVALID_REQUEST", "userId is required.");
        userId = userId.Trim(); Validate(file, "referenceImage");
        await enrollmentGate.WaitAsync(token);
        string? next = null;
        try
        {
            Directory.CreateDirectory(options.ReferenceDirectory);
            next = Path.Combine(options.ReferenceDirectory, $"{Regex.Replace(userId, "[^a-zA-Z0-9_-]", "-")}-{clock.GetUtcNow().ToUnixTimeMilliseconds()}-{Guid.NewGuid()}{FaceOptions.Extension(file.ContentType)}");
            await WriteAsync(file, next, token);
            var existing = await storage.GetProfilesAsync(userId);
            var previous = Text(existing?["faceReferenceImagePath"]);
            var now = clock.GetUtcNow().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
            var profiles = new JsonObject { ["userId"] = userId };
            foreach (var key in new[] { "keystroke", "faceEmbedding", "cardReferenceImagePath", "cardReferenceEnrolledAt", "voice", "voiceEmbedding" }) profiles[key] = existing?[key]?.DeepClone();
            profiles["faceReferenceImagePath"] = next; profiles["faceReferenceEnrolledAt"] = now; profiles["updatedAt"] = now;
            await storage.SaveProfilesAsync(userId, profiles);
            if (previous is not null && previous != next && FaceOptions.ContainsPath(options.ReferenceDirectory, previous)) File.Delete(previous);
            return new JsonObject { ["ok"] = true, ["userId"] = userId, ["reference"] = new JsonObject { ["imagePath"] = next, ["enrolledAt"] = now, ["source"] = "upload" } };
        }
        catch (OperationCanceledException) { if (next is not null) File.Delete(next); throw; }
        catch (Exception ex)
        {
            if (next is not null) File.Delete(next);
            throw new FaceFailure("INTERNAL_ERROR", "Failed to persist enrolled face reference.", 500, ex.Message);
        }
        finally { enrollmentGate.Release(); }
    }

    public async Task<JsonObject> VerifyAsync(string? userId, string? referencePath, IFormFile? reference, IFormFile probe, double? threshold, CancellationToken token)
    {
        Validate(probe, "probeImage");
        return await WithTemp(async directory =>
        {
            var resolved = reference is not null ? await WriteTemp(reference, directory, "reference", token) : await ResolveReference(userId, referencePath);
            var probePath = await WriteTemp(probe, directory, "probe", token);
            if (threshold is < 0 or > 1) throw new FaceFailure("INVALID_REQUEST", "threshold must be a number between 0 and 1.");
            var result = await python.RunAsync(new JsonObject { ["referenceImagePath"] = resolved, ["probeImagePath"] = probePath, ["threshold"] = threshold ?? options.Threshold }, false, token);
            if (result["ok"]!.GetValue<bool>() == false)
                result["failureCode"] = Text(result["reason"]) switch
                {
                    "reference_face_not_detected" or "probe_face_not_detected" => "FACE_NOT_DETECTED", "file_not_found" => "REFERENCE_NOT_FOUND",
                    "invalid_threshold" => "INVALID_REQUEST", "gpu_required" => "GPU_REQUIRED", _ => "PYTHON_PROCESS_ERROR"
                };
            return result;
        });
    }

    public Task<JsonObject> SlidingAsync(string userId, IFormFile probe, double? threshold, double? maxWindow, bool? update, CancellationToken token)
    {
        var userDirectory = new DirectoryInfo(Path.Combine(options.SlidingRoot, userId));
        if (userDirectory.Exists && userDirectory.LinkTarget is not null && !FaceOptions.ContainsPath(options.SlidingRoot, userDirectory.ResolveLinkTarget(true)!.FullName))
            throw new FaceFailure("INVALID_REQUEST", "User sliding window path is outside allowed directories.");
        return WithTemp(async directory =>
        {
            // The Node sliding route forwards numeric options and empty probes to the existing worker.
            var path = await WriteTemp(probe, directory, "probe", token, validate: false);
            return await python.RunAsync(new JsonObject { ["userId"] = userId, ["probeImagePath"] = path, ["threshold"] = threshold ?? options.Threshold, ["maxWindow"] = maxWindow ?? 3, ["updateOnSuccess"] = update ?? true }, true, token);
        });
    }

    private async Task<JsonObject> WithTemp(Func<string, Task<JsonObject>> action)
    {
        Directory.CreateDirectory(options.TempRoot);
        var directory = Path.Combine(options.TempRoot, "securekit-face-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        try { return await action(directory); }
        finally { Directory.Delete(directory, true); }
    }

    private async Task<string> ResolveReference(string? userId, string? requested)
    {
        var stored = false;
        if (requested is null && userId is not null) { requested = Text((await storage.GetProfilesAsync(userId))?["faceReferenceImagePath"]); stored = requested is { Length: > 0 }; }
        if (!string.IsNullOrWhiteSpace(requested))
        {
            var path = Path.GetFullPath(requested, options.RepositoryRoot);
            if (!Allowed(path)) throw new FaceFailure("REFERENCE_PATH_INVALID", stored ? "Stored face reference path is outside allowed directories." : "referenceImagePath is not within allowed directories.");
            if (!File.Exists(path)) throw new FaceFailure("REFERENCE_NOT_FOUND", stored ? "stored face reference was not found." : "reference image was not found.", 404);
            return path;
        }
        if (userId is not null)
        {
            string[] names = userId.ToLowerInvariant() switch
            {
                "emre" => ["emre referans 16.05.2026.jpg", "emre yüz 1.jpg", "emre yüz 2.jpg", "emre yüz 3.jpg", "emre karanlık %20.jpg", "emre karanlık %50.jpg", "emre karanlık %80.jpg", "emre simsiyah.jpg", "emre simsiyah 2.jpg"],
                "murat" => ["murat referans 18.05.2026.jpg", "murat yüz.jpeg", "murat yüz 2.jpg"], "mert" => ["mert yüz.jpg"], _ => []
            };
            foreach (var name in names) { var path = Path.Combine(options.SampleDirectory, name); if (File.Exists(path) && Allowed(path)) return path; }
            throw new FaceFailure("REFERENCE_NOT_FOUND", "No enrolled face reference found for user.", 404);
        }
        throw new FaceFailure("REFERENCE_REQUIRED", "Provide userId, referenceImagePath, or referenceImage.");
    }

    // Resolve links so a path inside an allowed directory cannot point at an outside file.
    private bool Allowed(string path)
    {
        if (!options.AllowedRoots.Any(root => FaceOptions.ContainsPath(root, path))) return false;
        var current = Path.GetPathRoot(path)!;
        foreach (var part in Path.GetRelativePath(current, path).Split(Path.DirectorySeparatorChar))
        {
            current = Path.Combine(current, part);
            FileSystemInfo info = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
            if (info.Exists && info.LinkTarget is not null) current = info.ResolveLinkTarget(true)!.FullName;
        }
        return options.AllowedRoots.Any(root => FaceOptions.ContainsPath(root, current));
    }

    private void Validate(IFormFile file, string field)
    {
        if (file.Length <= 0) throw new FaceFailure("INVALID_REQUEST", $"{field} is empty.");
        if (file.Length > options.MaxUploadBytes) throw new FaceFailure("IMAGE_TOO_LARGE", $"{field} exceeds the maximum size of {options.MaxUploadBytes} bytes.", 413);
    }
    private async Task<string> WriteTemp(IFormFile file, string directory, string prefix, CancellationToken token, bool validate = true)
    {
        if (validate) Validate(file, prefix + "Image");
        var path = Path.Combine(directory, prefix + "-" + Guid.NewGuid() + FaceOptions.Extension(file.ContentType));
        await WriteAsync(file, path, token); return path;
    }
    private static async Task WriteAsync(IFormFile file, string path, CancellationToken token)
    {
        await using var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true);
        await file.CopyToAsync(output, token);
    }
}
