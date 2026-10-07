import type {
  EnrollKeystrokeRequest,
  KeystrokeEvent,
  KeystrokeSample,
  VerifyKeystrokeRequest,
} from "@securekit/core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredStringField(
  source: Record<string, unknown>,
  field: string,
  fieldErrors: Record<string, string>
): string {
  const value = source[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    fieldErrors[field] = `${field} is required.`;
    return "";
  }

  return value.trim();
}

function parseKeystrokeEvent(
  input: unknown,
  index: number,
  fieldErrors: Record<string, string>,
  prefix = "events"
): KeystrokeEvent | null {
  if (!isRecord(input)) {
    fieldErrors[`${prefix}[${index}]`] = "Each event must be an object.";
    return null;
  }

  const key = input.key;
  if (key !== undefined && (typeof key !== "string" || key.length === 0)) {
    fieldErrors[`${prefix}[${index}].key`] = "key must be a non-empty string when provided.";
  }

  const code = input.code;
  if (code !== undefined && (typeof code !== "string" || code.trim().length === 0)) {
    fieldErrors[`${prefix}[${index}].code`] = "code must be a non-empty string when provided.";
  }

  const type = input.type;
  const validType = type === "down" || type === "up";
  if (!validType) {
    fieldErrors[`${prefix}[${index}].type`] = "type must be 'down' or 'up'.";
  }

  const t = input.t;
  const validTime = typeof t === "number" && Number.isFinite(t);
  if (!validTime) {
    fieldErrors[`${prefix}[${index}].t`] = "t must be a finite number.";
  }

  const isRepeat = input.isRepeat;
  if (isRepeat !== undefined && typeof isRepeat !== "boolean") {
    fieldErrors[`${prefix}[${index}].isRepeat`] = "isRepeat must be a boolean when provided.";
  }

  const location = input.location;
  if (location !== undefined && !(typeof location === "number" && Number.isFinite(location))) {
    fieldErrors[`${prefix}[${index}].location`] = "location must be a finite number when provided.";
  }

  const expectedIndex = input.expectedIndex;
  if (
    expectedIndex !== undefined &&
    !(typeof expectedIndex === "number" && Number.isFinite(expectedIndex) && Number.isInteger(expectedIndex))
  ) {
    fieldErrors[`${prefix}[${index}].expectedIndex`] =
      "expectedIndex must be an integer when provided.";
  }

  if (!validType || !validTime) {
    return null;
  }

  return {
    ...(typeof key === "string" && key.length > 0 ? { key } : {}),
    ...(typeof code === "string" && code.trim().length > 0 ? { code: code.trim() } : {}),
    type: type as KeystrokeEvent["type"],
    t: t as number,
    ...(typeof isRepeat === "boolean" ? { isRepeat } : {}),
    ...(typeof location === "number" && Number.isFinite(location) ? { location } : {}),
    ...((typeof expectedIndex === "number" &&
      Number.isFinite(expectedIndex) &&
      Number.isInteger(expectedIndex))
      ? { expectedIndex }
      : {}),
  };
}

export function parseEnrollKeystrokeRequest(body: unknown): {
  request: EnrollKeystrokeRequest | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isRecord(body)) {
    fieldErrors.body = "Request body must be an object.";
    return { request: null, fieldErrors };
  }

  const userId = readRequiredStringField(body, "userId", fieldErrors);

  const parseEvents = (value: unknown, fieldPath: string): KeystrokeEvent[] | null => {
    if (!Array.isArray(value) || value.length === 0) {
      fieldErrors[fieldPath] = `${fieldPath} must be a non-empty array.`;
      return null;
    }

    const parsedEvents: KeystrokeEvent[] = [];
    value.forEach((event, index) => {
      const parsed = parseKeystrokeEvent(event, index, fieldErrors, fieldPath);
      if (parsed) parsedEvents.push(parsed);
    });

    return parsedEvents;
  };

  let sample: KeystrokeSample | undefined;
  if (body.sample !== undefined) {
    if (!isRecord(body.sample)) {
      fieldErrors.sample = "sample must be an object when provided.";
    } else {
      const sampleEvents = parseEvents(body.sample.events, "sample.events");
      if (sampleEvents) {
        sample = { events: sampleEvents };

        if (typeof body.sample.expectedText === "string") sample.expectedText = body.sample.expectedText;
        if (typeof body.sample.challengeId === "string" && body.sample.challengeId.trim().length > 0) {
          sample.challengeId = body.sample.challengeId.trim();
        }
        if (body.sample.source === "legacy" || body.sample.source === "collector_v1") {
          sample.source = body.sample.source;
        }
        if (typeof body.sample.typedLength === "number" && Number.isFinite(body.sample.typedLength)) {
          sample.typedLength = body.sample.typedLength;
        }
        if (typeof body.sample.errorCount === "number" && Number.isFinite(body.sample.errorCount)) {
          sample.errorCount = body.sample.errorCount;
        }
        if (typeof body.sample.backspaceCount === "number" && Number.isFinite(body.sample.backspaceCount)) {
          sample.backspaceCount = body.sample.backspaceCount;
        }
        if (
          typeof body.sample.ignoredEventCount === "number" &&
          Number.isFinite(body.sample.ignoredEventCount)
        ) {
          sample.ignoredEventCount = body.sample.ignoredEventCount;
        }
        if (typeof body.sample.imeCompositionUsed === "boolean") {
          sample.imeCompositionUsed = body.sample.imeCompositionUsed;
        }
      }
    }
  }

  const events = sample?.events ?? parseEvents(body.events, "events") ?? [];

  let challengeId: string | undefined;
  if (body.challengeId !== undefined) {
    if (typeof body.challengeId !== "string" || body.challengeId.trim().length === 0) {
      fieldErrors.challengeId = "challengeId must be a non-empty string when provided.";
    } else {
      challengeId = body.challengeId.trim();
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { request: null, fieldErrors };
  }

  return {
    request: {
      userId,
      challengeId,
      events: sample ? undefined : events,
      ...(sample ? { sample } : {}),
      ...(typeof body.expectedText === "string" ? { expectedText: body.expectedText } : {}),
      ...(typeof body.typedLength === "number" && Number.isFinite(body.typedLength)
        ? { typedLength: body.typedLength }
        : {}),
      ...(typeof body.errorCount === "number" && Number.isFinite(body.errorCount)
        ? { errorCount: body.errorCount }
        : {}),
      ...(typeof body.backspaceCount === "number" && Number.isFinite(body.backspaceCount)
        ? { backspaceCount: body.backspaceCount }
        : {}),
      ...(typeof body.imeCompositionUsed === "boolean"
        ? { imeCompositionUsed: body.imeCompositionUsed }
        : {}),
    },
    fieldErrors,
  };
}

