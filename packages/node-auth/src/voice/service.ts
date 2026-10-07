import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  UserProfiles,
  VoiceDecision,
  VoiceEnrollmentProfile,
  VoicePolicy,
  VoiceRuntimeInfo,
  VoiceSignal,
  VoiceTranscriptResult,
} from "@securekit/core";
import type { ChallengeStore } from "../challenge/store";
import type { ChallengeRecord } from "../challenge/types";
import type { StorageAdapter } from "../storage/adapter";
import {
  DEFAULT_VOICE_DENY_THRESHOLD,
  DEFAULT_VOICE_MATCH_THRESHOLD,
  DEFAULT_VOICE_MIN_ENROLLMENT_SAMPLES,
  DEFAULT_VOICE_STEP_UP_THRESHOLD,
  DEFAULT_VOICE_TRANSCRIPT_THRESHOLD,
  averageEmbeddings,
  clamp01,
  cosineSimilarity01,
  mimeToExtension,
} from "./config";
import {
  VoicePythonBridgeError,
  runVoicePython,
  type RunVoicePythonOptions,
  type VoicePythonResult,
} from "./pythonBridge";
import {
  assertValidAudio,
  normalizeRequiredChallengeId,
  normalizeRequiredUserId,
  resolveMaxUploadBytes,
} from "./uploads";
import {
  VoiceServiceError,
  type VoiceEnrollmentInput,
  type VoiceEnrollmentServiceResult,
  type VoicePythonRunner,
  type VoiceUploadFile,
  type VoiceVerificationServiceResult,
  type VoiceVerifyInput,
} from "./types";

type VoiceThresholds = {
  matchThreshold: number;
  stepUpThreshold: number;
  denyThreshold: number;
  transcriptThreshold: number;
};

export interface VoiceVerificationServiceOptions {
  storage: StorageAdapter;
  challengeStore: ChallengeStore;
  nowFn?: () => number;
  nowFnIso?: () => string;
  maxUploadBytes?: number;
  defaultMatchThreshold?: number;
  defaultTranscriptThreshold?: number;
  minEnrollmentSamples?: number;
  pythonRunner?: VoicePythonRunner;
  pythonOptions?: RunVoicePythonOptions;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function finiteEmbeddingOrThrow(embedding: number[] | null): number[] {
  if (!embedding || embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) {
    throw new VoiceServiceError(
      "PYTHON_OUTPUT_INVALID",
      "Voice worker did not return a valid embedding.",
      502
    );
  }

  return embedding;
}

function resolveMinEnrollmentSamples(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.round(value));
  }

  return DEFAULT_VOICE_MIN_ENROLLMENT_SAMPLES;
}

function resolveThreshold(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return clamp01(value);
}

function resolveVoiceThresholds(
  policy: VoicePolicy | undefined,
  defaultMatchThreshold: number,
  defaultTranscriptThreshold: number
): VoiceThresholds {
  const matchThreshold = resolveThreshold(policy?.matchThreshold, defaultMatchThreshold);
  const stepUpThreshold = resolveThreshold(policy?.stepUpThreshold, DEFAULT_VOICE_STEP_UP_THRESHOLD);
  const denyThreshold = resolveThreshold(policy?.denyThreshold, DEFAULT_VOICE_DENY_THRESHOLD);
  const transcriptThreshold = resolveThreshold(
    policy?.transcriptThreshold,
    defaultTranscriptThreshold
  );

  return {
    matchThreshold,
    stepUpThreshold,
    denyThreshold,
    transcriptThreshold,
  };
}

function decideVoice(score: number, thresholds: VoiceThresholds): VoiceDecision {
  if (score >= thresholds.matchThreshold) return "allow";
  if (score >= thresholds.stepUpThreshold) return "step_up";
  return "deny";
}

function buildProfiles(args: {
  userId: string;
  existingProfiles: UserProfiles | null;
  voice: VoiceEnrollmentProfile | null;
  nowIso: string;
}): UserProfiles {
  return {
    userId: args.userId,
    keystroke: args.existingProfiles?.keystroke ?? null,
    faceReferenceImagePath: args.existingProfiles?.faceReferenceImagePath ?? null,
    faceReferenceEnrolledAt: args.existingProfiles?.faceReferenceEnrolledAt ?? null,
    faceEmbedding: args.existingProfiles?.faceEmbedding ?? null,
    cardReferenceImagePath: args.existingProfiles?.cardReferenceImagePath ?? null,
    cardReferenceEnrolledAt: args.existingProfiles?.cardReferenceEnrolledAt ?? null,
    voice: args.voice,
    voiceEmbedding: args.voice?.embedding ?? null,
    updatedAt: args.nowIso,
  };
}

