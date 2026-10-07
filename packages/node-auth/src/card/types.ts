import type { RunCardPythonOptions } from "./pythonBridge";

export const CARD_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type CardVerificationFailureCode =
  | "INVALID_REQUEST"
  | "PROBE_REQUIRED"
  | "INVALID_IMAGE_TYPE"
  | "IMAGE_TOO_LARGE"
  | "REFERENCE_NOT_FOUND"
  | "PYTHON_RUNTIME_UNAVAILABLE"
  | "PYTHON_TIMEOUT"
  | "PYTHON_PROCESS_ERROR"
  | "PYTHON_OUTPUT_INVALID"
  | "INTERNAL_ERROR";

export const DEFAULT_CARD_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export interface CardUploadFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  size: number;
}

export interface CardReferenceSummary {
  id: string;
  fileName: string;
  label: string;
  imagePath: string;
}

export type CardComparisonDecision = "same" | "different" | "uncertain";

export interface CardExtractedFields {
  name: string;
  studentNo: string;
  documentNo?: string;
  cardNo: string;
  validThru: string;
}

export interface CardComparisonQuality {
  cardDetectedProbe: boolean;
  cardDetectedReference: boolean;
  detectionConfidenceProbe: number;
  detectionConfidenceReference: number;
  ocrAvailable: boolean;
  ocrWeak: boolean;
  ocrErrorProbe: string | null;
  ocrErrorReference: string | null;
}

export interface CardVisualDetails {
  activeMethod: "clip";
  clipScore: number | null;
  clipCosine: number | null;
  clipAvailable: boolean;
  clipModel: string | null;
  clipDevice: string | null;
  clipError: string | null;
}

export interface CardMatchCandidate {
  referenceImagePath: string;
  referenceFileName: string;
  decision: CardComparisonDecision;
  overallScore: number;
  contentScore: number;
  visualScore: number;
  visualDetails?: CardVisualDetails;
  reasons: string[];
  fields: {
    probe: CardExtractedFields;
    reference: CardExtractedFields;
  };
  quality: CardComparisonQuality;
  matched: boolean;
}

export interface CardVerificationByClipOldResult {
  ok: boolean;
  clipScore?: number | null;
  isSameCard?: boolean | null;
  referenceImagePath?: string;
  error?: string;
}

export interface CardVerificationResult {
  ok: boolean;
  matched: boolean;
  threshold: number;
  checkedCount: number;
  reason: string | null;
  bestMatch: CardMatchCandidate | null;
  candidates: CardMatchCandidate[];
  cardVerificationByClipOld: CardVerificationByClipOldResult | null;
}

export interface CardReferencesResponse {
  ok: true;
  referenceDir: string;
  references: CardReferenceSummary[];
}

export interface CardVerifyInput {
  probeImage: CardUploadFile;
  userId?: string;
  threshold?: number;
  referenceId?: string;
}

export interface CardEnrollmentInput {
  userId: string;
  referenceImage: CardUploadFile;
}

export type CardPythonRunner = (
  input: {
    probeImagePath: string;
    referenceDir: string;
    threshold?: number;
  },
  options?: RunCardPythonOptions
) => Promise<CardVerificationResult>;

export class CardServiceError extends Error {
  readonly code: CardVerificationFailureCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: CardVerificationFailureCode,
    message: string,
    status = 400,
    details?: unknown
  ) {
    super(message);
    this.name = "CardServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
