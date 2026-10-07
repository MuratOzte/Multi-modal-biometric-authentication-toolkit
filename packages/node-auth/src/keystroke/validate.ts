import { createHash } from "node:crypto";
import type {
  KeystrokeCorrectionEvent,
  KeystrokeCorrections,
  KeystrokeSample,
} from "./types";

const DEFAULT_MIN_WORD_COUNT = 3;
const DEFAULT_MIN_LENGTH = 15;
const DEFAULT_MAX_LENGTH = 30;
const DEFAULT_MIN_DURATION_MS = 800;
const DEFAULT_MAX_DURATION_MS = 20_000;
const DEFAULT_MAX_AGE_MS = 120_000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 10_000;
const DEFAULT_MAX_NEGATIVE_DD_RATIO = 0.2;
// Fast typists often produce negative UD (overlap/rollover). Clamp by default, do not reject on ratio.
const DEFAULT_MAX_NEGATIVE_UD_RATIO = 1.0;
const MAX_CORRECTION_EVENTS = 200;
const CORRECTION_EVENT_TYPES = new Set(["mismatch", "extra", "backspace"]);

export interface ValidateSampleOptions {
  textId: string;
  expectedTextHash: string;
  nowMs: number;
  minWordCount?: number;
  minLength?: number;
  maxLength?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
  maxNegativeDdRatio?: number;
  maxNegativeUdRatio?: number;
}

