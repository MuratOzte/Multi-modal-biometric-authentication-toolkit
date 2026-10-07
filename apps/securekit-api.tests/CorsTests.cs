using System.Net;
using Microsoft.AspNetCore.Hosting;
using SecureKit.Api.Tests.Support;

namespace SecureKit.Api.Tests;

public sealed class CorsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task DefaultPolicyAllowsDemoOrigin()
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", "http://localhost:5173");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("*", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.False(response.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    [Fact]
    public async Task PreflightAllowsJsonDeleteRequests()
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/user/biometrics");
        request.Headers.Add("Origin", "http://localhost:5173");
        request.Headers.Add("Access-Control-Request-Method", "DELETE");
        request.Headers.Add("Access-Control-Request-Headers", "content-type");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("DELETE", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Methods")));
        Assert.Equal("content-type", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Headers")));
    }

    [Theory]
    [InlineData("http://localhost:5173", true)]
    [InlineData("https://unlisted.example", false)]
    public async Task ConfiguredOriginsAreRespected(string origin, bool allowed)
    {
        using var restrictedFactory = factory.WithWebHostBuilder(builder =>
            builder.UseSetting("Cors:AllowedOrigins:0", "http://localhost:5173"));
        using var client = restrictedFactory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add("Origin", origin);
        using var response = await client.SendAsync(request);
        Assert.Equal(allowed, response.Headers.Contains("Access-Control-Allow-Origin"));
        if (allowed)
            Assert.Equal(origin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
    }
}
