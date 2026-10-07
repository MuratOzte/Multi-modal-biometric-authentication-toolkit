import type { KeystrokeProfile, KeystrokeSample, KeystrokeSampleMetrics } from "./enrollment";

export type KeystrokeDecision = "allow" | "step_up" | "deny";

export type KeystrokePolicy = {
  enabled?: boolean;
  allowThreshold?: number;
  stepUpThreshold?: number;
  denyThreshold?: number;
  minEnrollmentRounds?: number;
  minEnrollmentKeystrokes?: number;
  minDigraphCount?: number;
  profileUpdateAlpha?: number;
  updateProfileOnAllow?: boolean;
};

export type VerifyKeystrokeRequest = {
  userId: string;
  sessionId?: string;
  challengeId?: string;
  sample: KeystrokeSample;
  policy?: KeystrokePolicy;
};

export type KeystrokeSignal = {
  similarityScore: number;
  distance: number;
  decision: KeystrokeDecision;
  reasons: string[];
  sampleMetrics: KeystrokeSampleMetrics;
  thresholds: {
    allowThreshold: number;
    stepUpThreshold: number;
    denyThreshold: number;
  };
};

export type VerifyKeystrokeResponse = {
  ok: true;
  userId: string;
  similarityScore: number;
  distance: number;
  decision: KeystrokeDecision;
  reasons: string[];
  sampleMetrics: KeystrokeSampleMetrics;
  profile: KeystrokeProfile | null;
  profileUpdated: boolean;
  signalsUsed: {
    keystroke: KeystrokeSignal;
  };
};
