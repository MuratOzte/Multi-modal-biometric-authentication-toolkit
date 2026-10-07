import type {
  EnrollReq,
  KeystrokeCorrectionEvent,
  KeystrokeCorrections,
  KeystrokeSample,
  VerifyReq,
} from "../../keystroke/types";
import { isFiniteNumber, isRecord } from "./common";

const MAX_CORRECTION_EVENTS = 200;
const CORRECTION_EVENT_TYPES = new Set(["mismatch", "extra", "backspace"]);

function readRequiredString(
  source: Record<string, unknown>,
  key: string,
  errors: Record<string, string>
): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors[key] = `${key} is required and must be a non-empty string.`;
    return "";
  }

  return value.trim();
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function parseCorrectionCount(
  value: unknown,
  path: string,
  errors: Record<string, string>
): number {
  if (!isNonNegativeInteger(value)) {
    errors[path] = `${path} must be a non-negative integer.`;
    return 0;
  }

  return value;
}

function parseOptionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: Record<string, string>
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    errors[path] = `${path} must be a string when provided.`;
    return undefined;
  }

  return value;
}

function parseCorrectionEvent(
  value: unknown,
  fieldPrefix: string,
  errors: Record<string, string>
): KeystrokeCorrectionEvent | null {
  if (!isRecord(value)) {
    errors[fieldPrefix] = `${fieldPrefix} must be an object.`;
    return null;
  }

  const type = typeof value.type === "string" ? value.type : "";
  if (!CORRECTION_EVENT_TYPES.has(type)) {
    errors[`${fieldPrefix}.type`] = "type must be mismatch, extra, or backspace.";
  }

  if (!isFiniteNumber(value.t) || value.t < 0) {
    errors[`${fieldPrefix}.t`] = "t must be a finite non-negative number.";
  }

  if (!isNonNegativeInteger(value.index)) {
    errors[`${fieldPrefix}.index`] = "index must be a non-negative integer.";
  }

  const key = parseOptionalString(value, "key", `${fieldPrefix}.key`, errors);
  const expected = parseOptionalString(value, "expected", `${fieldPrefix}.expected`, errors);
  const removed = parseOptionalString(value, "removed", `${fieldPrefix}.removed`, errors);

  if (type === "mismatch") {
    if (key === undefined) errors[`${fieldPrefix}.key`] = "key is required for mismatch.";
    if (expected === undefined) {
      errors[`${fieldPrefix}.expected`] = "expected is required for mismatch.";
    }
  }
  if (type === "extra" && key === undefined) {
    errors[`${fieldPrefix}.key`] = "key is required for extra.";
  }
  if (type === "backspace" && removed === undefined) {
    errors[`${fieldPrefix}.removed`] = "removed is required for backspace.";
  }

  if (Object.keys(errors).length > 0) return null;

  return {
    type: type as KeystrokeCorrectionEvent["type"],
    t: value.t as number,
    index: value.index as number,
    ...(key !== undefined ? { key } : {}),
    ...(expected !== undefined ? { expected } : {}),
    ...(removed !== undefined ? { removed } : {}),
  };
}

function parseCorrections(
  value: unknown,
  fieldPrefix: string,
  errors: Record<string, string>
): KeystrokeCorrections | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors[fieldPrefix] = `${fieldPrefix} must be an object when provided.`;
    return undefined;
  }

  if (!Array.isArray(value.events)) {
    errors[`${fieldPrefix}.events`] = "events must be an array.";
    return undefined;
  }
  if (value.events.length > MAX_CORRECTION_EVENTS) {
    errors[`${fieldPrefix}.events`] = `events must contain at most ${MAX_CORRECTION_EVENTS} items.`;
    return undefined;
  }

  const mismatchCount = parseCorrectionCount(
    value.mismatchCount,
    `${fieldPrefix}.mismatchCount`,
    errors
  );
  const extraCount = parseCorrectionCount(value.extraCount, `${fieldPrefix}.extraCount`, errors);
  const backspaceCount = parseCorrectionCount(
    value.backspaceCount,
    `${fieldPrefix}.backspaceCount`,
    errors
  );
  const events: KeystrokeCorrectionEvent[] = [];

  value.events.forEach((event, index) => {
    const parsed = parseCorrectionEvent(event, `${fieldPrefix}.events[${index}]`, errors);
    if (parsed) events.push(parsed);
  });

  if (Object.keys(errors).length > 0) return undefined;

  return {
    events,
    mismatchCount,
    extraCount,
    backspaceCount,
  };
}

