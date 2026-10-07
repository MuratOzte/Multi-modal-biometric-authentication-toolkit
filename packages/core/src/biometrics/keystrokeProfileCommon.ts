import type { KeystrokeProfile } from "../contracts/enrollment";
import { isFiniteNumber, toRounded } from "./keystrokeMath";

export function inferRounds(profile: KeystrokeProfile | null | undefined): number {
  if (!profile) return 0;
  if (isFiniteNumber(profile.sampleRoundCount) && profile.sampleRoundCount > 0) {
    return Math.round(profile.sampleRoundCount);
  }
  return profile.sampleCount > 0 ? 1 : 0;
}

export function mergeNumeric(
  existingValue: number | undefined,
  sampleValue: number,
  existingWeight: number,
  sampleWeight: number
): number {
  if (!isFiniteNumber(existingValue) || existingWeight <= 0) {
    return toRounded(sampleValue);
  }

  const totalWeight = existingWeight + sampleWeight;
  if (totalWeight <= 0) return toRounded(sampleValue);

  return toRounded((existingValue * existingWeight + sampleValue * sampleWeight) / totalWeight);
}
