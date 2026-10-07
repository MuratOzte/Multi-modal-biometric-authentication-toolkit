using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class ChallengeController(ChallengeStore store) : ControllerBase
{
    [HttpPost("/challenge/text")]
    public IActionResult Create([FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] JsonElement body)
    {
        var lang = "tr";
        var length = "short";
        string? text = null, session = null;
        int? count = null;
        if (body.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
        {
            // Express treats arrays as objects; unknown fields are ignored.
            if (body.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array)) return Invalid(false);
            if (body.ValueKind == JsonValueKind.Object)
            {
                if (body.TryGetProperty("lang", out var l))
                { if (l.ValueKind != JsonValueKind.String || l.GetString() is not ("tr" or "en")) return Invalid(false); lang = l.GetString()!; }
                if (body.TryGetProperty("length", out var len))
                { if (len.ValueKind != JsonValueKind.String || len.GetString() is not ("short" or "medium" or "long")) return Invalid(false); length = len.GetString()!; }
                if (body.TryGetProperty("wordCount", out var n))
                {
                    if (n.ValueKind != JsonValueKind.Number || !n.TryGetDouble(out var number) || !double.IsFinite(number)) return Invalid(false);
                    var rounded = Math.Floor(number + .5);
                    if (rounded < 1 || rounded > 64) return Invalid(false);
                    count = (int)rounded;
                }
                foreach (var field in new[] { "text", "sessionId" })
                {
                    if (!body.TryGetProperty(field, out var value)) continue;
                    if (value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString())) return Invalid(false);
                    if (field == "text") text = value.GetString()!.Trim(); else session = value.GetString()!.Trim();
                }
            }
        }
        var record = store.Create(lang, length, count, text, session);
        return Ok(new { challengeId = record.Id, record.Text, record.Lang,
            expiresAt = DateTimeOffset.FromUnixTimeMilliseconds(record.ExpiresAtMs).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture) });
    }

    [HttpPost("/challenge/text/consume")]
    public IActionResult Consume([FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty("challengeId", out var value)
            || value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString())) return Invalid(true);
        var (record, error) = store.Consume(value.GetString()!.Trim());
        return error switch
        {
            "CHALLENGE_NOT_FOUND" => StatusCode(404, new ApiErrorResponse(new ApiError(error, "Challenge was not found."))),
            "CHALLENGE_EXPIRED" => StatusCode(410, new ApiErrorResponse(new ApiError(error, "Challenge has expired."))),
            "CHALLENGE_ALREADY_USED" => StatusCode(409, new ApiErrorResponse(new ApiError(error, "Challenge has already been consumed."))),
            _ => Ok(new { ok = true, challengeId = record!.Id })
        };
    }

    private IActionResult Invalid(bool consume) => BadRequest(new ApiErrorResponse(new ApiError("INVALID_REQUEST",
        consume ? "A valid consume challenge request body is required." : "A valid challenge text request body is required.")));
}
