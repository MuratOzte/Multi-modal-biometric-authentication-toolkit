import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  CARD_IMAGE_MIME_TYPES,
  DEFAULT_CARD_UPLOAD_MAX_BYTES,
  CardServiceError,
  type CardPythonRunner,
  type CardUploadFile,
} from "../card/types";
import { CardVerificationService } from "../card/service";
import type { RunCardPythonOptions } from "../card/pythonBridge";
import type { StorageAdapter } from "../storage/adapter";

export interface CreateCardVerificationRouterArgs {
  storage?: StorageAdapter;
  nowFnIso?: () => string;
  referenceDir?: string;
  userReferenceDir?: string;
  maxUploadBytes?: number;
  defaultThreshold?: number;
  pythonRunner?: CardPythonRunner;
  pythonOptions?: RunCardPythonOptions;
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const error =
    details === undefined ? { code, message } : { code, message, details };
  res.status(status).json({ error });
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
    throw new CardServiceError("INVALID_REQUEST", "threshold must be a finite number.", 400);
  }

  return parsed;
}

function parseOptionalReferenceId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  if (typeof value !== "string") {
    throw new CardServiceError("INVALID_REQUEST", "referenceId must be a string.", 400);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalUserId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  if (typeof value !== "string") {
    throw new CardServiceError("INVALID_REQUEST", "userId must be a string.", 400);
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toUploadFile(file: Express.Multer.File | undefined): CardUploadFile | undefined {
  if (!file) return undefined;
  return {
    buffer: file.buffer,
    mimeType: file.mimetype,
    originalName: file.originalname,
    size: file.size,
  };
}

function mapRouteError(res: Response, error: unknown, maxUploadBytes: number): void {
  if (error instanceof CardServiceError) {
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

  sendError(res, 500, "INTERNAL_ERROR", "Card verification request failed.");
}

export function createCardVerificationRouter(args: CreateCardVerificationRouterArgs = {}) {
  const router = express.Router();
  const maxUploadBytes = args.maxUploadBytes ?? DEFAULT_CARD_UPLOAD_MAX_BYTES;
  const allowedMimeTypes = new Set<string>(CARD_IMAGE_MIME_TYPES);
  const service = new CardVerificationService({
    storage: args.storage,
    nowFnIso: args.nowFnIso,
    referenceDir: args.referenceDir,
    userReferenceDir: args.userReferenceDir,
    maxUploadBytes,
    defaultThreshold: args.defaultThreshold,
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
          new CardServiceError(
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
    "/enroll/card/reference",
    upload.single("referenceImage"),
    async (req: Request, res: Response) => {
      try {
        const referenceImage = toUploadFile(req.file);
        const userId = parseOptionalUserId(req.body?.userId) ?? "";

        if (!referenceImage) {
          throw new CardServiceError("INVALID_REQUEST", "referenceImage is required.", 400);
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

  router.get("/card/references", async (_req: Request, res: Response) => {
    try {
      const response = await service.listReferences();
      res.status(200).json(response);
    } catch (error) {
      mapRouteError(res, error, maxUploadBytes);
    }
  });

  router.post(
    "/verify/card",
    upload.single("probeImage"),
    async (req: Request, res: Response) => {
      try {
        const probeImage = toUploadFile(req.file);
        const threshold = parseOptionalThreshold(req.body?.threshold);
        const referenceId = parseOptionalReferenceId(req.body?.referenceId);
        const userId = parseOptionalUserId(req.body?.userId);

        if (!probeImage) {
          throw new CardServiceError("PROBE_REQUIRED", "probeImage is required.", 400);
        }

        const response = await service.verify({
          probeImage,
          threshold,
          referenceId,
          userId,
        });

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
