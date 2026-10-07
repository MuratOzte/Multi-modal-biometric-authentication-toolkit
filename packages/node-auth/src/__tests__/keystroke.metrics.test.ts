import { describe, expect, it } from "vitest";
import type { KeystrokeEvent, KeystrokeSample } from "@securekit/core";
import { buildKeystrokeProfile } from "../../../core/src/biometrics/keystrokeProfile";
import { computeKeystrokeMetrics } from "../../../core/src/biometrics/keystrokeMetrics";
import { scoreKeystrokeSample } from "../../../core/src/biometrics/keystrokeScoring";

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createSample(args: {
  seed: number;
  chars: number;
  speedMultiplier?: number;
  addOutlier?: boolean;
  errorCount?: number;
  backspaceCount?: number;
}): KeystrokeSample {
  const rng = createSeededRng(args.seed);
  const events: KeystrokeEvent[] = [];
  let t = 0;

  const speedMultiplier = args.speedMultiplier ?? 1;
  for (let index = 0; index < args.chars; index += 1) {
    const flight = (35 + Math.floor(rng() * 30)) * speedMultiplier;
    const hold = (80 + Math.floor(rng() * 35)) * speedMultiplier;
    const key = String.fromCharCode(97 + (index % 26));
    const code = `Key${key.toUpperCase()}`;

    t += flight;
    events.push({
      key,
      code,
      type: "down",
      t,
      expectedIndex: index,
    });

    t += hold;
    events.push({
      key,
      code,
      type: "up",
      t,
      expectedIndex: index,
    });
  }

  if (args.addOutlier) {
    t += 40;
    events.push({ key: "z", code: "KeyZ", type: "down", t, expectedIndex: args.chars + 1 });
    t += 1600;
    events.push({ key: "z", code: "KeyZ", type: "up", t, expectedIndex: args.chars + 1 });
  }

  return {
    events,
    expectedText: "sample text",
    typedLength: args.chars,
    errorCount: args.errorCount ?? 0,
    backspaceCount: args.backspaceCount ?? 0,
    source: "collector_v1",
  };
}

describe("keystroke metrics + scoring", () => {
  it("extracts metrics and trims outliers deterministically", () => {
    const sample = createSample({
      seed: 42,
      chars: 28,
      addOutlier: true,
    });

    const first = computeKeystrokeMetrics(sample);
    const second = computeKeystrokeMetrics(sample);

    expect(first).toEqual(second);
    expect(first.reasons).toContain("OUTLIER_TRIMMED");
    expect(first.metrics.keystrokeCount).toBeGreaterThanOrEqual(28);
    expect(first.metrics.holdMeanMs).toBeLessThan(220);
    expect(first.metrics.ddMeanMs).toBeGreaterThan(0);
    expect(first.metrics.udMeanMs).toBeGreaterThan(0);
  });

  it("scores similar samples higher than shifted rhythm samples", () => {
    const enrollmentSample = createSample({
      seed: 7,
      chars: 30,
    });
    const profile = buildKeystrokeProfile({
      userId: "u1",
      nowIso: "2026-02-18T12:00:00.000Z",
      sample: enrollmentSample,
    }).profile;

    const similar = computeKeystrokeMetrics(
      createSample({
        seed: 7,
        chars: 30,
      })
    ).metrics;

    const shifted = computeKeystrokeMetrics(
      createSample({
        seed: 77,
        chars: 30,
        speedMultiplier: 2.1,
        errorCount: 6,
        backspaceCount: 5,
      })
    ).metrics;

    const scoreSimilar = scoreKeystrokeSample({ profile, sampleMetrics: similar });
    const scoreShifted = scoreKeystrokeSample({ profile, sampleMetrics: shifted });

    expect(scoreSimilar.similarityScore).toBeGreaterThan(scoreShifted.similarityScore);
    expect(scoreSimilar.distance).toBeLessThan(scoreShifted.distance);
  });
});
