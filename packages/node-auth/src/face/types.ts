import type { FaceVerificationFailureCode, FaceVerificationResult } from "@securekit/core";
import type { RunFacePythonOptions } from "./pythonBridge";

export const FACE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type FaceImageMimeType = (typeof FACE_IMAGE_MIME_TYPES)[number];

export const DEFAULT_FACE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export interface FaceUploadFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  size: number;
}

export interface FaceEnrollmentInput {
  userId: string;
  referenceImage: FaceUploadFile;
}

export interface FaceVerifyInput {
  userId?: string;
  referenceImagePath?: string;
  referenceImage?: FaceUploadFile;
  probeImage: FaceUploadFile;
  threshold?: number;
}

export interface FaceVerificationServiceResult extends FaceVerificationResult {
  referenceImagePath: string;
}

export type FacePythonRunner = (
  input: {
    referenceImagePath: string;
    probeImagePath: string;
    threshold?: number;
  },
  options?: RunFacePythonOptions
) => Promise<FaceVerificationResult>;

export class FaceServiceError extends Error {
  readonly code: FaceVerificationFailureCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: FaceVerificationFailureCode,
    message: string,
    status = 400,
    details?: unknown
  ) {
    super(message);
    this.name = "FaceServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
