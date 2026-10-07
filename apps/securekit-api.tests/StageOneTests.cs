using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SecureKit.Api.Services;
using SecureKit.Api.Tests.Support;

namespace SecureKit.Api.Tests;

public sealed class StageOneTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.Parse("2026-10-07T09:00:00Z");
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Factory : WebApplicationFactory<Program>
    {
        public readonly Clock Clock = new();
        public string StorePath { get; } = Path.Combine(Path.GetTempPath(), "securekit-tests-" + Guid.NewGuid(), "profiles.json");
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            { ["SECUREKIT_PROFILE_STORE"] = StorePath, ["CHALLENGE_TTL_SECONDS"] = "120" }));
            builder.ConfigureServices(services => services.AddSingleton<TimeProvider>(Clock));
        }
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (Directory.Exists(Path.GetDirectoryName(StorePath))) Directory.Delete(Path.GetDirectoryName(StorePath)!, true);
        }
    }
    private static Task<HttpResponseMessage> Send(HttpClient client, string path, string json, bool delete = false) =>
        client.SendAsync(new HttpRequestMessage(delete ? HttpMethod.Delete : HttpMethod.Post, path)
        { Content = new StringContent(json, Encoding.UTF8, "application/json") });

    [Theory]
    [InlineData("{\"lang\":\"de\"}")]
    [InlineData("{\"length\":null}")]
    [InlineData("{\"wordCount\":0.49}")]
    [InlineData("{\"wordCount\":64.5}")]
    [InlineData("{\"wordCount\":\"4\"}")]
    [InlineData("{\"text\":\" \"}")]
    [InlineData("{\"sessionId\":2}")]
    public async Task InvalidChallenges(string body)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var json = await ContractAssert.JsonResponseAsync(await Send(client, "/challenge/text", body), HttpStatusCode.BadRequest);
        Assert.Equal("INVALID_REQUEST", json["error"]!["code"]!.GetValue<string>());
        Assert.Equal("A valid challenge text request body is required.", json["error"]!["message"]!.GetValue<string>());
    }

    [Fact]
    public async Task ChallengeExpiryAndOneUseAreAtomic()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var challenge = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/challenge/text", new { text = "  hello world  ", sessionId = " s1 " }), HttpStatusCode.OK);
        Assert.Equal("hello world", challenge["text"]!.GetValue<string>());
        Assert.Equal("2026-10-07T09:02:00.000Z", challenge["expiresAt"]!.GetValue<string>());
        var id = challenge["challengeId"]!.GetValue<string>();
        factory.Clock.Now = factory.Clock.Now.AddSeconds(120);
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => client.PostAsJsonAsync("/challenge/text/consume", new { challengeId = id })));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Equal(7, results.Count(r => r.StatusCode == HttpStatusCode.Conflict));
        factory.Clock.Now = factory.Clock.Now.AddMilliseconds(1);
        await ContractAssert.ErrorAsync(await client.PostAsJsonAsync("/challenge/text/consume", new { challengeId = id }), HttpStatusCode.Conflict, "CHALLENGE_ALREADY_USED");
        var next = await ContractAssert.JsonResponseAsync(await Send(client, "/challenge/text", "{}"), HttpStatusCode.OK);
        factory.Clock.Now = factory.Clock.Now.AddSeconds(120).AddMilliseconds(1);
        var payload = new { challengeId = next["challengeId"]!.GetValue<string>() };
        await ContractAssert.ErrorAsync(await client.PostAsJsonAsync("/challenge/text/consume", payload), HttpStatusCode.Gone, "CHALLENGE_EXPIRED");
        await ContractAssert.ErrorAsync(await client.PostAsJsonAsync("/challenge/text/consume", payload), HttpStatusCode.NotFound, "CHALLENGE_NOT_FOUND");
        await ContractAssert.ErrorAsync(await Send(client, "/challenge/text/consume", "{}"), HttpStatusCode.BadRequest, "INVALID_REQUEST");
    }

    [Theory]
    [InlineData("en", "short", 5, 7)]
    [InlineData("en", "medium", 10, 12)]
    [InlineData("en", "long", 16, 20)]
    [InlineData("tr", "long", 40, 50)]
    public async Task GeneratedTextMatchesNodeRules(string lang, string length, int min, int max)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        for (var i = 0; i < 10; i++)
        {
            var json = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/challenge/text", new { lang, length }), HttpStatusCode.OK);
            var text = json["text"]!.GetValue<string>();
            Assert.InRange(lang == "tr" ? text.Count(char.IsLetter) : text.Split(' ').Length, min, max);
            if (lang == "tr") Assert.EndsWith(".", text);
        }
        if (lang == "en")
        {
            var json = await ContractAssert.JsonResponseAsync(await Send(client, "/challenge/text", "{\"lang\":\"en\",\"wordCount\":4.5}"), HttpStatusCode.OK);
            Assert.Equal(5, json["text"]!.GetValue<string>().Split(' ').Length);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ConsentAndSeededNodeProfilesDeleteFlow(bool deleteConsent)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var consent = await ContractAssert.JsonResponseAsync(await Send(client, "/consent", "{\"userId\":\" u1 \",\"consentVersion\":\" v1 \"}"), HttpStatusCode.OK);
        Assert.Equal("u1", consent["userId"]!.GetValue<string>());
        Assert.Equal("2026-10-07T09:00:00.000Z", consent["grantedAt"]!.GetValue<string>());
        var payload = JsonNode.Parse(await File.ReadAllTextAsync(factory.StorePath))!;
        var profile = JsonNode.Parse("{\"userId\":\"u1\",\"keystroke\":{\"sampleCount\":3},\"faceEmbedding\":[0.1,0.2],\"updatedAt\":\"2026-10-06T00:00:00.000Z\"}")!;
        payload["records"]!["u1"]!["profiles"] = profile;
        await File.WriteAllTextAsync(factory.StorePath, payload.ToJsonString());
        var read = await ContractAssert.JsonResponseAsync(await client.GetAsync("/user/u1/profiles"), HttpStatusCode.OK);
        Assert.True(JsonNode.DeepEquals(profile, read["profiles"]));
        var response = await ContractAssert.JsonResponseAsync(await Send(client, "/user/biometrics?deleteConsent=false&deleteConsent=" + deleteConsent.ToString(), "{\"userId\":\"u1\"}", true), HttpStatusCode.OK);
        Assert.True(response["ok"]!.GetValue<bool>());
        var empty = await ContractAssert.JsonResponseAsync(await client.GetAsync("/user/u1/profiles"), HttpStatusCode.OK);
        Assert.Equal(10, empty["profiles"]!.AsObject().Count);
        Assert.Null(empty["profiles"]!["keystroke"]);
        payload = JsonNode.Parse(await File.ReadAllTextAsync(factory.StorePath))!;
        if (deleteConsent) Assert.Null(payload["records"]!["u1"]);
        else Assert.Single(payload["records"]!["u1"]!["consentLogs"]!.AsArray());
        using var second = new Factory();
        // A fresh adapter reads persisted data, without requiring a biometric enrollment endpoint.
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["SECUREKIT_PROFILE_STORE"] = factory.StorePath }).Build();
        Assert.Null(await new FileProfileStorage(config, factory.Services.GetRequiredService<IWebHostEnvironment>()).GetProfilesAsync("u1"));
    }

    [Theory]
    [InlineData("/consent", "{}", false, "consentVersion")]
    [InlineData("/consent", "null", false, "body")]
    [InlineData("/user/biometrics", "{\"userId\":4}", true, "userId")]
    public async Task ValidationHasFieldErrors(string path, string body, bool delete, string field)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var json = await ContractAssert.JsonResponseAsync(await Send(client, path, body, delete), HttpStatusCode.BadRequest);
        Assert.Equal("VALIDATION_ERROR", json["error"]!["code"]!.GetValue<string>());
        Assert.NotNull(json["error"]!["details"]!["fieldErrors"]![field]);
    }

    [Fact]
    public async Task WhitespaceUserIdUsesProfileValidation()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var json = await ContractAssert.JsonResponseAsync(await client.GetAsync("/user/%20/profiles"), HttpStatusCode.BadRequest);
        Assert.Equal("Invalid user profile request.", json["error"]!["message"]!.GetValue<string>());
        Assert.Equal("userId is required.", json["error"]!["details"]!["fieldErrors"]!["userId"]!.GetValue<string>());
    }

    [Fact]
    public async Task ConcurrentConsentWritesPersistAcrossAdapterInstances()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(i => client.PostAsJsonAsync("/consent", new { userId = "u1", consentVersion = "v" + i })));
        Assert.All(results, result => Assert.Equal(HttpStatusCode.OK, result.StatusCode));
        var payload = JsonNode.Parse(await File.ReadAllTextAsync(factory.StorePath))!;
        Assert.Equal(10, payload["records"]!["u1"]!["consentLogs"]!.AsArray().Count);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["SECUREKIT_PROFILE_STORE"] = factory.StorePath }).Build();
        var adapter = new FileProfileStorage(config, factory.Services.GetRequiredService<IWebHostEnvironment>());
        await adapter.AppendConsentAsync(new JsonObject { ["userId"] = "u1", ["consentVersion"] = "restart", ["grantedAt"] = "2026-10-07T09:00:00.000Z" });
        payload = JsonNode.Parse(await File.ReadAllTextAsync(factory.StorePath))!;
        Assert.Equal(11, payload["records"]!["u1"]!["consentLogs"]!.AsArray().Count);
    }

    [Fact]
    public async Task CorruptStoreReturnsEndpointSpecificErrors()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        Directory.CreateDirectory(Path.GetDirectoryName(factory.StorePath)!);
        await File.WriteAllTextAsync(factory.StorePath, "broken json");
        foreach (var (path, method, body, message) in new[] {
            ("/consent", HttpMethod.Post, "{\"userId\":\"u1\",\"consentVersion\":\"v1\"}", "Failed to persist consent."),
            ("/user/u1/profiles", HttpMethod.Get, "", "Failed to read user profiles."),
            ("/user/biometrics", HttpMethod.Delete, "{\"userId\":\"u1\"}", "Failed to delete biometrics.") })
        {
            var request = new HttpRequestMessage(method, path);
            if (body.Length > 0) request.Content = new StringContent(body, Encoding.UTF8, "application/json");
            var json = await ContractAssert.JsonResponseAsync(await client.SendAsync(request), HttpStatusCode.InternalServerError);
            Assert.Equal("INTERNAL_ERROR", json["error"]!["code"]!.GetValue<string>());
            Assert.Equal(message, json["error"]!["message"]!.GetValue<string>());
        }
    }
}
