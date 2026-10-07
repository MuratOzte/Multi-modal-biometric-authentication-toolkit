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

public sealed class StageFiveTests
{
    private sealed class Runner : IFacePython
    {
        public JsonObject? Input { get; private set; }
        public bool Sliding { get; private set; }
        public Task<JsonObject> RunAsync(JsonObject input, bool sliding, CancellationToken token)
        {
            Input = input.DeepClone().AsObject(); Sliding = sliding;
            Assert.True(File.Exists(input["probeImagePath"]!.GetValue<string>()));
            if (!sliding) Assert.True(File.Exists(input["referenceImagePath"]!.GetValue<string>()));
            return Task.FromResult(new JsonObject { ["ok"] = true, ["matched"] = true, ["score"] = .91, ["reason"] = null });
        }
    }
    private sealed class Factory(bool stub = true, Dictionary<string, string?>? settings = null) : WebApplicationFactory<Program>
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "securekit-stage5-" + Guid.NewGuid());
        public Runner Runner { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?> { ["SECUREKIT_PROFILE_STORE"] = Path.Combine(Root, "profiles.json"),
                    ["Face:ReferenceDirectory"] = Path.Combine(Root, "references"), ["FACE_SLIDING_REFERENCES_ROOT"] = Path.Combine(Root, "sliding"),
                    ["Face:TempRoot"] = Path.Combine(Root, "temp"), ["FACE_UPLOAD_MAX_BYTES"] = "128", ["FACE_PYTHON_BIN"] = OperatingSystem.IsWindows() ? "py -3" : "python3" });
                if (settings is not null) config.AddInMemoryCollection(settings);
            });
            if (stub) builder.ConfigureServices(services => services.AddSingleton<IFacePython>(Runner));
        }
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing && Directory.Exists(Root)) Directory.Delete(Root, true);
        }
    }
    private static MultipartFormDataContent Form(Dictionary<string, string>? fields = null, params (string Field, string Mime, int Size, string Name)[] files)
    {
        var form = new MultipartFormDataContent();
        foreach (var (key, value) in fields ?? []) form.Add(new StringContent(value), key);
        foreach (var file in files)
        {
            var content = new ByteArrayContent(Enumerable.Repeat((byte)42, file.Size).ToArray()); content.Headers.ContentType = new MediaTypeHeaderValue(file.Mime);
            form.Add(content, file.Field, file.Name);
        }
        return form;
    }
    private static (string, string, int, string) Probe(int size = 16, string mime = "image/jpeg") => ("probeImage", mime, size, "probe.jpg");
    private static (string, string, int, string) Reference() => ("referenceImage", "image/png", 16, "../../reference.exe");
    private static async Task<JsonNode> Send(HttpClient client, string route, MultipartFormDataContent form, HttpStatusCode status = HttpStatusCode.OK)
    { using (form) return await ContractAssert.JsonResponseAsync(await client.PostAsync(route, form), status); }

    [Fact]
    public async Task EnrollmentReplacementPreservesProfilesAndUsesMimeExtension()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var storage = factory.Services.GetRequiredService<IProfileStorage>();
        await storage.SaveProfilesAsync("u/ş", new JsonObject { ["keystroke"] = new JsonObject { ["sampleCount"] = 40 }, ["voiceEmbedding"] = new JsonArray(.5), ["cardReferenceImagePath"] = "card.jpg" });
        var first = await Send(client, "/enroll/face/reference", Form(new() { ["userId"] = " u/ş " }, Reference()));
        var path = first["reference"]!["imagePath"]!.GetValue<string>();
        Assert.True(File.Exists(path)); Assert.Equal(".png", Path.GetExtension(path));
        Assert.Equal(Path.Combine(factory.Root, "references"), Path.GetDirectoryName(path));
        var second = await Send(client, "/enroll/face/reference", Form(new() { ["userId"] = "u/ş" }, Reference()));
        Assert.False(File.Exists(path)); Assert.True(File.Exists(second["reference"]!["imagePath"]!.GetValue<string>()));
        var profile = await storage.GetProfilesAsync("u/ş");
        Assert.Equal(40, profile!["keystroke"]!["sampleCount"]!.GetValue<int>());
        Assert.Equal("card.jpg", profile["cardReferenceImagePath"]!.GetValue<string>());
        Assert.Equal(.5, profile["voiceEmbedding"]![0]!.GetValue<double>());
        await Send(client, "/verify/face", Form(new() { ["userId"] = "u/ş" }, Probe()));
        Assert.Equal(profile["faceReferenceImagePath"]!.GetValue<string>(), factory.Runner.Input!["referenceImagePath"]!.GetValue<string>());
        Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(factory.Root, "temp")));
    }

    [Fact]
    public async Task UploadedReferenceTakesPrecedenceAndAllTemporaryImagesAreRemoved()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var response = await Send(client, "/verify/face", Form(new() { ["userId"] = "missing", ["referenceImagePath"] = "C:/outside.jpg", ["threshold"] = ".9" }, Probe(), Reference()));
        Assert.True(response["matched"]!.GetValue<bool>());
        Assert.Equal(.9, factory.Runner.Input!["threshold"]!.GetValue<double>());
        foreach (var key in new[] { "referenceImagePath", "probeImagePath" }) Assert.False(File.Exists(factory.Runner.Input[key]!.GetValue<string>()));
        Assert.Null(response["referenceImagePath"]);
    }

    [Theory]
    [InlineData("/enroll/face/reference", "REFERENCE_REQUIRED")]
    [InlineData("/verify/face", "PROBE_REQUIRED")]
    [InlineData("/verify/face-sliding", "INVALID_REQUEST")]
    public async Task MissingFieldsMatchNode(string route, string code)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var response = await Send(client, route, Form(new() { ["unused"] = "1" }), HttpStatusCode.BadRequest);
        Assert.Equal(code, response["error"]!["code"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("text/plain", 16, "INVALID_IMAGE_TYPE", 400)]
    [InlineData("image/jpeg", 129, "IMAGE_TOO_LARGE", 413)]
    [InlineData("image/jpeg", 0, "INVALID_REQUEST", 400)]
    public async Task UploadLimitsAndMimeValidation(string mime, int size, string code, int status)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var response = await Send(client, "/verify/face", Form(null, Probe(size, mime)), (HttpStatusCode)status);
        Assert.Equal(code, response["error"]!["code"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("/verify/face", "threshold", "NaN", "threshold must be a finite number.")]
    [InlineData("/verify/face", "threshold", "1.1", "threshold must be a number between 0 and 1.")]
    [InlineData("/verify/face-sliding", "maxWindow", "Infinity", "maxWindow must be a finite number.")]
    [InlineData("/verify/face-sliding", "updateOnSuccess", "yes", "updateOnSuccess must be a boolean.")]
    public async Task InvalidOptions(string route, string key, string value, string message)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var files = route == "/verify/face" ? new[] { Probe(), Reference() } : [Probe()];
        var response = await Send(client, route, Form(new() { ["userId"] = "u", [key] = value }, files), HttpStatusCode.BadRequest);
        Assert.Equal(message, response["error"]!["message"]!.GetValue<string>());
        if (Directory.Exists(Path.Combine(factory.Root, "temp"))) Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(factory.Root, "temp")));
    }

    [Theory]
    [InlineData("unknown", null, "REFERENCE_NOT_FOUND", 404)]
    [InlineData(null, null, "REFERENCE_REQUIRED", 400)]
    [InlineData(null, "../../outside.jpg", "REFERENCE_PATH_INVALID", 400)]
    public async Task ReferenceResolutionErrors(string? user, string? path, string code, int status)
    {
        using var factory = new Factory(); using var client = factory.CreateClient(); var fields = new Dictionary<string, string>();
        if (user is not null) fields["userId"] = user; if (path is not null) fields["referenceImagePath"] = path;
        var response = await Send(client, "/verify/face", Form(fields, Probe()), (HttpStatusCode)status);
        Assert.Equal(code, response["error"]!["code"]!.GetValue<string>());
        Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(factory.Root, "temp")));
    }

    [Fact]
    public async Task DuplicateAndUnexpectedFileFieldsAreRejected()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        foreach (var files in new[] { new[] { Probe(), Probe() }, new[] { ("other", "image/png", 4, "image.png") } })
        {
            var response = await Send(client, "/verify/face", Form(null, files), HttpStatusCode.BadRequest);
            Assert.Equal("Unexpected field", response["error"]!["message"]!.GetValue<string>());
        }
    }

    [Fact]
    public async Task SlidingOptionsAreForwardedAndProbeIsRemoved()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        await Send(client, "/verify/face-sliding", Form(new() { ["userId"] = " u ", ["threshold"] = "-.5", ["maxWindow"] = "4", ["updateOnSuccess"] = "0" }, Probe()));
        Assert.True(factory.Runner.Sliding); var input = factory.Runner.Input!;
        Assert.Equal("u", input["userId"]!.GetValue<string>()); Assert.False(input["updateOnSuccess"]!.GetValue<bool>());
        Assert.Equal(-.5, input["threshold"]!.GetValue<double>()); Assert.Equal(4, input["maxWindow"]!.GetValue<double>());
        Assert.False(File.Exists(input["probeImagePath"]!.GetValue<string>()));
    }

    [Theory]
    [InlineData("print('not json')", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("print('[]')", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("print('{}')", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("print('{\"ok\":true,\"matched\":true,\"score\":\"bad\"}')", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("import sys; sys.exit(3)", "PYTHON_PROCESS_ERROR", 502)]
    [InlineData("import time; time.sleep(5)", "PYTHON_TIMEOUT", 504)]
    [InlineData("print('x' * 1048577); import time; time.sleep(5)", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("import sys,time; sys.stderr.write('x' * 1048577); sys.stderr.flush(); time.sleep(5)", "PYTHON_OUTPUT_INVALID", 502)]
    [InlineData("print('{\"ok\":false,\"matched\":false,\"score\":null,\"reason\":\"gpu_required\"}')", "GPU_REQUIRED", 503)]
    public async Task PythonFailuresCleanTemporaryFiles(string script, string code, int status)
    {
        using var factory = new Factory(false, new() { ["Face:ScriptPath"] = Path.Combine(Path.GetTempPath(), "unused") });
        Directory.CreateDirectory(factory.Root); var path = Path.Combine(factory.Root, "worker.py"); await File.WriteAllTextAsync(path, script);
        using var configured = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Face:ScriptPath"] = path, ["FACE_PYTHON_TIMEOUT_MS"] = "1000" })));
        using var client = configured.CreateClient();
        var response = await Send(client, "/verify/face", Form(null, Probe(), Reference()), (HttpStatusCode)status);
        Assert.Equal(code, response["error"]!["code"]!.GetValue<string>());
        Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(factory.Root, "temp")));
    }

    [Fact]
    public async Task MissingPythonRuntimeReturns503()
    {
        using var factory = new Factory(false, new() { ["FACE_PYTHON_BIN"] = "securekit-python-missing" }); using var client = factory.CreateClient();
        var response = await Send(client, "/verify/face", Form(null, Probe(), Reference()), HttpStatusCode.ServiceUnavailable);
        Assert.Equal("PYTHON_RUNTIME_UNAVAILABLE", response["error"]!["code"]!.GetValue<string>());
        Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(factory.Root, "temp")));
    }

    [Fact]
    public async Task ValidNegativeWorkerResultOnNonzeroExitRemainsHttp200()
    {
        using var factory = new Factory(false); Directory.CreateDirectory(factory.Root); var script = Path.Combine(factory.Root, "negative.py");
        await File.WriteAllTextAsync(script, "import sys\nprint('{\"ok\":false,\"matched\":false,\"score\":null,\"reason\":\"probe_face_not_detected\"}')\nsys.exit(1)");
        using var configured = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Face:ScriptPath"] = script })));
        using var client = configured.CreateClient(); var result = await Send(client, "/verify/face", Form(null, Probe(), Reference()));
        Assert.False(result["ok"]!.GetValue<bool>()); Assert.Equal("FACE_NOT_DETECTED", result["failureCode"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CancellationAndTimeoutKillProcessBeforeReturning(bool cancel)
    {
        using var factory = new Factory(false); Directory.CreateDirectory(factory.Root);
        var script = Path.Combine(factory.Root, "cancel.py"); var pid = Path.Combine(factory.Root, "pid.txt");
        await File.WriteAllTextAsync(script, "import os,time,pathlib\npathlib.Path(" + System.Text.Json.JsonSerializer.Serialize(pid) + ").write_text(str(os.getpid()))\ntime.sleep(20)");
        using var configured = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Face:ScriptPath"] = script, ["FACE_PYTHON_TIMEOUT_MS"] = "2000" })));
        var python = configured.Services.GetRequiredService<IFacePython>(); using var cancellation = new CancellationTokenSource();
        var run = python.RunAsync(new JsonObject { ["referenceImagePath"] = "reference.jpg", ["probeImagePath"] = "probe.jpg" }, false, cancellation.Token);
        for (var i = 0; i < 100 && !File.Exists(pid); i++) await Task.Delay(20);
        Assert.True(File.Exists(pid)); var processId = int.Parse(await File.ReadAllTextAsync(pid));
        if (cancel) { cancellation.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => run); }
        else { var failure = await Assert.ThrowsAsync<FaceFailure>(() => run); Assert.Equal("PYTHON_TIMEOUT", failure.Code); }
        Assert.Throws<ArgumentException>(() => System.Diagnostics.Process.GetProcessById(processId));
    }

    [Theory]
    [InlineData("..")]
    [InlineData("../outside")]
    [InlineData("C:/outside")]
    [InlineData("nested/user")]
    public async Task SlidingUserCannotChooseAnOutsideDirectory(string user)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var response = await Send(client, "/verify/face-sliding", Form(new() { ["userId"] = user }, Probe()), HttpStatusCode.BadRequest);
        Assert.Equal("INVALID_REQUEST", response["error"]!["code"]!.GetValue<string>()); Assert.Null(factory.Runner.Input);
    }

    [Fact]
    public async Task MissingManagedReferenceReturns404()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var path = Path.Combine(factory.Root, "references", "missing.jpg");
        var response = await Send(client, "/verify/face", Form(new() { ["referenceImagePath"] = path }, Probe()), HttpStatusCode.NotFound);
        Assert.Equal("reference image was not found.", response["error"]!["message"]!.GetValue<string>());
    }

    [Fact]
    public async Task FailedProfileWriteRemovesNewReference()
    {
        using var factory = new Factory(); Directory.CreateDirectory(Path.Combine(factory.Root, "profiles.json")); using var client = factory.CreateClient();
        var response = await Send(client, "/enroll/face/reference", Form(new() { ["userId"] = "u" }, Reference()), HttpStatusCode.InternalServerError);
        Assert.Equal("INTERNAL_ERROR", response["error"]!["code"]!.GetValue<string>());
        Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(factory.Root, "references")));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"ok\":true,\"matched\":false}")]
    [InlineData("{\"ok\":true,\"matched\":false,\"windowSizeBefore\":0,\"windowSizeAfter\":1,\"threshold\":\"bad\"}")]
    public async Task SlidingMalformedWorkerSchemaReturns502(string json)
    {
        using var factory = new Factory(false); Directory.CreateDirectory(factory.Root); var script = Path.Combine(factory.Root, "sliding.py");
        await File.WriteAllTextAsync(script, "print(" + System.Text.Json.JsonSerializer.Serialize(json) + ")");
        using var configured = factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["Face:SlidingScriptPath"] = script })));
        using var client = configured.CreateClient();
        var response = await Send(client, "/verify/face-sliding", Form(new() { ["userId"] = "u" }, Probe()), HttpStatusCode.BadGateway);
        Assert.Equal("PYTHON_OUTPUT_INVALID", response["error"]!["code"]!.GetValue<string>());
        Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(factory.Root, "temp")));
    }
}
