import type { KeystrokeSample } from "../../keystroke/types";

export type SyntheticProfile = "A" | "B";

interface SampleArgs {
  textId: string;
  text: string;
  seed: number;
  profile: SyntheticProfile;
  noiseLevel?: number;
  timestampMs?: number;
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function jitter(rng: () => number, amplitude: number): number {
  return (rng() * 2 - 1) * amplitude;
}

function resolveProfile(profile: SyntheticProfile): {
  holdMean: number;
  ddMean: number;
} {
  if (profile === "A") {
    return {
      holdMean: 95,
      ddMean: 150,
    };
  }

  return {
    holdMean: 170,
    ddMean: 260,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function createSyntheticFixedTextSample(args: SampleArgs): KeystrokeSample {
  const rng = createSeededRng(args.seed);
  const noiseLevel = args.noiseLevel ?? 1;
  const profile = resolveProfile(args.profile);
  const length = Array.from(args.text).length;

  const holdMs: number[] = [];
  const ddMs: number[] = [];
  const down: number[] = [];
  const up: number[] = [];

  for (let index = 0; index < length; index += 1) {
    const hold = Math.max(25, profile.holdMean + jitter(rng, 8 * noiseLevel));
    holdMs.push(round(hold));

    if (index === 0) {
      down.push(0);
      up.push(round(hold));
      continue;
    }

    const dd = Math.max(35, profile.ddMean + jitter(rng, 12 * noiseLevel));
    ddMs.push(round(dd));
    down.push(round(down[index - 1] + dd));
    up.push(round(down[index] + hold));
  }

  const udMs: number[] = [];
  for (let index = 1; index < length; index += 1) {
    udMs.push(round(down[index] - up[index - 1]));
  }

  const durationMs = round(up[length - 1] - down[0]);

  return {
    textId: args.textId,
    text: args.text,
    holdMs,
    ddMs,
    udMs,
    meta: {
      timestamp: args.timestampMs ?? Date.now(),
      durationMs,
    },
  };
}

export function createSyntheticFixedTextSamples(args: {
  textId: string;
  text: string;
  profile: SyntheticProfile;
  sampleCount: number;
  startSeed?: number;
  noiseLevel?: number;
  timestampMs?: number;
}): KeystrokeSample[] {
  const startSeed = args.startSeed ?? 1;
  const timestampMs = args.timestampMs ?? Date.now();
  const samples: KeystrokeSample[] = [];

  for (let index = 0; index < args.sampleCount; index += 1) {
    samples.push(
      createSyntheticFixedTextSample({
        textId: args.textId,
        text: args.text,
        profile: args.profile,
        seed: startSeed + index * 37,
        noiseLevel: args.noiseLevel,
        timestampMs,
      })
    );
  }

  return samples;
}

