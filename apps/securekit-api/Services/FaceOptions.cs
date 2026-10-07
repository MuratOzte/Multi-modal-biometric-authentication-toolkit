using System.Globalization;

namespace SecureKit.Api.Services;

public sealed class FaceFailure(string code, string message, int status = 400, object? details = null) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
    public object? Details { get; } = details;
}

public sealed class FaceOptions(IConfiguration config, IWebHostEnvironment environment)
{
    public string RepositoryRoot { get; } = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "../.."));
    public string ReferenceDirectory { get; } = Path.GetFullPath(config["Face:ReferenceDirectory"] ?? Path.Combine(environment.ContentRootPath, ".securekit/face-references"));
    public string SlidingRoot { get; } = Path.GetFullPath(config["FACE_SLIDING_REFERENCES_ROOT"] ?? config["Face:SlidingRoot"] ?? Path.Combine(environment.ContentRootPath, ".securekit/face-sliding-window"));
    public string TempRoot { get; } = Path.GetFullPath(config["Face:TempRoot"] ?? Path.GetTempPath());
    public long MaxUploadBytes { get; } = ParsePositive(config["FACE_UPLOAD_MAX_BYTES"] ?? config["Face:MaxUploadBytes"], 5 * 1024 * 1024);
    public int TimeoutMs { get; } = (int)Math.Min(int.MaxValue, ParsePositive(config["FACE_PYTHON_TIMEOUT_MS"] ?? config["Face:PythonTimeoutMs"], 30000));
    public double Threshold { get; } = double.TryParse(config["FACE_MATCH_THRESHOLD"] ?? config["Face:DefaultThreshold"], CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) && n is >= 0 and <= 1 ? n : .8;
    public string? PythonCommand => config["FACE_PYTHON_BIN"] ?? config["PYTHON_BIN"] ?? config["Face:PythonCommand"];
    public string[] PythonArgs => config.GetSection("Face:PythonArgs").Get<string[]>() ?? [];
    public string Script(bool sliding) => Path.GetFullPath(sliding
        ? config["Face:SlidingScriptPath"] ?? Path.Combine(RepositoryRoot, "python/face_verification/face_sliding_window.py")
        : config["FACE_PYTHON_SCRIPT_PATH"] ?? config["Face:ScriptPath"] ?? Path.Combine(RepositoryRoot, "python/face_verification/face_verification.py"));
    public string Device => (config["FACE_DEVICE"] ?? config["Face:Device"]) switch { "cpu" => "cpu", "cuda" => "cuda", _ => "auto" };
    public bool RequireGpu => (config["FACE_REQUIRE_GPU"] ?? config["Face:RequireGpu"])?.ToLowerInvariant() is "1" or "true" or "yes";
    public string SampleDirectory => Path.Combine(RepositoryRoot, "python/face_verification/images");
    public IEnumerable<string> AllowedRoots => new[] { ReferenceDirectory, SampleDirectory }.Concat(config.GetSection("Face:AllowedReferenceRoots").Get<string[]>() ?? []).Select(Path.GetFullPath);
    public static string Extension(string mime) => mime switch { "image/jpeg" => ".jpg", "image/png" => ".png", "image/webp" => ".webp", _ => ".img" };
    public static bool ContainsPath(string root, string path)
    {
        var relative = Path.GetRelativePath(Path.GetFullPath(root), Path.GetFullPath(path));
        return relative != ".." && !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal) && !Path.IsPathRooted(relative);
    }
    private static long ParsePositive(string? raw, long fallback) => double.TryParse(raw, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) && n > 0 && n < long.MaxValue ? (long)Math.Floor(n + .5) : fallback;
}
