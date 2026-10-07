using System.Diagnostics;
using System.Text.Json.Nodes;

namespace SecureKit.Api.Services;

public interface IIpCheckService
{
    Task<JsonObject> CheckAsync(string ip, string? expectedCountry, string? scenario, CancellationToken cancellationToken);
}

public sealed class IpCheckService(IConfiguration configuration, IWebHostEnvironment environment) : IIpCheckService
{
    public async Task<JsonObject> CheckAsync(string ip, string? expectedCountry, string? scenario, CancellationToken cancellationToken)
    {
        if ((configuration["MOCK_IP_CHECK"] ?? configuration["IpCheck:Mock"]) == "1")
        {
            var risky = scenario == "risky";
            var country = risky ? "RU" : "TR";
            return new JsonObject
            {
                ["same_country"] = expectedCountry is null ? null : JsonValue.Create(country == expectedCountry),
                ["ip_country_code"] = country, ["expected_country_code"] = expectedCountry,
                ["ip_info"] = new JsonObject
                {
                    ["ip"] = ip,
                    ["security"] = new JsonObject { ["vpn"] = risky, ["proxy"] = risky, ["tor"] = risky, ["relay"] = risky, ["hosting"] = risky, ["mobile"] = false, ["suspicious"] = risky },
                    ["location"] = new JsonObject { ["city"] = risky ? "Moscow" : "Istanbul", ["region"] = risky ? "Moscow" : "Istanbul", ["country"] = risky ? "Russia" : "Turkey", ["country_code"] = country, ["time_zone"] = risky ? "UTC" : "Europe/Istanbul", ["utc_offset_minutes"] = risky ? 0 : 180 },
                    ["network"] = new JsonObject { ["asn"] = risky ? 64512 : 15169, ["network"] = risky ? "1.1.1.0/24" : "8.8.8.0/24" }
                }
            };
        }
        var script = configuration["IpCheck:ScriptPath"] ?? Path.GetFullPath(Path.Combine(environment.ContentRootPath, "../../python/ip_check.py"));
        var start = new ProcessStartInfo(configuration["PYTHON_CMD"] ?? configuration["IpCheck:PythonCommand"] ?? (OperatingSystem.IsWindows() ? "py" : "python3"))
        { WorkingDirectory = Path.GetDirectoryName(script)!, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add(script);
        start.ArgumentList.Add(ip);
        if (expectedCountry is not null) start.ArgumentList.Add(expectedCountry);
        if (configuration["IpCheck:ApiKey"] is { } key) start.Environment["VPNAPI_KEY"] = key;
        using var process = new Process { StartInfo = start };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMilliseconds(JsonValues.Ttl(configuration, "IP_CHECK_TIMEOUT_SECONDS", "IpCheck:TimeoutSeconds", 15000)));
        try
        {
            process.Start();
            var stdout = ReadBoundedAsync(process.StandardOutput, timeout.Token);
            var stderr = ReadBoundedAsync(process.StandardError, timeout.Token);
            await Task.WhenAll(process.WaitForExitAsync(timeout.Token), stdout, stderr);
            if (process.ExitCode != 0) throw new InvalidOperationException($"ip_check.py exited with code {process.ExitCode}: {await stderr}");
            return JsonNode.Parse(await stdout) as JsonObject ?? throw new InvalidOperationException("IP verification returned a non-object JSON result.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException("IP verification timed out.");
        }
        finally
        {
            try { if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(CancellationToken.None); } }
            catch (InvalidOperationException) { /* Process was never started. */ }
        }
    }

    private static async Task<string> ReadBoundedAsync(StreamReader reader, CancellationToken token)
    {
        var text = new System.Text.StringBuilder();
        var buffer = new char[4096];
        int count;
        while ((count = await reader.ReadAsync(buffer.AsMemory(), token)) > 0)
        {
            if (text.Length + count > 1024 * 1024) throw new InvalidOperationException("IP verification output exceeded the limit.");
            text.Append(buffer, 0, count);
        }
        return text.ToString();
    }
}
