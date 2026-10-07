export type FixedTextInvalidReason =
  | "invalid_expected_text"
  | "modifier_or_control_key"
  | "non_character_key"
  | "key_repeat"
  | "text_mismatch"
  | "extra_input"
  | "keyup_without_keydown"
  | "duplicate_keyup";

export interface FixedTextRecorderEvent {
  key: string;
  repeat?: boolean;
}

export interface FixedTextKeystrokeSampleMeta {
  timestamp: number;
  durationMs: number;
}

export type FixedTextCorrectionEventType = "mismatch" | "extra" | "backspace";

export interface FixedTextCorrectionEvent {
  type: FixedTextCorrectionEventType;
  t: number;
  index: number;
  key?: string;
  expected?: string;
  removed?: string;
}

export interface FixedTextCorrections {
  events: FixedTextCorrectionEvent[];
  mismatchCount: number;
  extraCount: number;
  backspaceCount: number;
}

export interface FixedTextKeystrokeSample {
  textId: string;
  text: string;
  holdMs: number[];
  ddMs: number[];
  udMs: number[];
  meta: FixedTextKeystrokeSampleMeta;
  corrections?: FixedTextCorrections;
}

export interface FixedTextKeystrokeRecorder {
  keydown: (event: FixedTextRecorderEvent) => void;
  keyup: (event: FixedTextRecorderEvent) => void;
  reset: () => void;
  isInvalid: () => boolean;
  getInvalidReason: () => FixedTextInvalidReason | null;
  isComplete: () => boolean;
  getSample: (textId: string) => FixedTextKeystrokeSample | null;
}

const CONTROL_OR_MODIFIER_KEYS = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "Insert",
  "Meta",
  "NumLock",
  "PageDown",
  "PageUp",
  "Pause",
  "PrintScreen",
  "ScrollLock",
  "Shift",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

type CorrectKeyRecord = {
  key: string;
  down: number;
  up?: number;
};

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isControlOrModifierKey(key: string): boolean {
  return CONTROL_OR_MODIFIER_KEYS.has(key);
}

function isCharacterKey(key: string): boolean {
  return key.length === 1;
}

function toRelativeMs(value: number, base: number): number {
  return roundMs(value - base);
}

