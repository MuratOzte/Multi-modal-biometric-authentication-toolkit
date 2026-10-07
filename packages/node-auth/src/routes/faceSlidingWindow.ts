import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  runFaceSlidingWindow,
  SlidingWindowBridgeError,
  type RunSlidingWindowOptions,
  type SlidingWindowResult,
} from "../face/slidingWindowBridge";
import {
  DEFAULT_FACE_UPLOAD_MAX_BYTES,
  FACE_IMAGE_MIME_TYPES,
  FaceServiceError,
  type FaceUploadFile,
} from "../face/types";

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export interface CreateFaceSlidingWindowRouterArgs {
  referencesRoot: string;
  maxUploadBytes?: number;
  defaultThreshold?: number;
  maxWindow?: number;
  pythonOptions?: RunSlidingWindowOptions;
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const error = details === undefined ? { code, message } : { code, message, details };
  res.status(status).json({ error });
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
    throw new FaceServiceError("INVALID_REQUEST", `${fieldName} must be a finite number.`, 400);
  }
  return parsed;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  throw new FaceServiceError("INVALID_REQUEST", "updateOnSuccess must be a boolean.", 400);
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

function mapBridgeError(error: SlidingWindowBridgeError): {
  status: number;
  code: string;
  message: string;
} {
  switch (error.code) {
    case "PYTHON_SPAWN_FAILED":
      return { status: 503, code: "PYTHON_RUNTIME_UNAVAILABLE", message: error.message };
    case "PYTHON_TIMEOUT":
      return { status: 504, code: "PYTHON_TIMEOUT", message: error.message };
    case "PYTHON_JSON_PARSE_ERROR":
    case "PYTHON_OUTPUT_INVALID":
      return { status: 502, code: "PYTHON_OUTPUT_INVALID", message: error.message };
    default:
      return { status: 502, code: "PYTHON_PROCESS_ERROR", message: error.message };
  }
}

function mapRouteError(res: Response, error: unknown, maxUploadBytes: number): void {
  if (error instanceof FaceServiceError) {
    sendError(res, error.status, error.code, error.message, error.details);
    return;
  }
  if (error instanceof SlidingWindowBridgeError) {
    const mapped = mapBridgeError(error);
    sendError(res, mapped.status, mapped.code, mapped.message, error.details);
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
  sendError(res, 500, "INTERNAL_ERROR", "Face sliding window verification failed.");
}

async function writeProbeToTemp(file: FaceUploadFile): Promise<{ tempDir: string; filePath: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "securekit-face-sw-"));
  const ext = MIME_TO_EXTENSION[file.mimeType] ?? ".img";
  const filePath = path.join(tempDir, `probe-${randomUUID()}${ext}`);
  await fs.writeFile(filePath, file.buffer, { flag: "wx" });
  return { tempDir, filePath };
}

export function createFaceSlidingWindowRouter(args: CreateFaceSlidingWindowRouterArgs) {
  const router = express.Router();
  const referencesRoot = path.resolve(args.referencesRoot);
  const maxUploadBytes = args.maxUploadBytes ?? DEFAULT_FACE_UPLOAD_MAX_BYTES;
  const defaultThreshold = args.defaultThreshold;
  const maxWindow = args.maxWindow ?? 3;
  const allowedMimeTypes = new Set<string>(FACE_IMAGE_MIME_TYPES);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes, files: 1 },
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
    "/verify/face-sliding",
    upload.single("probeImage"),
    async (req: Request, res: Response) => {
      try {
        const userId = readOptionalString(req.body?.userId);
        const probeImage = toUploadFile(req.file);
        const threshold = parseOptionalNumber(req.body?.threshold, "threshold") ?? defaultThreshold;
        const requestedMaxWindow = parseOptionalNumber(req.body?.maxWindow, "maxWindow") ?? maxWindow;
        const updateOnSuccess = parseOptionalBoolean(req.body?.updateOnSuccess) ?? true;

        if (!userId) {
          throw new FaceServiceError("INVALID_REQUEST", "userId is required.", 400);
        }
        if (!probeImage) {
          throw new FaceServiceError("PROBE_REQUIRED", "probeImage is required.", 400);
        }

        const { tempDir, filePath } = await writeProbeToTemp(probeImage);

        try {
          const result: SlidingWindowResult = await runFaceSlidingWindow(
            {
              probeImagePath: filePath,
              userId,
              referencesRoot,
              threshold,
              maxWindow: requestedMaxWindow,
              updateOnSuccess,
            },
            args.pythonOptions
          );

          res.status(200).json(result);
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true });
        }
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
