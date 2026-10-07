import {
  DEFAULT_FACE_UPLOAD_MAX_BYTES,
  FaceServiceError,
  type FaceUploadFile,
} from "./types";
import { FACE_ALLOWED_MIME_TYPES } from "./config";

export function normalizeRequiredUserId(raw: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new FaceServiceError("INVALID_REQUEST", "userId is required.", 400);
  }
  return raw.trim();
}

export function resolveThreshold(defaultThreshold: number, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultThreshold;
  }
  if (value < 0 || value > 1) {
    throw new FaceServiceError(
      "INVALID_REQUEST",
      "threshold must be a number between 0 and 1.",
      400
    );
  }
  return value;
}

export function resolveMaxUploadBytes(value: number | undefined): number {
  return value ?? DEFAULT_FACE_UPLOAD_MAX_BYTES;
}

export function assertValidUpload(
  file: FaceUploadFile | undefined,
  fieldName: string,
  maxUploadBytes: number
): void {
  if (!file) {
    throw new FaceServiceError(
      fieldName === "probeImage" ? "PROBE_REQUIRED" : "REFERENCE_REQUIRED",
      `${fieldName} is required.`,
      400
    );
  }

  if (!FACE_ALLOWED_MIME_TYPES.has(file.mimeType)) {
    throw new FaceServiceError(
      "INVALID_IMAGE_TYPE",
      `${fieldName} must be one of: ${Array.from(FACE_ALLOWED_MIME_TYPES).join(", ")}.`,
      400
    );
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new FaceServiceError("INVALID_REQUEST", `${fieldName} is empty.`, 400);
  }

  if (file.size > maxUploadBytes) {
    throw new FaceServiceError(
      "IMAGE_TOO_LARGE",
      `${fieldName} exceeds the maximum size of ${maxUploadBytes} bytes.`,
      413
    );
  }
}
