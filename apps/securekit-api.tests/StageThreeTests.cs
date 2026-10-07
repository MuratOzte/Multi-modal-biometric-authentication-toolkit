using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SecureKit.Api.Services;
using SecureKit.Api.Tests.Support;

namespace SecureKit.Api.Tests;

public sealed class StageThreeTests
{
    private sealed class Stub(JsonObject? output = null, bool fail = false) : IIpCheckService
    {
        public Task<JsonObject> CheckAsync(string ip, string? expectedCountry, string? scenario, CancellationToken cancellationToken) =>
            fail ? throw new InvalidOperationException("boom") : Task.FromResult(output?.DeepClone().AsObject() ?? new JsonObject());
    }
    private sealed class Factory(IIpCheckService? service = null, Dictionary<string, string?>? settings = null) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?> { ["MOCK_IP_CHECK"] = "1" });
                if (settings is not null) config.AddInMemoryCollection(settings);
            });
            if (service is not null) builder.ConfigureServices(services => services.AddSingleton(service));
        }
    }
    private static async Task<JsonNode> Send(HttpClient client, string route, object body, HttpStatusCode status = HttpStatusCode.OK, bool ip = true)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, route) { Content = JsonContent.Create(body) };
        if (ip) request.Headers.Add("x-forwarded-for", " 1.2.3.4, 5.6.7.8");
        return await ContractAssert.JsonResponseAsync(await client.SendAsync(request), status);
    }

    [Theory]
    [InlineData(240, 1, 0)]
    [InlineData(241, .9, 1)]
    [InlineData(360, .9, 1)]
    [InlineData(361, .7, 1)]
    [InlineData(540, .7, 1)]
    [InlineData(541, .5, 1)]
    public async Task DriftBoundaries(double offset, double score, int reasons)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var result = await Send(client, "/verify/network", new { clientOffsetMin = "invalid", tzOffset = offset });
        Assert.Equal(score, result["score"]!.GetValue<double>(), 12);
        Assert.Equal(reasons, result["reasons"]!.AsArray().Count);
        Assert.Equal("1.2.3.4", result["ipInfo"]!["ip"]!.GetValue<string>());
    }

    [Fact]
    public async Task RiskyFixtureAndLegacyVpnScenarioBehavior()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var result = await Send(client, "/verify/network", new { scenario = "risky", clientOffsetMin = 400 });
        Assert.False(result["ok"]!.GetValue<bool>());
        Assert.Equal(0, result["score"]!.GetValue<double>());
        Assert.Equal(5, result["reasons"]!.AsArray().Count);
        var legacy = await Send(client, "/verify/vpn:check", new { scenario = "risky", clientTimezone = "Europe/Istanbul", clientTimezoneOffset = 180 });
        Assert.True(legacy["ok"]!.GetValue<bool>());
        Assert.Equal("Europe/Istanbul", legacy["details"]!["clientTimeZone"]!.GetValue<string>());
        Assert.Equal(0, legacy["details"]!["timezoneDriftHours"]!.GetValue<double>());
    }

    [Theory]
    [InlineData("tr", true)]
    [InlineData("US", false)]
    public async Task CountriesAreNormalized(string country, bool allowed)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var result = await Send(client, "/verify/location", new { allowedCountries = new object[] { " " + country + " ", 4, null!, country } });
        Assert.Equal(allowed, result["allowed"]!.GetValue<bool>());
        var legacy = await Send(client, "/verify/location:country", new { expectedCountryCode = " " + country + " " });
        Assert.Equal(allowed ? 1 : .2, legacy["score"]!.GetValue<double>());
    }

    [Fact]
    public async Task UnknownCountryWithoutPolicyIsAllowedAndRawIsOmitted()
    {
        using var factory = new Factory(new Stub()); using var client = factory.CreateClient();
        var location = await Send(client, "/verify/location", new { });
        Assert.True(location["ok"]!.GetValue<bool>());
        Assert.Empty(location["reasons"]!.AsArray());
        location = await Send(client, "/verify/location", new { allowedCountries = new[] { "TR" } });
        Assert.Equal(2, location["reasons"]!.AsArray().Count);
        var network = await Send(client, "/verify/network", new { });
        Assert.False(network.AsObject().ContainsKey("raw"));
    }

    [Theory]
    [InlineData("/verify/network", 502)]
    [InlineData("/verify/location", 502)]
    [InlineData("/verify/vpn:check", 500)]
    [InlineData("/verify/location:country", 500)]
    public async Task ServiceFailuresPreserveEndpointContracts(string route, int status)
    {
        using var factory = new Factory(new Stub(fail: true)); using var client = factory.CreateClient();
        var result = await Send(client, route, new { }, (HttpStatusCode)status);
        if (status == 502) Assert.Equal("boom", result["error"]!["details"]!.GetValue<string>());
        else Assert.False(result["ok"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData("/verify/network")]
    [InlineData("/verify/location")]
    [InlineData("/verify/vpn:check")]
    [InlineData("/verify/location:country")]
    public async Task MissingIpHasItsOwnContract(string route)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        await Send(client, route, new { }, HttpStatusCode.BadRequest, ip: false);
    }

    [Theory]
    [InlineData("{}", false)]
    [InlineData("{\"proof\":{}}", true)]
    [InlineData("{\"proof\":0}", false)]
    [InlineData("{\"proof\":\"false\"}", true)]
    public async Task PasskeyUsesJavaScriptTruthiness(string body, bool ok)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var result = await Send(client, "/verify/webauthn:passkey", JsonNode.Parse(body)!);
        Assert.Equal(ok, result["ok"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData(.8, true, false)]
    [InlineData(.81, true, true)]
    [InlineData(.9, false, false)]
    public async Task LivenessQualityAndIllumination(double quality, bool illumination, bool ok)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var result = await Send(client, "/verify/face:liveness", new { proof = new { tasksOk = true }, metrics = new { quality, illuminationOk = illumination } });
        Assert.Equal(ok, result["ok"]!.GetValue<bool>());
        Assert.Equal(illumination, result["details"]!["illuminationOk"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData("/verify/network")]
    [InlineData("/verify/face:liveness")]
    public async Task InvalidJsonUsesCentralValidation(string route)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        await ContractAssert.ErrorAsync(await client.PostAsync(route, new StringContent("{", System.Text.Encoding.UTF8, "application/json")), HttpStatusCode.BadRequest, "VALIDATION_ERROR");
    }

    [Theory]
    [InlineData("success")]
    [InlineData("invalid-json")]
    [InlineData("non-object")]
    [InlineData("exit")]
    [InlineData("timeout")]
    [InlineData("missing")]
    [InlineData("output-limit")]
    [InlineData("cancel")]
    public async Task PythonProcessBridge(string mode)
    {
        var directory = Path.Combine(Path.GetTempPath(), "securekit-ip-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        var script = Path.Combine(directory, "fixture.py");
        var pidFile = Path.Combine(directory, "pid.txt");
        var code = mode switch
        {
            "success" => "print(json.dumps({'ip_country_code':sys.argv[2], 'ip_info':{'ip':sys.argv[1]}}))",
            "invalid-json" => "print('broken')",
            "non-object" => "print('[]')",
            "exit" => "sys.exit(7)",
            "output-limit" => "print('x' * (1024 * 1024 + 10))",
            _ => "time.sleep(30)"
        };
        await File.WriteAllTextAsync(script, "import os,sys,time,json\nopen(os.path.join(os.path.dirname(__file__), 'pid.txt'),'w').write(str(os.getpid()))\n" + code + "\n");
        try
        {
            using var factory = new Factory(settings: new Dictionary<string, string?>
            {
                ["MOCK_IP_CHECK"] = "0", ["PYTHON_CMD"] = mode == "missing" ? "securekit-missing-python-command" : OperatingSystem.IsWindows() ? "py" : "python3",
                ["IpCheck:ScriptPath"] = script, ["IP_CHECK_TIMEOUT_SECONDS"] = mode == "timeout" ? "1" : "5"
            });
            using var client = factory.CreateClient();
            if (mode == "cancel")
            {
                using var cancellation = new CancellationTokenSource();
                var service = factory.Services.GetRequiredService<IIpCheckService>();
                var task = service.CheckAsync("1.2.3.4", null, null, cancellation.Token);
                for (var i = 0; i < 100 && !File.Exists(pidFile); i++) await Task.Delay(20);
                cancellation.Cancel();
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
            }
            else
            {
                var result = await Send(client, "/verify/location:country", new { expectedCountryCode = "tr" }, mode == "success" ? HttpStatusCode.OK : HttpStatusCode.InternalServerError);
                Assert.Equal(mode == "success", result["ok"]!.GetValue<bool>());
            }
            if (File.Exists(pidFile))
            {
                var pid = int.Parse(await File.ReadAllTextAsync(pidFile));
                var running = false;
                try { using var process = System.Diagnostics.Process.GetProcessById(pid); running = !process.HasExited; }
                catch (ArgumentException) { }
                Assert.False(running, "Python worker must exit or be killed before the request completes.");
            }
        }
        finally { Directory.Delete(directory, true); }
    }
}
