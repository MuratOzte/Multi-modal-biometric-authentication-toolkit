using Microsoft.AspNetCore.Mvc;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class HealthController : ControllerBase
{
    [HttpGet("/health")]
    public IActionResult Get() => Ok(new { ok = true });
}
