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

export type CardEnrollmentReference = {
  imagePath: string;
  enrolledAt: string;
  source: "upload";
};

export type CardEnrollmentReferenceResponse = {
  ok: true;
  userId: string;
  reference: CardEnrollmentReference;
};

export type CardReferenceSummary = {
  id: string;
  fileName: string;
  label: string;
  imagePath: string;
};

export type CardComparisonDecision = "same" | "different" | "uncertain";

export type CardExtractedFields = {
  name: string;
  studentNo: string;
  documentNo?: string;
  cardNo: string;
  validThru: string;
};

export type CardComparisonQuality = {
  cardDetectedProbe: boolean;
  cardDetectedReference: boolean;
  detectionConfidenceProbe: number;
  detectionConfidenceReference: number;
  ocrAvailable: boolean;
  ocrWeak: boolean;
  ocrErrorProbe: string | null;
  ocrErrorReference: string | null;
};

export type CardVisualDetails = {
  activeMethod: "clip";
  clipScore: number | null;
  clipCosine: number | null;
  clipAvailable: boolean;
  clipModel: string | null;
  clipDevice: string | null;
  clipError: string | null;
};

export type CardMatchCandidate = {
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
};

export type CardVerificationResult = {
  ok: boolean;
  matched: boolean;
  threshold: number;
  checkedCount: number;
  reason: string | null;
  bestMatch: CardMatchCandidate | null;
  candidates: CardMatchCandidate[];
};

export type CardReferencesResponse = {
  ok: true;
  referenceDir: string;
  references: CardReferenceSummary[];
};

export type CardVerificationError = {
  code: CardVerificationFailureCode;
  message: string;
  details?: unknown;
};
