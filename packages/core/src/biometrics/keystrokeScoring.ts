import type { KeystrokeProfile, KeystrokeSampleMetrics } from "../contracts/enrollment";
import type { KeystrokeDecision, KeystrokePolicy } from "../contracts/keystroke";
import { clamp, isFiniteNumber, toRounded } from "./keystrokeMath";
import { resolveDistance } from "./keystrokeScoringFeatures";

export type ResolvedKeystrokeThresholds = {
  allowThreshold: number;
  stepUpThreshold: number;
  denyThreshold: number;
};

export type ScoreKeystrokeResult = {
  distance: number;
  similarityScore: number;
  decision: KeystrokeDecision;
  reasons: string[];
  thresholds: ResolvedKeystrokeThresholds;
};

export type EnrollmentReadinessResult = {
  ok: boolean;
  reasons: string[];
};

export const DEFAULT_KEYSTROKE_THRESHOLDS: ResolvedKeystrokeThresholds = {
  allowThreshold: 0.77,
  stepUpThreshold: 0.56,
  denyThreshold: 0.36,
};

const DEFAULT_MIN_ENROLLMENT_ROUNDS = 8;
const DEFAULT_MIN_ENROLLMENT_KEYSTROKES = 120;
const DEFAULT_MIN_DIGRAPH_COUNT = 40;

export function resolveKeystrokeThresholds(policy?: KeystrokePolicy): ResolvedKeystrokeThresholds {
  const allowThreshold = clamp(
    isFiniteNumber(policy?.allowThreshold)
      ? policy.allowThreshold
      : DEFAULT_KEYSTROKE_THRESHOLDS.allowThreshold,
    0.1,
    0.99
  );
  const stepUpThreshold = clamp(
    isFiniteNumber(policy?.stepUpThreshold)
      ? policy.stepUpThreshold
      : DEFAULT_KEYSTROKE_THRESHOLDS.stepUpThreshold,
    0.05,
    allowThreshold
  );
  const denyThreshold = clamp(
    isFiniteNumber(policy?.denyThreshold)
      ? policy.denyThreshold
      : DEFAULT_KEYSTROKE_THRESHOLDS.denyThreshold,
    0,
    stepUpThreshold
  );

  return {
    allowThreshold,
    stepUpThreshold,
    denyThreshold,
  };
}

function inferRoundCount(profile: KeystrokeProfile): number {
  if (isFiniteNumber(profile.sampleRoundCount) && profile.sampleRoundCount > 0) {
    return Math.round(profile.sampleRoundCount);
  }
  return profile.sampleCount > 0 ? 1 : 0;
}

function distanceToSimilarity(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return clamp(Math.exp(-0.9 * distance), 0, 1);
}

function decide(similarityScore: number, thresholds: ResolvedKeystrokeThresholds): KeystrokeDecision {
  if (similarityScore >= thresholds.allowThreshold) return "allow";
  if (similarityScore < thresholds.denyThreshold) return "deny";
  return "step_up";
}

export function evaluateEnrollmentReadiness(
  profile: KeystrokeProfile,
  policy?: KeystrokePolicy
): EnrollmentReadinessResult {
  const rounds = inferRoundCount(profile);
  const minRounds =
    isFiniteNumber(policy?.minEnrollmentRounds) && policy.minEnrollmentRounds > 0
      ? Math.round(policy.minEnrollmentRounds)
      : DEFAULT_MIN_ENROLLMENT_ROUNDS;
  const minKeystrokes =
    isFiniteNumber(policy?.minEnrollmentKeystrokes) && policy.minEnrollmentKeystrokes > 0
      ? Math.round(policy.minEnrollmentKeystrokes)
      : DEFAULT_MIN_ENROLLMENT_KEYSTROKES;
  const minDigraphCount =
    isFiniteNumber(policy?.minDigraphCount) && policy.minDigraphCount > 0
      ? Math.round(policy.minDigraphCount)
      : DEFAULT_MIN_DIGRAPH_COUNT;

  const reasons: string[] = [];
  if (rounds < minRounds && profile.sampleCount < minKeystrokes) {
    reasons.push("INSUFFICIENT_SAMPLES");
  }
  if ((profile.digraphCount ?? 0) < minDigraphCount) {
    reasons.push("LOW_DIGRAPH_COVERAGE");
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

export function scoreKeystrokeSample(args: {
  profile: KeystrokeProfile;
  sampleMetrics: KeystrokeSampleMetrics;
  policy?: KeystrokePolicy;
}): ScoreKeystrokeResult {
  const thresholds = resolveKeystrokeThresholds(args.policy);
  const distanceDetails = resolveDistance(args.profile, args.sampleMetrics);
  const similarity = distanceToSimilarity(distanceDetails.distance);
  const decision = decide(similarity, thresholds);

  const reasons: string[] = [];
  if (distanceDetails.featuresUsed < 3) {
    reasons.push("INSUFFICIENT_SAMPLES");
  }
  if (distanceDetails.distance > 2.2) {
    reasons.push("HIGH_DISTANCE");
  }
  if (similarity < thresholds.stepUpThreshold) {
    reasons.push("LOW_SIMILARITY");
  }

  return {
    distance: toRounded(distanceDetails.distance),
    similarityScore: toRounded(similarity),
    decision,
    reasons: Array.from(new Set(reasons)),
    thresholds,
  };
}
