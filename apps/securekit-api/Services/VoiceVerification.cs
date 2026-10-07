using System.Text.Json.Nodes;
using static SecureKit.Api.Services.JsonValues;

namespace SecureKit.Api.Services;

public sealed class VoiceVerification(VoiceOptions options, IProfileStorage storage, ChallengeStore challenges, IVoicePython python, TimeProvider clock)
{
    // Serialize profile updates so simultaneous enrollment samples cannot overwrite one another.
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<JsonObject> ExecuteAsync(bool enroll, JsonObject fields, IFormFile? audio, CancellationToken token)
    {
        double? OptionalNumber(string key) => Number(fields[key]);
        double Threshold(string key, double fallback) => Math.Clamp(OptionalNumber(key) ?? fallback, 0, 1);
        var userId = Text(fields["userId"])?.Trim();
        if (string.IsNullOrEmpty(userId)) throw new VoiceFailure("INVALID_REQUEST", "userId is required.");
        var challengeId = Text(fields["challengeId"])?.Trim();
        if (string.IsNullOrEmpty(challengeId)) throw new VoiceFailure("INVALID_REQUEST", "challengeId is required.");
        if (audio is null) throw new VoiceFailure("AUDIO_REQUIRED", "audioSample is required.");
        if (audio.Length == 0) throw new VoiceFailure("INVALID_REQUEST", "audioSample is empty.");
        await gate.WaitAsync(token);
        try
        {
            if (enroll && await storage.GetLatestConsentAsync(userId) is null)
                throw new VoiceFailure("CONSENT_REQUIRED", "Consent is required before voice enrollment.", 403);
            var existing = await storage.GetProfilesAsync(userId);
            var profile = existing?["voice"]?.DeepClone() as JsonObject;
            if (!enroll && profile is null && existing?["voiceEmbedding"] is JsonArray legacy)
                profile = new JsonObject { ["embedding"] = legacy.DeepClone(), ["sampleCount"] = 1, ["embeddingDim"] = legacy.Count,
                    ["enrolledAt"] = Text(existing["updatedAt"]) ?? Iso(clock.GetUtcNow()), ["updatedAt"] = Text(existing["updatedAt"]) ?? Iso(clock.GetUtcNow()), ["model"] = "legacy" };
            if (!enroll && profile is null) throw new VoiceFailure("PROFILE_NOT_FOUND", "No enrolled voice profile found for user.", 404);
            var (challenge, error) = challenges.Consume(challengeId);
            if (error is not null) throw error switch
            {
                "CHALLENGE_EXPIRED" => new VoiceFailure(error, "Challenge has expired.", 410),
                "CHALLENGE_ALREADY_USED" => new VoiceFailure(error, "Challenge has already been consumed.", 409),
                _ => new VoiceFailure(error, "Challenge was not found.", 404)
            };
            var sessionId = Text(fields["sessionId"])?.Trim();
            if (challenge!.SessionId is { } assigned && !string.IsNullOrEmpty(sessionId) && assigned != sessionId)
                throw new VoiceFailure("CHALLENGE_SESSION_MISMATCH", "sessionId must match the session assigned to this challenge.");
            var transcriptThreshold = Threshold("transcriptThreshold", options.TranscriptThreshold);
            var analysis = await AnalyzeAsync(audio, challenge.Text, transcriptThreshold, token);
            if (!analysis["ok"]!.GetValue<bool>()) throw Text(analysis["reason"]) switch
            {
                "audio_too_short" => new VoiceFailure("AUDIO_TOO_SHORT", "Voice sample is too short."),
                "gpu_required" => new VoiceFailure("GPU_REQUIRED", "GPU is required for voice verification but CUDA is unavailable.", 503),
                "ffmpeg_missing" => new VoiceFailure("PYTHON_DEPENDENCY_MISSING", "ffmpeg is required for Whisper audio decoding. Install ffmpeg or keep imageio-ffmpeg in the voice Python environment.", 503, analysis["runtime"]?.DeepClone()),
                _ => new VoiceFailure("PYTHON_PROCESS_ERROR", "Voice verification process failed.", 502, Text(analysis["reason"]))
            };
            var transcript = (JsonObject)analysis["transcript"]!;
            var matchedText = transcript["matched"]!.GetValue<bool>();
            if (enroll && !matchedText) throw new VoiceFailure("TRANSCRIPT_MISMATCH", "Spoken text does not match the challenge.", 422, transcript.DeepClone());
            double[] Embedding(JsonNode? node) => node is JsonArray array && array.Count > 0 && array.All(v => Number(v) is not null)
                ? array.Select(v => Number(v)!.Value).ToArray()
                : throw new VoiceFailure("PYTHON_OUTPUT_INVALID", "Voice worker did not return a valid embedding.", 502);
            JsonArray Array(double[] values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
            async Task Save(JsonObject voice)
            {
                var result = new JsonObject { ["userId"] = userId };
                foreach (var key in new[] { "keystroke", "faceReferenceImagePath", "faceReferenceEnrolledAt", "faceEmbedding", "cardReferenceImagePath", "cardReferenceEnrolledAt" })
                    result[key] = existing?[key]?.DeepClone();
                result["voice"] = voice.DeepClone(); result["voiceEmbedding"] = voice["embedding"]?.DeepClone(); result["updatedAt"] = Iso(clock.GetUtcNow());
                await storage.SaveProfilesAsync(userId, result);
            }
            var response = new JsonObject { ["ok"] = true, ["userId"] = userId, ["transcript"] = transcript.DeepClone(), ["runtime"] = analysis["runtime"]!.DeepClone() };
            if (enroll)
            {
                var next = Embedding(analysis["embedding"]);
                var currentNode = profile?["embedding"] ?? existing?["voiceEmbedding"];
                var current = currentNode is JsonArray ? Embedding(currentNode) : null;
                var requested = OptionalNumber("minEnrollmentSamples") ?? options.MinEnrollmentSamples;
                var required = requested > 0 ? Math.Max(1, Math.Floor(requested + .5)) : 3;
                var count = 1d;
                if (current is not null && current.Length == next.Length)
                {
                    var weight = Math.Min(Math.Max(Number(profile?["sampleCount"]) ?? 1, 1), required - 1);
                    count = Math.Min(weight + 1, required);
                    next = current.Select((v, i) => v * (1 - 1 / count) + next[i] / count).ToArray();
                }
                var now = Iso(clock.GetUtcNow());
                profile = new JsonObject { ["embedding"] = Array(next), ["sampleCount"] = count, ["embeddingDim"] = next.Length,
                    ["enrolledAt"] = Text(profile?["enrolledAt"]) ?? now, ["updatedAt"] = now, ["model"] = Text(analysis["runtime"]?["speakerModel"]) ?? VoiceOptions.SpeakerModelDefault };
                await Save(profile);
                response["profile"] = profile; response["enrollmentProgress"] = new JsonObject { ["sampleCount"] = count, ["requiredSamples"] = required, ["complete"] = count >= required };
                response["reasons"] = Strings([count >= required ? "VOICE_ENROLLMENT_COMPLETE" : "VOICE_ENROLLMENT_IN_PROGRESS"]);
                return response;
            }
            var thresholds = new JsonObject { ["matchThreshold"] = Threshold("matchThreshold", options.MatchThreshold), ["stepUpThreshold"] = Threshold("stepUpThreshold", .5),
                ["denyThreshold"] = Threshold("denyThreshold", .35), ["transcriptThreshold"] = transcriptThreshold };
            var score = 0d; var decision = "deny"; var reason = "TRANSCRIPT_MISMATCH"; var updated = false;
            if (matchedText)
            {
                var next = Embedding(analysis["embedding"]); var current = Embedding(profile!["embedding"]);
                score = Cosine(current, next);
                decision = score >= Number(thresholds["matchThreshold"]) ? "allow" : score >= Number(thresholds["stepUpThreshold"]) ? "step_up" : "deny";
                reason = decision switch { "allow" => "VOICE_MATCH", "step_up" => "VOICE_STEP_UP", _ => "LOW_SIMILARITY" };
                if (decision == "allow" && fields["updateProfileOnAllow"]?.GetValue<bool>() != false)
                {
                    var alpha = Threshold("profileUpdateAlpha", .08);
                    profile["embedding"] = Array(current.Select((v, i) => v * (1 - alpha) + (i < next.Length ? next[i] : v) * alpha).ToArray());
                    profile["embeddingDim"] = current.Length; profile["sampleCount"] = Math.Max(Number(profile["sampleCount"]) ?? 1, options.MinEnrollmentSamples);
                    profile["updatedAt"] = Iso(clock.GetUtcNow()); await Save(profile); updated = true;
                }
            }
            response["matched"] = decision == "allow"; response["similarityScore"] = score; response["decision"] = decision;
            response["reasons"] = Strings([reason]); response["profile"] = profile; response["profileUpdated"] = updated;
            response["signalsUsed"] = new JsonObject { ["voice"] = new JsonObject { ["similarityScore"] = score, ["decision"] = decision, ["reasons"] = Strings([reason]),
                ["transcript"] = transcript.DeepClone(), ["runtime"] = analysis["runtime"]!.DeepClone(), ["thresholds"] = thresholds } };
            return response;
        }
        finally { gate.Release(); }
    }

    private async Task<JsonObject> AnalyzeAsync(IFormFile audio, string text, double threshold, CancellationToken token)
    {
        var directory = Path.Combine(options.TempRoot, "securekit-voice-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "sample" + VoiceOptions.Extension(audio.ContentType));
            await using (var output = new FileStream(path, FileMode.CreateNew)) await audio.CopyToAsync(output, token);
            return await python.RunAsync(new JsonObject { ["audioPath"] = path, ["expectedText"] = text, ["transcriptThreshold"] = threshold }, token);
        }
        finally { Directory.Delete(directory, true); }
    }

    public static double Cosine(double[] reference, double[] probe)
    {
        var dot = 0d; var a = 0d; var b = 0d;
        for (var i = 0; i < Math.Min(reference.Length, probe.Length); i++) { dot += reference[i] * probe[i]; a += reference[i] * reference[i]; b += probe[i] * probe[i]; }
        return a == 0 || b == 0 ? 0 : Math.Clamp((dot / (Math.Sqrt(a) * Math.Sqrt(b)) + 1) / 2, 0, 1);
    }
}
