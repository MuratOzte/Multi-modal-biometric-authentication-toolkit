using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics;

namespace SecureKit.Api.Infrastructure;

public sealed class RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var started = Stopwatch.GetTimestamp();
        try
        {
            await next(context);
        }
        finally
        {
            // Route templates avoid logging user IDs; omit query strings, headers and bodies.
            // Exception middleware clears the endpoint; its feature retains the failed route.
            var endpoint = context.GetEndpoint() ?? context.Features.Get<IExceptionHandlerFeature>()?.Endpoint;
            var template = (endpoint as RouteEndpoint)?.RoutePattern.RawText;
            var route = template is null ? "<unmatched>" : "/" + template.TrimStart('/');
            logger.LogInformation(
                "HTTP {Method} {Route} responded {StatusCode} in {ElapsedMs:F2} ms. TraceId: {TraceId}",
                context.Request.Method, route, context.Response.StatusCode,
                Stopwatch.GetElapsedTime(started).TotalMilliseconds, context.TraceIdentifier);
        }
    }
}
