import type {
  EnrollmentProgress,
  KeystrokeProfile,
  KeystrokeSample,
  KeystrokeSampleMetrics,
} from "../contracts/enrollment";
import { buildEmptyKeystrokeMetrics, computeKeystrokeMetrics } from "./keystrokeMetrics";
import { normalizePositiveInt, toRounded } from "./keystrokeMath";
import { inferRounds, mergeNumeric } from "./keystrokeProfileCommon";
import {
  DEFAULT_ENROLLMENT_MIN_KEYSTROKES,
  DEFAULT_ENROLLMENT_MIN_ROUNDS,
  type BuildKeystrokeProfileArgs,
  type BuildKeystrokeProfileResult,
  type EnrollmentTargets,
} from "./keystrokeProfileTypes";

function mergeMeanStd(args: {
  existingMean: number;
  existingStd: number;
  sampleMean: number;
  sampleStd: number;
  existingWeight: number;
  sampleWeight: number;
}): { mean: number; std: number } {
  const totalWeight = args.existingWeight + args.sampleWeight;
  if (totalWeight <= 0) {
    return {
      mean: toRounded(args.sampleMean),
      std: toRounded(args.sampleStd),
    };
  }

  const mean =
    (args.existingMean * args.existingWeight + args.sampleMean * args.sampleWeight) / totalWeight;

  const existingVariance = Math.max(0, args.existingStd) ** 2;
  const sampleVariance = Math.max(0, args.sampleStd) ** 2;

  const variance =
    ((existingVariance + (args.existingMean - mean) ** 2) * args.existingWeight +
      (sampleVariance + (args.sampleMean - mean) ** 2) * args.sampleWeight) /
    totalWeight;

  return {
    mean: toRounded(mean),
    std: toRounded(Math.sqrt(Math.max(0, variance))),
  };
}

function resolveSample(args: BuildKeystrokeProfileArgs): KeystrokeSample {
  if (args.sample) {
    return {
      ...args.sample,
      events: Array.isArray(args.sample.events) ? args.sample.events : [],
      ...(args.expectedText !== undefined ? { expectedText: args.expectedText } : {}),
      ...(args.typedLength !== undefined ? { typedLength: args.typedLength } : {}),
      ...(args.errorCount !== undefined ? { errorCount: args.errorCount } : {}),
      ...(args.backspaceCount !== undefined ? { backspaceCount: args.backspaceCount } : {}),
      ...(args.imeCompositionUsed !== undefined
        ? { imeCompositionUsed: args.imeCompositionUsed }
        : {}),
    };
  }

  return {
    source: "legacy",
    events: Array.isArray(args.events) ? args.events : [],
    ...(args.expectedText !== undefined ? { expectedText: args.expectedText } : {}),
    ...(args.typedLength !== undefined ? { typedLength: args.typedLength } : {}),
    ...(args.errorCount !== undefined ? { errorCount: args.errorCount } : {}),
    ...(args.backspaceCount !== undefined ? { backspaceCount: args.backspaceCount } : {}),
    ...(args.imeCompositionUsed !== undefined ? { imeCompositionUsed: args.imeCompositionUsed } : {}),
  };
}

function resolveTargets(input?: EnrollmentTargets): { minRounds: number; minKeystrokes: number } {
  return {
    minRounds: normalizePositiveInt(input?.minRounds, DEFAULT_ENROLLMENT_MIN_ROUNDS),
    minKeystrokes: normalizePositiveInt(input?.minKeystrokes, DEFAULT_ENROLLMENT_MIN_KEYSTROKES),
  };
}

