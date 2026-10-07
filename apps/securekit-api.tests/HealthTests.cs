using System.Net;
using SecureKit.Api.Tests.Support;

namespace SecureKit.Api.Tests;

public sealed class HealthTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task HealthMatchesNodeContract()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/health");
        var json = await ContractAssert.JsonResponseAsync(response, HttpStatusCode.OK);
        Assert.Equal("{\"ok\":true}", json.ToJsonString());
    }

    [Fact]
    public async Task UnmigratedBiometricRoutesAreNotExposed()
    {
        using var client = factory.CreateClient();
        using var response = await client.PostAsync("/enroll/card/reference", null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task InfrastructureProbeRoutesAreNotExposedByDefault()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/__test/throw");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