export function parseVerifyKeystrokeRequest(body: unknown): {
  request: VerifyKeystrokeRequest | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isRecord(body)) {
    fieldErrors.body = "Request body must be an object.";
    return { request: null, fieldErrors };
  }

  const userId = readRequiredStringField(body, "userId", fieldErrors);

  if (!isRecord(body.sample)) {
    fieldErrors.sample = "sample is required and must be an object.";
    return { request: null, fieldErrors };
  }

  const sampleEvents: KeystrokeEvent[] = [];
  if (!Array.isArray(body.sample.events) || body.sample.events.length === 0) {
    fieldErrors["sample.events"] = "sample.events must be a non-empty array.";
  } else {
    body.sample.events.forEach((event, index) => {
      const parsed = parseKeystrokeEvent(event, index, fieldErrors, "sample.events");
      if (parsed) sampleEvents.push(parsed);
    });
  }

  let challengeId: string | undefined;
  if (body.challengeId !== undefined) {
    if (typeof body.challengeId !== "string" || body.challengeId.trim().length === 0) {
      fieldErrors.challengeId = "challengeId must be a non-empty string when provided.";
    } else {
      challengeId = body.challengeId.trim();
    }
  }

  let sampleChallengeId: string | undefined;
  if (body.sample.challengeId !== undefined) {
    if (
      typeof body.sample.challengeId !== "string" ||
      body.sample.challengeId.trim().length === 0
    ) {
      fieldErrors["sample.challengeId"] =
        "sample.challengeId must be a non-empty string when provided.";
    } else {
      sampleChallengeId = body.sample.challengeId.trim();
    }
  }

  if (challengeId && sampleChallengeId && challengeId !== sampleChallengeId) {
    fieldErrors["sample.challengeId"] =
      "sample.challengeId must match challengeId when both are provided.";
  }

  const resolvedChallengeId = challengeId ?? sampleChallengeId;
  if (!resolvedChallengeId) {
    fieldErrors.challengeId = "challengeId is required for verification.";
  }

  const expectedText =
    typeof body.sample.expectedText === "string" ? body.sample.expectedText : undefined;
  if (expectedText === undefined || expectedText.length === 0) {
    fieldErrors["sample.expectedText"] = "sample.expectedText is required for verification.";
  }

  let policy: VerifyKeystrokeRequest["policy"] | undefined;
  if (body.policy !== undefined) {
    if (!isRecord(body.policy)) {
      fieldErrors.policy = "policy must be an object when provided.";
    } else {
      policy = body.policy as VerifyKeystrokeRequest["policy"];
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { request: null, fieldErrors };
  }

  const sample: KeystrokeSample = {
    events: sampleEvents,
    expectedText: expectedText as string,
    challengeId: resolvedChallengeId as string,
    ...(typeof body.sample.typedLength === "number" && Number.isFinite(body.sample.typedLength)
      ? { typedLength: body.sample.typedLength }
      : {}),
    ...(typeof body.sample.errorCount === "number" && Number.isFinite(body.sample.errorCount)
      ? { errorCount: body.sample.errorCount }
      : {}),
    ...(typeof body.sample.backspaceCount === "number" && Number.isFinite(body.sample.backspaceCount)
      ? { backspaceCount: body.sample.backspaceCount }
      : {}),
    ...(typeof body.sample.ignoredEventCount === "number" &&
    Number.isFinite(body.sample.ignoredEventCount)
      ? { ignoredEventCount: body.sample.ignoredEventCount }
      : {}),
    ...(typeof body.sample.imeCompositionUsed === "boolean"
      ? { imeCompositionUsed: body.sample.imeCompositionUsed }
      : {}),
    ...(typeof body.sample.source === "string" &&
    (body.sample.source === "legacy" || body.sample.source === "collector_v1")
      ? { source: body.sample.source }
      : {}),
  };

  return {
    request: {
      userId,
      ...(typeof body.sessionId === "string" && body.sessionId.trim().length > 0
        ? { sessionId: body.sessionId.trim() }
        : {}),
      challengeId: resolvedChallengeId as string,
      sample,
      ...(policy ? { policy } : {}),
    },
    fieldErrors,
  };
}