function createInitialProfile(args: {
  userId: string;
  nowIso: string;
  sampleMetrics: KeystrokeSampleMetrics;
  sampleWeight: number;
}): KeystrokeProfile {
  return {
    userId: args.userId,
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
    sampleCount: args.sampleWeight,
    sampleRoundCount: 1,
    holdMeanMs: args.sampleMetrics.holdMeanMs,
    holdStdMs: args.sampleMetrics.holdStdMs,
    holdMedianMs: args.sampleMetrics.holdMedianMs,
    flightMeanMs: args.sampleMetrics.flightMeanMs,
    flightStdMs: args.sampleMetrics.flightStdMs,
    flightMedianMs: args.sampleMetrics.flightMedianMs,
    digraphCount: args.sampleMetrics.digraphCount,
    ddMeanMs: args.sampleMetrics.ddMeanMs,
    ddStdMs: args.sampleMetrics.ddStdMs,
    ddMedianMs: args.sampleMetrics.ddMedianMs,
    udMeanMs: args.sampleMetrics.udMeanMs,
    udStdMs: args.sampleMetrics.udStdMs,
    udMedianMs: args.sampleMetrics.udMedianMs,
    uuMeanMs: args.sampleMetrics.uuMeanMs,
    uuStdMs: args.sampleMetrics.uuStdMs,
    uuMedianMs: args.sampleMetrics.uuMedianMs,
    typingSpeedMean: args.sampleMetrics.typingSpeedCharsPerSec,
    typingSpeedStd: 0,
    errorRateMean: args.sampleMetrics.errorRate,
    backspaceRateMean: args.sampleMetrics.backspaceRate,
    startDelayMean: args.sampleMetrics.startDelayMs,
    startDelayStd: 0,
    interWordPauseMean: args.sampleMetrics.interWordPauseMeanMs,
    interWordPauseStd: args.sampleMetrics.interWordPauseStdMs,
    longPauseRateMean: args.sampleMetrics.longPauseRate,
    correctionBurstRateMean: args.sampleMetrics.correctionBurstRate,
  };
}

