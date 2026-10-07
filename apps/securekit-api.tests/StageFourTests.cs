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

public sealed class StageFourTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.Parse("2026-10-07T09:00:00Z");
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Factory(Dictionary<string, string?>? settings = null) : WebApplicationFactory<Program>
    {
        public string DirectoryPath { get; } = Path.Combine(Path.GetTempPath(), "securekit-stage4-" + Guid.NewGuid());
        public Clock Clock { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?> { ["SECUREKIT_PROFILE_STORE"] = Path.Combine(DirectoryPath, "profiles.json"), ["SECUREKIT_KEYSTROKE_STORE"] = Path.Combine(DirectoryPath, "fixed"),
                    ["PYTHON_BIN"] = OperatingSystem.IsWindows() ? "py -3" : "python3", ["KEYSTROKE_FIXED_PYTHON_TIMEOUT_MS"] = "5000" });
                if (settings is not null) config.AddInMemoryCollection(settings);
            });
            builder.ConfigureServices(services => services.AddSingleton<TimeProvider>(Clock));
        }
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing && Directory.Exists(DirectoryPath)) Directory.Delete(DirectoryPath, true);
        }
    }
    private static JsonObject Dynamic(double scale = 1) => new()
    {
        ["events"] = new JsonArray(Enumerable.Range(0, 20).SelectMany(i => new JsonNode[] {
            new JsonObject { ["key"] = "a", ["code"] = "KeyA", ["type"] = "down", ["t"] = (50 + i * 150) * scale, ["expectedIndex"] = i },
            new JsonObject { ["key"] = "a", ["code"] = "KeyA", ["type"] = "up", ["t"] = (130 + i * 150) * scale, ["expectedIndex"] = i }
        }).ToArray()), ["typedLength"] = 20, ["expectedText"] = "alpha beta gamma"
    };
    private static JsonObject Fixed(long now) => new()
    {
        ["textId"] = "text/ş?1", ["text"] = "alpha beta gamma", ["holdMs"] = new JsonArray(Enumerable.Repeat(90, 16).Select(n => (JsonNode)JsonValue.Create(n)!).ToArray()),
        ["ddMs"] = new JsonArray(Enumerable.Repeat(180, 15).Select(n => (JsonNode)JsonValue.Create(n)!).ToArray()),
        ["udMs"] = new JsonArray(Enumerable.Repeat(90, 15).Select(n => (JsonNode)JsonValue.Create(n)!).ToArray()),
        ["meta"] = new JsonObject { ["timestamp"] = now, ["durationMs"] = 3000 }
    };
    private static async Task<JsonNode> Send(HttpClient client, string route, object body, HttpStatusCode status = HttpStatusCode.OK) =>
        await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync(route, body), status);
    private static async Task<JsonNode> Verify(HttpClient client, JsonObject sample, object? policy = null, string user = "u")
    {
        var challenge = await Send(client, "/challenge/text", new { text = "alpha beta gamma" });
        return await Send(client, "/verify/keystroke", new { userId = user, challengeId = challenge["challengeId"]!.GetValue<string>(), sample, policy = policy ?? new { } });
    }
    public static IEnumerable<object[]> SharedCases() => Enumerable.Range(0, 12).Select(i => new object[] { i });

    [Theory]
    [MemberData(nameof(SharedCases))]
    public async Task NodeFixturesMatchMetricsEnrollmentAndScoring(int index)
    {
        var fixtures = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Fixtures", "keystroke-stage4.json")))!.AsArray();
        var fixture = fixtures[index]!; var sample = fixture["sample"]!.DeepClone().AsObject();
        var (metrics, reasons) = KeystrokeMetrics.Compute(sample);
        Assert.True(JsonNode.DeepEquals(fixture["metrics"], metrics), fixture["name"]!.GetValue<string>());
        Assert.Equal(fixture["reasons"]!.AsArray().Select(r => r!.GetValue<string>()), reasons);
        var built = KeystrokeEnrollment.Build("fixture", sample, null, "2026-10-07T09:00:00.000Z", 10, 160);
        Assert.True(JsonNode.DeepEquals(fixture["profile"], built["profile"]));
        using var factory = new Factory();
        var storage = factory.Services.GetRequiredService<IProfileStorage>();
        await storage.SaveProfilesAsync("fixture", new JsonObject { ["userId"] = "fixture", ["keystroke"] = fixture["baseline"]!.DeepClone() });
        var signal = await factory.Services.GetRequiredService<SessionKeystrokeVerifier>().VerifyAsync("fixture", sample,
            new JsonObject { ["minEnrollmentRounds"] = 1, ["minDigraphCount"] = 1, ["updateProfileOnAllow"] = false });
        foreach (var key in new[] { "similarityScore", "distance", "decision", "thresholds" }) Assert.True(JsonNode.DeepEquals(fixture["scored"]![key], signal[key]), key);
    }
    [Fact]
    public async Task ConsentEnrollmentWeightedMergeReadinessAndProfilePreservation()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var denied = await Send(client, "/enroll/keystroke", new { userId = "u", sample = Dynamic() }, HttpStatusCode.Forbidden);
        Assert.Equal("CONSENT_REQUIRED", denied["error"]!["code"]!.GetValue<string>());
        await Send(client, "/consent", new { userId = "u", consentVersion = "v1" });
        var storage = factory.Services.GetRequiredService<IProfileStorage>();
        await storage.SaveProfilesAsync("u", new JsonObject { ["userId"] = "u", ["faceEmbedding"] = new JsonArray(.1, .2) });
        var first = await Send(client, "/enroll/keystroke", new { userId = " u ", sample = Dynamic() });
        Assert.Equal(80, first["profile"]!["holdMeanMs"]!.GetValue<double>());
        Assert.False(first["enrollmentProgress"]!["ready"]!.GetValue<bool>());
        var second = await Send(client, "/enroll/keystroke", new { userId = "u", sample = Dynamic(2) });
        Assert.Equal(120, second["profile"]!["holdMeanMs"]!.GetValue<double>());
        Assert.Equal(40, second["profile"]!["holdStdMs"]!.GetValue<double>());
        Assert.Equal(40, second["profile"]!["sampleCount"]!.GetValue<double>());
        for (var i = 0; i < 6; i++) second = await Send(client, "/enroll/keystroke", new { userId = "u", events = Dynamic()["events"] });
        Assert.True(second["enrollmentProgress"]!["ready"]!.GetValue<bool>());
        Assert.Equal(8, second["enrollmentProgress"]!["roundsCompleted"]!.GetValue<double>());
        Assert.Equal(2, (await storage.GetProfilesAsync("u"))!["faceEmbedding"]!.AsArray().Count);
    }
    [Fact]
    public async Task DynamicVerificationMissingAllowDenyAndEma()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var missing = await Verify(client, Dynamic(), user: "missing");
        Assert.Equal("step_up", missing["decision"]!.GetValue<string>());
        Assert.Null(missing["profile"]);
        await Send(client, "/consent", new { userId = "u", consentVersion = "v1" });
        await Send(client, "/enroll/keystroke", new { userId = "u", sample = Dynamic() });
        Assert.Equal("step_up", (await Verify(client, Dynamic()))["decision"]!.GetValue<string>());
        var allow = await Verify(client, Dynamic(), new { minEnrollmentRounds = 1, minDigraphCount = 1 });
        Assert.Equal("allow", allow["decision"]!.GetValue<string>());
        Assert.True(allow["profileUpdated"]!.GetValue<bool>());
        Assert.Equal(2, allow["profile"]!["sampleRoundCount"]!.GetValue<double>());
        var disabled = await Verify(client, Dynamic(), new { minEnrollmentRounds = 1, minDigraphCount = 1, updateProfileOnAllow = false });
        Assert.False(disabled["profileUpdated"]!.GetValue<bool>());
        Assert.Equal("deny", (await Verify(client, Dynamic(10)))["decision"]!.GetValue<string>());
    }
    [Theory]
    [InlineData("text")]
    [InlineData("session")]
    [InlineData("expired")]
    [InlineData("used")]
    public async Task ChallengeFailuresAndConsumeBeforeBindingValidation(string mode)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var challenge = await Send(client, "/challenge/text", new { text = "alpha beta gamma", sessionId = "s" });
        var id = challenge["challengeId"]!.GetValue<string>();
        var sample = Dynamic();
        if (mode == "text") sample["expectedText"] = "wrong";
        if (mode == "expired") factory.Clock.Now = factory.Clock.Now.AddSeconds(121);
        if (mode == "used") await Send(client, "/challenge/text/consume", new { challengeId = id });
        var result = await Send(client, "/verify/keystroke", new { userId = "u", sessionId = mode == "session" ? "other" : "s", challengeId = id, sample },
            mode == "expired" ? HttpStatusCode.Gone : mode == "used" ? HttpStatusCode.Conflict : HttpStatusCode.BadRequest);
        Assert.Equal(mode == "expired" ? "CHALLENGE_EXPIRED" : mode == "used" ? "CHALLENGE_ALREADY_USED" : "VALIDATION_ERROR", result["error"]!["code"]!.GetValue<string>());
        if (mode is "text" or "session") await Send(client, "/verify/keystroke", new { userId = "u", challengeId = id, sample = Dynamic() }, HttpStatusCode.Conflict);
    }
    [Fact]
    public async Task RealPythonEnrollmentAutoEnrollAndPersistedStatus()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var now = factory.Clock.Now.ToUnixTimeMilliseconds();
        var result = await Send(client, "/api/securekit/keystroke/enroll", new { userId = "u", textId = "text/ş?1", expectedText = "alpha beta gamma", samples = Enumerable.Range(0, 10).Select(_ => Fixed(now)).ToArray() });
        Assert.Equal(10, result["template"]!["count"]!.GetValue<double>());
        var verify = await Send(client, "/api/securekit/keystroke/verify", new { userId = "u", textId = "text/ş?1", sample = Fixed(now), opts = new { autoEnroll = true } });
        Assert.Equal("accept", verify["decision"]!.GetValue<string>());
        Assert.True(verify["autoEnrolled"]!.GetValue<bool>());
        Assert.Equal(11, verify["metrics"]!["count"]!.GetValue<double>());
        var route = "/api/securekit/keystroke/status?userId=u&textId=" + Uri.EscapeDataString("text/ş?1");
        var status = await ContractAssert.JsonResponseAsync(await client.GetAsync(route), HttpStatusCode.OK);
        Assert.True(status["registered"]!.GetValue<bool>());
        Assert.Equal(11, status["template"]!["sampleCount"]!.GetValue<double>());
        var store = factory.Services.GetRequiredService<FixedKeystrokeStore>();
        Assert.NotNull(await store.ReadAsync(store.UserHash("u"), "text/ş?1"));
        Assert.Equal(2, Directory.GetFiles(store.Root, "*", SearchOption.AllDirectories).Length);
    }
    [Theory]
    [InlineData("length", "LENGTH_MISMATCH")]
    [InlineData("range", "OUT_OF_RANGE")]
    [InlineData("old", "REPLAY_REJECTED")]
    [InlineData("future", "REPLAY_REJECTED")]
    [InlineData("negative", "INVALID_SAMPLE")]
    [InlineData("text", "TEXT_MISMATCH")]
    [InlineData("id", "TEXT_ID_MISMATCH")]
    public async Task InvalidFixedSampleIsRejectedBeforePython(string mode, string code)
    {
        using var factory = new Factory(new() { ["PYTHON_BIN"] = "securekit-missing-python" }); using var client = factory.CreateClient();
        var sample = Fixed(factory.Clock.Now.ToUnixTimeMilliseconds());
        switch (mode)
        {
            case "length": sample["ddMs"]!.AsArray().RemoveAt(0); break;
            case "range": sample["meta"]!["durationMs"] = 799; break;
            case "old": sample["meta"]!["timestamp"] = factory.Clock.Now.ToUnixTimeMilliseconds() - 120001; break;
            case "future": sample["meta"]!["timestamp"] = factory.Clock.Now.ToUnixTimeMilliseconds() + 10001; break;
            case "negative": sample["holdMs"]![0] = -1; break;
            case "text": sample["text"] = "wrong text here"; break;
            case "id": sample["textId"] = "other"; break;
        }
        var result = await Send(client, "/api/securekit/keystroke/enroll", new { userId = "u", textId = "text/ş?1", expectedText = "alpha beta gamma", samples = new[] { sample } }, HttpStatusCode.BadRequest);
        Assert.Equal(code, result["error"]!["code"]!.GetValue<string>());
    }
    [Theory]
    [InlineData(-120000)]
    [InlineData(10000)]
    public async Task TimestampBoundariesAreInclusiveAndNegativeTransitionsClamp(long offset)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var sample = Fixed(factory.Clock.Now.ToUnixTimeMilliseconds() + offset);
        sample["ddMs"]![0] = -1; sample["ddMs"]![1] = -1; sample["ddMs"]![2] = -1;
        for (var i = 0; i < 15; i++) sample["udMs"]![i] = -1;
        var result = await Send(client, "/api/securekit/keystroke/enroll", new { userId = "u", textId = "text/ş?1", expectedText = "alpha beta gamma", samples = new[] { sample } });
        Assert.True(result["enrolled"]!.GetValue<bool>());
    }
    [Theory]
    [InlineData("success", null)]
    [InlineData("invalid-json", "PYTHON_JSON_PARSE_ERROR")]
    [InlineData("non-object", "PYTHON_JSON_PARSE_ERROR")]
    [InlineData("exit", "PYTHON_EXIT_NON_ZERO")]
    [InlineData("reported", "PYTHON_REPORTED_ERROR")]
    [InlineData("protocol", "PYTHON_PROTOCOL_ERROR")]
    [InlineData("timeout", "PYTHON_TIMEOUT")]
    [InlineData("missing", "PYTHON_SPAWN_FAILED")]
    [InlineData("stdout-limit", "PYTHON_PROTOCOL_ERROR")]
    [InlineData("stderr-limit", "PYTHON_PROTOCOL_ERROR")]
    [InlineData("cancel", null)]
    public async Task PythonBridgeFailuresShutdownWorkerAndNeverPersist(string mode, string? expectedCode)
    {
        var directory = Path.Combine(Path.GetTempPath(), "securekit-python-" + Guid.NewGuid()); Directory.CreateDirectory(directory);
        var script = Path.Combine(directory, "fixture.py"); var pidFile = Path.Combine(directory, "pid.txt");
        var code = mode switch
        {
            "success" => "print(json.dumps({'ok':True,'echo':json.load(sys.stdin)}))",
            "invalid-json" => "sys.stdin.read();print('broken')",
            "non-object" => "sys.stdin.read();print('[]')",
            "protocol" => "sys.stdin.read();print('{}')",
            "reported" => "sys.stdin.read();print(json.dumps({'ok':False,'error':'fixture error'}))",
            "exit" => "sys.stdin.read();sys.exit(7)",
            "stdout-limit" => "sys.stdin.read();print('x'*(1024*1024+10),flush=True);time.sleep(30)",
            "stderr-limit" => "sys.stdin.read();print('x'*(1024*1024+10),file=sys.stderr,flush=True);time.sleep(30)",
            _ => "sys.stdin.read();time.sleep(30)"
        };
        await File.WriteAllTextAsync(script, "import os,sys,time,json\nopen(os.path.join(os.path.dirname(__file__),'pid.txt'),'w').write(str(os.getpid()))\n" + code + "\n");
        try
        {
            using var factory = new Factory(new() { ["Keystroke:ScriptPath"] = script, ["PYTHON_BIN"] = mode == "missing" ? "securekit-missing-python" : OperatingSystem.IsWindows() ? "py -3" : "python3", ["KEYSTROKE_FIXED_PYTHON_TIMEOUT_MS"] = mode == "timeout" ? "700" : "5000" });
            using var client = factory.CreateClient(); var service = factory.Services.GetRequiredService<IKeystrokePython>();
            if (mode == "success") Assert.Equal("hello ş", (await service.RunAsync(new JsonObject { ["text"] = "hello ş" }, default))["echo"]!["text"]!.GetValue<string>());
            else if (mode == "cancel")
            {
                using var cancel = new CancellationTokenSource(); var task = service.RunAsync(new JsonObject(), cancel.Token);
                for (var i = 0; i < 100 && !File.Exists(pidFile); i++) await Task.Delay(20);
                Assert.True(File.Exists(pidFile)); cancel.Cancel();
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
            }
            else
            {
                var result = await Send(client, "/api/securekit/keystroke/enroll", new { userId = "u", textId = "text/ş?1", expectedText = "alpha beta gamma", samples = new[] { Fixed(factory.Clock.Now.ToUnixTimeMilliseconds()) } }, HttpStatusCode.BadGateway);
                Assert.Equal(expectedCode, result["error"]!["code"]!.GetValue<string>());
                Assert.False(Directory.Exists(factory.Services.GetRequiredService<FixedKeystrokeStore>().Root));
            }
            if (File.Exists(pidFile))
            {
                var running = false;
                try { using var process = System.Diagnostics.Process.GetProcessById(int.Parse(await File.ReadAllTextAsync(pidFile))); running = !process.HasExited; } catch (ArgumentException) { }
                Assert.False(running, "Worker must stop before the request completes.");
            }
        }
        finally { Directory.Delete(directory, true); }
    }
}
