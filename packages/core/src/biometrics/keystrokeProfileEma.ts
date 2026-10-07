import type { KeystrokeProfile, KeystrokeSampleMetrics } from "../contracts/enrollment";
import { clamp, isFiniteNumber, toRounded } from "./keystrokeMath";
import { inferRounds, mergeNumeric } from "./keystrokeProfileCommon";

function ema(current: number, sample: number, alpha: number): number {
  return current + alpha * (sample - current);
}

function emaStd(currentStd: number, currentMean: number, sample: number, alpha: number): number {
  const variance = Math.max(0, currentStd) ** 2;
  const nextVariance = (1 - alpha) * variance + alpha * (sample - currentMean) ** 2;
  return Math.sqrt(Math.max(0, nextVariance));
}

export function applyKeystrokeProfileEmaUpdate(args: {
  profile: KeystrokeProfile;
  sampleMetrics: KeystrokeSampleMetrics;
  nowIso: string;
  alpha?: number;
}): KeystrokeProfile {
  const alpha = clamp(isFiniteNumber(args.alpha) ? args.alpha : 0.08, 0.01, 0.5);

  const holdMean = ema(args.profile.holdMeanMs, args.sampleMetrics.holdMeanMs, alpha);
  const holdStd = emaStd(args.profile.holdStdMs, args.profile.holdMeanMs, args.sampleMetrics.holdMeanMs, alpha);
  const flightMean = ema(args.profile.flightMeanMs, args.sampleMetrics.flightMeanMs, alpha);
  const flightStd = emaStd(
    args.profile.flightStdMs,
    args.profile.flightMeanMs,
    args.sampleMetrics.flightMeanMs,
    alpha
  );
  const startDelayMean = ema(
    args.profile.startDelayMean ?? args.sampleMetrics.startDelayMs,
    args.sampleMetrics.startDelayMs,
    alpha
  );
  const startDelayStd = emaStd(
    args.profile.startDelayStd ?? 0,
    args.profile.startDelayMean ?? args.sampleMetrics.startDelayMs,
    args.sampleMetrics.startDelayMs,
    alpha
  );
  const interWordPauseMean = ema(
    args.profile.interWordPauseMean ?? args.sampleMetrics.interWordPauseMeanMs,
    args.sampleMetrics.interWordPauseMeanMs,
    alpha
  );
  const interWordPauseStd = emaStd(
    args.profile.interWordPauseStd ?? 0,
    args.profile.interWordPauseMean ?? args.sampleMetrics.interWordPauseMeanMs,
    args.sampleMetrics.interWordPauseMeanMs,
    alpha
  );

  return {
    ...args.profile,
    updatedAt: args.nowIso,
    sampleCount: Math.max(1, args.profile.sampleCount) + Math.max(1, args.sampleMetrics.keystrokeCount),
    sampleRoundCount: inferRounds(args.profile) + 1,
    holdMeanMs: toRounded(holdMean),
    holdStdMs: toRounded(holdStd),
    holdMedianMs: mergeNumeric(
      args.profile.holdMedianMs,
      args.sampleMetrics.holdMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    flightMeanMs: toRounded(flightMean),
    flightStdMs: toRounded(flightStd),
    flightMedianMs: mergeNumeric(
      args.profile.flightMedianMs,
      args.sampleMetrics.flightMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    digraphCount: Math.max(0, (args.profile.digraphCount ?? 0) + args.sampleMetrics.digraphCount),
    ddMeanMs: toRounded(
      ema(args.profile.ddMeanMs ?? args.profile.flightMeanMs, args.sampleMetrics.ddMeanMs, alpha)
    ),
    ddStdMs: toRounded(
      emaStd(
        args.profile.ddStdMs ?? args.profile.flightStdMs,
        args.profile.ddMeanMs ?? args.profile.flightMeanMs,
        args.sampleMetrics.ddMeanMs,
        alpha
      )
    ),
    ddMedianMs: mergeNumeric(
      args.profile.ddMedianMs,
      args.sampleMetrics.ddMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    udMeanMs: toRounded(
      ema(args.profile.udMeanMs ?? args.profile.flightMeanMs, args.sampleMetrics.udMeanMs, alpha)
    ),
    udStdMs: toRounded(
      emaStd(
        args.profile.udStdMs ?? args.profile.flightStdMs,
        args.profile.udMeanMs ?? args.profile.flightMeanMs,
        args.sampleMetrics.udMeanMs,
        alpha
      )
    ),
    udMedianMs: mergeNumeric(
      args.profile.udMedianMs,
      args.sampleMetrics.udMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    uuMeanMs: toRounded(
      ema(args.profile.uuMeanMs ?? args.profile.flightMeanMs, args.sampleMetrics.uuMeanMs, alpha)
    ),
    uuStdMs: toRounded(
      emaStd(
        args.profile.uuStdMs ?? args.profile.flightStdMs,
        args.profile.uuMeanMs ?? args.profile.flightMeanMs,
        args.sampleMetrics.uuMeanMs,
        alpha
      )
    ),
    uuMedianMs: mergeNumeric(
      args.profile.uuMedianMs,
      args.sampleMetrics.uuMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    typingSpeedMean: toRounded(
      ema(args.profile.typingSpeedMean ?? 0, args.sampleMetrics.typingSpeedCharsPerSec, alpha)
    ),
    typingSpeedStd: toRounded(
      emaStd(
        args.profile.typingSpeedStd ?? 0,
        args.profile.typingSpeedMean ?? 0,
        args.sampleMetrics.typingSpeedCharsPerSec,
        alpha
      )
    ),
    errorRateMean: toRounded(ema(args.profile.errorRateMean ?? 0, args.sampleMetrics.errorRate, alpha)),
    backspaceRateMean: toRounded(
      ema(args.profile.backspaceRateMean ?? 0, args.sampleMetrics.backspaceRate, alpha)
    ),
    startDelayMean: toRounded(startDelayMean),
    startDelayStd: toRounded(startDelayStd),
    interWordPauseMean: toRounded(interWordPauseMean),
    interWordPauseStd: toRounded(interWordPauseStd),
    longPauseRateMean: toRounded(
      ema(args.profile.longPauseRateMean ?? 0, args.sampleMetrics.longPauseRate, alpha)
    ),
    correctionBurstRateMean: toRounded(
      ema(args.profile.correctionBurstRateMean ?? 0, args.sampleMetrics.correctionBurstRate, alpha)
    ),
  };
}
