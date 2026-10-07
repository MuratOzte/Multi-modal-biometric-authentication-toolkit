using System.Text.Json.Serialization;

namespace SecureKit.Api.Contracts;

public sealed record ApiError(
    string Code,
    string Message,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] object? Details = null);

public sealed record ApiErrorResponse(ApiError Error);