function mergeProfile(args: {
  existingProfile: KeystrokeProfile;
  nowIso: string;
  sampleMetrics: KeystrokeSampleMetrics;
  sampleWeight: number;
}): KeystrokeProfile {
  const existingWeight = Math.max(0, args.existingProfile.sampleCount);
  if (existingWeight <= 0) {
    return createInitialProfile({
      userId: args.existingProfile.userId,
      nowIso: args.nowIso,
      sampleMetrics: args.sampleMetrics,
      sampleWeight: args.sampleWeight,
    });
  }

  const hold = mergeMeanStd({
    existingMean: args.existingProfile.holdMeanMs,
    existingStd: args.existingProfile.holdStdMs,
    sampleMean: args.sampleMetrics.holdMeanMs,
    sampleStd: args.sampleMetrics.holdStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const flight = mergeMeanStd({
    existingMean: args.existingProfile.flightMeanMs,
    existingStd: args.existingProfile.flightStdMs,
    sampleMean: args.sampleMetrics.flightMeanMs,
    sampleStd: args.sampleMetrics.flightStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const dd = mergeMeanStd({
    existingMean: args.existingProfile.ddMeanMs ?? args.existingProfile.flightMeanMs,
    existingStd: args.existingProfile.ddStdMs ?? args.existingProfile.flightStdMs,
    sampleMean: args.sampleMetrics.ddMeanMs,
    sampleStd: args.sampleMetrics.ddStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const ud = mergeMeanStd({
    existingMean: args.existingProfile.udMeanMs ?? args.existingProfile.flightMeanMs,
    existingStd: args.existingProfile.udStdMs ?? args.existingProfile.flightStdMs,
    sampleMean: args.sampleMetrics.udMeanMs,
    sampleStd: args.sampleMetrics.udStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const uu = mergeMeanStd({
    existingMean: args.existingProfile.uuMeanMs ?? args.existingProfile.flightMeanMs,
    existingStd: args.existingProfile.uuStdMs ?? args.existingProfile.flightStdMs,
    sampleMean: args.sampleMetrics.uuMeanMs,
    sampleStd: args.sampleMetrics.uuStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const startDelay = mergeMeanStd({
    existingMean: args.existingProfile.startDelayMean ?? args.sampleMetrics.startDelayMs,
    existingStd: args.existingProfile.startDelayStd ?? 0,
    sampleMean: args.sampleMetrics.startDelayMs,
    sampleStd: 0,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const interWordPause = mergeMeanStd({
    existingMean: args.existingProfile.interWordPauseMean ?? args.sampleMetrics.interWordPauseMeanMs,
    existingStd: args.existingProfile.interWordPauseStd ?? 0,
    sampleMean: args.sampleMetrics.interWordPauseMeanMs,
    sampleStd: args.sampleMetrics.interWordPauseStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });

  const sampleRoundCount = inferRounds(args.existingProfile) + 1;
  const sampleCount = existingWeight + args.sampleWeight;

  return {
    ...args.existingProfile,
    updatedAt: args.nowIso,
    sampleCount,
    sampleRoundCount,
    holdMeanMs: hold.mean,
    holdStdMs: hold.std,
    holdMedianMs: mergeNumeric(
      args.existingProfile.holdMedianMs,
      args.sampleMetrics.holdMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    flightMeanMs: flight.mean,
    flightStdMs: flight.std,
    flightMedianMs: mergeNumeric(
      args.existingProfile.flightMedianMs,
      args.sampleMetrics.flightMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    digraphCount: Math.max(0, (args.existingProfile.digraphCount ?? 0) + args.sampleMetrics.digraphCount),
    ddMeanMs: dd.mean,
    ddStdMs: dd.std,
    ddMedianMs: mergeNumeric(
      args.existingProfile.ddMedianMs,
      args.sampleMetrics.ddMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    udMeanMs: ud.mean,
    udStdMs: ud.std,
    udMedianMs: mergeNumeric(
      args.existingProfile.udMedianMs,
      args.sampleMetrics.udMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    uuMeanMs: uu.mean,
    uuStdMs: uu.std,
    uuMedianMs: mergeNumeric(
      args.existingProfile.uuMedianMs,
      args.sampleMetrics.uuMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    typingSpeedMean: mergeNumeric(
      args.existingProfile.typingSpeedMean,
      args.sampleMetrics.typingSpeedCharsPerSec,
      existingWeight,
      args.sampleWeight
    ),
    typingSpeedStd: mergeNumeric(
      args.existingProfile.typingSpeedStd,
      0,
      existingWeight,
      args.sampleWeight
    ),
    errorRateMean: mergeNumeric(
      args.existingProfile.errorRateMean,
      args.sampleMetrics.errorRate,
      existingWeight,
      args.sampleWeight
    ),
    backspaceRateMean: mergeNumeric(
      args.existingProfile.backspaceRateMean,
      args.sampleMetrics.backspaceRate,
      existingWeight,
      args.sampleWeight
    ),
    startDelayMean: startDelay.mean,
    startDelayStd: startDelay.std,
    interWordPauseMean: interWordPause.mean,
    interWordPauseStd: interWordPause.std,
    longPauseRateMean: mergeNumeric(
      args.existingProfile.longPauseRateMean,
      args.sampleMetrics.longPauseRate,
      existingWeight,
      args.sampleWeight
    ),
    correctionBurstRateMean: mergeNumeric(
      args.existingProfile.correctionBurstRateMean,
      args.sampleMetrics.correctionBurstRate,
      existingWeight,
      args.sampleWeight
    ),
  };
}

function toEnrollmentProgress(args: {
  profile: KeystrokeProfile;
  minRounds: number;
  minKeystrokes: number;
}): EnrollmentProgress {
  const roundsCompleted = inferRounds(args.profile);
  const keystrokesCollected = Math.max(0, Math.round(args.profile.sampleCount));

  const roundsRemaining = Math.max(0, args.minRounds - roundsCompleted);
  const keystrokesRemaining = Math.max(0, args.minKeystrokes - keystrokesCollected);

  return {
    roundsCompleted,
    roundsTarget: args.minRounds,
    roundsRemaining,
    keystrokesCollected,
    keystrokesTarget: args.minKeystrokes,
    keystrokesRemaining,
    ready: roundsRemaining === 0 || keystrokesRemaining === 0,
  };
}

export function buildKeystrokeProfile(args: BuildKeystrokeProfileArgs): BuildKeystrokeProfileResult {
  const sample = resolveSample(args);
  const metricsResult = sample.events.length
    ? computeKeystrokeMetrics(sample)
    : { metrics: buildEmptyKeystrokeMetrics(), reasons: ["INSUFFICIENT_SAMPLES"], trimmed: false };

  const sampleWeight = Math.max(1, metricsResult.metrics.keystrokeCount);
  const profile = args.existingProfile
    ? mergeProfile({
        existingProfile: args.existingProfile,
        nowIso: args.nowIso,
        sampleMetrics: metricsResult.metrics,
        sampleWeight,
      })
    : createInitialProfile({
        userId: args.userId,
        nowIso: args.nowIso,
        sampleMetrics: metricsResult.metrics,
        sampleWeight,
      });

  const targets = resolveTargets(args.enrollmentTargets);
  const enrollmentProgress = toEnrollmentProgress({
    profile,
    minRounds: targets.minRounds,
    minKeystrokes: targets.minKeystrokes,
  });

  const reasons = [...metricsResult.reasons];
  if (!enrollmentProgress.ready) {
    reasons.push("INSUFFICIENT_SAMPLES");
  }

  return {
    profile,
    sampleMetrics: metricsResult.metrics,
    enrollmentProgress,
    reasons: Array.from(new Set(reasons)),
  };
}
