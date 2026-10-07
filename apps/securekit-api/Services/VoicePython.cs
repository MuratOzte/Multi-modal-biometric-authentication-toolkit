using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SecureKit.Api.Infrastructure;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public interface IVoicePython
{
    Task<JsonObject> RunAsync(JsonObject input, CancellationToken token);
}

// Own one instance of the existing JSON-lines worker per request; always stop it before deleting audio.
public sealed class VoicePython(VoiceOptions options, ILogger<VoicePython> logger) : IVoicePython
{
    public async Task<JsonObject> RunAsync(JsonObject input, CancellationToken token)
    {
        var commands = options.PythonCommand is { Length: > 0 } explicitCommand ? new[] { explicitCommand } : Candidates().ToArray();
        VoiceFailure? last = null;
        foreach (var command in commands)
        {
            try { return await RunOnce(input, command, token); }
            catch (Win32Exception ex) { last = new VoiceFailure("PYTHON_RUNTIME_UNAVAILABLE", "Python runtime is not available for voice verification.", 503, ex.Message); }
            catch (VoiceFailure ex) when (ex.Code == "PYTHON_DEPENDENCY_MISSING") { last = ex; }
        }
        throw last ?? new VoiceFailure("PYTHON_RUNTIME_UNAVAILABLE", "Python runtime is not available for voice verification.", 503);
    }

    private IEnumerable<string> Candidates()
    {
        foreach (var name in new[] { ".venv-voice", ".venv" })
        {
            var path = Path.Combine(options.RepositoryRoot, name, OperatingSystem.IsWindows() ? "Scripts/python.exe" : "bin/python");
            if (File.Exists(path)) yield return path;
        }
        if (OperatingSystem.IsWindows()) yield return "py -3";
        yield return "python3"; yield return "python";
    }

