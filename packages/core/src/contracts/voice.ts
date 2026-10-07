export type VoiceDecision = "allow" | "step_up" | "deny";

export type VoiceVerificationFailureCode =
  | "INVALID_REQUEST"
  | "CONSENT_REQUIRED"
  | "AUDIO_REQUIRED"
  | "INVALID_AUDIO_TYPE"
  | "AUDIO_TOO_LARGE"
  | "AUDIO_TOO_SHORT"
  | "PROFILE_NOT_FOUND"
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_ALREADY_USED"
  | "CHALLENGE_SESSION_MISMATCH"
  | "TRANSCRIPT_MISMATCH"
  | "PYTHON_RUNTIME_UNAVAILABLE"
  | "PYTHON_DEPENDENCY_MISSING"
  | "PYTHON_TIMEOUT"
  | "PYTHON_PROCESS_ERROR"
  | "PYTHON_OUTPUT_INVALID"
  | "GPU_REQUIRED"
  | "INTERNAL_ERROR";

export type VoiceRuntimeInfo = {
  device: "cuda" | "cpu";
  cudaAvailable: boolean;
  cudaDeviceName?: string | null;
  fallbackReason?: string | null;
  whisperModel?: string;
  speakerModel?: string;
};

export type VoiceTranscriptResult = {
  expectedText: string;
  transcript: string | null;
  similarityScore: number;
  matched: boolean;
  threshold: number;
};

export type VoicePolicy = {
  enabled?: boolean;
  matchThreshold?: number;
  stepUpThreshold?: number;
  denyThreshold?: number;
  transcriptThreshold?: number;
  minEnrollmentSamples?: number;
  updateProfileOnAllow?: boolean;
  profileUpdateAlpha?: number;
};

export type VoiceEnrollmentProfile = {
  embedding: number[];
  sampleCount: number;
  embeddingDim: number;
  enrolledAt: string;
  updatedAt: string;
  model: string;
};

export type VoiceEnrollmentProgress = {
  sampleCount: number;
  requiredSamples: number;
  complete: boolean;
};

export type VoiceSignal = {
  similarityScore: number;
  decision: VoiceDecision;
  reasons: string[];
  transcript: VoiceTranscriptResult;
  runtime: VoiceRuntimeInfo;
  thresholds: {
    matchThreshold: number;
    stepUpThreshold: number;
    denyThreshold: number;
    transcriptThreshold: number;
  };
};

export type VoiceEnrollmentResponse = {
  ok: true;
  userId: string;
  profile: VoiceEnrollmentProfile;
  enrollmentProgress: VoiceEnrollmentProgress;
  transcript: VoiceTranscriptResult;
  runtime: VoiceRuntimeInfo;
  reasons: string[];
};

export type VoiceVerificationResult = {
  ok: true;
  userId: string;
  matched: boolean;
  similarityScore: number;
  decision: VoiceDecision;
  reasons: string[];
  transcript: VoiceTranscriptResult;
  runtime: VoiceRuntimeInfo;
  profile: VoiceEnrollmentProfile | null;
  profileUpdated: boolean;
  signalsUsed: {
    voice: VoiceSignal;
  };
};

export type VoiceVerificationError = {
  code: VoiceVerificationFailureCode;
  message: string;
  details?: unknown;
};
