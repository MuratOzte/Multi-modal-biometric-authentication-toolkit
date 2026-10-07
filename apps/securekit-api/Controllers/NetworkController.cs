using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using SecureKit.Api.Contracts;
using SecureKit.Api.Services;
using static SecureKit.Api.Services.NetworkVerification;

namespace SecureKit.Api.Controllers;

[ApiController]
public sealed class NetworkController(IIpCheckService service, IWebHostEnvironment environment) : ControllerBase
{
    [HttpPost("/verify/webauthn:passkey")]
    public IActionResult Passkey([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonNode? body)
    {
        var ok = JsonValues.Truthy(Field(body, "proof"));
        return Ok(new { ok, score = ok ? 1 : 0 });
    }

    [HttpPost("/verify/face:liveness")]
    public IActionResult Liveness([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonNode? body)
    {
        var illumination = Field(Field(body, "metrics"), "illuminationOk");
        var isBoolean = illumination is JsonValue v && v.TryGetValue<bool>(out _);
        var ok = IsTrue(Field(Field(body, "proof"), "tasksOk")) && JsonValues.Number(Field(Field(body, "metrics"), "quality")) > .8 && !(isBoolean && !IsTrue(illumination));
        var result = new JsonObject { ["ok"] = ok, ["score"] = ok ? 1 : 0 };
        if (isBoolean) result["details"] = new JsonObject { ["illuminationOk"] = illumination!.DeepClone() };
        return Ok(result);
    }

    [HttpPost("/verify/network")]
    [HttpPost("/verify/location")]
    [HttpPost("/verify/vpn:check")]
    [HttpPost("/verify/location:country")]
    public async Task<IActionResult> Verify([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonNode? body, CancellationToken cancellationToken)
    {
        var request = body as JsonObject;
        var route = Request.Path.Value!;
        var vpn = route.EndsWith("vpn:check", StringComparison.Ordinal);
        var legacyCountry = route.EndsWith("location:country", StringComparison.Ordinal);
        var ip = ClientIp();
        var expected = Country(request?["expectedCountryCode"]);
        var clientCountry = Country(request?["clientCountryCode"]);
        if (ip is null)
            return BadRequest(vpn ? VpnResult(null, null, null, request, "ip_missing") : legacyCountry ? CountryResult(null, null, null, expected, clientCountry, "no_ip") : new ApiErrorResponse(new ApiError("IP_NOT_FOUND", "Client IP could not be determined.")));
        try
        {
            var scenario = JsonValues.Text(request?["scenario"]);
            // The legacy VPN route does not forward the mock scenario.
            var check = await service.CheckAsync(ip, legacyCountry ? expected ?? clientCountry : null, !vpn && scenario is "clean" or "risky" ? scenario : null, cancellationToken);
            var network = Network(check, Offset(request), ip);
            if (vpn) return Ok(VpnResult(ip, check, network, request, "vpnapi.io+ip_check.py"));
            if (legacyCountry) return Ok(CountryResult(ip, check, network, expected, clientCountry, null));
            if (route.EndsWith("/location", StringComparison.Ordinal))
            {
                var countries = (request?["allowedCountries"] as JsonArray)?.Select(Country).OfType<string>().Distinct();
                return Ok(Location(check, countries));
            }
            return Ok(network);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            if (vpn) return StatusCode(500, VpnResult(ip, null, null, request, "ip_check_failed"));
            if (legacyCountry) return StatusCode(500, CountryResult(ip, null, null, expected, clientCountry, "ip_check_failed"));
            return StatusCode(502, new ApiErrorResponse(new ApiError("IP_CHECK_FAILED", "Failed to run IP verification pipeline.", error.Message)));
        }
    }

    private string? ClientIp()
    {
        var forwarded = Request.Headers["x-forwarded-for"].ToString();
        var ip = forwarded.Length > 0 ? forwarded.Split(',')[0].Trim() : HttpContext.Connection.RemoteIpAddress?.ToString();
        if (!environment.IsProduction() && ip is "::1" or "127.0.0.1") return "8.8.8.8";
        return string.IsNullOrEmpty(ip) ? null : ip;
    }

    private static JsonObject VpnResult(string? ip, JsonObject? check, JsonObject? network, JsonObject? body, string source)
    {
        var location = Field(check?["ip_info"], "location");
        var flags = network?["flags"];
        return new JsonObject
        {
            ["ok"] = network?["ok"]?.DeepClone() ?? JsonValue.Create(false), ["score"] = network?["score"]?.DeepClone() ?? JsonValue.Create(0),
            ["details"] = new JsonObject
            {
                ["ip"] = Field(network?["ipInfo"], "ip")?.DeepClone() ?? JsonValue.Create(ip),
                ["ipTimeZone"] = JsonValues.Text(Field(location, "time_zone")), ["ipCountry"] = check is null ? null : CountryCode(check),
                ["ipRegion"] = JsonValues.Text(Field(location, "region")) ?? JsonValues.Text(Field(location, "city")),
                ["isVpn"] = IsTrue(Field(flags, "vpn")), ["isProxy"] = IsTrue(Field(flags, "proxy")), ["isTor"] = IsTrue(Field(flags, "tor")), ["isRelay"] = IsTrue(Field(flags, "relay")),
                ["timezoneDriftHours"] = JsonValues.Number(Field(network?["ipInfo"], "driftMin")) / 60,
                ["clientTimeZone"] = JsonValues.Text(body?["clientTimeZone"]) ?? JsonValues.Text(body?["clientTimezone"]),
                ["clientTimeOffsetMinutes"] = Offset(body), ["source"] = source, ["ipInfo"] = check?["ip_info"]?.DeepClone()
            }
        };
    }

    private static JsonObject CountryResult(string? ip, JsonObject? check, JsonObject? network, string? expected, string? clientCountry, string? failure)
    {
        var country = check is null ? null : CountryCode(check);
        bool? matchesExpected = expected is not null && country is not null ? expected == country : null;
        bool? matchesClient = clientCountry is not null && country is not null ? clientCountry == country : null;
        var reason = "no_expected_country";
        var score = .7;
        if (expected is not null)
        {
            if (matchesExpected == true) { score = 1; reason = "match_expected"; }
            else if (matchesExpected == false) { score = .2; reason = "expected_country_mismatch"; }
        }
        else if (matchesClient is not null) { score = matchesClient.Value ? 1 : .2; reason = matchesClient.Value ? "match_client_country" : "client_country_mismatch"; }
        var security = new JsonObject();
        var risky = false;
        foreach (var (flag, penalty) in new[] { ("vpn", .4), ("proxy", .3), ("tor", .5), ("relay", .2) })
        {
            var present = IsTrue(Field(network?["flags"], flag));
            security[flag] = failure is null ? JsonValue.Create(present) : null;
            if (present) { score -= penalty; risky = true; }
        }
        score = failure is null ? Math.Clamp(score, 0, 1) : 0;
        if (risky && reason is "match_expected" or "match_client_country") reason = "country_match_but_ip_security_risky";
        else if (risky && reason == "no_expected_country") reason = "ip_security_risky";
        return new JsonObject
        {
            ["ok"] = score >= .5, ["score"] = score, ["ipCountryCode"] = country, ["expectedCountryCode"] = expected, ["clientCountryCode"] = clientCountry,
            ["details"] = new JsonObject
            {
                ["ip"] = ip, ["ipCountryCode"] = country, ["expectedCountryCode"] = expected, ["clientCountryCode"] = clientCountry,
                ["matchesExpectedCountry"] = matchesExpected, ["matchesClientCountry"] = matchesClient, ["reason"] = failure ?? reason,
                ["ipInfo"] = check?["ip_info"]?.DeepClone(), ["security"] = security
            }
        };
    }
}
