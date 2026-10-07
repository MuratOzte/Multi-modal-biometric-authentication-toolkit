using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class SessionController(SessionStore store, SessionRiskEvaluator evaluator) : ControllerBase
{
    [HttpPost("/session/start")]
    public IActionResult Start()
    {
        var record = store.Start();
        return Ok(new { sessionId = record.SessionId, expiresAt = JsonValues.Iso(DateTimeOffset.FromUnixTimeMilliseconds(record.ExpiresAt)) });
    }
    [HttpPost("/verify/session")]
    public async Task<IActionResult> Verify([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonNode? body)
    {
        var request = body as JsonObject;
        var id = JsonValues.Text(request?["sessionId"])?.Trim();
        if (string.IsNullOrEmpty(id)) return BadRequest(new ApiErrorResponse(new ApiError("INVALID_REQUEST", "A valid verify session request body is required.")));
        var (record, error) = store.Merge(id, request?["signals"] as JsonObject);
        if (error is not null) return StatusCode(error == "SESSION_EXPIRED" ? 410 : 404, new ApiErrorResponse(new ApiError(error,
            error == "SESSION_EXPIRED" ? "Session has expired." : "Session was not found.")));
        return Ok(await evaluator.EvaluateAsync(record!, JsonValues.Text(request?["userId"])?.Trim(), request?["policy"] as JsonObject));
    }
}
