import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateAndNormalizeSample } from "../keystroke/validate";
import { createSyntheticFixedTextSample } from "./helpers/fixedTextSynthetic";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("validateAndNormalizeSample", () => {
  const nowMs = 1_700_000_000_000;
  const textId = "fixed-text-v1";
  const text = "securekit typing shield";

  it("accepts a valid sample and clamps limited negative transitions", () => {
    const sample = createSyntheticFixedTextSample({
      textId,
      text,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 500,
    });
    sample.ddMs[0] = -2;
    sample.udMs[0] = -4;

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(text),
      nowMs,
    });

    expect(result.ok).toBe(true);
    expect(result.sample?.ddMs[0]).toBe(0);
    expect(result.sample?.udMs[0]).toBe(0);
  });

  it("accepts samples with fully negative ud transitions by default and clamps them", () => {
    const sample = createSyntheticFixedTextSample({
      textId,
      text,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 500,
    });
    sample.udMs = sample.udMs.map(() => -20);

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(text),
      nowMs,
    });

    expect(result.ok).toBe(true);
    expect(result.sample?.udMs.every((value) => value === 0)).toBe(true);
  });

  it("rejects when too many negative dd transitions are clamped", () => {
    const sample = createSyntheticFixedTextSample({
      textId,
      text,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 500,
    });
    sample.ddMs = sample.ddMs.map(() => -20);

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(text),
      nowMs,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_SAMPLE");
    expect(result.error?.message).toBe("too many negative dd/ud transitions were clamped.");
  });

  it("rejects when hold/dd/ud lengths do not match", () => {
    const sample = createSyntheticFixedTextSample({
      textId,
      text,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 500,
    });
    sample.ddMs.pop();

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(text),
      nowMs,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("LENGTH_MISMATCH");
  });

  it("rejects out-of-range duration", () => {
    const sample = createSyntheticFixedTextSample({
      textId,
      text,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 500,
    });
    sample.meta.durationMs = 500;

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(text),
      nowMs,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("OUT_OF_RANGE");
  });

  it("rejects stale timestamps for replay protection", () => {
    const sample = createSyntheticFixedTextSample({
      textId,
      text,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 130_000,
    });

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(text),
      nowMs,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("REPLAY_REJECTED");
  });

  it("rejects samples whose text has fewer than 3 words", () => {
    const shortText = "securekit typing";
    const sample = createSyntheticFixedTextSample({
      textId,
      text: shortText,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 500,
    });

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(shortText),
      nowMs,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("OUT_OF_RANGE");
    expect(result.error?.message).toBe("text must contain at least 3 words.");
  });

  it("rejects samples flagged invalid by backspace usage", () => {
    const sample = createSyntheticFixedTextSample({
      textId,
      text,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 500,
    });
    sample.meta.invalidReason = "backspace_pressed";

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(text),
      nowMs,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_SAMPLE");
  });

  it("preserves and normalizes valid correction metadata", () => {
    const sample = createSyntheticFixedTextSample({
      textId,
      text,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 500,
    });
    sample.corrections = {
      events: [
        {
          type: "mismatch",
          t: 120,
          index: 1,
          key: "x",
          expected: "e",
        },
        {
          type: "backspace",
          t: 150,
          index: 1,
          removed: "x",
        },
      ],
      mismatchCount: 99,
      extraCount: 99,
      backspaceCount: 99,
    };

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(text),
      nowMs,
    });

    expect(result.ok).toBe(true);
    expect(result.sample?.corrections).toEqual({
      events: sample.corrections.events,
      mismatchCount: 1,
      extraCount: 0,
      backspaceCount: 1,
    });
  });

  it("rejects malformed correction metadata", () => {
    const sample = createSyntheticFixedTextSample({
      textId,
      text,
      seed: 42,
      profile: "A",
      timestampMs: nowMs - 500,
    });
    sample.corrections = {
      events: [
        {
          type: "backspace",
          t: 150,
          index: 1,
        },
      ],
      mismatchCount: 0,
      extraCount: 0,
      backspaceCount: 1,
    } as typeof sample.corrections;

    const result = validateAndNormalizeSample(sample, {
      textId,
      expectedTextHash: sha256Hex(text),
      nowMs,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_SAMPLE");
    expect(result.error?.message).toBe("backspace correction events require removed.");
  });
});
