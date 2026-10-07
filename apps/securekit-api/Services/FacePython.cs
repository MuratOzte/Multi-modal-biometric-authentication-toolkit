using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public interface IFacePython
{
    Task<JsonObject> RunAsync(JsonObject input, bool sliding, CancellationToken token);
}

// Each call owns a bounded CLI process. The existing Python entry points and models are preserved.
public sealed class FacePython(FaceOptions options, ILogger<FacePython> logger) : IFacePython
{
    public async Task<JsonObject> RunAsync(JsonObject input, bool sliding, CancellationToken token)
    {
        var commands = options.PythonCommand is { } explicitCommand ? new[] { explicitCommand } : Candidates().ToArray();
        foreach (var command in commands)
        {
            try { return await RunOnce(input, sliding, command, token); }
            catch (Win32Exception) { }
        }
        throw new FaceFailure("PYTHON_RUNTIME_UNAVAILABLE", sliding ? "Python runtime not found. Install Python 3 or set FACE_PYTHON_BIN/PYTHON_BIN." : "Python runtime is not available for face verification.", 503);
    }

    private IEnumerable<string> Candidates()
    {
        foreach (var name in new[] { ".venv-face", ".venv" })
        {
            var path = Path.Combine(options.RepositoryRoot, name, OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
            if (File.Exists(path)) yield return path;
        }
        if (OperatingSystem.IsWindows()) yield return "py -3";
        yield return "python3"; yield return "python";
    }

    private async Task<JsonObject> RunOnce(JsonObject input, bool sliding, string command, CancellationToken token)
    {
        var launcher = command.Trim() is "py -3" or "py -3.11";
        var start = new ProcessStartInfo(launcher ? "py" : command.Trim().Trim('"'))
        {
            WorkingDirectory = options.RepositoryRoot, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        start.Environment["PYTHONIOENCODING"] = "utf-8"; start.Environment["PYTHONUTF8"] = "1";
        if (launcher) start.ArgumentList.Add(command.Trim()[3..]);
        foreach (var arg in options.PythonArgs) start.ArgumentList.Add(arg);
        start.ArgumentList.Add(options.Script(sliding));
        void Arg(string key, string value) { start.ArgumentList.Add(key); start.ArgumentList.Add(value); }
        Arg("--probe", Text(input["probeImagePath"])!);
        if (sliding)
        {
            Arg("--user-id", Text(input["userId"])!); Arg("--references-root", options.SlidingRoot);
            Arg("--max-window", (Number(input["maxWindow"]) ?? 3).ToString(CultureInfo.InvariantCulture));
            if (input["updateOnSuccess"]?.GetValue<bool>() == false) start.ArgumentList.Add("--no-update");
            start.ArgumentList.Add("--json");
        }
        else Arg("--reference", Text(input["referenceImagePath"])!);
        Arg("--threshold", (Number(input["threshold"]) ?? options.Threshold).ToString(CultureInfo.InvariantCulture));
        if (options.Device != "auto") Arg("--device", options.Device);
        if (!sliding && options.RequireGpu) start.ArgumentList.Add("--require-gpu");
        using var process = new Process { StartInfo = start };
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(options.TimeoutMs);
        var tasks = new List<Task>();
        try
        {
            process.Start();
            var stdout = ReadAsync(process.StandardOutput, deadline.Token); var stderr = ReadAsync(process.StandardError, deadline.Token);
            tasks.AddRange([stdout, stderr, process.WaitForExitAsync(deadline.Token)]);
            var pending = tasks.ToList();
            while (pending.Count > 0) { var done = await Task.WhenAny(pending); await done; pending.Remove(done); }
            var output = (await stdout).Trim(); var error = (await stderr).Trim();
            if (error.Length > 0) logger.LogDebug("Face Python stderr: {Stderr}", error);
            if (output.Length == 0 && process.ExitCode != 0)
                throw new FaceFailure("PYTHON_PROCESS_ERROR", sliding ? $"Sliding window process exited with code {process.ExitCode}." : "Face verification process failed.", 502);
            JsonObject raw;
            try { raw = JsonNode.Parse(output) as JsonObject ?? throw new JsonException(); }
            catch (JsonException) { throw new FaceFailure("PYTHON_OUTPUT_INVALID", sliding ? "Failed to parse sliding window output as JSON." : "Invalid response received from face verification process.", 502); }
            return Normalize(raw, sliding);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        { throw new FaceFailure("PYTHON_TIMEOUT", sliding ? $"Sliding window process timed out after {options.TimeoutMs}ms." : "Face verification process timed out.", 504); }
        finally
        {
            deadline.Cancel();
            try { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); } } catch (InvalidOperationException) { }
            try { await Task.WhenAll(tasks); } catch { /* Observe canceled streams after process shutdown. */ }
        }
    }

    public static JsonObject Normalize(JsonObject raw, bool sliding)
    {
        bool Boolean(string name) => raw[name] is JsonValue v && v.TryGetValue<bool>(out _);
        var invalid = new FaceFailure("PYTHON_OUTPUT_INVALID", sliding ? "Sliding window output missing ok/matched booleans." : "Invalid response received from face verification process.", 502);
        if (!Boolean("ok") || !Boolean("matched")) throw invalid;
        if (!sliding && raw["score"] is not null && Number(raw["score"]) is null) throw invalid;
        var result = new JsonObject { ["ok"] = raw["ok"]!.DeepClone(), ["matched"] = raw["matched"]!.DeepClone(), ["score"] = Number(raw["score"]), ["reason"] = Text(raw["reason"]) };
        if (sliding)
        {
            foreach (var name in new[] { "windowSizeBefore", "windowSizeAfter", "threshold" })
            {
                if (Number(raw[name]) is not { } number) throw new FaceFailure("PYTHON_OUTPUT_INVALID", "Sliding window output missing numeric window/threshold fields.", 502);
                result[name] = number;
            }
            static JsonObject? Entry(JsonNode? n)
            {
                if (n is not JsonObject o || string.IsNullOrEmpty(Text(o["id"])) || Number(o["ts"]) is null) return null;
                var entry = new JsonObject { ["id"] = Text(o["id"]), ["ts"] = Number(o["ts"]) };
                if (Text(o["image"]) is { Length: > 0 } image) entry["image"] = image;
                return entry;
            }
            result["added"] = Entry(raw["added"]);
            result["evicted"] = new JsonArray((raw["evicted"] as JsonArray ?? []).Select(Entry).Where(e => e is not null).Cast<JsonNode>().ToArray());
            result["perReferenceScores"] = new JsonArray((raw["perReferenceScores"] as JsonArray ?? []).OfType<JsonObject>()
                .Where(o => Text(o["id"]) is { Length: > 0 } && Number(o["ts"]) is not null && Number(o["score"]) is not null)
                .Select(o => (JsonNode)new JsonObject { ["id"] = Text(o["id"]), ["ts"] = Number(o["ts"]), ["score"] = Number(o["score"]) }).ToArray());
        }
        else
        {
            if (raw["runtime"] is JsonObject rt)
            {
                var runtime = new JsonObject { ["device"] = Text(rt["device"]) == "cuda" ? "cuda" : "cpu", ["cudaAvailable"] = rt["cudaAvailable"] is JsonValue v && v.TryGetValue<bool>(out var b) && b,
                    ["cudaDeviceName"] = Text(rt["cudaDeviceName"]), ["fallbackReason"] = Text(rt["fallbackReason"]) };
                if (Text(rt["model"]) is { } model) runtime["model"] = model;
                result["runtime"] = runtime;
            }
            if (result["ok"]!.GetValue<bool>() == false && Text(result["reason"]) == "gpu_required")
                throw new FaceFailure("GPU_REQUIRED", "GPU is required for face verification but CUDA is unavailable.", 503);
        }
        return result;
    }

    private static async Task<string> ReadAsync(StreamReader reader, CancellationToken token)
    {
        var result = new StringBuilder(); var buffer = new char[4096]; var bytes = 0; int count;
        while ((count = await reader.ReadAsync(buffer.AsMemory(), token)) > 0)
        {
            bytes += Encoding.UTF8.GetByteCount(buffer, 0, count);
            if (bytes > 1024 * 1024) throw new FaceFailure("PYTHON_OUTPUT_INVALID", "Face process output exceeded the limit.", 502);
            result.Append(buffer, 0, count);
        }
        return result.ToString();
    }
}
