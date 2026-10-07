import {
  DEFAULT_CARD_UPLOAD_MAX_BYTES,
  CardServiceError,
  type CardUploadFile,
} from "./types";
import { CARD_ALLOWED_MIME_TYPES } from "./config";

export function resolveThreshold(defaultThreshold: number, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultThreshold;
  }

  if (value < 0 || value > 1) {
    throw new CardServiceError(
      "INVALID_REQUEST",
      "threshold must be a number between 0 and 1.",
      400
    );
  }

  return value;
}

export function resolveMaxUploadBytes(value: number | undefined): number {
  return value ?? DEFAULT_CARD_UPLOAD_MAX_BYTES;
}

export function assertValidUpload(
  file: CardUploadFile | undefined,
  fieldName: string,
  maxUploadBytes: number
): void {
  if (!file) {
    throw new CardServiceError("PROBE_REQUIRED", `${fieldName} is required.`, 400);
  }

  if (!CARD_ALLOWED_MIME_TYPES.has(file.mimeType)) {
    throw new CardServiceError(
      "INVALID_IMAGE_TYPE",
      `${fieldName} must be one of: ${Array.from(CARD_ALLOWED_MIME_TYPES).join(", ")}.`,
      400
    );
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new CardServiceError("INVALID_REQUEST", `${fieldName} is empty.`, 400);
  }

  if (file.size > maxUploadBytes) {
    throw new CardServiceError(
      "IMAGE_TOO_LARGE",
      `${fieldName} exceeds the maximum size of ${maxUploadBytes} bytes.`,
      413
    );
  }
}
