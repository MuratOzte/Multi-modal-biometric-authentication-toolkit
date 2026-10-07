import { clamp, isFiniteNumber, toRounded } from "./keystrokeMath";

export type NumericSummary = {
  mean: number;
  std: number;
  median: number;
  count: number;
  trimmed: boolean;
};

export type TrimConfig = {
  lowerQuantile: number;
  upperQuantile: number;
};

export const DEFAULT_TRIM_CONFIG: TrimConfig = {
  lowerQuantile: 0.05,
  upperQuantile: 0.95,
};

function safeSlice(values: number[], start: number, end: number): number[] {
  if (values.length === 0) return [];
  const normalizedStart = clamp(start, 0, values.length - 1);
  const normalizedEnd = clamp(end, normalizedStart + 1, values.length);
  return values.slice(normalizedStart, normalizedEnd);
}

function trimOutliers(values: number[], config: TrimConfig): { values: number[]; trimmed: boolean } {
  const sorted = values.filter((value) => isFiniteNumber(value) && value >= 0).sort((a, b) => a - b);
  if (sorted.length < 10) {
    return { values: sorted, trimmed: false };
  }

  const start = Math.floor(sorted.length * config.lowerQuantile);
  const end = Math.ceil(sorted.length * config.upperQuantile);
  const sliced = safeSlice(sorted, start, end);

  if (sliced.length < 3) {
    return { values: sorted, trimmed: false };
  }

  return {
    values: sliced,
    trimmed: sliced.length !== sorted.length,
  };
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function calculateStd(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[middle - 1] + values[middle]) / 2;
  }
  return values[middle];
}

export function resolveTrimConfig(trimConfig: Partial<TrimConfig> = {}): TrimConfig {
  return {
    lowerQuantile:
      isFiniteNumber(trimConfig.lowerQuantile) && trimConfig.lowerQuantile >= 0
        ? trimConfig.lowerQuantile
        : DEFAULT_TRIM_CONFIG.lowerQuantile,
    upperQuantile:
      isFiniteNumber(trimConfig.upperQuantile) && trimConfig.upperQuantile <= 1
        ? trimConfig.upperQuantile
        : DEFAULT_TRIM_CONFIG.upperQuantile,
  };
}

export function summarize(values: number[], trimConfig: TrimConfig): NumericSummary {
  const normalized = values.filter((value) => isFiniteNumber(value) && value >= 0).sort((a, b) => a - b);
  if (normalized.length === 0) {
    return {
      mean: 0,
      std: 0,
      median: 0,
      count: 0,
      trimmed: false,
    };
  }

  const trimmed = trimOutliers(normalized, trimConfig);
  const bucket = trimmed.values.length > 0 ? trimmed.values : normalized;
  const mean = calculateMean(bucket);
  const std = calculateStd(bucket, mean);
  const median = calculateMedian(bucket);

  return {
    mean: toRounded(mean),
    std: toRounded(std),
    median: toRounded(median),
    count: normalized.length,
    trimmed: trimmed.trimmed,
  };
}
