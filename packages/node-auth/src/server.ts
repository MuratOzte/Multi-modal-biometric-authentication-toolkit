import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ENROLLMENT_MIN_KEYSTROKES,
  DEFAULT_ENROLLMENT_MIN_ROUNDS,
} from "../../core/src/biometrics/keystrokeProfile";
import { createAuthRouter } from "./routes/auth";
import { createChallengeRouter, resolveChallengeTtlMs } from "./routes/challenge";
import { createCardVerificationRouter } from "./routes/card";
import { createConsentRouter } from "./routes/consent";
import { createFaceVerificationRouter } from "./routes/face";
import { createFaceSlidingWindowRouter } from "./routes/faceSlidingWindow";
import { createFixedTextKeystrokeRouter } from "./routes/keystrokeFixedText";
import { createKeystrokeRouter } from "./routes/keystroke";
import { createLegacyVerificationRouter } from "./routes/legacyVerification";
import { createProfilesRouter } from "./routes/profiles";
import { createSessionRouter } from "./routes/session";
import { createVoiceVerificationRouter } from "./routes/voice";
import { closeCardPythonWorkers } from "./card/pythonBridge";
import { closeFacePythonWorkers } from "./face/pythonBridge";
import { closeVoicePythonWorkers } from "./voice/pythonBridge";
import { InMemoryChallengeStore } from "./challenge/inMemoryStore";
import type { ChallengeStore } from "./challenge/store";
import type { Rng } from "./challenge/generateText";
import type { CardPythonRunner } from "./card/types";
import type { FacePythonRunner } from "./face/types";
import type { VoicePythonRunner } from "./voice/types";
import {
  FileKeystrokeTemplateStore,
  type KeystrokeTemplateStore,
} from "./keystroke/store";
import type { RunIpCheckParams, IpCheckOutput } from "./services/ipCheck";
import { runIpCheck as defaultRunIpCheck } from "./services/ipCheck";
import { InMemorySessionStore } from "./session/inMemoryStore";
import type { SessionStore } from "./session/store";
import { InMemoryAdapter } from "./storage/inMemoryAdapter";
import { FileStorageAdapter } from "./storage/fileAdapter";
import type { StorageAdapter } from "./storage/adapter";
import { FileUserStore } from "./auth/userStore";

const __filename = fileURLToPath(import.meta.url);

type RunIpCheckFn = (ip: string, params?: RunIpCheckParams) => Promise<IpCheckOutput>;

export interface CreateAppDeps {
  runIpCheck?: RunIpCheckFn;
  sessionStore?: SessionStore;
  challengeStore?: ChallengeStore;
  storage?: StorageAdapter;
  fixedTextKeystrokeStore?: KeystrokeTemplateStore;
  challengeRng?: Rng;
  nowFn?: () => number;
  nowFnIso?: () => string;
  challengeTtlSeconds?: number;
  fixedTextKeystrokeServerSalt?: string;
  fixedTextKeystrokePythonTimeoutMs?: number;
  fixedTextKeystrokePythonBin?: string;
  fixedTextKeystrokePythonScriptPath?: string;
  faceReferenceDir?: string;
  faceUploadMaxBytes?: number;
  faceDefaultThreshold?: number;
  facePythonTimeoutMs?: number;
  facePythonBin?: string;
  facePythonScriptPath?: string;
  faceDevice?: "auto" | "cuda" | "cpu";
  faceRequireGpu?: boolean;
  facePythonRunner?: FacePythonRunner;
  voiceUploadMaxBytes?: number;
  voiceDefaultMatchThreshold?: number;
  voiceDefaultTranscriptThreshold?: number;
  voiceMinEnrollmentSamples?: number;
  voicePythonTimeoutMs?: number;
  voicePythonBin?: string;
  voicePythonScriptPath?: string;
  voiceDevice?: "auto" | "cuda" | "cpu";
  voiceRequireGpu?: boolean;
  voiceWhisperModel?: string;
  voiceSpeakerModel?: string;
  voicePythonRunner?: VoicePythonRunner;
  cardReferenceDir?: string;
  cardUserReferenceDir?: string;
  cardUploadMaxBytes?: number;
  cardDefaultThreshold?: number;
  cardPythonTimeoutMs?: number;
  cardPythonBin?: string;
  cardPythonScriptPath?: string;
  cardPythonRunner?: CardPythonRunner;
  usersFilePath?: string;
  userStore?: FileUserStore;
  profileStorePath?: string;
  useInMemoryStorage?: boolean;
}

function resolvePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function resolveUnitIntervalEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

function resolveBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;

  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function resolveVoiceDeviceEnv(fallback: "auto" | "cuda" | "cpu"): "auto" | "cuda" | "cpu" {
  const raw = process.env.VOICE_DEVICE;
  if (raw === "auto" || raw === "cuda" || raw === "cpu") return raw;
  return fallback;
}

function resolveFaceDeviceEnv(fallback: "auto" | "cuda" | "cpu"): "auto" | "cuda" | "cpu" {
  const raw = process.env.FACE_DEVICE;
  if (raw === "auto" || raw === "cuda" || raw === "cpu") return raw;
  return fallback;
}

function resolveStringEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createApp(deps: CreateAppDeps = {}) {
  const app = express();
  const runIpCheck = deps.runIpCheck ?? defaultRunIpCheck;
  const sessionStore = deps.sessionStore ?? new InMemorySessionStore();
  const challengeStore = deps.challengeStore ?? new InMemoryChallengeStore();
  const storage =
    deps.storage ??
    (deps.useInMemoryStorage || process.env.VITEST
      ? new InMemoryAdapter()
      : new FileStorageAdapter({ filePath: deps.profileStorePath }));
  const fixedTextKeystrokeStore =
    deps.fixedTextKeystrokeStore ?? new FileKeystrokeTemplateStore();
  const challengeRng = deps.challengeRng ?? (() => Math.random());
  const nowFn = deps.nowFn ?? (() => Date.now());
  const nowFnIso = deps.nowFnIso ?? (() => new Date().toISOString());
  const challengeTtlMs = resolveChallengeTtlMs(deps.challengeTtlSeconds);
  const enrollmentMinRounds = resolvePositiveIntEnv(
    "KEYSTROKE_ENROLL_MIN_ROUNDS",
    DEFAULT_ENROLLMENT_MIN_ROUNDS
  );
  const enrollmentMinKeystrokes = resolvePositiveIntEnv(
    "KEYSTROKE_ENROLL_MIN_KEYSTROKES",
    DEFAULT_ENROLLMENT_MIN_KEYSTROKES
  );
  const fixedTextKeystrokePythonTimeoutMs =
    deps.fixedTextKeystrokePythonTimeoutMs ??
    resolvePositiveIntEnv("KEYSTROKE_FIXED_PYTHON_TIMEOUT_MS", 2_000);
  const faceUploadMaxBytes =
    deps.faceUploadMaxBytes ?? resolvePositiveIntEnv("FACE_UPLOAD_MAX_BYTES", 5 * 1024 * 1024);
  const facePythonTimeoutMs =
    deps.facePythonTimeoutMs ?? resolvePositiveIntEnv("FACE_PYTHON_TIMEOUT_MS", 30_000);
  const faceDefaultThreshold =
    deps.faceDefaultThreshold ?? resolveUnitIntervalEnv("FACE_MATCH_THRESHOLD", 0.8);
  const voiceUploadMaxBytes =
    deps.voiceUploadMaxBytes ?? resolvePositiveIntEnv("VOICE_UPLOAD_MAX_BYTES", 12 * 1024 * 1024);
  const voicePythonTimeoutMs =
    deps.voicePythonTimeoutMs ?? resolvePositiveIntEnv("VOICE_PYTHON_TIMEOUT_MS", 120_000);
  const voiceDefaultMatchThreshold =
    deps.voiceDefaultMatchThreshold ?? resolveUnitIntervalEnv("VOICE_MATCH_THRESHOLD", 0.85);
  const voiceDefaultTranscriptThreshold =
    deps.voiceDefaultTranscriptThreshold ?? resolveUnitIntervalEnv("VOICE_TEXT_THRESHOLD", 0.78);
  const voiceMinEnrollmentSamples =
    deps.voiceMinEnrollmentSamples ?? resolvePositiveIntEnv("VOICE_MIN_ENROLLMENT_SAMPLES", 3);
  const cardUploadMaxBytes =
    deps.cardUploadMaxBytes ?? resolvePositiveIntEnv("CARD_UPLOAD_MAX_BYTES", 5 * 1024 * 1024);
  const cardPythonTimeoutMs =
    deps.cardPythonTimeoutMs ?? resolvePositiveIntEnv("CARD_PYTHON_TIMEOUT_MS", 300_000);
  const cardDefaultThreshold =
    deps.cardDefaultThreshold ?? resolveUnitIntervalEnv("CARD_MATCH_THRESHOLD", 0.7);

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.use(
    createAuthRouter({
      userStore:
        deps.userStore ??
        new FileUserStore({
          filePath: deps.usersFilePath,
        }),
      nowFnIso,
    })
  );
  app.use(
    createSessionRouter({
      sessionStore,
      storage,
      nowFnIso,
    })
  );
  app.use(
    createChallengeRouter({
      challengeStore,
      rng: challengeRng,
      nowFn,
      ttlMs: challengeTtlMs,
    })
  );
  app.use(
    createFixedTextKeystrokeRouter({
      store: fixedTextKeystrokeStore,
      nowFn,
      serverSalt: deps.fixedTextKeystrokeServerSalt,
      pythonOptions: {
        timeoutMs: fixedTextKeystrokePythonTimeoutMs,
        ...(typeof deps.fixedTextKeystrokePythonBin === "string" &&
        deps.fixedTextKeystrokePythonBin.trim().length > 0
          ? { pythonBin: deps.fixedTextKeystrokePythonBin.trim() }
          : {}),
        ...(typeof deps.fixedTextKeystrokePythonScriptPath === "string" &&
        deps.fixedTextKeystrokePythonScriptPath.trim().length > 0
          ? { scriptPath: deps.fixedTextKeystrokePythonScriptPath.trim() }
          : {}),
      },
    })
  );
  app.use(
    createCardVerificationRouter({
      storage,
      nowFnIso,
      referenceDir: deps.cardReferenceDir,
      userReferenceDir: deps.cardUserReferenceDir,
      maxUploadBytes: cardUploadMaxBytes,
      defaultThreshold: cardDefaultThreshold,
      pythonRunner: deps.cardPythonRunner,
      pythonOptions: {
        timeoutMs: cardPythonTimeoutMs,
        ...(typeof deps.cardPythonBin === "string" && deps.cardPythonBin.trim().length > 0
          ? { pythonBin: deps.cardPythonBin.trim() }
          : resolveStringEnv("CARD_PYTHON_BIN")
            ? { pythonBin: resolveStringEnv("CARD_PYTHON_BIN") }
            : {}),
        ...(typeof deps.cardPythonScriptPath === "string" &&
        deps.cardPythonScriptPath.trim().length > 0
          ? { scriptPath: deps.cardPythonScriptPath.trim() }
          : resolveStringEnv("CARD_PYTHON_SCRIPT_PATH")
            ? { scriptPath: resolveStringEnv("CARD_PYTHON_SCRIPT_PATH") }
            : {}),
      },
    })
  );
  app.use(
    createFaceVerificationRouter({
      storage,
      nowFnIso,
      referenceDir: deps.faceReferenceDir,
      maxUploadBytes: faceUploadMaxBytes,
      defaultThreshold: faceDefaultThreshold,
      pythonRunner: deps.facePythonRunner,
      pythonOptions: {
        timeoutMs: facePythonTimeoutMs,
        ...(typeof deps.facePythonBin === "string" && deps.facePythonBin.trim().length > 0
          ? { pythonBin: deps.facePythonBin.trim() }
          : resolveStringEnv("FACE_PYTHON_BIN")
            ? { pythonBin: resolveStringEnv("FACE_PYTHON_BIN") }
          : {}),
        ...(typeof deps.facePythonScriptPath === "string" &&
        deps.facePythonScriptPath.trim().length > 0
          ? { scriptPath: deps.facePythonScriptPath.trim() }
          : resolveStringEnv("FACE_PYTHON_SCRIPT_PATH")
            ? { scriptPath: resolveStringEnv("FACE_PYTHON_SCRIPT_PATH") }
          : {}),
        device: deps.faceDevice ?? resolveFaceDeviceEnv("auto"),
        requireGpu: deps.faceRequireGpu ?? resolveBooleanEnv("FACE_REQUIRE_GPU", false),
      },
    })
  );
  app.use(
    createFaceSlidingWindowRouter({
      referencesRoot:
        resolveStringEnv("FACE_SLIDING_REFERENCES_ROOT") ??
        path.resolve(deps.faceReferenceDir ?? ".securekit/face-references", "..", "face-sliding-window"),
      maxUploadBytes: faceUploadMaxBytes,
      defaultThreshold: faceDefaultThreshold,
      maxWindow: 3,
      pythonOptions: {
        timeoutMs: facePythonTimeoutMs,
        ...(typeof deps.facePythonBin === "string" && deps.facePythonBin.trim().length > 0
          ? { pythonBin: deps.facePythonBin.trim() }
          : resolveStringEnv("FACE_PYTHON_BIN")
            ? { pythonBin: resolveStringEnv("FACE_PYTHON_BIN") }
          : {}),
        device: deps.faceDevice ?? resolveFaceDeviceEnv("auto"),
      },
    })
  );
  app.use(
    createVoiceVerificationRouter({
      storage,
      challengeStore,
      nowFn,
      nowFnIso,
      maxUploadBytes: voiceUploadMaxBytes,
      defaultMatchThreshold: voiceDefaultMatchThreshold,
      defaultTranscriptThreshold: voiceDefaultTranscriptThreshold,
      minEnrollmentSamples: voiceMinEnrollmentSamples,
      pythonRunner: deps.voicePythonRunner,
      pythonOptions: {
        timeoutMs: voicePythonTimeoutMs,
        ...(typeof deps.voicePythonBin === "string" && deps.voicePythonBin.trim().length > 0
          ? { pythonBin: deps.voicePythonBin.trim() }
          : resolveStringEnv("VOICE_PYTHON_BIN")
            ? { pythonBin: resolveStringEnv("VOICE_PYTHON_BIN") }
            : {}),
        ...(typeof deps.voicePythonScriptPath === "string" &&
        deps.voicePythonScriptPath.trim().length > 0
          ? { scriptPath: deps.voicePythonScriptPath.trim() }
          : resolveStringEnv("VOICE_PYTHON_SCRIPT_PATH")
            ? { scriptPath: resolveStringEnv("VOICE_PYTHON_SCRIPT_PATH") }
            : {}),
        device: deps.voiceDevice ?? resolveVoiceDeviceEnv("auto"),
        requireGpu: deps.voiceRequireGpu ?? resolveBooleanEnv("VOICE_REQUIRE_GPU", false),
        ...(typeof deps.voiceWhisperModel === "string" &&
        deps.voiceWhisperModel.trim().length > 0
          ? { whisperModel: deps.voiceWhisperModel.trim() }
          : resolveStringEnv("VOICE_WHISPER_MODEL")
            ? { whisperModel: resolveStringEnv("VOICE_WHISPER_MODEL") }
            : {}),
        ...(typeof deps.voiceSpeakerModel === "string" &&
        deps.voiceSpeakerModel.trim().length > 0
          ? { speakerModel: deps.voiceSpeakerModel.trim() }
          : resolveStringEnv("VOICE_SPEAKER_MODEL")
            ? { speakerModel: resolveStringEnv("VOICE_SPEAKER_MODEL") }
            : {}),
      },
    })
  );
  app.use(
    createConsentRouter({
      storage,
      nowFnIso,
    })
  );
  app.use(
    createKeystrokeRouter({
      storage,
      challengeStore,
      nowFn,
      nowFnIso,
      enrollmentMinRounds,
      enrollmentMinKeystrokes,
    })
  );
  app.use(
    createProfilesRouter({
      storage,
      nowFnIso,
    })
  );
  app.use(
    createLegacyVerificationRouter({
      runIpCheck,
    })
  );

  return app;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(__filename);
}

if (isDirectRun()) {
  const PORT = Number(process.env.PORT) || 3001;
  const app = createApp();

  const server = app.listen(PORT, () => {
    console.log(`node-auth listening on http://localhost:${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`node-auth received ${signal}; closing python workers...`);
    closeCardPythonWorkers();
    closeFacePythonWorkers();
    closeVoicePythonWorkers();

    server.close(() => {
      process.exit(0);
    });

    setTimeout(() => {
      process.exit(0);
    }, 5_000).unref();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("exit", () => {
    closeCardPythonWorkers();
    closeFacePythonWorkers();
    closeVoicePythonWorkers();
  });
}
