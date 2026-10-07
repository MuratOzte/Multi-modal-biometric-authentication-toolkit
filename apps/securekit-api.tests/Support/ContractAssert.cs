using System.Net;
using System.Text.Json.Nodes;

namespace SecureKit.Api.Tests.Support;

public static class ContractAssert
{
    public static async Task<JsonNode> JsonResponseAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var json = JsonNode.Parse(await response.Content.ReadAsStringAsync());
        Assert.NotNull(json);
        return json;
    }

    public static async Task ErrorAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        var json = await JsonResponseAsync(response, status);
        Assert.Equal(code, json["error"]?["code"]?.GetValue<string>());
        Assert.False(string.IsNullOrWhiteSpace(json["error"]?["message"]?.GetValue<string>()));
    }

    // Requests must be created separately: HttpRequestMessage cannot be sent twice.
    // Callers explicitly normalize random IDs/timestamps in both responses when necessary.
    public static async Task EquivalentAsync(
        HttpClient nodeClient, HttpClient apiClient, Func<HttpRequestMessage> createRequest,
        Action<JsonNode>? normalize = null)
    {
        using var nodeRequest = createRequest();
        using var apiRequest = createRequest();
        using var nodeResponse = await nodeClient.SendAsync(nodeRequest);
        using var apiResponse = await apiClient.SendAsync(apiRequest);
        var expected = await JsonResponseAsync(nodeResponse, nodeResponse.StatusCode);
        var actual = await JsonResponseAsync(apiResponse, nodeResponse.StatusCode);
        normalize?.Invoke(expected);
        normalize?.Invoke(actual);
        Assert.True(JsonNode.DeepEquals(expected, actual),
            $"Node response: {expected}\nASP.NET response: {actual}");
    }
}
