using System.Globalization;

namespace SecureKit.Api.Services;

public sealed class VoiceFailure(string code, string message, int status = 400, object? details = null) : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
    public object? Details { get; } = details;
}

public sealed class VoiceOptions(IConfiguration config, IWebHostEnvironment environment)
{
    public const string SpeakerModelDefault = "speechbrain/spkrec-ecapa-voxceleb";
    public string RepositoryRoot { get; } = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "../.."));
    public string TempRoot { get; } = Path.GetFullPath(config["Voice:TempRoot"] ?? Path.GetTempPath());
    public long MaxUploadBytes { get; } = Positive(config["VOICE_UPLOAD_MAX_BYTES"] ?? config["Voice:MaxUploadBytes"], 12 * 1024 * 1024);
    public int TimeoutMs { get; } = (int)Math.Min(int.MaxValue, Positive(config["VOICE_PYTHON_TIMEOUT_MS"] ?? config["Voice:PythonTimeoutMs"], 120000));
    public double MatchThreshold { get; } = Threshold(config["VOICE_MATCH_THRESHOLD"] ?? config["Voice:MatchThreshold"], .85);
    public double TranscriptThreshold { get; } = Threshold(config["VOICE_TEXT_THRESHOLD"] ?? config["Voice:TranscriptThreshold"], .78);
    public double MinEnrollmentSamples { get; } = Positive(config["VOICE_MIN_ENROLLMENT_SAMPLES"] ?? config["Voice:MinEnrollmentSamples"], 3);
    public string? PythonCommand => config["VOICE_PYTHON_BIN"] ?? config["PYTHON_BIN"] ?? config["Voice:PythonCommand"];
    public string[] PythonArgs => config.GetSection("Voice:PythonArgs").Get<string[]>() ?? [];
    public string ScriptPath => Path.GetFullPath(config["VOICE_PYTHON_SCRIPT_PATH"] ?? config["Voice:ScriptPath"] ?? Path.Combine(RepositoryRoot, "python/voice_verification/voice_worker.py"));
    public string Device => (config["VOICE_DEVICE"] ?? config["Voice:Device"]) switch { "cpu" => "cpu", "cuda" => "cuda", _ => "auto" };
    public bool RequireGpu => (config["VOICE_REQUIRE_GPU"] ?? config["Voice:RequireGpu"])?.ToLowerInvariant() is "1" or "true" or "yes";
    public string WhisperModel => config["VOICE_WHISPER_MODEL"] ?? config["Voice:WhisperModel"] ?? "base";
    public string SpeakerModel => config["VOICE_SPEAKER_MODEL"] ?? config["Voice:SpeakerModel"] ?? SpeakerModelDefault;
    public static string? Extension(string mime) => mime switch
    { "audio/webm" => ".webm", "audio/wav" or "audio/wave" or "audio/x-wav" => ".wav", "audio/mpeg" => ".mp3", "audio/mp4" => ".m4a", "audio/ogg" => ".ogg", _ => null };
    private static long Positive(string? raw, long fallback) => double.TryParse(raw, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) && n > 0 && n < long.MaxValue ? Math.Max(1, (long)Math.Floor(n + .5)) : fallback;
    private static double Threshold(string? raw, double fallback) => double.TryParse(raw, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) && n is >= 0 and <= 1 ? n : fallback;
}
