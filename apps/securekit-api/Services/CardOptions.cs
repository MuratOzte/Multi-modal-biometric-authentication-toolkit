using System.Globalization;

namespace SecureKit.Api.Services;

public sealed class CardFailure(string code, string message, int status = 400, object? details = null) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
    public object? Details { get; } = details;
}

public sealed class CardOptions(IConfiguration config, IWebHostEnvironment environment)
{
    public string RepositoryRoot { get; } = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "../.."));
    public string ReferenceDirectory => Path.GetFullPath(config["Card:ReferenceDirectory"] ?? Path.Combine(RepositoryRoot, "python/card_verification/images"));
    public string UserReferenceDirectory { get; } = Path.GetFullPath(config["Card:UserReferenceDirectory"] ?? Path.Combine(environment.ContentRootPath, ".securekit/card-references"));
    public string TempRoot { get; } = Path.GetFullPath(config["Card:TempRoot"] ?? Path.GetTempPath());
    public long MaxUploadBytes { get; } = Positive(config["CARD_UPLOAD_MAX_BYTES"] ?? config["Card:MaxUploadBytes"], 5 * 1024 * 1024);
    public int TimeoutMs { get; } = (int)Math.Min(int.MaxValue, Positive(config["CARD_PYTHON_TIMEOUT_MS"] ?? config["Card:PythonTimeoutMs"], 300000));
    public double Threshold { get; } = double.TryParse(config["CARD_MATCH_THRESHOLD"] ?? config["Card:DefaultThreshold"], CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) && n is >= 0 and <= 1 ? n : .7;
    public string? PythonCommand => config["CARD_PYTHON_BIN"] ?? config["PYTHON_BIN"] ?? config["Card:PythonCommand"];
    public string[] PythonArgs => config.GetSection("Card:PythonArgs").Get<string[]>() ?? [];
    public string ScriptPath => Path.GetFullPath(config["CARD_PYTHON_SCRIPT_PATH"] ?? config["Card:ScriptPath"] ?? Path.Combine(RepositoryRoot, "python/card_verification/main.py"));
    public IEnumerable<string> AllowedRoots => new[] { ReferenceDirectory, UserReferenceDirectory }.Concat(config.GetSection("Card:AllowedReferenceRoots").Get<string[]>() ?? []).Select(Path.GetFullPath);
    private static long Positive(string? raw, long fallback) => double.TryParse(raw, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) && n > 0 && n < long.MaxValue ? Math.Max(1, (long)Math.Floor(n + .5)) : fallback;

    // Resolve each path component, including directory links, before reading or deleting files.
    public bool Allowed(string path, bool managedOnly = false)
    {
        var roots = managedOnly ? new[] { UserReferenceDirectory } : AllowedRoots.ToArray();
        path = Path.GetFullPath(path);
        if (!roots.Any(root => FaceOptions.ContainsPath(root, path))) return false;
        var current = Path.GetPathRoot(path)!;
        foreach (var part in Path.GetRelativePath(current, path).Split(Path.DirectorySeparatorChar))
        {
            current = Path.Combine(current, part);
            FileSystemInfo info = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
            if (info.Exists && info.LinkTarget is not null) current = info.ResolveLinkTarget(true)!.FullName;
        }
        return roots.Any(root => FaceOptions.ContainsPath(root, current));
    }
}
