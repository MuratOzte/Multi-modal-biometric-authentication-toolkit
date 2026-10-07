import type {
  KeystrokePolicy,
  KeystrokeSample,
  KeystrokeSignal,
  UserProfiles,
} from "@securekit/core";
import { applyKeystrokeProfileEmaUpdate } from "../../../core/src/biometrics/keystrokeProfile";
import { computeKeystrokeMetrics } from "../../../core/src/biometrics/keystrokeMetrics";
import {
  evaluateEnrollmentReadiness,
  resolveKeystrokeThresholds,
  scoreKeystrokeSample,
} from "../../../core/src/biometrics/keystrokeScoring";
import type { StorageAdapter } from "../storage/adapter";

export type VerifyKeystrokeAgainstProfileResult = {
  signal: KeystrokeSignal;
  profileUpdated: boolean;
  profile: UserProfiles["keystroke"];
};

export async function verifyKeystrokeAgainstProfile(args: {
  userId: string;
  sample: KeystrokeSample;
  storage: StorageAdapter;
  policy?: KeystrokePolicy;
  nowIso: string;
}): Promise<VerifyKeystrokeAgainstProfileResult> {
  const metricsResult = computeKeystrokeMetrics(args.sample);
  const thresholds = resolveKeystrokeThresholds(args.policy);
  const existingProfiles = await args.storage.getProfiles(args.userId);
  const existingProfile = existingProfiles?.keystroke ?? null;

  const reasons = [...metricsResult.reasons];
  let profileUpdated = false;
  let resolvedProfile = existingProfile;

  if (!existingProfile) {
    reasons.push("PROFILE_MISSING");
    return {
      profileUpdated: false,
      profile: null,
      signal: {
        similarityScore: 0,
        distance: 10,
        decision: "step_up",
        reasons: Array.from(new Set(reasons)),
        sampleMetrics: metricsResult.metrics,
        thresholds,
      },
    };
  }

  const readiness = evaluateEnrollmentReadiness(existingProfile, args.policy);
  reasons.push(...readiness.reasons);

  const scored = scoreKeystrokeSample({
    profile: existingProfile,
    sampleMetrics: metricsResult.metrics,
    policy: args.policy,
  });
  reasons.push(...scored.reasons);

  let decision = scored.decision;
  if (!readiness.ok && decision === "allow") {
    decision = "step_up";
  }

  if (decision === "allow" && (args.policy?.updateProfileOnAllow ?? true)) {
    const nextProfile = applyKeystrokeProfileEmaUpdate({
      profile: existingProfile,
      sampleMetrics: metricsResult.metrics,
      nowIso: args.nowIso,
      alpha: args.policy?.profileUpdateAlpha,
    });

    const nextProfiles: UserProfiles = {
      userId: args.userId,
      keystroke: nextProfile,
      faceReferenceImagePath: existingProfiles?.faceReferenceImagePath ?? null,
      faceReferenceEnrolledAt: existingProfiles?.faceReferenceEnrolledAt ?? null,
      faceEmbedding: existingProfiles?.faceEmbedding ?? null,
      cardReferenceImagePath: existingProfiles?.cardReferenceImagePath ?? null,
      cardReferenceEnrolledAt: existingProfiles?.cardReferenceEnrolledAt ?? null,
      voice: existingProfiles?.voice ?? null,
      voiceEmbedding: existingProfiles?.voiceEmbedding ?? null,
      updatedAt: args.nowIso,
    };

    await args.storage.saveProfiles(args.userId, nextProfiles);
    profileUpdated = true;
    resolvedProfile = nextProfile;
  }

  return {
    profileUpdated,
    profile: resolvedProfile,
    signal: {
      similarityScore: scored.similarityScore,
      distance: scored.distance,
      decision,
      reasons: Array.from(new Set(reasons)),
      sampleMetrics: metricsResult.metrics,
      thresholds: scored.thresholds,
    },
  };
}
