import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { VerifyError } from "@securekit/core";
import type { RunFacePythonOptions } from "../face/pythonBridge";
import { FaceVerificationService } from "../face/service";
import {
  DEFAULT_FACE_UPLOAD_MAX_BYTES,
  FACE_IMAGE_MIME_TYPES,
  FaceServiceError,
  type FacePythonRunner,
  type FaceUploadFile,
} from "../face/types";
import type { StorageAdapter } from "../storage/adapter";

export interface CreateFaceVerificationRouterArgs {
  storage: StorageAdapter;
  nowFnIso?: () => string;
  referenceDir?: string;
  allowedReferenceRoots?: string[];
  maxUploadBytes?: number;
  defaultThreshold?: number;
  pythonRunner?: FacePythonRunner;
  pythonOptions?: RunFacePythonOptions;
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

function parseOptionalThreshold(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new FaceServiceError("INVALID_REQUEST", "threshold must be a finite number.", 400);
  }

  return parsed;
}

function toUploadFile(file: Express.Multer.File | undefined): FaceUploadFile | undefined {
  if (!file) return undefined;
  return {
    buffer: file.buffer,
    mimeType: file.mimetype,
    originalName: file.originalname,
    size: file.size,
  };
}

function mapRouteError(res: Response, error: unknown, maxUploadBytes: number): void {
  if (error instanceof FaceServiceError) {
    sendError(res, error.status, error.code, error.message, error.details);
    return;
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      sendError(
        res,
        413,
        "IMAGE_TOO_LARGE",
        `Uploaded image exceeds maximum size (${maxUploadBytes} bytes).`
      );
      return;
    }

    sendError(res, 400, "INVALID_REQUEST", error.message);
    return;
  }

  sendError(res, 500, "INTERNAL_ERROR", "Face verification request failed.");
}

export function createFaceVerificationRouter(args: CreateFaceVerificationRouterArgs) {
  const router = express.Router();
  const maxUploadBytes = args.maxUploadBytes ?? DEFAULT_FACE_UPLOAD_MAX_BYTES;
  const allowedMimeTypes = new Set<string>(FACE_IMAGE_MIME_TYPES);
  const service = new FaceVerificationService({
    storage: args.storage,
    nowFnIso: args.nowFnIso,
    referenceDir: args.referenceDir,
    allowedReferenceRoots: args.allowedReferenceRoots,
    maxUploadBytes,
    defaultThreshold: args.defaultThreshold,
    pythonRunner: args.pythonRunner,
    pythonOptions: args.pythonOptions,
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxUploadBytes,
      files: 2,
    },
    fileFilter: (_req, file, callback) => {
      if (!allowedMimeTypes.has(file.mimetype)) {
        callback(
          new FaceServiceError(
            "INVALID_IMAGE_TYPE",
            `Unsupported image type (${file.mimetype}).`,
            400
          )
        );
        return;
      }
      callback(null, true);
    },
  });

  router.post(
    "/enroll/face/reference",
    upload.single("referenceImage"),
    async (req: Request, res: Response) => {
      try {
        const userId = readOptionalString(req.body?.userId) ?? "";
        const referenceImage = toUploadFile(req.file);
        if (!referenceImage) {
          throw new FaceServiceError("REFERENCE_REQUIRED", "referenceImage is required.", 400);
        }

        const response = await service.enrollReference({
          userId,
          referenceImage,
        });

        res.status(200).json(response);
      } catch (error) {
        mapRouteError(res, error, maxUploadBytes);
      }
    }
  );

  router.post(
    "/verify/face",
    upload.fields([
      { name: "probeImage", maxCount: 1 },
      { name: "referenceImage", maxCount: 1 },
    ]),
    async (req: Request, res: Response) => {
      try {
        const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
        const probeImage = toUploadFile(files.probeImage?.[0]);
        const referenceImage = toUploadFile(files.referenceImage?.[0]);
        const threshold = parseOptionalThreshold(req.body?.threshold);
        const userId = readOptionalString(req.body?.userId);
        const referenceImagePath = readOptionalString(req.body?.referenceImagePath);

        if (!probeImage) {
          throw new FaceServiceError("PROBE_REQUIRED", "probeImage is required.", 400);
        }

        const verified = await service.verify({
          userId,
          referenceImagePath,
          referenceImage,
          probeImage,
          threshold,
        });

        const { referenceImagePath: _resolvedPath, ...response } = verified;
        res.status(200).json(response);
      } catch (error) {
        mapRouteError(res, error, maxUploadBytes);
      }
    }
  );

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    mapRouteError(res, error, maxUploadBytes);
  });

  return router;
}
