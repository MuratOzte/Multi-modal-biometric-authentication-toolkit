using System.Net;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using SecureKit.Api.Tests.Support;

namespace SecureKit.Api.Tests;

public sealed class StageSevenTests
{
    private sealed class Factory : WebApplicationFactory<Program>
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "securekit-stage7-" + Guid.NewGuid());
        public Dictionary<string, string?> Settings { get; } = new();
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((context, config) =>
            {
                var repository = Path.GetFullPath(Path.Combine(context.HostingEnvironment.ContentRootPath, "../.."));
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["SECUREKIT_PROFILE_STORE"] = Path.Combine(Root, "profiles.json"),
                    ["Card:ReferenceDirectory"] = Path.Combine(Root, "references"),
                    ["Card:UserReferenceDirectory"] = Path.Combine(Root, "users"),
                    ["Card:TempRoot"] = Path.Combine(Root, "temp"),
                    ["CARD_UPLOAD_MAX_BYTES"] = "128", ["CARD_PYTHON_TIMEOUT_MS"] = "3000",
                    ["CARD_PYTHON_BIN"] = OperatingSystem.IsWindows() ? "py -3" : "python3",
                    ["Card:ScriptPath"] = Path.Combine(repository, "packages/node-auth/scripts/fixtures/card-stage7.py")
                });
                config.AddInMemoryCollection(Settings);
            });
        }
        protected override void Dispose(bool disposing)
        { base.Dispose(disposing); if (disposing && Directory.Exists(Root)) Directory.Delete(Root, true); }
        public void References()
        { Directory.CreateDirectory(Path.Combine(Root, "references")); File.WriteAllText(Path.Combine(Root, "references", "test-card.jpg"), "reference"); }
        public void Clean()
        { if (Directory.Exists(Path.Combine(Root, "temp"))) Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(Root, "temp"))); }
    }
    private static MultipartFormDataContent Form(string? user = null, string text = "same", string field = "probeImage", string mime = "image/jpeg", string? threshold = null, string? reference = null)
    {
        var form = new MultipartFormDataContent();
        if (user is not null) form.Add(new StringContent(user), "userId");
        if (threshold is not null) form.Add(new StringContent(threshold), "threshold");
        if (reference is not null) form.Add(new StringContent(reference), "referenceId");
        var file = new ByteArrayContent(System.Text.Encoding.UTF8.GetBytes(text));
        file.Headers.ContentType = new MediaTypeHeaderValue(mime); form.Add(file, field, "../../sample.exe");
        return form;
    }
    private static async Task<JsonNode> Send(HttpClient client, MultipartFormDataContent form, int status = 200, bool enroll = false)
    { using (form) return await ContractAssert.JsonResponseAsync(await client.PostAsync(enroll ? "/enroll/card/reference" : "/verify/card", form), (HttpStatusCode)status); }

    [Fact]
    public async Task ListsOnlyImagesAndHumanizesLabels()
    {
        using var f = new Factory(); f.References(); File.WriteAllText(Path.Combine(f.Root, "references", "ignore.txt"), "x");
        Directory.CreateDirectory(Path.Combine(f.Root, "references", "directory.png")); using var client = f.CreateClient();
        var result = await ContractAssert.JsonResponseAsync(await client.GetAsync("/card/references"), HttpStatusCode.OK);
        Assert.Single(result["references"]!.AsArray()); Assert.Equal("test card", result["references"]![0]!["label"]!.GetValue<string>());
    }
    [Theory]
    [InlineData("same", true)] [InlineData("different", false)] [InlineData("uncertain", false)]
    public async Task RealProtocolReturnsDecisionAndCleansTemp(string mode, bool matched)
    {
        using var f = new Factory(); f.References(); using var client = f.CreateClient();
        var result = await Send(client, Form(text: mode)); Assert.Equal(matched, result["matched"]!.GetValue<bool>());
        Assert.Equal(mode, result["bestMatch"]!["decision"]!.GetValue<string>());
        Assert.Equal("", result["bestMatch"]!["fields"]!["probe"]!["documentNo"]!.GetValue<string>()); f.Clean();
    }
    [Fact]
    public async Task EnrollmentNormalizesUserReplacesFileAndUsesStoredReference()
    {
        using var f = new Factory(); using var client = f.CreateClient();
        var first = await Send(client, Form(" U ", field: "referenceImage"), enroll: true);
        Assert.Equal("u", first["userId"]!.GetValue<string>());
        var previous = first["reference"]!["imagePath"]!.GetValue<string>(); Assert.Equal(".jpg", Path.GetExtension(previous));
        var next = await Send(client, Form("u", field: "referenceImage", mime: "image/png"), enroll: true);
        Assert.False(File.Exists(previous)); Assert.True(File.Exists(next["reference"]!["imagePath"]!.GetValue<string>()));
        var verified = await Send(client, Form(" U ", reference: "ignored")); Assert.True(verified["matched"]!.GetValue<bool>()); f.Clean();
    }
    [Theory]
    [InlineData("invalid", 502, "PYTHON_OUTPUT_INVALID")]
    [InlineData("schema", 502, "PYTHON_OUTPUT_INVALID")]
    [InlineData("stdout", 502, "PYTHON_OUTPUT_INVALID")]
    [InlineData("stderr", 502, "PYTHON_OUTPUT_INVALID")]
    [InlineData("exit", 502, "PYTHON_PROCESS_ERROR")]
    [InlineData("failure", 502, "PYTHON_PROCESS_ERROR")]
    [InlineData("dependency", 502, "PYTHON_PROCESS_ERROR")]
    [InlineData("empty", 404, "REFERENCE_NOT_FOUND")]
    [InlineData("timeout", 504, "PYTHON_TIMEOUT")]
    public async Task WorkerFailuresAreMappedAndCleaned(string mode, int status, string code)
    {
        using var f = new Factory(); f.References(); using var client = f.CreateClient();
        var result = await Send(client, Form(text: mode), status); Assert.Equal(code, result["error"]!["code"]!.GetValue<string>()); f.Clean();
    }
    [Theory]
    [InlineData("NaN")] [InlineData("Infinity")] [InlineData("-1")] [InlineData("2")]
    public async Task RejectsInvalidThreshold(string threshold)
    { using var f = new Factory(); f.References(); using var client = f.CreateClient(); await Send(client, Form(threshold: threshold), 400); f.Clean(); }
    [Theory]
    [InlineData("", "probeImage", "image/jpeg", 400)]
    [InlineData("x", "other", "image/jpeg", 400)]
    [InlineData("x", "probeImage", "text/plain", 400)]
    public async Task RejectsInvalidUploads(string text, string field, string mime, int status)
    { using var f = new Factory(); using var client = f.CreateClient(); await Send(client, Form(text: text, field: field, mime: mime), status); }
    [Fact]
    public async Task RejectsOversizeAndMissingRuntime()
    {
        using var f = new Factory(); f.References(); f.Settings["CARD_PYTHON_BIN"] = Path.Combine(f.Root, "missing-python"); using var client = f.CreateClient();
        await Send(client, Form(text: new string('x', 129)), 413);
        var result = await Send(client, Form(), 503); Assert.Equal("PYTHON_RUNTIME_UNAVAILABLE", result["error"]!["code"]!.GetValue<string>()); f.Clean();
    }
    [Fact]
    public async Task MissingAndUnknownReferencesReturn404()
    {
        using var f = new Factory(); using var client = f.CreateClient(); await Send(client, Form(), 404);
        f.References(); await Send(client, Form(reference: "../test-card.jpg"), 404); await Send(client, Form("missing"), 404);
    }
}
