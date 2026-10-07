import type { LocationResult, NetworkResult } from "@securekit/core";
import type { FetchLike } from "./transport";

export interface VerificationResult {
  ok: boolean;
  score: number;
  details?: unknown;
}

export interface VpnCheckDetails {
  ip: string | null;
  ipTimeZone: string | null;
  ipCountry: string | null;
  ipRegion: string | null;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isRelay: boolean;
  timezoneDriftHours: number | null;
  clientTimeZone: string | null;
  clientTimeOffsetMinutes: number | null;
  source: string | null;
  ipInfo?: unknown;
}

export interface LocationCountryResultDetails {
  ip: string | null;
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  matchesExpectedCountry: boolean | null;
  matchesClientCountry: boolean | null;
  reason: string | null;
  ipInfo?: unknown;
  security?: {
    vpn?: boolean | null;
    proxy?: boolean | null;
    tor?: boolean | null;
    relay?: boolean | null;
  };
}

export interface LocationCountryResult {
  ok: boolean;
  score: number;
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  details?: LocationCountryResultDetails;
}

export interface VpnPolicyConfig {
  allowVpn?: boolean;
  allowProxy?: boolean;
  allowTor?: boolean;
  allowRelay?: boolean;
  minScore?: number;
}

export interface LocationPolicyConfig {
  requireCountryMatch?: boolean;
  allowedCountries?: string[];
  minScore?: number;
  treatVpnAsFailure?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  effectiveScore: number;
}

export interface VpnVerificationWithDecision {
  raw: VerificationResult & { details?: VpnCheckDetails };
  decision: PolicyDecision;
}

export interface LocationVerificationWithDecision {
  raw: LocationCountryResult;
  decision: PolicyDecision;
}

export interface VerifyNetworkOptions {
  clientOffsetMin?: number | null;
}

export interface VerifyLocationOptions {
  allowedCountries?: string[];
}

export interface EnrollFaceReferenceArgs {
  userId: string;
  referenceImage: Blob;
  referenceFileName?: string;
}

export interface VerifyFaceArgs {
  probeImage: Blob;
  userId?: string;
  referenceImagePath?: string;
  referenceImage?: Blob;
  probeFileName?: string;
  referenceFileName?: string;
  threshold?: number;
}

export interface VerifyFaceSlidingWindowArgs {
  probeImage: Blob;
  userId: string;
  probeFileName?: string;
  threshold?: number;
  maxWindow?: number;
  updateOnSuccess?: boolean;
}

export interface FaceLivenessMetrics {
  quality?: number;
  illuminationOk?: boolean;
  baselineY?: number;
  flashY?: number;
  recoveryY?: number;
  deltaY?: number;
  relativeDelta?: number;
  sampleCount?: number;
  saturatedRatio?: number;
}

export interface VerifyFaceLivenessPayload {
  proof?: { tasksOk?: boolean };
  metrics?: FaceLivenessMetrics;
}

export interface VerifyCardArgs {
  probeImage: Blob;
  userId?: string;
  referenceId?: string;
  probeFileName?: string;
  threshold?: number;
}

export interface EnrollCardReferenceArgs {
  userId: string;
  referenceImage: Blob;
  referenceFileName?: string;
}

export interface EnrollVoiceArgs {
  userId: string;
  challengeId: string;
  audioSample: Blob;
  sessionId?: string;
  audioFileName?: string;
  transcriptThreshold?: number;
  minEnrollmentSamples?: number;
}

export interface VerifyVoiceArgs {
  userId: string;
  challengeId: string;
  audioSample: Blob;
  sessionId?: string;
  audioFileName?: string;
  matchThreshold?: number;
  stepUpThreshold?: number;
  denyThreshold?: number;
  transcriptThreshold?: number;
  updateProfileOnAllow?: boolean;
  profileUpdateAlpha?: number;
}

export interface SecureKitClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  vpnPolicy?: VpnPolicyConfig;
  locationPolicy?: LocationPolicyConfig;
}

export interface AuthCredentials {
  userId: string;
  password: string;
}

export interface AuthLoginResponse {
  ok: true;
  userId: string;
}

export interface AuthRegisterResponse {
  ok: true;
  userId: string;
  created: boolean;
}

export interface AuthUserSummary {
  userId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthUsersResponse {
  ok: true;
  users: AuthUserSummary[];
}

export interface BuildLegacyVpnResultArgs {
  network: NetworkResult;
  clientTimeZone: string | null;
  clientTimeOffsetMinutes: number | null;
}

export interface BuildLocationCountryResultArgs {
  location: LocationResult;
  network: NetworkResult;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
}
