using System.ComponentModel.DataAnnotations;
using System.Net;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using SecureKit.Api.Tests.Support;

namespace SecureKit.Api.Tests;

public sealed class InfrastructureTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task JsonUsesCamelCaseStringEnumsAndExplicitNulls()
    {
        using var testFactory = WithProbe();
        using var client = testFactory.CreateClient();
        using var response = await client.PostAsync("/__test/json",
            new StringContent("{\"userId\":\"demo\",\"count\":2,\"decision\":\"allow\"}", Encoding.UTF8, "application/json"));
        var json = await ContractAssert.JsonResponseAsync(response, HttpStatusCode.OK);
        Assert.Equal("demo", json["userId"]?.GetValue<string>());
        Assert.Equal(2, json["count"]?.GetValue<int>());
        Assert.Equal("allow", json["decision"]?.GetValue<string>());
        Assert.True(json.AsObject().ContainsKey("optionalValue"));
        Assert.Null(json["optionalValue"]);
        Assert.False(json.AsObject().ContainsKey("UserId"));
    }

    [Theory]
    [InlineData("{")]
    [InlineData("{\"UserId\":\"demo\"}")]
    [InlineData("{\"userId\":\"demo\",\"count\":\"2\"}")]
    [InlineData("{\"userId\":\"demo\",\"decision\":0}")]
    public async Task InvalidJsonUsesErrorEnvelope(string body)
    {
        using var testFactory = WithProbe();
        using var client = testFactory.CreateClient();
        using var response = await client.PostAsync("/__test/json",
            new StringContent(body, Encoding.UTF8, "application/json"));
        await ContractAssert.ErrorAsync(response, HttpStatusCode.BadRequest, "VALIDATION_ERROR");
    }

    [Fact]
    public async Task ExceptionsAreHandledWithoutExposingDetailsAndIncludeCors()
    {
        using var testFactory = WithProbe();
        using var client = testFactory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/__test/throw");
        request.Headers.Add("Origin", "http://localhost:5173");
        using var response = await client.SendAsync(request);
        await ContractAssert.ErrorAsync(response, HttpStatusCode.InternalServerError, "INTERNAL_ERROR");
        Assert.DoesNotContain("sensitive exception", await response.Content.ReadAsStringAsync());
        Assert.Equal("*", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
    }

    private Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> WithProbe() =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddControllers().AddApplicationPart(typeof(InfrastructureProbeController).Assembly)));
}

// Registered only by WithProbe; these endpoints never ship in the API.
[ApiController]
public sealed class InfrastructureProbeController : ControllerBase
{
    [HttpPost("/__test/json")]
    public IActionResult Json(ProbeRequest request) => Ok(request);

    [HttpGet("/__test/throw")]
    public IActionResult Throw() => throw new InvalidOperationException("sensitive exception");

    [HttpGet("/__test/users/{userId}")]
    public IActionResult GetUser(string userId) => Ok(new { userId });
}

public sealed class ProbeRequest
{
    [Required]
    public string UserId { get; set; } = "";
    public int Count { get; set; }
    public ProbeDecision Decision { get; set; }
    public string? OptionalValue { get; set; }
}
public enum ProbeDecision { Allow, StepUp, Deny }
