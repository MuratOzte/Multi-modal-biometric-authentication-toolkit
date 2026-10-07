import type {
  VoiceEnrollmentResponse,
  VoiceVerificationFailureCode,
  VoiceVerificationResult,
} from "@securekit/core";
import type {
  RunVoicePythonOptions,
  VoicePythonInput,
  VoicePythonResult,
} from "./pythonBridge";

export const VOICE_AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
] as const;

export type VoiceAudioMimeType = (typeof VOICE_AUDIO_MIME_TYPES)[number];

export const DEFAULT_VOICE_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;

export interface VoiceUploadFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  size: number;
}

export interface VoiceEnrollmentInput {
  userId: string;
  challengeId: string;
  sessionId?: string;
  audioSample: VoiceUploadFile;
  policy?: {
    transcriptThreshold?: number;
    minEnrollmentSamples?: number;
  };
}

export interface VoiceVerifyInput {
  userId: string;
  challengeId: string;
  sessionId?: string;
  audioSample: VoiceUploadFile;
  policy?: {
    matchThreshold?: number;
    stepUpThreshold?: number;
    denyThreshold?: number;
    transcriptThreshold?: number;
    updateProfileOnAllow?: boolean;
    profileUpdateAlpha?: number;
  };
}

export type VoiceEnrollmentServiceResult = VoiceEnrollmentResponse;
export type VoiceVerificationServiceResult = VoiceVerificationResult;

export type VoicePythonRunner = (
  input: VoicePythonInput,
  options?: RunVoicePythonOptions
) => Promise<VoicePythonResult>;

export class VoiceServiceError extends Error {
  readonly code: VoiceVerificationFailureCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: VoiceVerificationFailureCode,
    message: string,
    status = 400,
    details?: unknown
  ) {
    super(message);
    this.name = "VoiceServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
