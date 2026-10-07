export type FaceVerificationFailureCode =
  | "INVALID_REQUEST"
  | "REFERENCE_REQUIRED"
  | "PROBE_REQUIRED"
  | "INVALID_IMAGE_TYPE"
  | "IMAGE_TOO_LARGE"
  | "REFERENCE_NOT_FOUND"
  | "REFERENCE_PATH_INVALID"
  | "PYTHON_RUNTIME_UNAVAILABLE"
  | "PYTHON_TIMEOUT"
  | "PYTHON_PROCESS_ERROR"
  | "PYTHON_OUTPUT_INVALID"
  | "GPU_REQUIRED"
  | "FACE_NOT_DETECTED"
  | "INTERNAL_ERROR";

export type FaceRuntimeInfo = {
  device: "cuda" | "cpu";
  cudaAvailable: boolean;
  cudaDeviceName?: string | null;
  fallbackReason?: string | null;
  model?: string;
};

export type FaceEnrollmentReference = {
  imagePath: string;
  enrolledAt: string;
  source: "upload" | "external";
};

export type FaceEnrollmentReferenceRequest = {
  userId: string;
  imagePath: string;
  source?: FaceEnrollmentReference["source"];
};

export type FaceEnrollmentReferenceResponse = {
  ok: true;
  userId: string;
  reference: FaceEnrollmentReference;
};

export type FaceVerificationInput = {
  referenceImagePath: string;
  probeImagePath: string;
  threshold?: number;
};

export type FaceVerificationResult = {
  ok: boolean;
  matched: boolean;
  score: number | null;
  reason: string | null;
  failureCode?: FaceVerificationFailureCode;
  runtime?: FaceRuntimeInfo;
};

export type FaceSlidingWindowEntry = {
  id: string;
  ts: number;
  image?: string;
};

export type FaceSlidingWindowReferenceScore = {
  id: string;
  ts: number;
  score: number;
};

export type FaceSlidingWindowVerificationResult = FaceVerificationResult & {
  perReferenceScores: FaceSlidingWindowReferenceScore[];
  windowSizeBefore: number;
  windowSizeAfter: number;
  threshold: number;
  added: FaceSlidingWindowEntry | null;
  evicted: FaceSlidingWindowEntry[];
};

export type FaceVerificationError = {
  code: FaceVerificationFailureCode;
  message: string;
  details?: unknown;
};
