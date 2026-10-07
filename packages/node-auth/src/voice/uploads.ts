import {
  DEFAULT_VOICE_TRANSCRIPT_THRESHOLD,
  clamp01,
} from "./config";
import { VOICE_ALLOWED_MIME_TYPES } from "./config";
import {
  DEFAULT_VOICE_UPLOAD_MAX_BYTES,
  VoiceServiceError,
  type VoiceUploadFile,
} from "./types";

export function normalizeRequiredUserId(userId: string): string {
  const normalized = typeof userId === "string" ? userId.trim() : "";
  if (!normalized) {
    throw new VoiceServiceError("INVALID_REQUEST", "userId is required.", 400);
  }

  return normalized;
}

export function normalizeRequiredChallengeId(challengeId: string): string {
  const normalized = typeof challengeId === "string" ? challengeId.trim() : "";
  if (!normalized) {
    throw new VoiceServiceError("INVALID_REQUEST", "challengeId is required.", 400);
  }

  return normalized;
}

export function resolveMaxUploadBytes(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  return DEFAULT_VOICE_UPLOAD_MAX_BYTES;
}

export function resolveTranscriptThreshold(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_VOICE_TRANSCRIPT_THRESHOLD;
  }

  return clamp01(value);
}

export function assertValidAudio(
  file: VoiceUploadFile | undefined,
  fieldName: string,
  maxUploadBytes: number
): asserts file is VoiceUploadFile {
  if (!file) {
    throw new VoiceServiceError("AUDIO_REQUIRED", `${fieldName} is required.`, 400);
  }

  if (!VOICE_ALLOWED_MIME_TYPES.has(file.mimeType)) {
    throw new VoiceServiceError(
      "INVALID_AUDIO_TYPE",
      `${fieldName} must be one of: ${Array.from(VOICE_ALLOWED_MIME_TYPES).join(", ")}.`,
      400
    );
  }

  if (file.size <= 0 || file.buffer.length === 0) {
    throw new VoiceServiceError("INVALID_REQUEST", `${fieldName} is empty.`, 400);
  }

  if (file.size > maxUploadBytes || file.buffer.length > maxUploadBytes) {
    throw new VoiceServiceError(
      "AUDIO_TOO_LARGE",
      `${fieldName} exceeds maximum size (${maxUploadBytes} bytes).`,
      413
    );
  }
}