function buildSignal(args: {
  similarityScore: number;
  decision: VoiceDecision;
  reasons: string[];
  transcript: VoiceTranscriptResult;
  runtime: VoiceRuntimeInfo;
  thresholds: VoiceThresholds;
}): VoiceSignal {
  return {
    similarityScore: args.similarityScore,
    decision: args.decision,
    reasons: uniq(args.reasons),
    transcript: args.transcript,
    runtime: args.runtime,
    thresholds: args.thresholds,
  };
}

function mapPythonBridgeError(error: VoicePythonBridgeError): VoiceServiceError {
  if (error.code === "PYTHON_SPAWN_FAILED") {
    return new VoiceServiceError(
      "PYTHON_RUNTIME_UNAVAILABLE",
      "Python runtime is not available for voice verification.",
      503,
      error.details
    );
  }

  if (error.code === "PYTHON_DEPENDENCY_MISSING") {
    return new VoiceServiceError(
      "PYTHON_DEPENDENCY_MISSING",
      error.message,
      503,
      error.details
    );
  }

  if (error.code === "PYTHON_TIMEOUT") {
    return new VoiceServiceError("PYTHON_TIMEOUT", "Voice verification process timed out.", 504);
  }

  if (error.code === "GPU_REQUIRED") {
    return new VoiceServiceError(
      "GPU_REQUIRED",
      "GPU is required for voice verification but CUDA is unavailable.",
      503
    );
  }

  if (error.code === "PYTHON_JSON_PARSE_ERROR" || error.code === "PYTHON_OUTPUT_INVALID") {
    return new VoiceServiceError(
      "PYTHON_OUTPUT_INVALID",
      "Invalid response received from voice verification process.",
      502
    );
  }

  return new VoiceServiceError("PYTHON_PROCESS_ERROR", "Voice verification process failed.", 502);
}

function mapWorkerFailure(result: VoicePythonResult): VoiceServiceError {
  if (result.reason === "audio_too_short") {
    return new VoiceServiceError("AUDIO_TOO_SHORT", "Voice sample is too short.", 400);
  }

  if (result.reason === "gpu_required") {
    return new VoiceServiceError(
      "GPU_REQUIRED",
      "GPU is required for voice verification but CUDA is unavailable.",
      503
    );
  }

  if (result.reason === "ffmpeg_missing") {
    return new VoiceServiceError(
      "PYTHON_DEPENDENCY_MISSING",
      "ffmpeg is required for Whisper audio decoding. Install ffmpeg or keep imageio-ffmpeg in the voice Python environment.",
      503,
      result.runtime
    );
  }

  return new VoiceServiceError(
    "PYTHON_PROCESS_ERROR",
    "Voice verification process failed.",
    502,
    result.reason
  );
}

export class VoiceVerificationService {
  private readonly storage: StorageAdapter;
  private readonly challengeStore: ChallengeStore;
  private readonly nowFn: () => number;
  private readonly nowFnIso: () => string;
  private readonly maxUploadBytes: number;
  private readonly defaultMatchThreshold: number;
  private readonly defaultTranscriptThreshold: number;
  private readonly minEnrollmentSamples: number;
  private readonly pythonRunner: VoicePythonRunner;
  private readonly pythonOptions?: RunVoicePythonOptions;

  constructor(options: VoiceVerificationServiceOptions) {
    this.storage = options.storage;
    this.challengeStore = options.challengeStore;
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.nowFnIso = options.nowFnIso ?? (() => new Date().toISOString());
    this.maxUploadBytes = resolveMaxUploadBytes(options.maxUploadBytes);
    this.defaultMatchThreshold =
      options.defaultMatchThreshold ?? DEFAULT_VOICE_MATCH_THRESHOLD;
    this.defaultTranscriptThreshold =
      options.defaultTranscriptThreshold ?? DEFAULT_VOICE_TRANSCRIPT_THRESHOLD;
    this.minEnrollmentSamples = resolveMinEnrollmentSamples(options.minEnrollmentSamples);
    this.pythonRunner = options.pythonRunner ?? runVoicePython;
    this.pythonOptions = options.pythonOptions;
  }

