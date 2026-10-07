import type { KeystrokeSample, KeystrokeSampleMetrics } from "../contracts/enrollment";
import {
  buildPairs,
  deriveDurations,
  normalizeEvents,
  resolveCorrectionBurstRate,
  resolveDurationMs,
  resolveInterWordPauseDurations,
  resolveLongPauseRate,
  resolveStartDelayMs,
  resolveTypedLength,
} from "./keystrokeMetricEvents";
import { resolveTrimConfig, summarize, type TrimConfig } from "./keystrokeMetricStatistics";
import { clamp, normalizeCount, toRounded } from "./keystrokeMath";

export type ComputeKeystrokeMetricsResult = {
  metrics: KeystrokeSampleMetrics;
  reasons: string[];
  trimmed: boolean;
};

export function buildEmptyKeystrokeMetrics(): KeystrokeSampleMetrics {
  return {
    holdMeanMs: 0,
    holdStdMs: 0,
    holdMedianMs: 0,
    flightMeanMs: 0,
    flightStdMs: 0,
    flightMedianMs: 0,
    ddMeanMs: 0,
    ddStdMs: 0,
    ddMedianMs: 0,
    udMeanMs: 0,
    udStdMs: 0,
    udMedianMs: 0,
    uuMeanMs: 0,
    uuStdMs: 0,
    uuMedianMs: 0,
    typingSpeedCharsPerSec: 0,
    errorRate: 0,
    backspaceRate: 0,
    digraphCount: 0,
    keystrokeCount: 0,
    eventCount: 0,
    durationMs: 0,
    startDelayMs: 0,
    interWordPauseMeanMs: 0,
    interWordPauseStdMs: 0,
    interWordPauseMedianMs: 0,
    interWordPauseCount: 0,
    longPauseRate: 0,
    correctionBurstRate: 0,
  };
}

export function computeKeystrokeMetrics(
  sample: KeystrokeSample,
  trimConfig: Partial<TrimConfig> = {}
): ComputeKeystrokeMetricsResult {
  const resolvedTrim = resolveTrimConfig(trimConfig);

  const pairs = buildPairs(sample.events ?? []);
  const durations = deriveDurations(pairs);
  const flightValues = durations.ud.length > 0 ? durations.ud : durations.dd;

  const holdSummary = summarize(durations.hold, resolvedTrim);
  const flightSummary = summarize(flightValues, resolvedTrim);
  const ddSummary = summarize(durations.dd, resolvedTrim);
  const udSummary = summarize(durations.ud, resolvedTrim);
  const uuSummary = summarize(durations.uu, resolvedTrim);

  const durationMs = resolveDurationMs(sample.events ?? []);
  const typedLength = resolveTypedLength(sample, pairs.length);
  const errorCount = normalizeCount(sample.errorCount);
  const backspaceCount = normalizeCount(sample.backspaceCount);
  const normalizedEvents = normalizeEvents(sample.events ?? []);
  const startDelayMs = resolveStartDelayMs(normalizedEvents);
  const interWordPauses = resolveInterWordPauseDurations(normalizedEvents);
  const interWordPauseSummary = summarize(interWordPauses, resolvedTrim);
  const longPauseRate = resolveLongPauseRate(normalizedEvents);
  const correctionBurstRate = resolveCorrectionBurstRate(normalizedEvents, typedLength);

  const typingSpeedCharsPerSec =
    durationMs > 0 ? toRounded(typedLength / (durationMs / 1000)) : 0;
  const errorRate = typedLength > 0 ? toRounded(clamp(errorCount / typedLength, 0, 1)) : 0;
  const backspaceRate =
    typedLength > 0 ? toRounded(clamp(backspaceCount / typedLength, 0, 1)) : 0;

  const metrics: KeystrokeSampleMetrics = {
    holdMeanMs: holdSummary.mean,
    holdStdMs: holdSummary.std,
    holdMedianMs: holdSummary.median,
    flightMeanMs: flightSummary.mean,
    flightStdMs: flightSummary.std,
    flightMedianMs: flightSummary.median,
    ddMeanMs: ddSummary.mean,
    ddStdMs: ddSummary.std,
    ddMedianMs: ddSummary.median,
    udMeanMs: udSummary.mean,
    udStdMs: udSummary.std,
    udMedianMs: udSummary.median,
    uuMeanMs: uuSummary.mean,
    uuStdMs: uuSummary.std,
    uuMedianMs: uuSummary.median,
    typingSpeedCharsPerSec,
    errorRate,
    backspaceRate,
    digraphCount: durations.dd.length,
    keystrokeCount: pairs.length,
    eventCount: Array.isArray(sample.events) ? sample.events.length : 0,
    durationMs,
    startDelayMs,
    interWordPauseMeanMs: interWordPauseSummary.mean,
    interWordPauseStdMs: interWordPauseSummary.std,
    interWordPauseMedianMs: interWordPauseSummary.median,
    interWordPauseCount: interWordPauseSummary.count,
    longPauseRate,
    correctionBurstRate,
  };

  const reasons: string[] = [];
  const trimmed =
    holdSummary.trimmed ||
    flightSummary.trimmed ||
    ddSummary.trimmed ||
    udSummary.trimmed ||
    uuSummary.trimmed ||
    interWordPauseSummary.trimmed;

  if (trimmed) {
    reasons.push("OUTLIER_TRIMMED");
  }

  if (sample.imeCompositionUsed) {
    reasons.push("IME_COMPOSITION_DETECTED");
  }

  if (pairs.length < 3) {
    reasons.push("INSUFFICIENT_SAMPLES");
  }

  if (durations.dd.length < 2 || durations.ud.length < 2) {
    reasons.push("LOW_DIGRAPH_COVERAGE");
  }

  return {
    metrics,
    reasons,
    trimmed,
  };
}
