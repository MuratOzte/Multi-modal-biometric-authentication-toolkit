import path from "node:path";
import { fileURLToPath } from "node:url";
import { VOICE_AUDIO_MIME_TYPES } from "./types";

const VOICE_MIME_TO_EXTENSION: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const VOICE_ALLOWED_MIME_TYPES = new Set<string>(VOICE_AUDIO_MIME_TYPES);
export const DEFAULT_VOICE_MATCH_THRESHOLD = 0.85;
export const DEFAULT_VOICE_STEP_UP_THRESHOLD = 0.5;
export const DEFAULT_VOICE_DENY_THRESHOLD = 0.35;
export const DEFAULT_VOICE_TRANSCRIPT_THRESHOLD = 0.78;
export const DEFAULT_VOICE_MIN_ENROLLMENT_SAMPLES = 3;
export const DEFAULT_VOICE_PYTHON_TIMEOUT_MS = 120_000;
export const DEFAULT_VOICE_WHISPER_MODEL = "base";
export const DEFAULT_VOICE_DEVICE = "auto";
export const DEFAULT_VOICE_SPEAKER_MODEL = "speechbrain/spkrec-ecapa-voxceleb";

export function resolveDefaultVoiceScriptPath(): string {
  return path.resolve(__dirname, "../../../../python/voice_verification/voice_worker.py");
}

export function mimeToExtension(mimeType: string): string {
  return VOICE_MIME_TO_EXTENSION[mimeType] ?? ".audio";
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function cosineSimilarity01(referenceEmbedding: number[], probeEmbedding: number[]): number {
  const length = Math.min(referenceEmbedding.length, probeEmbedding.length);
  if (length === 0) return 0;

  let dot = 0;
  let referenceNorm = 0;
  let probeNorm = 0;

  for (let index = 0; index < length; index += 1) {
    const referenceValue = referenceEmbedding[index];
    const probeValue = probeEmbedding[index];
    if (!Number.isFinite(referenceValue) || !Number.isFinite(probeValue)) {
      return 0;
    }

    dot += referenceValue * probeValue;
    referenceNorm += referenceValue * referenceValue;
    probeNorm += probeValue * probeValue;
  }

  if (referenceNorm === 0 || probeNorm === 0) return 0;
  const cosine = dot / (Math.sqrt(referenceNorm) * Math.sqrt(probeNorm));
  return clamp01((cosine + 1) / 2);
}

export function averageEmbeddings(args: {
  currentEmbedding: number[] | null;
  currentSampleCount: number;
  nextEmbedding: number[];
  maxSamples: number;
}): { embedding: number[]; sampleCount: number } {
  if (!args.currentEmbedding || args.currentEmbedding.length !== args.nextEmbedding.length) {
    return {
      embedding: [...args.nextEmbedding],
      sampleCount: 1,
    };
  }

  const currentWeight = Math.min(Math.max(args.currentSampleCount, 1), args.maxSamples - 1);
  const sampleCount = Math.min(currentWeight + 1, args.maxSamples);
  const nextWeight = 1 / sampleCount;
  const previousWeight = 1 - nextWeight;

  return {
    embedding: args.currentEmbedding.map((value, index) => {
      const nextValue = args.nextEmbedding[index] ?? 0;
      return value * previousWeight + nextValue * nextWeight;
    }),
    sampleCount,
  };
}