function parseSample(
  value: unknown,
  fieldPrefix: string,
  errors: Record<string, string>
): KeystrokeSample | null {
  if (!isRecord(value)) {
    errors[fieldPrefix] = `${fieldPrefix} must be an object.`;
    return null;
  }

  const textId = typeof value.textId === "string" ? value.textId.trim() : "";
  const text = typeof value.text === "string" ? value.text : "";
  if (!textId) {
    errors[`${fieldPrefix}.textId`] = "textId is required.";
  }
  if (!text) {
    errors[`${fieldPrefix}.text`] = "text is required.";
  }

  const readNumberArray = (input: unknown, path: string): number[] => {
    if (!Array.isArray(input)) {
      errors[path] = `${path} must be an array of numbers.`;
      return [];
    }

    const values: number[] = [];
    input.forEach((candidate, index) => {
      if (!isFiniteNumber(candidate)) {
        errors[`${path}[${index}]`] = "must be a finite number.";
      } else {
        values.push(candidate);
      }
    });
    return values;
  };

  const holdMs = readNumberArray(value.holdMs, `${fieldPrefix}.holdMs`);
  const ddMs = readNumberArray(value.ddMs, `${fieldPrefix}.ddMs`);
  const udMs = readNumberArray(value.udMs, `${fieldPrefix}.udMs`);
  const corrections = parseCorrections(value.corrections, `${fieldPrefix}.corrections`, errors);

  if (!isRecord(value.meta)) {
    errors[`${fieldPrefix}.meta`] = "meta is required and must be an object.";
    return null;
  }

  if (!isFiniteNumber(value.meta.timestamp)) {
    errors[`${fieldPrefix}.meta.timestamp`] = "timestamp must be a finite number.";
  }
  if (!isFiniteNumber(value.meta.durationMs)) {
    errors[`${fieldPrefix}.meta.durationMs`] = "durationMs must be a finite number.";
  }
  if (value.meta.invalid !== undefined && typeof value.meta.invalid !== "boolean") {
    errors[`${fieldPrefix}.meta.invalid`] = "invalid must be boolean when provided.";
  }
  if (
    value.meta.invalidReason !== undefined &&
    typeof value.meta.invalidReason !== "string"
  ) {
    errors[`${fieldPrefix}.meta.invalidReason`] = "invalidReason must be string when provided.";
  }

  if (Object.keys(errors).length > 0) return null;

  return {
    textId,
    text,
    holdMs,
    ddMs,
    udMs,
    meta: {
      timestamp: value.meta.timestamp as number,
      durationMs: value.meta.durationMs as number,
      ...(typeof value.meta.invalid === "boolean" ? { invalid: value.meta.invalid } : {}),
      ...(typeof value.meta.invalidReason === "string"
        ? { invalidReason: value.meta.invalidReason }
        : {}),
    },
    ...(corrections ? { corrections } : {}),
  };
}

export function parseEnrollRequest(body: unknown): {
  request: EnrollReq | null;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (!isRecord(body)) {
    errors.body = "request body must be an object.";
    return { request: null, errors };
  }

  const userId = readRequiredString(body, "userId", errors);
  const textId = readRequiredString(body, "textId", errors);
  const expectedText = readRequiredString(body, "expectedText", errors);

  if (!Array.isArray(body.samples) || body.samples.length === 0) {
    errors.samples = "samples must be a non-empty array.";
    return { request: null, errors };
  }

  const samples: KeystrokeSample[] = [];
  body.samples.forEach((sample, index) => {
    const parsed = parseSample(sample, `samples[${index}]`, errors);
    if (parsed) samples.push(parsed);
  });

  if (Object.keys(errors).length > 0) {
    return { request: null, errors };
  }

  return {
    request: {
      userId,
      textId,
      expectedText,
      samples,
    },
    errors,
  };
}

export function parseVerifyRequest(body: unknown): {
  request: VerifyReq | null;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (!isRecord(body)) {
    errors.body = "request body must be an object.";
    return { request: null, errors };
  }

  const userId = readRequiredString(body, "userId", errors);
  const textId = readRequiredString(body, "textId", errors);

  const sample = parseSample(body.sample, "sample", errors);
  const expectedText =
    typeof body.expectedText === "string" && body.expectedText.length > 0
      ? body.expectedText
      : undefined;

  let autoEnroll: boolean | undefined;
  if (body.opts !== undefined) {
    if (!isRecord(body.opts)) {
      errors.opts = "opts must be an object when provided.";
    } else if (body.opts.autoEnroll !== undefined && typeof body.opts.autoEnroll !== "boolean") {
      errors["opts.autoEnroll"] = "autoEnroll must be boolean when provided.";
    } else if (typeof body.opts.autoEnroll === "boolean") {
      autoEnroll = body.opts.autoEnroll;
    }
  }

  if (Object.keys(errors).length > 0 || !sample) {
    return { request: null, errors };
  }

  return {
    request: {
      userId,
      textId,
      sample,
      ...(expectedText ? { expectedText } : {}),
      ...(autoEnroll !== undefined ? { opts: { autoEnroll } } : {}),
    },
    errors,
  };
}
