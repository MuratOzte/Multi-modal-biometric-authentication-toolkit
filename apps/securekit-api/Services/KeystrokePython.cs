using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public interface IKeystrokePython
{
    Task<JsonObject> RunAsync(JsonObject input, CancellationToken cancellationToken);
}

public sealed class KeystrokePython(IConfiguration config, IWebHostEnvironment environment, ILogger<KeystrokePython> logger) : IKeystrokePython
{
    public async Task<JsonObject> RunAsync(JsonObject input, CancellationToken cancellationToken)
    {
        var explicitCommand = config["PYTHON_BIN"] ?? config["Keystroke:PythonCommand"];
        var commands = explicitCommand is not null ? new[] { explicitCommand } : OperatingSystem.IsWindows() ? new[] { "py -3", "python3", "python" } : new[] { "python3", "python" };
        foreach (var command in commands)
        {
            try { return await RunOnceAsync(input, command, cancellationToken); }
            catch (Win32Exception) { if (explicitCommand is not null) break; }
            catch (KeystrokeFailure ex) when (ex.Code == "PYTHON_EXIT_NON_ZERO" && (ex.Message.Contains("code 9009 ", StringComparison.Ordinal) || ex.Message.Contains("code 127 ", StringComparison.Ordinal)))
            { if (explicitCommand is not null) break; }
        }
        throw new KeystrokeFailure("PYTHON_SPAWN_FAILED", "Python runtime not found. Install Python 3 or set PYTHON_BIN (Windows example: \"py -3\").");
    }

    private async Task<JsonObject> RunOnceAsync(JsonObject input, string command, CancellationToken cancellationToken)
    {
        var script = Path.GetFullPath(config["Keystroke:ScriptPath"] ?? Path.Combine(environment.ContentRootPath, "../../packages/node-auth/src/keystroke/python/keystroke_ml.py"));
        // A complete executable path (including spaces) is preferred. Only the Python launcher accepts the legacy "py -3" shorthand.
        var launcher = command.Trim() is "py -3" or "py -3.11";
        var start = new ProcessStartInfo(launcher ? "py" : command.Trim().Trim('"'))
        { WorkingDirectory = Path.GetDirectoryName(script)!, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true, StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        if (launcher) start.ArgumentList.Add(command.Trim()[3..]);
        foreach (var arg in config.GetSection("Keystroke:PythonArgs").Get<string[]>() ?? []) start.ArgumentList.Add(arg);
        start.ArgumentList.Add(script);
        var rawTimeout = config["KEYSTROKE_FIXED_PYTHON_TIMEOUT_MS"] ?? config["Keystroke:PythonTimeoutMs"];
        var timeoutMs = double.TryParse(rawTimeout, out var n) && double.IsFinite(n) && n > 0 ? Math.Floor(n + .5) : 2000;
        using var process = new Process { StartInfo = start };
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromMilliseconds(timeoutMs));
        var tasks = new List<Task>();
        try
        {
            process.Start();
            var stdout = ReadAsync(process.StandardOutput, deadline.Token); var stderr = ReadAsync(process.StandardError, deadline.Token);
            async Task WriteAsync() { await process.StandardInput.WriteAsync(input.ToJsonString().AsMemory(), deadline.Token); process.StandardInput.Close(); }
            tasks.AddRange([stdout, stderr, WriteAsync(), process.WaitForExitAsync(deadline.Token)]);
            // Fail on a stream limit immediately; waiting for all streams could leave a blocked worker alive.
            var pending = tasks.ToList();
            while (pending.Count > 0) { var done = await Task.WhenAny(pending); await done; pending.Remove(done); }
            var output = (await stdout).Trim(); var error = (await stderr).Trim();
            if (error.Length > 0) logger.LogDebug("Keystroke Python stderr: {Stderr}", error);
            if (process.ExitCode != 0) throw new KeystrokeFailure("PYTHON_EXIT_NON_ZERO", $"Python keystroke process exited with code {process.ExitCode} .", error.Length > 0 ? error : output.Length > 0 ? output : null);
            JsonObject result;
            try { result = JsonNode.Parse(output) as JsonObject ?? throw new JsonException("Expected a JSON object."); }
            catch (JsonException) { throw new KeystrokeFailure("PYTHON_JSON_PARSE_ERROR", "Failed to parse python keystroke output as JSON."); }
            if (result["ok"] is JsonValue v && v.TryGetValue<bool>(out var ok) && !ok) throw new KeystrokeFailure("PYTHON_REPORTED_ERROR", Text(result["error"]) ?? "Python reported an error.", Text(result["details"]));
            return result;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { throw new KeystrokeFailure("PYTHON_TIMEOUT", $"Python keystroke process timed out after {timeoutMs}ms."); }
        catch (IOException ex) { throw new KeystrokeFailure("PYTHON_EXIT_NON_ZERO", "Python keystroke process closed its input stream.", ex.Message); }
        finally
        {
            deadline.Cancel();
            try { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); } }
            catch (InvalidOperationException) { }
            try { await Task.WhenAll(tasks); } catch { /* Observe stream failures after shutdown. */ }
        }
    }

    private static async Task<string> ReadAsync(StreamReader reader, CancellationToken token)
    {
        var output = new StringBuilder(); var buffer = new char[4096]; int count; var bytes = 0;
        while ((count = await reader.ReadAsync(buffer.AsMemory(), token)) > 0)
        {
            bytes += Encoding.UTF8.GetByteCount(buffer, 0, count);
            if (bytes > 1024 * 1024) throw new KeystrokeFailure("PYTHON_PROTOCOL_ERROR", "Python keystroke output exceeded the limit.");
            output.Append(buffer, 0, count);
        }
        return output.ToString();
    }
}
