using System.Net;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SecureKit.Api.Services;
using SecureKit.Api.Tests.Support;

namespace SecureKit.Api.Tests;

public sealed class StageSixTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.Parse("2026-10-07T09:00:00Z");
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Runner : IVoicePython
    {
        public JsonObject Result { get; set; } = VoicePython.Normalize(JsonNode.Parse("""
            {"ok":true,"embedding":[1,0],"transcript":{"matched":true},"runtime":{}}
            """)!.AsObject());
        public JsonObject? Input { get; private set; }
        public Task<JsonObject> RunAsync(JsonObject input, CancellationToken token)
        {
            Input = input.DeepClone().AsObject();
            Assert.True(File.Exists(input["audioPath"]!.GetValue<string>()));
            var result = Result.DeepClone().AsObject(); result["transcript"]!["expectedText"] = input["expectedText"]!.DeepClone();
            return Task.FromResult(result);
        }
    }
    private sealed class Factory(bool stub = true, Dictionary<string, string?>? settings = null) : WebApplicationFactory<Program>
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "securekit-stage6-" + Guid.NewGuid());
        public Runner Runner { get; } = new();
        public Clock Clock { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?> { ["SECUREKIT_PROFILE_STORE"] = Path.Combine(Root, "profiles.json"),
                    ["Voice:TempRoot"] = Path.Combine(Root, "temp"), ["VOICE_UPLOAD_MAX_BYTES"] = "128", ["VOICE_PYTHON_BIN"] = OperatingSystem.IsWindows() ? "py -3" : "python3" });
                if (settings is not null) config.AddInMemoryCollection(settings);
            });
            builder.ConfigureServices(services => { services.AddSingleton<TimeProvider>(Clock); if (stub) services.AddSingleton<IVoicePython>(Runner); });
        }
        protected override void Dispose(bool disposing)
        { base.Dispose(disposing); if (disposing && Directory.Exists(Root)) Directory.Delete(Root, true); }
    }
    private static MultipartFormDataContent Form(Dictionary<string, string>? fields = null, string mime = "audio/webm", int size = 16, string field = "audioSample", bool audio = true)
    {
        var form = new MultipartFormDataContent();
        foreach (var (key, value) in fields ?? []) form.Add(new StringContent(value), key);
        if (audio) { var content = new ByteArrayContent(new byte[size]); content.Headers.ContentType = new MediaTypeHeaderValue(mime); form.Add(content, field, "../../sample.exe"); }
        return form;
    }
    private static async Task<JsonNode> Send(HttpClient client, bool enroll, MultipartFormDataContent form, int status = 200)
    { using (form) return await ContractAssert.JsonResponseAsync(await client.PostAsync(enroll ? "/enroll/voice" : "/verify/voice", form), (HttpStatusCode)status); }
    private static ChallengeRecord Challenge(Factory f, string? session = null) => f.Services.GetRequiredService<ChallengeStore>().Create("tr", "short", null, "Merhaba dünya", session);
    private static async Task Seed(Factory f)
    {
        var storage = f.Services.GetRequiredService<IProfileStorage>();
        await storage.AppendConsentAsync(new JsonObject { ["userId"] = "u" });
        await storage.SaveProfilesAsync("u", new JsonObject { ["voiceEmbedding"] = new JsonArray(1, 0), ["updatedAt"] = "2026-10-07T00:00:00.000Z", ["cardReferenceImagePath"] = "card.jpg" });
    }
    private static Dictionary<string, string> Fields(Factory f) => new() { ["userId"] = " u ", ["challengeId"] = Challenge(f).Id };
    private static void Clean(Factory f)
    { if (Directory.Exists(Path.Combine(f.Root, "temp"))) Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(f.Root, "temp"))); }

    [Fact]
    public async Task EnrollmentAveragesSamplesPreservesOtherProfilesAndCompletes()
    {
        using var f = new Factory(); using var client = f.CreateClient(); await Seed(f);
        f.Runner.Result["embedding"] = new JsonArray(0, 1);
        var result = await Send(client, true, Form(Fields(f)));
        Assert.Equal(.5, result["profile"]!["embedding"]![0]!.GetValue<double>());
        Assert.Equal(2, result["enrollmentProgress"]!["sampleCount"]!.GetValue<double>());
        Assert.False(result["enrollmentProgress"]!["complete"]!.GetValue<bool>());
        result = await Send(client, true, Form(Fields(f), "audio/mp4"));
        Assert.True(result["enrollmentProgress"]!["complete"]!.GetValue<bool>());
        Assert.Equal(".m4a", Path.GetExtension(f.Runner.Input!["audioPath"]!.GetValue<string>()));
        Assert.Equal("Merhaba dünya", f.Runner.Input["expectedText"]!.GetValue<string>());
        Assert.False(File.Exists(f.Runner.Input["audioPath"]!.GetValue<string>()));
        var profile = await f.Services.GetRequiredService<IProfileStorage>().GetProfilesAsync("u");
        Assert.Equal("card.jpg", profile!["cardReferenceImagePath"]!.GetValue<string>()); Clean(f);
    }

    [Theory]
    [InlineData(1, 0, "allow", true)]
    [InlineData(0, 1, "step_up", false)]
    [InlineData(-1, 0, "deny", false)]
    public async Task VerificationDecisionsAndLegacyProfileUpdate(double a, double b, string decision, bool updated)
    {
        using var f = new Factory(); using var client = f.CreateClient(); await Seed(f); f.Runner.Result["embedding"] = new JsonArray(a, b);
        var result = await Send(client, false, Form(Fields(f)));
        Assert.Equal(decision, result["decision"]!.GetValue<string>()); Assert.Equal(updated, result["profileUpdated"]!.GetValue<bool>());
        Assert.Equal("legacy", result["profile"]!["model"]!.GetValue<string>()); Clean(f);
    }

    [Fact]
    public async Task MismatchDeniesVerificationAndDoesNotChangeProfile()
    {
        using var f = new Factory(); using var client = f.CreateClient(); await Seed(f);
        f.Runner.Result["transcript"]!["matched"] = false; f.Runner.Result["embedding"] = null;
        await Send(client, true, Form(Fields(f)), 422);
        var result = await Send(client, false, Form(Fields(f)));
        Assert.Equal("deny", result["decision"]!.GetValue<string>()); Assert.False(result["profileUpdated"]!.GetValue<bool>());
        Assert.Equal("TRANSCRIPT_MISMATCH", result["reasons"]![0]!.GetValue<string>()); Clean(f);
    }

    [Fact]
    public async Task ConsentAndProfileAreCheckedBeforeConsumingChallenge()
    {
        using var f = new Factory(); using var client = f.CreateClient(); var fields = Fields(f);
        await Send(client, true, Form(fields), 403); await Send(client, false, Form(fields), 404);
        await Seed(f); await Send(client, true, Form(fields));
        var used = await Send(client, true, Form(fields), 409);
        Assert.Equal("CHALLENGE_ALREADY_USED", used["error"]!["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task WrongSessionConsumesChallengeAndMissingSessionRemainsCompatible()
    {
        using var f = new Factory(); using var client = f.CreateClient(); await Seed(f);
        var fields = new Dictionary<string, string> { ["userId"] = "u", ["challengeId"] = Challenge(f, "s").Id, ["sessionId"] = "other" };
        var wrong = await Send(client, false, Form(fields), 400); Assert.Equal("CHALLENGE_SESSION_MISMATCH", wrong["error"]!["code"]!.GetValue<string>());
        await Send(client, false, Form(fields), 409);
        fields["challengeId"] = Challenge(f, "s").Id; fields.Remove("sessionId"); await Send(client, false, Form(fields));
    }

    [Theory]
    [InlineData("text/plain", 16, "INVALID_AUDIO_TYPE", 400)]
    [InlineData("audio/wav", 129, "AUDIO_TOO_LARGE", 413)]
    [InlineData("audio/wav", 0, "INVALID_REQUEST", 400)]
    public async Task InvalidUploads(string mime, int size, string code, int status)
    {
        using var f = new Factory(); using var client = f.CreateClient();
        var result = await Send(client, true, Form(Fields(f), mime, size), status); Assert.Equal(code, result["error"]!["code"]!.GetValue<string>()); Clean(f);
    }

    [Theory]
    [InlineData("matchThreshold", "NaN")]
    [InlineData("stepUpThreshold", "Infinity")]
    [InlineData("updateProfileOnAllow", "1")]
    public async Task InvalidPolicyDoesNotConsumeChallenge(string key, string value)
    {
        using var f = new Factory(); using var client = f.CreateClient(); await Seed(f); var fields = Fields(f); fields[key] = value;
        await Send(client, false, Form(fields), 400); fields.Remove(key); await Send(client, false, Form(fields));
    }

    [Theory]
    [InlineData("audio_too_short", "AUDIO_TOO_SHORT", 400)]
    [InlineData("gpu_required", "GPU_REQUIRED", 503)]
    [InlineData("ffmpeg_missing", "PYTHON_DEPENDENCY_MISSING", 503)]
    [InlineData("other", "PYTHON_PROCESS_ERROR", 502)]
    public async Task WorkerFailuresMapToHttpAndCleanAudio(string reason, string code, int status)
    {
        using var f = new Factory(); using var client = f.CreateClient(); await Seed(f);
        f.Runner.Result["ok"] = false; f.Runner.Result["reason"] = reason;
        var result = await Send(client, true, Form(Fields(f)), status); Assert.Equal(code, result["error"]!["code"]!.GetValue<string>()); Clean(f);
    }

    [Theory]
    [InlineData("print('not json',flush=True)", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("print('[]',flush=True)", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("import sys; sys.exit(3)", "PYTHON_PROCESS_ERROR", 502)]
    [InlineData("import time; time.sleep(5)", "PYTHON_TIMEOUT", 504)]
    [InlineData("print('x' * 1048577,flush=True); import time; time.sleep(5)", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("import sys,time; sys.stderr.write('x' * 1048577); sys.stderr.flush(); time.sleep(5)", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("print('{\"event\":\"ready\",\"ok\":false,\"reason\":\"gpu_required\"}',flush=True)", "GPU_REQUIRED", 503)]
    [InlineData("import sys; sys.stderr.write(\"ModuleNotFoundError: No module named 'speechbrain'\"); sys.exit(1)", "PYTHON_DEPENDENCY_MISSING", 503)]
    public async Task PythonProtocolFailuresAndTimeoutCleanAudio(string script, string code, int status)
    {
        using var f = new Factory(false); Directory.CreateDirectory(f.Root); var path = Path.Combine(f.Root, "worker.py"); await File.WriteAllTextAsync(path, script);
        using var configured = f.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Voice:ScriptPath"] = path, ["VOICE_PYTHON_TIMEOUT_MS"] = "1000" })));
        using var client = configured.CreateClient(); await f.Services.GetRequiredService<IProfileStorage>().AppendConsentAsync(new JsonObject { ["userId"] = "u" });
        var id = configured.Services.GetRequiredService<ChallengeStore>().Create("tr", "short", null, "test", null).Id;
        var result = await Send(client, true, Form(new() { ["userId"] = "u", ["challengeId"] = id }), status);
        Assert.Equal(code, result["error"]!["code"]!.GetValue<string>()); Clean(f);
    }

    [Fact]
    public async Task MissingPythonReturns503AndCleansAudio()
    {
        using var f = new Factory(false, new() { ["VOICE_PYTHON_BIN"] = "securekit-python-missing" }); using var client = f.CreateClient(); await Seed(f);
        var result = await Send(client, true, Form(Fields(f)), 503); Assert.Equal("PYTHON_RUNTIME_UNAVAILABLE", result["error"]!["code"]!.GetValue<string>()); Clean(f);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"ok\":true,\"transcript\":{},\"runtime\":{},\"embedding\":[\"bad\"]}")]
    public void InvalidWorkerSchemaIsRejected(string json) => Assert.Equal("PYTHON_OUTPUT_INVALID", Assert.Throws<VoiceFailure>(() => VoicePython.Normalize(JsonNode.Parse(json)!.AsObject())).Code);

    [Fact]
    public async Task ExpiredChallengeReturns410WithoutCallingWorker()
    {
        using var f = new Factory(); using var client = f.CreateClient(); await Seed(f); var fields = Fields(f);
        f.Clock.Now = f.Clock.Now.AddSeconds(121);
        var result = await Send(client, false, Form(fields), 410);
        Assert.Equal("CHALLENGE_EXPIRED", result["error"]!["code"]!.GetValue<string>()); Assert.Null(f.Runner.Input);
    }

    [Fact]
    public async Task ConcurrentEnrollmentDoesNotLoseSamples()
    {
        using var f = new Factory(); using var client = f.CreateClient();
        await f.Services.GetRequiredService<IProfileStorage>().AppendConsentAsync(new JsonObject { ["userId"] = "u" });
        var responses = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Send(client, true, Form(Fields(f)))));
        Assert.Equal(new double[] { 1, 2, 3 }, responses.Select(r => r["profile"]!["sampleCount"]!.GetValue<double>()).Order().ToArray());
        var stored = await f.Services.GetRequiredService<IProfileStorage>().GetProfilesAsync("u");
        Assert.Equal(3, stored!["voice"]!["sampleCount"]!.GetValue<double>()); Clean(f);
    }

    [Fact]
    public async Task ExplicitAlphaUpdatesEmbeddingAndDisabledUpdatePreservesStorage()
    {
        using var f = new Factory(); using var client = f.CreateClient(); await Seed(f); f.Runner.Result["embedding"] = new JsonArray(0, 1);
        var fields = Fields(f); fields["matchThreshold"] = ".4"; fields["profileUpdateAlpha"] = ".2";
        var result = await Send(client, false, Form(fields));
        Assert.Equal(.8, result["profile"]!["embedding"]![0]!.GetValue<double>()); Assert.Equal(.2, result["profile"]!["embedding"]![1]!.GetValue<double>());
        var before = await File.ReadAllTextAsync(Path.Combine(f.Root, "profiles.json"));
        fields = Fields(f); fields["matchThreshold"] = "0"; fields["updateProfileOnAllow"] = "false";
        await Send(client, false, Form(fields)); Assert.Equal(before, await File.ReadAllTextAsync(Path.Combine(f.Root, "profiles.json")));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CancellationAndTimeoutKillProcessTreeAndCleanAudio(bool cancel)
    {
        using var f = new Factory(false); Directory.CreateDirectory(f.Root);
        var script = Path.Combine(f.Root, "cancel.py"); var pid = Path.Combine(f.Root, "pid.txt");
        await File.WriteAllTextAsync(script, "import os,time,pathlib,subprocess,sys\nchild=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'])\npathlib.Path(" + System.Text.Json.JsonSerializer.Serialize(pid) + ").write_text(str(os.getpid())+','+str(child.pid))\ntime.sleep(20)");
        using var configured = f.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Voice:ScriptPath"] = script, ["VOICE_PYTHON_TIMEOUT_MS"] = "2000" })));
        var service = configured.Services.GetRequiredService<VoiceVerification>();
        await configured.Services.GetRequiredService<IProfileStorage>().AppendConsentAsync(new JsonObject { ["userId"] = "u" });
        var id = configured.Services.GetRequiredService<ChallengeStore>().Create("tr", "short", null, "test", null).Id;
        using var audioStream = new MemoryStream(new byte[16]);
        var audio = new Microsoft.AspNetCore.Http.FormFile(audioStream, 0, 16, "audioSample", "audio.wav") { Headers = new Microsoft.AspNetCore.Http.HeaderDictionary(), ContentType = "audio/wav" };
        using var cancellation = new CancellationTokenSource();
        var run = service.ExecuteAsync(true, new JsonObject { ["userId"] = "u", ["challengeId"] = id }, audio, cancellation.Token);
        for (var i = 0; i < 100 && !File.Exists(pid); i++) await Task.Delay(20);
        Assert.True(File.Exists(pid)); var ids = (await File.ReadAllTextAsync(pid)).Split(',').Select(int.Parse).ToArray();
        if (cancel) { cancellation.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => run); }
        else { var error = await Assert.ThrowsAsync<VoiceFailure>(() => run); Assert.Equal("PYTHON_TIMEOUT", error.Code); }
        foreach (var processId in ids)
        {
            bool Stopped()
            {
                try { using var process = System.Diagnostics.Process.GetProcessById(processId); return process.HasExited; }
                catch (ArgumentException) { return true; }
            }
            for (var i = 0; i < 50 && !Stopped(); i++) await Task.Delay(20);
            Assert.True(Stopped(), $"Voice worker process {processId} is still running.");
        }
        Clean(f);
    }

    [Theory]
    [InlineData("{\"id\":\"1\",\"ok\":true,\"embedding\":[1,0],\"transcript\":{\"matched\":true},\"runtime\":{}}", 200)]
    [InlineData("{\"id\":\"1\",\"ok\":true,\"embedding\":[\"bad\"],\"transcript\":{},\"runtime\":{}}", 502)]
    [InlineData("{\"id\":\"wrong\",\"ok\":true,\"embedding\":[1,0],\"transcript\":{},\"runtime\":{}}", 502)]
    [InlineData("{\"id\":\"1\",\"ok\":true,\"embedding\":[],\"transcript\":{\"matched\":true},\"runtime\":{}}", 502)]
    public async Task ReadyThenResponseIsValidatedBeforeSavingProfile(string json, int status)
    {
        using var f = new Factory(false); Directory.CreateDirectory(f.Root); var script = Path.Combine(f.Root, "worker.py");
        await File.WriteAllTextAsync(script, "import sys\nprint('{\"event\":\"ready\",\"ok\":true}',flush=True)\nsys.stdin.readline()\nprint(" + System.Text.Json.JsonSerializer.Serialize(json) + ",flush=True)\nimport time; time.sleep(10)");
        using var configured = f.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Voice:ScriptPath"] = script })));
        using var client = configured.CreateClient();
        var storage = configured.Services.GetRequiredService<IProfileStorage>(); await storage.AppendConsentAsync(new JsonObject { ["userId"] = "u" });
        var id = configured.Services.GetRequiredService<ChallengeStore>().Create("tr", "short", null, "test", null).Id;
        await Send(client, true, Form(new() { ["userId"] = "u", ["challengeId"] = id }), status);
        Assert.Equal(status == 200, await storage.GetProfilesAsync("u") is not null); Clean(f);
    }
}
