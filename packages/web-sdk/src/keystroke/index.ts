import type { KeystrokeEvent, KeystrokeSample } from "@securekit/core";

export interface KeystrokeCollectorOptions {
  expectedText?: string;
  includeBackspace?: boolean;
  includeEnter?: boolean;
  includeRawKey?: boolean;
}

export interface KeystrokeCollectorSnapshot {
  events: KeystrokeEvent[];
  typedLength: number;
  errorCount: number;
  backspaceCount: number;
  ignoredEventCount: number;
  imeCompositionUsed: boolean;
  collecting: boolean;
}

export interface BuildKeystrokeSampleOptions {
  challengeId?: string;
  typedLength?: number;
  errorCount?: number;
  backspaceCount?: number;
  ignoredEventCount?: number;
  imeCompositionUsed?: boolean;
  source?: KeystrokeSample["source"];
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock"]);

function isAllowedKey(
  key: string,
  includeBackspace: boolean,
  includeEnter: boolean
): boolean {
  if (MODIFIER_KEYS.has(key)) return false;
  if (key === "Backspace") return includeBackspace;
  if (key === "Enter") return includeEnter;
  return key.length === 1;
}

function toRelativeTime(now: number, start: number): number {
  return Math.round((now - start) * 1000) / 1000;
}

function eventToken(event: KeyboardEvent): string {
  return `${event.code}|${event.location}|${event.key}`;
}

function createEventRecord(args: {
  event: KeyboardEvent;
  type: "down" | "up";
  includeRawKey: boolean;
  t: number;
  expectedIndex?: number;
}): KeystrokeEvent {
  return {
    ...(args.includeRawKey ? { key: args.event.key } : {}),
    ...(args.event.code ? { code: args.event.code } : {}),
    type: args.type,
    t: args.t,
    isRepeat: args.event.repeat,
    location: args.event.location,
    ...(typeof args.expectedIndex === "number" ? { expectedIndex: args.expectedIndex } : {}),
  };
}

function getExpectedIndex(inputEl: HTMLInputElement | HTMLTextAreaElement, event: KeyboardEvent): number {
  if (event.key === "Backspace") {
    return Math.max(0, inputEl.value.length - 1);
  }
  return inputEl.value.length;
}

export function createKeystrokeCollector(
  inputEl: HTMLInputElement | HTMLTextAreaElement,
  options: KeystrokeCollectorOptions = {}
): {
  start: () => void;
  stop: () => void;
  reset: () => void;
  getEvents: () => KeystrokeEvent[];
  getSnapshot: () => KeystrokeCollectorSnapshot;
} {
  const includeBackspace = options.includeBackspace ?? true;
  const includeEnter = options.includeEnter ?? false;
  const includeRawKey = options.includeRawKey ?? false;

  let startTs = performance.now();
  let collecting = false;
  let isComposing = false;
  let imeCompositionUsed = false;
  let errorCount = 0;
  let backspaceCount = 0;
  let ignoredEventCount = 0;
  const events: KeystrokeEvent[] = [];
  const expectedIndexByToken = new Map<string, number>();

  const onCompositionStart = (): void => {
    isComposing = true;
    imeCompositionUsed = true;
  };

  const onCompositionEnd = (): void => {
    isComposing = false;
  };

  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    const keyEvent = event;

    if (!collecting) return;
    if (isComposing) {
      ignoredEventCount += 1;
      return;
    }
    if (keyEvent.repeat) {
      ignoredEventCount += 1;
      return;
    }
    if (!isAllowedKey(keyEvent.key, includeBackspace, includeEnter)) {
      ignoredEventCount += 1;
      return;
    }

    const expectedIndex = getExpectedIndex(inputEl, keyEvent);
    expectedIndexByToken.set(eventToken(keyEvent), expectedIndex);

    if (keyEvent.key === "Backspace") {
      backspaceCount += 1;
    }

    if (typeof options.expectedText === "string" && keyEvent.key.length === 1) {
      const expectedChar = options.expectedText[expectedIndex];
      if (expectedChar !== undefined && expectedChar !== keyEvent.key) {
        errorCount += 1;
      }
    }

    events.push(
      createEventRecord({
        event: keyEvent,
        type: "down",
        includeRawKey,
        t: toRelativeTime(performance.now(), startTs),
        expectedIndex,
      })
    );
  };