export function createFixedTextKeystrokeRecorder(expectedText: string): FixedTextKeystrokeRecorder {
  const expectedChars = Array.from(expectedText);

  let invalidReason: FixedTextInvalidReason | null = null;
  let perfBaseAtReset = performance.now();
  let epochBaseAtReset = Date.now();
  const draftChars: string[] = [];
  const draftRecords: Array<CorrectKeyRecord | null> = [];
  const downRecordsByKey = new Map<string, CorrectKeyRecord[]>();
  const correctionEvents: FixedTextCorrectionEvent[] = [];
  let mismatchCount = 0;
  let extraCount = 0;
  let backspaceCount = 0;

  const markInvalid = (reason: FixedTextInvalidReason): void => {
    if (invalidReason !== null) return;
    invalidReason = reason;
  };

  const assertRecordableKey = (event: FixedTextRecorderEvent): boolean => {
    if (isControlOrModifierKey(event.key)) {
      markInvalid("modifier_or_control_key");
      return false;
    }

    if (!isCharacterKey(event.key)) {
      markInvalid("non_character_key");
      return false;
    }

    return true;
  };

  const recordCorrection = (
    event: Omit<FixedTextCorrectionEvent, "t">
  ): void => {
    correctionEvents.push({
      ...event,
      t: toRelativeMs(performance.now(), perfBaseAtReset),
    });
  };

  const keydownBackspace = (): void => {
    if (draftChars.length === 0) {
      return;
    }

    const removed = draftChars.pop();
    draftRecords.pop();
    backspaceCount += 1;
    recordCorrection({
      type: "backspace",
      index: draftChars.length,
      ...(removed !== undefined ? { removed } : {}),
    });
  };

  const keydown = (event: FixedTextRecorderEvent): void => {
    if (invalidReason) return;
    if (expectedChars.length === 0) {
      markInvalid("invalid_expected_text");
      return;
    }

    if (event.repeat) {
      markInvalid("key_repeat");
      return;
    }

    if (event.key === "Backspace") {
      keydownBackspace();
      return;
    }

    if (!assertRecordableKey(event)) {
      return;
    }

    const index = draftChars.length;
    draftChars.push(event.key);

    if (index >= expectedChars.length) {
      draftRecords.push(null);
      extraCount += 1;
      recordCorrection({
        type: "extra",
        index,
        key: event.key,
      });
      return;
    }

    const expectedChar = expectedChars[index];
    if (expectedChar !== event.key) {
      draftRecords.push(null);
      mismatchCount += 1;
      recordCorrection({
        type: "mismatch",
        index,
        key: event.key,
        expected: expectedChar,
      });
      return;
    }

    const now = performance.now();
    const record: CorrectKeyRecord = {
      key: event.key,
      down: now,
    };
    draftRecords.push(record);

    const queue = downRecordsByKey.get(event.key);
    if (queue) {
      queue.push(record);
    } else {
      downRecordsByKey.set(event.key, [record]);
    }
  };

  const keyup = (event: FixedTextRecorderEvent): void => {
    if (invalidReason) return;
    if (event.key === "Backspace") {
      return;
    }
    if (isControlOrModifierKey(event.key) || !isCharacterKey(event.key)) {
      return;
    }

    const queue = downRecordsByKey.get(event.key);
    if (!queue || queue.length === 0) {
      return;
    }

    const record = queue.shift();
    if (record === undefined) {
      return;
    }

    if (Number.isFinite(record.up)) {
      return;
    }

    record.up = performance.now();
  };

  const isComplete = (): boolean => {
    if (invalidReason) return false;
    if (draftChars.length !== expectedChars.length) return false;
    for (let index = 0; index < expectedChars.length; index += 1) {
      if (draftChars[index] !== expectedChars[index]) {
        return false;
      }

      const record = draftRecords[index];
      if (
        record === null ||
        record.key !== expectedChars[index] ||
        !Number.isFinite(record.down) ||
        !Number.isFinite(record.up)
      ) {
        return false;
      }
    }
    return true;
  };

  const reset = (): void => {
    invalidReason = null;
    perfBaseAtReset = performance.now();
    epochBaseAtReset = Date.now();
    draftChars.length = 0;
    draftRecords.length = 0;
    downRecordsByKey.clear();
    correctionEvents.length = 0;
    mismatchCount = 0;
    extraCount = 0;
    backspaceCount = 0;
  };

  const getSample = (textId: string): FixedTextKeystrokeSample | null => {
    if (!isComplete()) return null;

    const length = expectedChars.length;
    const holdMs: number[] = [];
    const ddMs: number[] = [];
    const udMs: number[] = [];
    const records = draftRecords as CorrectKeyRecord[];

    for (let index = 0; index < length; index += 1) {
      const down = records[index].down;
      const up = records[index].up as number;
      holdMs.push(roundMs(up - down));

      if (index > 0) {
        ddMs.push(roundMs(down - records[index - 1].down));
        udMs.push(roundMs(down - (records[index - 1].up as number)));
      }
    }

    const firstDown = records[0].down;
    const lastUp = records[length - 1].up as number;
    const timestamp = Math.round(epochBaseAtReset + (firstDown - perfBaseAtReset));

    return {
      textId,
      text: expectedText,
      holdMs,
      ddMs,
      udMs,
      meta: {
        timestamp,
        durationMs: roundMs(lastUp - firstDown),
      },
      ...(correctionEvents.length > 0
        ? {
            corrections: {
              events: correctionEvents.map((event) => ({ ...event })),
              mismatchCount,
              extraCount,
              backspaceCount,
            },
          }
        : {}),
    };
  };

  if (expectedChars.length === 0) {
    markInvalid("invalid_expected_text");
  }

  return {
    keydown,
    keyup,
    reset,
    isInvalid: () => invalidReason !== null,
    getInvalidReason: () => invalidReason,
    isComplete,
    getSample,
  };
}
