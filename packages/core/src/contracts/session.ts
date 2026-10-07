import type { LocationResult, NetworkResult } from "./verify";
import type { KeystrokePolicy, KeystrokeSignal } from "./keystroke";
import type { KeystrokeSample } from "./enrollment";
import type { VoicePolicy, VoiceSignal } from "./voice";

export type RiskDecision = "allow" | "step-up" | "deny";

export type VerifyStep =
  | "network"
  | "location"
  | "keystroke"
  | "face"
  | "voice"
  | "object"
  | "passkey";

export type StepUi = {
  title: string;
  instruction: string;
};

export type RequiredStep = {
  step: VerifyStep;
  ui: StepUi;
  meta?: Record<string, unknown>;
};

export type SessionPolicy = {
  allowMaxRisk?: number;
  denyMinRisk?: number;
  stepUpSteps?: VerifyStep[];
  treatVpnAsFailure?: boolean;
  allowedCountries?: string[];
  minNetworkScore?: number;
  keystroke?: KeystrokePolicy;
  voice?: VoicePolicy;
};

export type VerifySessionRequest = {
  sessionId: string;
  userId?: string;
  policy?: SessionPolicy;
  signals?: {
    network?: NetworkResult;
    location?: LocationResult;
    keystroke?: KeystrokeSample;
    voice?: VoiceSignal;
  };
};

export type VerifySessionResponse = {
  sessionId: string;
  riskScore: number;
  decision: RiskDecision;
  requiredSteps: RequiredStep[];
  reasons: string[];
  signalsUsed?: {
    network?: NetworkResult;
    location?: LocationResult;
    keystroke?: KeystrokeSignal;
    voice?: VoiceSignal;
  };
};

export type SessionStartResponse = {
  sessionId: string;
  expiresAt: string;
};