    private async Task<JsonObject> RunOnce(JsonObject input, string command, CancellationToken token)
    {
        var launcher = command.Trim() is "py -3" or "py -3.11";
        var start = new ProcessStartInfo(launcher ? "py" : command.Trim().Trim('"'))
        {
            WorkingDirectory = options.RepositoryRoot, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, StandardInputEncoding = new UTF8Encoding(false)
        };
        start.Environment["PYTHONIOENCODING"] = "utf-8"; start.Environment["PYTHONUTF8"] = "1";
        if (launcher) start.ArgumentList.Add(command.Trim()[3..]);
        foreach (var arg in options.PythonArgs) start.ArgumentList.Add(arg);
        start.ArgumentList.Add(options.ScriptPath);
        void Arg(string key, string value) { start.ArgumentList.Add(key); start.ArgumentList.Add(value); }
        Arg("--device", options.Device); Arg("--whisper-model", options.WhisperModel); Arg("--speaker-model", options.SpeakerModel);
        if (options.RequireGpu) start.ArgumentList.Add("--require-gpu");
        using var process = new Process { StartInfo = start };
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(options.TimeoutMs);
        Task? stderr = null; Task<JsonObject>? conversation = null;
        ProcessJob? job = null;
        var errorText = new StringBuilder();
        try
        {
            process.Start();
            job = ProcessJob.Attach(process);
            stderr = DrainError(process.StandardError, errorText, deadline.Token);
            conversation = Converse(process, input, deadline.Token);
            var first = await Task.WhenAny(stderr, conversation);
            if (first == stderr) await stderr; // Propagate output limits immediately, including during startup.
            var result = await conversation;
            if (stderr.IsFaulted) await stderr;
            return result;
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        { throw new VoiceFailure("PYTHON_TIMEOUT", "Voice verification process timed out.", 504); }
        catch (IOException) { throw new VoiceFailure("PYTHON_PROCESS_ERROR", "Voice verification process failed.", 502); }
        catch (VoiceFailure ex) when (ex.Code == "PYTHON_PROCESS_ERROR")
        {
            if (process.HasExited && stderr is not null) await stderr;
            var details = errorText.ToString().Trim();
            var dependency = Regex.Match(details, "(?:ModuleNotFoundError|ImportError): No module named ['\"]([^'\"]+)['\"]", RegexOptions.IgnoreCase);
            if (dependency.Success) throw new VoiceFailure("PYTHON_DEPENDENCY_MISSING", $"Python voice dependency is missing: {dependency.Groups[1].Value}. Install python/voice_verification/requirements.txt in .venv-voice or set VOICE_PYTHON_BIN to a configured voice environment.", 503, details);
            throw;
        }
        finally
        {
            deadline.Cancel();
            job?.Dispose();
            try { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); } } catch (InvalidOperationException) { }
            try { if (stderr is not null) await stderr; } catch { }
            try { if (conversation is not null) await conversation; } catch { }
            if (errorText.Length > 0) logger.LogDebug("Voice Python stderr: {Stderr}", errorText.ToString());
        }
    }

    private static async Task<JsonObject> Converse(Process process, JsonObject input, CancellationToken token)
    {
        var line = new StringBuilder(); var buffer = new char[4096]; var bytes = 0; var ready = false;
        var request = (JsonObject)input.DeepClone(); request["id"] = "1";
        int count;
        while ((count = await process.StandardOutput.ReadAsync(buffer.AsMemory(), token)) > 0)
        {
            bytes += Encoding.UTF8.GetByteCount(buffer, 0, count);
            if (bytes > 1024 * 1024) throw InvalidOutput();
            for (var i = 0; i < count; i++)
            {
                if (buffer[i] != '\n') { line.Append(buffer[i]); continue; }
                var text = line.ToString().Trim(); line.Clear(); if (text.Length == 0) continue;
                JsonObject raw;
                try { raw = JsonNode.Parse(text) as JsonObject ?? throw new JsonException(); }
                catch (JsonException) { throw InvalidOutput(); }
                if (!ready)
                {
                    if (Text(raw["event"]) != "ready" || raw["ok"] is not JsonValue value || !value.TryGetValue<bool>(out var ok)) throw InvalidOutput();
                    if (!ok) throw Text(raw["reason"]) == "gpu_required"
                        ? new VoiceFailure("GPU_REQUIRED", "GPU is required for voice verification but CUDA is unavailable.", 503)
                        : new VoiceFailure("PYTHON_PROCESS_ERROR", "Voice verification process failed.", 502);
                    ready = true;
                    await process.StandardInput.WriteLineAsync(request.ToJsonString().AsMemory(), token);
                    await process.StandardInput.FlushAsync(token);
                }
                else
                {
                    if (Text(raw["id"]) != "1") throw InvalidOutput();
                    return Normalize(raw);
                }
            }
        }
        throw new VoiceFailure("PYTHON_PROCESS_ERROR", "Voice verification process failed.", 502);
    }

    public static JsonObject Normalize(JsonObject raw)
    {
        if (raw["ok"] is not JsonValue ok || !ok.TryGetValue<bool>(out var success) || raw["transcript"] is not JsonObject text || raw["runtime"] is not JsonObject runtime) throw InvalidOutput();
        if (raw["embedding"] is not null && (raw["embedding"] is not JsonArray array || array.Any(v => Number(v) is null))) throw InvalidOutput();
        bool Boolean(JsonNode? node) => node is JsonValue v && v.TryGetValue<bool>(out var b) && b;
        return new JsonObject
        {
            ["ok"] = success, ["embedding"] = raw["embedding"]?.DeepClone(), ["reason"] = Text(raw["reason"]),
            ["transcript"] = new JsonObject { ["expectedText"] = Text(text["expectedText"]) ?? "", ["transcript"] = Text(text["transcript"]),
                ["similarityScore"] = Number(text["similarityScore"]) ?? 0, ["matched"] = Boolean(text["matched"]), ["threshold"] = Number(text["threshold"]) ?? 0 },
            ["runtime"] = new JsonObject { ["device"] = Text(runtime["device"]) == "cuda" ? "cuda" : "cpu", ["cudaAvailable"] = Boolean(runtime["cudaAvailable"]),
                ["cudaDeviceName"] = Text(runtime["cudaDeviceName"]), ["fallbackReason"] = Text(runtime["fallbackReason"]),
                ["whisperModel"] = Text(runtime["whisperModel"]) ?? "base", ["speakerModel"] = Text(runtime["speakerModel"]) ?? VoiceOptions.SpeakerModelDefault }
        };
    }
    private static VoiceFailure InvalidOutput() => new("PYTHON_OUTPUT_INVALID", "Invalid response received from voice verification process.", 502);
    private static async Task DrainError(StreamReader reader, StringBuilder result, CancellationToken token)
    {
        var buffer = new char[4096]; var bytes = 0; int count;
        while ((count = await reader.ReadAsync(buffer.AsMemory(), token)) > 0)
        {
            bytes += Encoding.UTF8.GetByteCount(buffer, 0, count);
            if (bytes > 1024 * 1024) throw InvalidOutput();
            result.Append(buffer, 0, count);
        }
    }
}
