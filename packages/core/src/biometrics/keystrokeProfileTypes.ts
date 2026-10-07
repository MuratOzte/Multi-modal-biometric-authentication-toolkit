import type {
  EnrollmentProgress,
  KeystrokeEvent,
  KeystrokeProfile,
  KeystrokeSample,
  KeystrokeSampleMetrics,
} from "../contracts/enrollment";

export const DEFAULT_ENROLLMENT_MIN_ROUNDS = 10;
export const DEFAULT_ENROLLMENT_MIN_KEYSTROKES = 160;

export type EnrollmentTargets = {
  minRounds?: number;
  minKeystrokes?: number;
};

export type BuildKeystrokeProfileArgs = {
  userId: string;
  nowIso: string;
  events?: KeystrokeEvent[];
  sample?: KeystrokeSample;
  expectedText?: string;
  typedLength?: number;
  errorCount?: number;
  backspaceCount?: number;
  imeCompositionUsed?: boolean;
  existingProfile?: KeystrokeProfile | null;
  enrollmentTargets?: EnrollmentTargets;
};

export type BuildKeystrokeProfileResult = {
  profile: KeystrokeProfile;
  sampleMetrics: KeystrokeSampleMetrics;
  enrollmentProgress: EnrollmentProgress;
  reasons: string[];
};
