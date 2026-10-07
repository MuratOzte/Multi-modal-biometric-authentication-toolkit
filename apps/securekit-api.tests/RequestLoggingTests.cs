using System.Collections.Concurrent;
using System.Net;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SecureKit.Api.Infrastructure;
using SecureKit.Api.Tests.Support;

namespace SecureKit.Api.Tests;

public sealed class RequestLoggingTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Theory]
    [InlineData("/__test/users/private-user?token=private-token", HttpStatusCode.OK, "/__test/users/{userId}")]
    [InlineData("/__test/throw?token=private-token", HttpStatusCode.InternalServerError, "/__test/throw")]
    public async Task LogsRouteAndFinalStatusWithoutQueryOrUserId(string path, HttpStatusCode status, string route)
    {
        using var logs = new CapturedLogs();
        using var testFactory = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddControllers().AddApplicationPart(typeof(InfrastructureProbeController).Assembly);
            services.AddLogging(logging => logging.AddProvider(logs));
        }));
        using var client = testFactory.CreateClient();
        using var response = await client.GetAsync(path);
        Assert.Equal(status, response.StatusCode);
        var entry = Assert.Single(logs.Entries, entry =>
            entry.Category == typeof(RequestLoggingMiddleware).FullName);
        Assert.Contains(route, entry.Message);
        Assert.Contains($"responded {(int)status}", entry.Message);
        Assert.Contains("TraceId:", entry.Message);
        Assert.DoesNotContain("private-user", entry.Message);
        Assert.DoesNotContain("private-token", entry.Message);
    }

    private sealed class CapturedLogs : ILoggerProvider
    {
        public ConcurrentQueue<(string Category, string Message)> Entries { get; } = new();
        public ILogger CreateLogger(string categoryName) => new CapturedLogger(categoryName, Entries);
        public void Dispose() { }
    }

    private sealed class CapturedLogger(string category, ConcurrentQueue<(string Category, string Message)> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => entries.Enqueue((category, formatter(state, exception)));
    }
}