  async enroll(input: VoiceEnrollmentInput): Promise<VoiceEnrollmentServiceResult> {
    const userId = normalizeRequiredUserId(input.userId);
    const challengeId = normalizeRequiredChallengeId(input.challengeId);
    assertValidAudio(input.audioSample, "audioSample", this.maxUploadBytes);

    const latestConsent = await this.storage.getLatestConsent(userId);
    if (!latestConsent) {
      throw new VoiceServiceError("CONSENT_REQUIRED", "Consent is required before voice enrollment.", 403);
    }

    const challenge = await this.consumeChallenge(challengeId, input.sessionId);
    const transcriptThreshold = resolveThreshold(
      input.policy?.transcriptThreshold,
      this.defaultTranscriptThreshold
    );
    const analysis = await this.analyzeAudio({
      audioSample: input.audioSample,
      expectedText: challenge.text,
      transcriptThreshold,
    });

    if (!analysis.ok) {
      throw mapWorkerFailure(analysis);
    }

    if (!analysis.transcript.matched) {
      throw new VoiceServiceError(
        "TRANSCRIPT_MISMATCH",
        "Spoken text does not match the challenge.",
        422,
        analysis.transcript
      );
    }

    const embedding = finiteEmbeddingOrThrow(analysis.embedding);
    const nowIso = this.nowFnIso();
    const existingProfiles = await this.storage.getProfiles(userId);
    const existingVoice = existingProfiles?.voice ?? null;
    const requiredSamples = resolveMinEnrollmentSamples(
      input.policy?.minEnrollmentSamples ?? this.minEnrollmentSamples
    );
    const averaged = averageEmbeddings({
      currentEmbedding: existingVoice?.embedding ?? existingProfiles?.voiceEmbedding ?? null,
      currentSampleCount: existingVoice?.sampleCount ?? (existingProfiles?.voiceEmbedding ? 1 : 0),
      nextEmbedding: embedding,
      maxSamples: requiredSamples,
    });
    const profile: VoiceEnrollmentProfile = {
      embedding: averaged.embedding,
      sampleCount: averaged.sampleCount,
      embeddingDim: averaged.embedding.length,
      enrolledAt: existingVoice?.enrolledAt ?? nowIso,
      updatedAt: nowIso,
      model: analysis.runtime.speakerModel ?? "speechbrain/spkrec-ecapa-voxceleb",
    };

    await this.storage.saveProfiles(
      userId,
      buildProfiles({
        userId,
        existingProfiles,
        voice: profile,
        nowIso,
      })
    );

    const complete = profile.sampleCount >= requiredSamples;
    return {
      ok: true,
      userId,
      profile,
      enrollmentProgress: {
        sampleCount: profile.sampleCount,
        requiredSamples,
        complete,
      },
      transcript: analysis.transcript,
      runtime: analysis.runtime,
      reasons: complete ? ["VOICE_ENROLLMENT_COMPLETE"] : ["VOICE_ENROLLMENT_IN_PROGRESS"],
    };
  }

