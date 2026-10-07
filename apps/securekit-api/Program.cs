using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using SecureKit.Api.Contracts;
using SecureKit.Api.Infrastructure;
using SecureKit.Api.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<ChallengeStore>();
builder.Services.AddSingleton<IProfileStorage, FileProfileStorage>();
builder.Services.AddSingleton<FileUserStore>();
builder.Services.AddSingleton<SessionStore>();
builder.Services.AddSingleton<SessionRiskEvaluator>();
builder.Services.AddSingleton<SessionKeystrokeVerifier>();
builder.Services.AddSingleton<IIpCheckService, IpCheckService>();
builder.Services.AddSingleton<FixedKeystrokeStore>();
builder.Services.AddSingleton<IKeystrokePython, KeystrokePython>();
builder.Services.AddSingleton<FaceOptions>();
builder.Services.AddSingleton<IFacePython, FacePython>();
builder.Services.AddSingleton<FaceVerification>();
builder.Services.AddSingleton<VoiceOptions>();
builder.Services.AddSingleton<IVoicePython, VoicePython>();
builder.Services.AddSingleton<VoiceVerification>();
builder.Services.AddSingleton<CardOptions>();
builder.Services.AddSingleton<ICardPython, CardPython>();
builder.Services.AddSingleton<CardVerification>();

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.DictionaryKeyPolicy = null;
        options.JsonSerializerOptions.PropertyNameCaseInsensitive = false;
        options.JsonSerializerOptions.NumberHandling = JsonNumberHandling.Strict;
        options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, false));
    });
builder.Services.Configure<ApiBehaviorOptions>(options =>
{
    // Endpoint-specific validation/messages will be ported with each route group.
    options.InvalidModelStateResponseFactory = _ => new BadRequestObjectResult(
        new ApiErrorResponse(new ApiError("VALIDATION_ERROR", "Invalid request body.")));
});
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
{
    var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>();
    if (allowedOrigins is { Length: > 0 })
        policy.WithOrigins(allowedOrigins);
    else
        policy.AllowAnyOrigin(); // Matches the current Express cors() default.
    policy.AllowAnyHeader().AllowAnyMethod();
}));
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseExceptionHandler();
app.UseRouting();
app.UseCors();
app.MapControllers();
app.Run();

// Exposes the entry point to WebApplicationFactory without starting a separate server.
public partial class Program;
