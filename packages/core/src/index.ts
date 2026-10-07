export * from "./contracts";
export * from "./contracts/verify";
export * from "./contracts/session";
export * from "./contracts/consent";
export * from "./contracts/enrollment";
export * from "./contracts/face";
export * from "./contracts/card";
export * from "./contracts/voice";
export * from "./contracts/keystroke";
export * from "./contracts/userProfiles";
export type {
  ChallengeLang,
  ChallengeLength,
  ChallengeTextRequest,
  ChallengeTextResponse,
  ConsumeChallengeRequest,
  ConsumeChallengeResponse,
} from "./contracts/challenge";
export * from "./biometrics/keystrokeProfile";
export * from "./biometrics/keystrokeMetrics";
export * from "./biometrics/keystrokeScoring";
export * from "./orchestrator";
export * from "./policies.defaultPolicy";
export * from "./risk/aggregate";
export * from "./risk/decide";
export * from "./risk/policy";

export const FACTORS = {
  PASSKEY: "webauthn:passkey",
  FACE_LIVENESS: "face:liveness",
  VPN_CHECK: "vpn:check",
} as const;

export type FactorId = (typeof FACTORS)[keyof typeof FACTORS];

export interface VerificationResult {
  ok: boolean;
  score: number;
  details?: Record<string, unknown>;
}

export interface VerificationError {
  code: string;
  message: string;
}