  async verify(input: VoiceVerifyInput): Promise<VoiceVerificationServiceResult> {
    const userId = normalizeRequiredUserId(input.userId);
    const challengeId = normalizeRequiredChallengeId(input.challengeId);
    assertValidAudio(input.audioSample, "audioSample", this.maxUploadBytes);

    const existingProfiles = await this.storage.getProfiles(userId);
    const existingVoice = existingProfiles?.voice ?? null;
    const legacyEmbedding = existingProfiles?.voiceEmbedding ?? null;
    const profile =
      existingVoice ??
      (legacyEmbedding
        ? {
            embedding: legacyEmbedding,
            sampleCount: 1,
            embeddingDim: legacyEmbedding.length,
            enrolledAt: existingProfiles?.updatedAt ?? this.nowFnIso(),
            updatedAt: existingProfiles?.updatedAt ?? this.nowFnIso(),
            model: "legacy",
          }
        : null);

    if (!profile) {
      throw new VoiceServiceError("PROFILE_NOT_FOUND", "No enrolled voice profile found for user.", 404);
    }

    const challenge = await this.consumeChallenge(challengeId, input.sessionId);
    const thresholds = resolveVoiceThresholds(
      input.policy,
      this.defaultMatchThreshold,
      this.defaultTranscriptThreshold
    );
    const analysis = await this.analyzeAudio({
      audioSample: input.audioSample,
      expectedText: challenge.text,
      transcriptThreshold: thresholds.transcriptThreshold,
    });

    if (!analysis.ok) {
      throw mapWorkerFailure(analysis);
    }

    const reasons: string[] = [];
    let similarityScore = 0;
    let decision: VoiceDecision = "deny";
    let profileUpdated = false;
    let resolvedProfile: VoiceEnrollmentProfile | null = profile;

    if (!analysis.transcript.matched) {
      reasons.push("TRANSCRIPT_MISMATCH");
    } else {
      const embedding = finiteEmbeddingOrThrow(analysis.embedding);
      similarityScore = cosineSimilarity01(profile.embedding, embedding);
      decision = decideVoice(similarityScore, thresholds);

      if (decision === "allow") {
        reasons.push("VOICE_MATCH");
      } else if (decision === "step_up") {
        reasons.push("VOICE_STEP_UP");
      } else {
        reasons.push("LOW_SIMILARITY");
      }

      if (decision === "allow" && (input.policy?.updateProfileOnAllow ?? true)) {
        const alpha = resolveThreshold(input.policy?.profileUpdateAlpha, 0.08);
        const nextEmbedding = profile.embedding.map((value, index) => {
          const nextValue = embedding[index] ?? value;
          return value * (1 - alpha) + nextValue * alpha;
        });
        const nowIso = this.nowFnIso();
        resolvedProfile = {
          ...profile,
          embedding: nextEmbedding,
          embeddingDim: nextEmbedding.length,
          sampleCount: Math.max(profile.sampleCount, this.minEnrollmentSamples),
          updatedAt: nowIso,
        };

        await this.storage.saveProfiles(
          userId,
          buildProfiles({
            userId,
            existingProfiles,
            voice: resolvedProfile,
            nowIso,
          })
        );
        profileUpdated = true;
      }
    }

    const signal = buildSignal({
      similarityScore,
      decision,
      reasons,
      transcript: analysis.transcript,
      runtime: analysis.runtime,
      thresholds,
    });

    return {
      ok: true,
      userId,
      matched: decision === "allow",
      similarityScore,
      decision,
      reasons: signal.reasons,
      transcript: analysis.transcript,
      runtime: analysis.runtime,
      profile: resolvedProfile,
      profileUpdated,
      signalsUsed: {
        voice: signal,
      },
    };
  }

  private async consumeChallenge(
    challengeId: string,
    sessionId: string | undefined
  ): Promise<ChallengeRecord> {
    const consumed = await this.challengeStore.consume(challengeId, this.nowFn());

    if (consumed === null) {
      throw new VoiceServiceError("CHALLENGE_NOT_FOUND", "Challenge was not found.", 404);
    }

    if (consumed === "EXPIRED") {
      throw new VoiceServiceError("CHALLENGE_EXPIRED", "Challenge has expired.", 410);
    }

    if (consumed === "USED") {
      throw new VoiceServiceError("CHALLENGE_ALREADY_USED", "Challenge has already been consumed.", 409);
    }

    if (
      typeof consumed.sessionId === "string" &&
      typeof sessionId === "string" &&
      consumed.sessionId !== sessionId
    ) {
      throw new VoiceServiceError(
        "CHALLENGE_SESSION_MISMATCH",
        "sessionId must match the session assigned to this challenge.",
        400
      );
    }

    return consumed;
  }

  private async analyzeAudio(args: {
    audioSample: VoiceUploadFile;
    expectedText: string;
    transcriptThreshold: number;
  }): Promise<VoicePythonResult> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "securekit-voice-"));
    const audioPath = path.join(
      tempDir,
      `voice-${randomUUID()}${mimeToExtension(args.audioSample.mimeType)}`
    );

    try {
      await fs.writeFile(audioPath, args.audioSample.buffer, { flag: "wx" });
      return await this.pythonRunner(
        {
          audioPath,
          expectedText: args.expectedText,
          transcriptThreshold: args.transcriptThreshold,
        },
        this.pythonOptions
      );
    } catch (error) {
      if (error instanceof VoicePythonBridgeError) {
        throw mapPythonBridgeError(error);
      }

      throw error;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}
