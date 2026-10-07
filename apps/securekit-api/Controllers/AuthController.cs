using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class AuthController(FileUserStore store, TimeProvider clock) : ControllerBase
{
    [HttpGet("/auth/users")]
    public async Task<IActionResult> Users()
    {
        try { return Ok(new { ok = true, users = await store.ListAsync() }); }
        catch (Exception ex) { return Failure("Failed to list users.", ex); }
    }

    [HttpPost("/auth/register")]
    public Task<IActionResult> Register([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonNode? body) => Authenticate(body, true);

    [HttpPost("/auth/login")]
    public Task<IActionResult> Login([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonNode? body) => Authenticate(body, false);

    private async Task<IActionResult> Authenticate(JsonNode? body, bool register)
    {
        var errors = new Dictionary<string, string>();
        var obj = body as JsonObject;
        var id = JsonValues.Text(obj?["userId"])?.Trim().ToLowerInvariant() ?? "";
        var password = JsonValues.Text(obj?["password"]) ?? "";
        if (body is not (JsonObject or JsonArray)) errors["body"] = "Request body must be an object.";
        else
        {
            if (id.Length == 0) errors["userId"] = "userId is required.";
            if (password.Length == 0) errors["password"] = "password is required.";
        }
        if (errors.Count > 0) return BadRequest(new ApiErrorResponse(new ApiError("VALIDATION_ERROR",
            register ? "Invalid registration request." : "Invalid login request.", new { fieldErrors = errors })));
        try
        {
            if (!register) return await store.LoginAsync(id, password) ? Ok(new { ok = true, userId = id })
                : StatusCode(401, new ApiErrorResponse(new ApiError("INVALID_CREDENTIALS", "Invalid userId or password.")));
            var result = await store.RegisterAsync(id, password, JsonValues.Iso(clock.GetUtcNow()));
            return result == "conflict" ? StatusCode(409, new ApiErrorResponse(new ApiError("USER_EXISTS", "User already exists with a different password.")))
                : StatusCode(result == "created" ? 201 : 200, new { ok = true, userId = id, created = result == "created" });
        }
        catch (Exception ex) { return Failure(register ? "Failed to register user." : "Failed to login.", ex); }
    }
    private IActionResult Failure(string message, Exception ex) => StatusCode(500, new ApiErrorResponse(new ApiError("INTERNAL_ERROR", message, ex.Message)));
}
