using Microsoft.AspNetCore.Diagnostics;
using SecureKit.Api.Contracts;

namespace SecureKit.Api.Infrastructure;

public sealed class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        logger.LogError(exception, "Unhandled API exception. TraceId: {TraceId}", context.TraceIdentifier);
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(
            new ApiErrorResponse(new ApiError("INTERNAL_ERROR", "An unexpected error occurred.")),
            cancellationToken);
        return true;
    }
}