  const onKeyUp = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    const keyEvent = event;

    if (!collecting) return;
    if (isComposing) {
      ignoredEventCount += 1;
      return;
    }
    if (!isAllowedKey(keyEvent.key, includeBackspace, includeEnter)) {
      ignoredEventCount += 1;
      return;
    }

    const token = eventToken(keyEvent);
    const expectedIndex = expectedIndexByToken.get(token);
    expectedIndexByToken.delete(token);

    events.push(
      createEventRecord({
        event: keyEvent,
        type: "up",
        includeRawKey,
        t: toRelativeTime(performance.now(), startTs),
        expectedIndex,
      })
    );
  };

  const start = (): void => {
    if (collecting) return;
    collecting = true;
    startTs = performance.now();
    inputEl.addEventListener("compositionstart", onCompositionStart);
    inputEl.addEventListener("compositionend", onCompositionEnd);
    inputEl.addEventListener("keydown", onKeyDown);
    inputEl.addEventListener("keyup", onKeyUp);
  };

  const stop = (): void => {
    if (!collecting) return;
    collecting = false;
    inputEl.removeEventListener("compositionstart", onCompositionStart);
    inputEl.removeEventListener("compositionend", onCompositionEnd);
    inputEl.removeEventListener("keydown", onKeyDown);
    inputEl.removeEventListener("keyup", onKeyUp);
  };

  const reset = (): void => {
    events.length = 0;
    expectedIndexByToken.clear();
    imeCompositionUsed = false;
    isComposing = false;
    errorCount = 0;
    backspaceCount = 0;
    ignoredEventCount = 0;
    startTs = performance.now();
  };

  const getEvents = (): KeystrokeEvent[] => events.map((event) => ({ ...event }));

  const getSnapshot = (): KeystrokeCollectorSnapshot => ({
    events: getEvents(),
    typedLength: inputEl.value.length,
    errorCount,
    backspaceCount,
    ignoredEventCount,
    imeCompositionUsed,
    collecting,
  });

  return {
    start,
    stop,
    reset,
    getEvents,
    getSnapshot,
  };
}

export function buildKeystrokeSample(
  events: KeystrokeEvent[],
  expectedText: string,
  options: BuildKeystrokeSampleOptions = {}
): KeystrokeSample {
  return {
    events: events.map((event) => ({ ...event })),
    expectedText,
    ...(typeof options.challengeId === "string" && options.challengeId.trim().length > 0
      ? { challengeId: options.challengeId.trim() }
      : {}),
    ...(typeof options.typedLength === "number" && Number.isFinite(options.typedLength)
      ? { typedLength: Math.max(0, Math.round(options.typedLength)) }
      : {}),
    ...(typeof options.errorCount === "number" && Number.isFinite(options.errorCount)
      ? { errorCount: Math.max(0, Math.round(options.errorCount)) }
      : {}),
    ...(typeof options.backspaceCount === "number" && Number.isFinite(options.backspaceCount)
      ? { backspaceCount: Math.max(0, Math.round(options.backspaceCount)) }
      : {}),
    ...(typeof options.ignoredEventCount === "number" && Number.isFinite(options.ignoredEventCount)
      ? { ignoredEventCount: Math.max(0, Math.round(options.ignoredEventCount)) }
      : {}),
    ...(typeof options.imeCompositionUsed === "boolean"
      ? { imeCompositionUsed: options.imeCompositionUsed }
      : {}),
    source: options.source ?? "collector_v1",
  };
}
