import type { KeystrokeProfile, KeystrokeSampleMetrics } from "../contracts/enrollment";
import { isFiniteNumber } from "./keystrokeMath";

type FeatureConfig = {
  key: string;
  sample: (metrics: KeystrokeSampleMetrics) => number;
  profileMean: (profile: KeystrokeProfile) => number | undefined;
  profileStd: (profile: KeystrokeProfile) => number | undefined;
  minStd: number;
  weight: number;
};

const FEATURE_SET: FeatureConfig[] = [
  {
    key: "hold",
    sample: (metrics) => metrics.holdMeanMs,
    profileMean: (profile) => profile.holdMeanMs,
    profileStd: (profile) => profile.holdStdMs,
    minStd: 8,
    weight: 1.2,
  },
  {
    key: "flight",
    sample: (metrics) => metrics.flightMeanMs,
    profileMean: (profile) => profile.flightMeanMs,
    profileStd: (profile) => profile.flightStdMs,
    minStd: 8,
    weight: 1,
  },
  {
    key: "dd",
    sample: (metrics) => metrics.ddMeanMs,
    profileMean: (profile) => profile.ddMeanMs,
    profileStd: (profile) => profile.ddStdMs,
    minStd: 8,
    weight: 0.8,
  },
  {
    key: "ud",
    sample: (metrics) => metrics.udMeanMs,
    profileMean: (profile) => profile.udMeanMs,
    profileStd: (profile) => profile.udStdMs,
    minStd: 8,
    weight: 1,
  },
  {
    key: "uu",
    sample: (metrics) => metrics.uuMeanMs,
    profileMean: (profile) => profile.uuMeanMs,
    profileStd: (profile) => profile.uuStdMs,
    minStd: 8,
    weight: 0.6,
  },
  {
    key: "speed",
    sample: (metrics) => metrics.typingSpeedCharsPerSec,
    profileMean: (profile) => profile.typingSpeedMean,
    profileStd: (profile) => profile.typingSpeedStd,
    minStd: 0.3,
    weight: 0.5,
  },
  {
    key: "start_delay",
    sample: (metrics) => metrics.startDelayMs,
    profileMean: (profile) => profile.startDelayMean,
    profileStd: (profile) => profile.startDelayStd,
    minStd: 40,
    weight: 0.7,
  },
  {
    key: "inter_word_pause",
    sample: (metrics) => metrics.interWordPauseMeanMs,
    profileMean: (profile) => profile.interWordPauseMean,
    profileStd: (profile) => profile.interWordPauseStd,
    minStd: 35,
    weight: 0.8,
  },
  {
    key: "error",
    sample: (metrics) => metrics.errorRate,
    profileMean: (profile) => profile.errorRateMean,
    profileStd: () => 0.08,
    minStd: 0.05,
    weight: 0.5,
  },
  {
    key: "backspace",
    sample: (metrics) => metrics.backspaceRate,
    profileMean: (profile) => profile.backspaceRateMean,
    profileStd: () => 0.1,
    minStd: 0.05,
    weight: 0.4,
  },
  {
    key: "long_pause",
    sample: (metrics) => metrics.longPauseRate,
    profileMean: (profile) => profile.longPauseRateMean,
    profileStd: () => 0.08,
    minStd: 0.03,
    weight: 0.4,
  },
  {
    key: "correction_burst",
    sample: (metrics) => metrics.correctionBurstRate,
    profileMean: (profile) => profile.correctionBurstRateMean,
    profileStd: () => 0.08,
    minStd: 0.03,
    weight: 0.35,
  },
];

export function resolveDistance(profile: KeystrokeProfile, sampleMetrics: KeystrokeSampleMetrics): {
  distance: number;
  featuresUsed: number;
} {
  let weightedDistance = 0;
  let totalWeight = 0;
  let featuresUsed = 0;

  for (const feature of FEATURE_SET) {
    const sampleValue = feature.sample(sampleMetrics);
    const profileMean = feature.profileMean(profile);
    const profileStd = feature.profileStd(profile);

    if (!isFiniteNumber(sampleValue) || !isFiniteNumber(profileMean)) {
      continue;
    }

    const std = isFiniteNumber(profileStd) ? Math.max(feature.minStd, Math.abs(profileStd)) : feature.minStd;
    const delta = sampleValue - profileMean;
    const normalized = (delta * delta) / (std * std);

    weightedDistance += normalized * feature.weight;
    totalWeight += feature.weight;
    featuresUsed += 1;
  }

  if (featuresUsed === 0 || totalWeight <= 0) {
    return { distance: 10, featuresUsed: 0 };
  }

  return {
    distance: Math.sqrt(weightedDistance / totalWeight),
    featuresUsed,
  };
}