export interface ValidateSampleResult {
  ok: boolean;
  sample?: KeystrokeSample;
  error?: {
    code:
      | "INVALID_SAMPLE"
      | "TEXT_ID_MISMATCH"
      | "TEXT_MISMATCH"
      | "LENGTH_MISMATCH"
      | "OUT_OF_RANGE"
      | "REPLAY_REJECTED";
    message: string;
    details?: Record<string, unknown>;
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function cloneSample(sample: KeystrokeSample): KeystrokeSample {
  return {
    textId: sample.textId,
    text: sample.text,
    holdMs: [...sample.holdMs],
    ddMs: [...sample.ddMs],
    udMs: [...sample.udMs],
    meta: {
      ...sample.meta,
    },
    ...(sample.corrections
      ? {
          corrections: {
            events: sample.corrections.events.map((event) => ({ ...event })),
            mismatchCount: sample.corrections.mismatchCount,
            extraCount: sample.corrections.extraCount,
            backspaceCount: sample.corrections.backspaceCount,
          },
        }
      : {}),
  };
}

type CorrectionNormalizeResult =
  | {
      ok: true;
      corrections?: KeystrokeCorrections;
    }
  | {
      ok: false;
      error: NonNullable<ValidateSampleResult["error"]>;
    };

function invalidCorrections(message: string): CorrectionNormalizeResult {
  return {
    ok: false,
    error: {
      code: "INVALID_SAMPLE",
      message,
    },
  };
}

function hasStringField(
  event: KeystrokeCorrectionEvent,
  key: "key" | "expected" | "removed"
): boolean {
  return typeof event[key] === "string";
}

function normalizeCorrections(corrections: KeystrokeCorrections | undefined): CorrectionNormalizeResult {
  if (corrections === undefined) return { ok: true };
  if (!Array.isArray(corrections.events)) {
    return invalidCorrections("corrections.events must be an array.");
  }
  if (corrections.events.length > MAX_CORRECTION_EVENTS) {
    return invalidCorrections(`corrections.events must contain at most ${MAX_CORRECTION_EVENTS} items.`);
  }

  let mismatchCount = 0;
  let extraCount = 0;
  let backspaceCount = 0;
  const events: KeystrokeCorrectionEvent[] = [];

  for (const event of corrections.events) {
    if (!CORRECTION_EVENT_TYPES.has(event.type)) {
      return invalidCorrections("corrections.events contains an unknown type.");
    }
    if (!isFiniteNumber(event.t) || event.t < 0) {
      return invalidCorrections("corrections.events contains an invalid timestamp.");
    }
    if (!isNonNegativeInteger(event.index)) {
      return invalidCorrections("corrections.events contains an invalid index.");
    }

    if (event.type === "mismatch") {
      if (!hasStringField(event, "key") || !hasStringField(event, "expected")) {
        return invalidCorrections("mismatch correction events require key and expected.");
      }
      mismatchCount += 1;
    }
    if (event.type === "extra") {
      if (!hasStringField(event, "key")) {
        return invalidCorrections("extra correction events require key.");
      }
      extraCount += 1;
    }
    if (event.type === "backspace") {
      if (!hasStringField(event, "removed")) {
        return invalidCorrections("backspace correction events require removed.");
      }
      backspaceCount += 1;
    }

    events.push({
      type: event.type,
      t: event.t,
      index: event.index,
      ...(typeof event.key === "string" ? { key: event.key } : {}),
      ...(typeof event.expected === "string" ? { expected: event.expected } : {}),
      ...(typeof event.removed === "string" ? { removed: event.removed } : {}),
    });
  }

  return {
    ok: true,
    corrections: {
      events,
      mismatchCount,
      extraCount,
      backspaceCount,
    },
  };
}

function countWords(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((word) => word.length > 0).length;
}

export function validateAndNormalizeSample(
  sample: KeystrokeSample,
  options: ValidateSampleOptions
): ValidateSampleResult {
  const minWordCount = options.minWordCount ?? DEFAULT_MIN_WORD_COUNT;
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const minDurationMs = options.minDurationMs ?? DEFAULT_MIN_DURATION_MS;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_MAX_FUTURE_SKEW_MS;
  const maxNegativeDdRatio = options.maxNegativeDdRatio ?? DEFAULT_MAX_NEGATIVE_DD_RATIO;
  const maxNegativeUdRatio = options.maxNegativeUdRatio ?? DEFAULT_MAX_NEGATIVE_UD_RATIO;

  const normalized = cloneSample(sample);
  const normalizedCorrections = normalizeCorrections(normalized.corrections);
  if (!normalizedCorrections.ok) {
    return {
      ok: false,
      error: normalizedCorrections.error,
    };
  }
  if (normalizedCorrections.corrections) {
    normalized.corrections = normalizedCorrections.corrections;
  } else {
    delete normalized.corrections;
  }

  if (normalized.meta.invalid === true) {
    return {
      ok: false,
      error: {
        code: "INVALID_SAMPLE",
        message: "sample meta.invalid flagged true.",
      },
    };
  }

  if (
    typeof normalized.meta.invalidReason === "string" &&
    normalized.meta.invalidReason.toLowerCase().includes("backspace")
  ) {
    return {
      ok: false,
      error: {
        code: "INVALID_SAMPLE",
        message: "sample marked invalid due to backspace usage.",
      },
    };
  }

  if (normalized.textId !== options.textId) {
    return {
      ok: false,
      error: {
        code: "TEXT_ID_MISMATCH",
        message: "sample.textId does not match route textId.",
        details: {
          sampleTextId: normalized.textId,
          expectedTextId: options.textId,
        },
      },
    };
  }

  const textHash = sha256Hex(normalized.text);
  if (textHash !== options.expectedTextHash) {
    return {
      ok: false,
      error: {
        code: "TEXT_MISMATCH",
        message: "sample.text does not match expected text hash.",
      },
    };
  }

  const wordCount = countWords(normalized.text);
  if (wordCount < minWordCount) {
    return {
      ok: false,
      error: {
        code: "OUT_OF_RANGE",
        message: `text must contain at least ${minWordCount} words.`,
        details: { wordCount, minWordCount },
      },
    };
  }

  const charLength = normalized.holdMs.length;
  if (
    normalized.ddMs.length !== Math.max(0, charLength - 1) ||
    normalized.udMs.length !== Math.max(0, charLength - 1)
  ) {
    return {
      ok: false,
      error: {
        code: "LENGTH_MISMATCH",
        message: "hold/dd/ud lengths are inconsistent.",
        details: {
          holdLength: normalized.holdMs.length,
          ddLength: normalized.ddMs.length,
          udLength: normalized.udMs.length,
        },
      },
    };
  }

  if (charLength < minLength || charLength > maxLength) {
    return {
      ok: false,
      error: {
        code: "OUT_OF_RANGE",
        message: `hold length must be in [${minLength}, ${maxLength}].`,
        details: { holdLength: charLength },
      },
    };
  }

  if (!isFiniteNumber(normalized.meta.durationMs)) {
    return {
      ok: false,
      error: {
        code: "INVALID_SAMPLE",
        message: "meta.durationMs must be a finite number.",
      },
    };
  }

  if (normalized.meta.durationMs < minDurationMs || normalized.meta.durationMs > maxDurationMs) {
    return {
      ok: false,
      error: {
        code: "OUT_OF_RANGE",
        message: `meta.durationMs must be in [${minDurationMs}, ${maxDurationMs}].`,
        details: { durationMs: normalized.meta.durationMs },
      },
    };
  }

  if (!isFiniteNumber(normalized.meta.timestamp)) {
    return {
      ok: false,
      error: {
        code: "INVALID_SAMPLE",
        message: "meta.timestamp must be a finite epoch milliseconds value.",
      },
    };
  }

  const ageMs = options.nowMs - normalized.meta.timestamp;
  if (ageMs > maxAgeMs) {
    return {
      ok: false,
      error: {
        code: "REPLAY_REJECTED",
        message: "sample timestamp is too old.",
        details: { ageMs, maxAgeMs },
      },
    };
  }

  if (ageMs < -maxFutureSkewMs) {
    return {
      ok: false,
      error: {
        code: "REPLAY_REJECTED",
        message: "sample timestamp is too far in the future.",
        details: { ageMs, maxFutureSkewMs },
      },
    };
  }

  if (!normalized.holdMs.every((value) => isFiniteNumber(value) && value >= 0)) {
    return {
      ok: false,
      error: {
        code: "INVALID_SAMPLE",
        message: "holdMs must contain only finite non-negative numbers.",
      },
    };
  }

  if (!normalized.ddMs.every((value) => isFiniteNumber(value))) {
    return {
      ok: false,
      error: {
        code: "INVALID_SAMPLE",
        message: "ddMs must contain only finite numbers.",
      },
    };
  }

  if (!normalized.udMs.every((value) => isFiniteNumber(value))) {
    return {
      ok: false,
      error: {
        code: "INVALID_SAMPLE",
        message: "udMs must contain only finite numbers.",
      },
    };
  }

  let clampedDd = 0;
  for (let index = 0; index < normalized.ddMs.length; index += 1) {
    if (normalized.ddMs[index] < 0) {
      normalized.ddMs[index] = 0;
      clampedDd += 1;
    }
  }

  let clampedUd = 0;
  for (let index = 0; index < normalized.udMs.length; index += 1) {
    if (normalized.udMs[index] < 0) {
      normalized.udMs[index] = 0;
      clampedUd += 1;
    }
  }

  const ddRatio = normalized.ddMs.length > 0 ? clampedDd / normalized.ddMs.length : 0;
  const udRatio = normalized.udMs.length > 0 ? clampedUd / normalized.udMs.length : 0;

  if (ddRatio > maxNegativeDdRatio || udRatio > maxNegativeUdRatio) {
    return {
      ok: false,
      error: {
        code: "INVALID_SAMPLE",
        message: "too many negative dd/ud transitions were clamped.",
        details: {
          clampedDd,
          ddLength: normalized.ddMs.length,
          ddRatio,
          clampedUd,
          udLength: normalized.udMs.length,
          udRatio,
        },
      },
    };
  }

  return {
    ok: true,
    sample: normalized,
  };
}
