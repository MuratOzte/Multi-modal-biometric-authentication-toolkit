using System.ComponentModel;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SecureKit.Api.Infrastructure;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public interface ICardPython
{
    Task<JsonObject> RunAsync(JsonObject input, CancellationToken token);
}

// Own one instance of the JSON-lines worker per request; stop it before deleting images.
public sealed class CardPython(CardOptions options, ILogger<CardPython> logger) : ICardPython
{
    public async Task<JsonObject> RunAsync(JsonObject input, CancellationToken token)
    {
        var commands = options.PythonCommand is { Length: > 0 } explicitCommand ? new[] { explicitCommand } : Candidates().ToArray();
        CardFailure? last = null;
        foreach (var command in commands)
        {
            try { return await RunOnce(input, command, token); }
            catch (Win32Exception) { last = new CardFailure("PYTHON_RUNTIME_UNAVAILABLE", "Python runtime is not available for card verification.", 503); }
            catch (CardFailure ex) when (ex.Code == "PYTHON_DEPENDENCY_MISSING") { last = ex; }
        }
        if (last?.Code == "PYTHON_DEPENDENCY_MISSING") throw new CardFailure("PYTHON_PROCESS_ERROR", last.Message, 502, last.Details);
        throw last ?? new CardFailure("PYTHON_RUNTIME_UNAVAILABLE", "Python runtime is not available for card verification.", 503);
    }

    private IEnumerable<string> Candidates()
    {
        foreach (var name in new[] { ".venv-card", ".venv" })
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
        start.ArgumentList.Add("--worker");
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
        { throw new CardFailure("PYTHON_TIMEOUT", "Card verification process timed out.", 504); }
        catch (IOException) { throw new CardFailure("PYTHON_PROCESS_ERROR", "Card verification process failed.", 502); }
        catch (CardFailure ex) when (ex.Code == "PYTHON_PROCESS_ERROR")
        {
            if (process.HasExited && stderr is not null) await stderr;
            var details = errorText.ToString().Trim();
            var dependency = Regex.Match(details, "(?:ModuleNotFoundError|ImportError): No module named ['\"]([^'\"]+)['\"]", RegexOptions.IgnoreCase);
            if (dependency.Success) throw new CardFailure("PYTHON_DEPENDENCY_MISSING", $"Python card dependency is missing: {dependency.Groups[1].Value}. Install python/card_verification/requirements.txt in the selected Python environment or set CARD_PYTHON_BIN to a configured card environment.", 502, details);
            throw;
        }
        finally
        {
            deadline.Cancel();
            job?.Dispose();
            try { if (!process.HasExited) { process.Kill(true); await process.WaitForExitAsync(CancellationToken.None); } } catch (InvalidOperationException) { }
            try { if (stderr is not null) await stderr; } catch { }
            try { if (conversation is not null) await conversation; } catch { }
            if (errorText.Length > 0) logger.LogDebug("Card Python stderr: {Stderr}", errorText.ToString());
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
                    if (!ok) throw Text(raw["reason"]) == "invalid_request" ? InvalidOutput()
                        : new CardFailure("PYTHON_PROCESS_ERROR", "Card verification process failed.", 502);
                    ready = true;
                    await process.StandardInput.WriteLineAsync(request.ToJsonString().AsMemory(), token);
                    await process.StandardInput.FlushAsync(token);
                }
                else
                {
                    if (Text(raw["id"]) != "1") throw InvalidOutput();
                    return CardResult.Normalize(raw);
                }
            }
        }
        throw new CardFailure("PYTHON_PROCESS_ERROR", "Card verification process failed.", 502);
    }

    private static CardFailure InvalidOutput() => new("PYTHON_OUTPUT_INVALID", "Invalid response received from card verification process.", 502);
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
