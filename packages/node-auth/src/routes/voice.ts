import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { VerifyError } from "@securekit/core";
import type { ChallengeStore } from "../challenge/store";
import type { RunVoicePythonOptions } from "../voice/pythonBridge";
import { VoiceVerificationService } from "../voice/service";
import {
  DEFAULT_VOICE_UPLOAD_MAX_BYTES,
  VOICE_AUDIO_MIME_TYPES,
  VoiceServiceError,
  type VoicePythonRunner,
  type VoiceUploadFile,
} from "../voice/types";
import type { StorageAdapter } from "../storage/adapter";

export interface CreateVoiceVerificationRouterArgs {
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

function makeError(error: VerifyError): { error: VerifyError } {
  return { error };
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const payload: VerifyError = details === undefined ? { code, message } : { code, message, details };
  res.status(status).json(makeError(payload));
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new VoiceServiceError("INVALID_REQUEST", `${fieldName} must be a finite number.`, 400);
  }

  return parsed;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  throw new VoiceServiceError("INVALID_REQUEST", "Boolean fields must be true or false.", 400);
}

function toUploadFile(file: Express.Multer.File | undefined): VoiceUploadFile | undefined {
  if (!file) return undefined;
  return {
    buffer: file.buffer,
    mimeType: file.mimetype,
    originalName: file.originalname,
    size: file.size,
  };
}

function mapRouteError(res: Response, error: unknown, maxUploadBytes: number): void {
  if (error instanceof VoiceServiceError) {
    sendError(res, error.status, error.code, error.message, error.details);
    return;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      sendError(
        res,
        413,
        "AUDIO_TOO_LARGE",
        `Uploaded audio exceeds maximum size (${maxUploadBytes} bytes).`
      );
      return;
    }

    sendError(res, 400, "INVALID_REQUEST", error.message);
    return;
  }

  sendError(res, 500, "INTERNAL_ERROR", "Voice verification request failed.");
}

export function createVoiceVerificationRouter(args: CreateVoiceVerificationRouterArgs) {
  const router = express.Router();
  const maxUploadBytes = args.maxUploadBytes ?? DEFAULT_VOICE_UPLOAD_MAX_BYTES;
  const allowedMimeTypes = new Set<string>(VOICE_AUDIO_MIME_TYPES);
  const service = new VoiceVerificationService({
    storage: args.storage,
    challengeStore: args.challengeStore,
    nowFn: args.nowFn,
    nowFnIso: args.nowFnIso,
    maxUploadBytes,
    defaultMatchThreshold: args.defaultMatchThreshold,
    defaultTranscriptThreshold: args.defaultTranscriptThreshold,
    minEnrollmentSamples: args.minEnrollmentSamples,
    pythonRunner: args.pythonRunner,
    pythonOptions: args.pythonOptions,
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxUploadBytes,
      files: 1,
    },
    fileFilter: (_req, file, callback) => {
      if (!allowedMimeTypes.has(file.mimetype)) {
        callback(
          new VoiceServiceError(
            "INVALID_AUDIO_TYPE",
            `Unsupported audio type (${file.mimetype}).`,
            400
          )
        );
        return;
      }
      callback(null, true);
    },
  });

  router.post("/enroll/voice", upload.single("audioSample"), async (req: Request, res: Response) => {
    try {
      const userId = readOptionalString(req.body?.userId) ?? "";
      const challengeId = readOptionalString(req.body?.challengeId) ?? "";
      const sessionId = readOptionalString(req.body?.sessionId);
      const audioSample = toUploadFile(req.file);
      const transcriptThreshold = parseOptionalNumber(
        req.body?.transcriptThreshold,
        "transcriptThreshold"
      );
      const minEnrollmentSamples = parseOptionalNumber(
        req.body?.minEnrollmentSamples,
        "minEnrollmentSamples"
      );

      const response = await service.enroll({
        userId,
        challengeId,
        sessionId,
        audioSample: audioSample as VoiceUploadFile,
        policy: {
          transcriptThreshold,
          minEnrollmentSamples,
        },
      });

      res.status(200).json(response);
    } catch (error) {
      mapRouteError(res, error, maxUploadBytes);
    }
  });

  router.post("/verify/voice", upload.single("audioSample"), async (req: Request, res: Response) => {
    try {
      const userId = readOptionalString(req.body?.userId) ?? "";
      const challengeId = readOptionalString(req.body?.challengeId) ?? "";
      const sessionId = readOptionalString(req.body?.sessionId);
      const audioSample = toUploadFile(req.file);
      const matchThreshold = parseOptionalNumber(req.body?.matchThreshold, "matchThreshold");
      const stepUpThreshold = parseOptionalNumber(req.body?.stepUpThreshold, "stepUpThreshold");
      const denyThreshold = parseOptionalNumber(req.body?.denyThreshold, "denyThreshold");
      const transcriptThreshold = parseOptionalNumber(
        req.body?.transcriptThreshold,
        "transcriptThreshold"
      );
      const profileUpdateAlpha = parseOptionalNumber(
        req.body?.profileUpdateAlpha,
        "profileUpdateAlpha"
      );
      const updateProfileOnAllow = parseOptionalBoolean(req.body?.updateProfileOnAllow);

      const response = await service.verify({
        userId,
        challengeId,
        sessionId,
        audioSample: audioSample as VoiceUploadFile,
        policy: {
          matchThreshold,
          stepUpThreshold,
          denyThreshold,
          transcriptThreshold,
          profileUpdateAlpha,
          updateProfileOnAllow,
        },
      });

      res.status(200).json(response);
    } catch (error) {
      mapRouteError(res, error, maxUploadBytes);
    }
  });

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    mapRouteError(res, error, maxUploadBytes);
  });

  return router;
}
