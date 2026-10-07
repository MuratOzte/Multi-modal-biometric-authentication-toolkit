using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using SecureKit.Api.Tests.Support;

namespace SecureKit.Api.Tests;

public sealed class StageTwoTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.Parse("2026-10-07T09:00:00Z");
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Factory : WebApplicationFactory<Program>
    {
        public Clock Clock { get; } = new();
        public string DirectoryPath { get; } = Path.Combine(Path.GetTempPath(), "securekit-stage2-" + Guid.NewGuid());
        public string UsersPath => Path.Combine(DirectoryPath, "users.json");
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            { ["SECUREKIT_USERS_FILE"] = UsersPath, ["SECUREKIT_PROFILE_STORE"] = Path.Combine(DirectoryPath, "profiles.json"), ["SESSION_TTL_SECONDS"] = "1" }));
            builder.ConfigureServices(services => services.AddSingleton<TimeProvider>(Clock));
        }
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (Directory.Exists(DirectoryPath)) Directory.Delete(DirectoryPath, true);
        }
    }
    public static IEnumerable<object[]> RiskFixtures() => JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "session-risk.json")))!
        .AsArray().Select(f => new object[] { f!["name"]!.GetValue<string>(), f.ToJsonString() });
    private static async Task<string> Start(HttpClient client) => (await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/session/start", new { }), HttpStatusCode.OK))["sessionId"]!.GetValue<string>();

    [Fact]
    public async Task RegistrationLoginAndDuplicateContract()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var body = new { userId = " TestUser ", password = " pass " };
        var created = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/auth/register", body), HttpStatusCode.Created);
        Assert.Equal("testuser", created["userId"]!.GetValue<string>());
        Assert.True(created["created"]!.GetValue<bool>());
        var duplicate = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/auth/register", body), HttpStatusCode.OK);
        Assert.False(duplicate["created"]!.GetValue<bool>());
        await ContractAssert.ErrorAsync(await client.PostAsJsonAsync("/auth/register", new { userId = "TESTUSER", password = "other" }), HttpStatusCode.Conflict, "USER_EXISTS");
        await ContractAssert.ErrorAsync(await client.PostAsJsonAsync("/auth/login", new { userId = "testuser", password = "pass" }), HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
        await ContractAssert.ErrorAsync(await client.PostAsJsonAsync("/auth/login", new { userId = "missing", password = "pass" }), HttpStatusCode.Unauthorized, "INVALID_CREDENTIALS");
        var login = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/auth/login", body), HttpStatusCode.OK);
        Assert.Equal("testuser", login["userId"]!.GetValue<string>());
        var users = await ContractAssert.JsonResponseAsync(await client.GetAsync("/auth/users"), HttpStatusCode.OK);
        Assert.Single(users["users"]!.AsArray());
        Assert.Equal("2026-10-07T09:00:00.000Z", users["users"]![0]!["createdAt"]!.GetValue<string>());
        Assert.DoesNotContain("password", users.ToJsonString());
        Assert.Single(JsonNode.Parse(await File.ReadAllTextAsync(factory.UsersPath))!["users"]!.AsArray());
    }

    [Theory]
    [InlineData("/auth/register", "Invalid registration request.")]
    [InlineData("/auth/login", "Invalid login request.")]
    public async Task InvalidAuthUsesFieldErrors(string route, string message)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var json = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync(route, new { userId = " ", password = 1 }), HttpStatusCode.BadRequest);
        Assert.Equal(message, json["error"]!["message"]!.GetValue<string>());
        Assert.Equal(2, json["error"]!["details"]!["fieldErrors"]!.AsObject().Count);
    }

    [Fact]
    public async Task SeededUsersNormalizeAndPersistAcrossHosts()
    {
        using var factory = new Factory();
        Directory.CreateDirectory(factory.DirectoryPath);
        await File.WriteAllTextAsync(factory.UsersPath, "{\"users\":[{\"id\":\" Bob \",\"password\":\"x\"},{\"id\":\"bob\",\"password\":\"y\"},{\"id\":4,\"password\":\"z\"}]}");
        using (var client = factory.CreateClient())
        {
            var users = await ContractAssert.JsonResponseAsync(await client.GetAsync("/auth/users"), HttpStatusCode.OK);
            Assert.Single(users["users"]!.AsArray());
            Assert.Single(users["users"]![0]!.AsObject());
            await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/auth/login", new { userId = "BOB", password = "x" }), HttpStatusCode.OK);
            await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/auth/register", new { userId = "alice", password = "secret" }), HttpStatusCode.Created);
        }
        using var second = factory.WithWebHostBuilder(_ => { }); using var secondClient = second.CreateClient();
        await ContractAssert.JsonResponseAsync(await secondClient.PostAsJsonAsync("/auth/login", new { userId = "alice", password = "secret" }), HttpStatusCode.OK);
    }

    [Fact]
    public async Task ConcurrentRegistrationIsAtomic()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var results = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => client.PostAsJsonAsync("/auth/register", new { userId = "u1", password = "p" })));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.Created);
        Assert.Equal(9, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Single(JsonNode.Parse(await File.ReadAllTextAsync(factory.UsersPath))!["users"]!.AsArray());
    }

    [Theory]
    [MemberData(nameof(RiskFixtures))]
    public async Task RiskMatchesSharedFixtures(string name, string raw)
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var fixture = JsonNode.Parse(raw)!;
        var id = await Start(client);
        var body = new JsonObject { ["sessionId"] = id, ["signals"] = fixture["signals"]!.DeepClone(), ["policy"] = fixture["policy"]!.DeepClone() };
        var result = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/verify/session", body), HttpStatusCode.OK);
        Assert.Equal(fixture["decision"]!.GetValue<string>(), result["decision"]!.GetValue<string>());
        Assert.Equal(fixture["riskScore"]!.GetValue<int>(), result["riskScore"]!.GetValue<int>());
        Assert.Equal(id, result["sessionId"]!.GetValue<string>());
        if (name == "stepOrder") Assert.Equal(new[] { "face", "voice", "passkey" }, result["requiredSteps"]!.AsArray().Select(s => s!["step"]!.GetValue<string>()));
        if (name == "empty") Assert.Empty(result["signalsUsed"]!.AsObject());
    }

    [Fact]
    public async Task SessionsExpireAtBoundaryAndRetainSignals()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var started = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/session/start", new { }), HttpStatusCode.OK);
        Assert.Equal("2026-10-07T09:00:01.000Z", started["expiresAt"]!.GetValue<string>());
        var id = started["sessionId"]!.GetValue<string>();
        await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/verify/session", new { sessionId = id, signals = new { network = new { score = 95, flags = new { }, reasons = Array.Empty<string>() } } }), HttpStatusCode.OK);
        var result = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/verify/session", new { sessionId = id, signals = new { location = new { countryCode = "TR", allowed = true, reasons = Array.Empty<string>() } } }), HttpStatusCode.OK);
        Assert.Equal(2, result["signalsUsed"]!.AsObject().Count);
        factory.Clock.Now = factory.Clock.Now.AddSeconds(1);
        await ContractAssert.ErrorAsync(await client.PostAsJsonAsync("/verify/session", new { sessionId = id }), HttpStatusCode.Gone, "SESSION_EXPIRED");
        await ContractAssert.ErrorAsync(await client.PostAsJsonAsync("/verify/session", new { sessionId = id }), HttpStatusCode.NotFound, "SESSION_NOT_FOUND");
        await ContractAssert.ErrorAsync(await client.PostAsJsonAsync("/verify/session", new { }), HttpStatusCode.BadRequest, "INVALID_REQUEST");
    }

    [Fact]
    public async Task KeystrokeMissingProfileAndUserProduceCompatibleReasons()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        var id = await Start(client);
        var request = new JsonObject { ["sessionId"] = id, ["policy"] = JsonNode.Parse("{\"keystroke\":{\"enabled\":true}}"), ["signals"] = JsonNode.Parse("{\"keystroke\":{\"events\":[]}}") };
        var noUser = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/verify/session", request), HttpStatusCode.OK);
        Assert.Contains("USER_ID_REQUIRED", noUser["reasons"]!.AsArray().Select(n => n!.GetValue<string>()));
        request["userId"] = "u1";
        var noProfile = await ContractAssert.JsonResponseAsync(await client.PostAsJsonAsync("/verify/session", request), HttpStatusCode.OK);
        Assert.Equal("step-up", noProfile["decision"]!.GetValue<string>());
        Assert.Equal("step_up", noProfile["signalsUsed"]!["keystroke"]!["decision"]!.GetValue<string>());
        Assert.Contains("PROFILE_MISSING", noProfile["reasons"]!.AsArray().Select(n => n!.GetValue<string>()));
    }

    [Fact]
    public async Task CorruptUsersFileUsesAuthErrors()
    {
        using var factory = new Factory(); using var client = factory.CreateClient();
        Directory.CreateDirectory(factory.DirectoryPath); await File.WriteAllTextAsync(factory.UsersPath, "invalid");
        await ContractAssert.ErrorAsync(await client.GetAsync("/auth/users"), HttpStatusCode.InternalServerError, "INTERNAL_ERROR");
        foreach (var route in new[] { "/auth/register", "/auth/login" })
            await ContractAssert.ErrorAsync(await client.PostAsJsonAsync(route, new { userId = "u1", password = "p" }), HttpStatusCode.InternalServerError, "INTERNAL_ERROR");
    }
}
