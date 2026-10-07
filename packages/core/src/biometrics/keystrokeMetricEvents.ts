import type { KeystrokeEvent, KeystrokeSample } from "../contracts/enrollment";
import { clamp, isFiniteNumber, toRounded } from "./keystrokeMath";

type KeyPair = {
  down: number;
  up: number;
};

export type KeystrokeDurations = {
  hold: number[];
  dd: number[];
  ud: number[];
  uu: number[];
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock"]);
const LONG_PAUSE_THRESHOLD_MS = 700;
const CORRECTION_BURST_GAP_MS = 350;

function isAllowedKey(key: string | undefined): boolean {
  if (!key) return true;
  if (key.length === 1) return true;
  if (key === "Backspace" || key === "Enter") return true;
  return !MODIFIER_KEYS.has(key);
}

function normalizeEvent(event: KeystrokeEvent): KeystrokeEvent | null {
  if (event.type !== "down" && event.type !== "up") return null;
  if (!isFiniteNumber(event.t)) return null;
  if (event.t < 0) return null;
  if (event.isRepeat) return null;
  if (!isAllowedKey(event.key)) return null;

  return {
    key: event.key,
    code: event.code,
    type: event.type,
    t: event.t,
    isRepeat: event.isRepeat,
    location: event.location,
    expectedIndex: event.expectedIndex,
  };
}

export function normalizeEvents(events: KeystrokeEvent[]): KeystrokeEvent[] {
  return events
    .map((event) => normalizeEvent(event))
    .filter((event): event is KeystrokeEvent => Boolean(event))
    .sort((left, right) => {
      if (left.t === right.t) {
        if (left.type === right.type) return 0;
        return left.type === "down" ? -1 : 1;
      }
      return left.t - right.t;
    });
}

function isSpaceEvent(event: KeystrokeEvent): boolean {
  return event.key === " " || event.code === "Space";
}

function isBackspaceEvent(event: KeystrokeEvent): boolean {
  return event.key === "Backspace" || event.code === "Backspace";
}

function isTextDownEvent(event: KeystrokeEvent): boolean {
  if (event.type !== "down") return false;
  if (isBackspaceEvent(event) || isSpaceEvent(event)) return false;
  if (event.key === "Enter" || event.code === "Enter") return false;
  if (typeof event.key === "string") {
    return event.key.length === 1;
  }
  return true;
}

export function resolveStartDelayMs(events: KeystrokeEvent[]): number {
  const firstTextDown = events.find((event) => isTextDownEvent(event));
  if (firstTextDown) return toRounded(Math.max(0, firstTextDown.t));

  const firstDown = events.find((event) => event.type === "down");
  if (firstDown) return toRounded(Math.max(0, firstDown.t));
  return 0;
}

export function resolveInterWordPauseDurations(events: KeystrokeEvent[]): number[] {
  const pauses: number[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type !== "up" || !isSpaceEvent(event)) continue;

    for (let lookahead = index + 1; lookahead < events.length; lookahead += 1) {
      const next = events[lookahead];
      if (!isTextDownEvent(next)) continue;
      if (next.t >= event.t) {
        pauses.push(next.t - event.t);
      }
      break;
    }
  }

  return pauses.filter((value) => isFiniteNumber(value) && value >= 0);
}

export function resolveLongPauseRate(events: KeystrokeEvent[]): number {
  const textDowns = events.filter((event) => isTextDownEvent(event));
  if (textDowns.length < 2) return 0;

  let longPauseCount = 0;
  for (let index = 1; index < textDowns.length; index += 1) {
    const gap = textDowns[index].t - textDowns[index - 1].t;
    if (gap > LONG_PAUSE_THRESHOLD_MS) {
      longPauseCount += 1;
    }
  }

  return toRounded(longPauseCount / (textDowns.length - 1));
}

export function resolveCorrectionBurstRate(events: KeystrokeEvent[], typedLength: number): number {
  const backspaceDowns = events
    .filter((event) => event.type === "down" && isBackspaceEvent(event))
    .map((event) => event.t)
    .filter((value) => isFiniteNumber(value) && value >= 0);

  if (backspaceDowns.length === 0) return 0;

  let burstCount = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const ts of backspaceDowns) {
    if (ts - previous > CORRECTION_BURST_GAP_MS) {
      burstCount += 1;
    }
    previous = ts;
  }

  if (typedLength <= 0) return toRounded(burstCount);
  return toRounded(clamp(burstCount / typedLength, 0, 1));
}

function eventToken(event: KeystrokeEvent, index: number): string {
  const codePart = event.code && event.code.length > 0 ? event.code : "code:none";
  const keyPart = event.key && event.key.length > 0 ? event.key : "key:none";
  const indexPart =
    isFiniteNumber(event.expectedIndex) && Number.isInteger(event.expectedIndex)
      ? `idx:${event.expectedIndex}`
      : `idx:auto:${index}`;
  const locationPart = isFiniteNumber(event.location) ? `loc:${event.location}` : "loc:none";
  return `${codePart}|${keyPart}|${indexPart}|${locationPart}`;
}

export function buildPairs(events: KeystrokeEvent[]): KeyPair[] {
  const sortedEvents = normalizeEvents(events);

  const downByToken = new Map<string, number[]>();
  const pairs: KeyPair[] = [];

  sortedEvents.forEach((event, index) => {
    const token = eventToken(event, index);
    if (event.type === "down") {
      const queue = downByToken.get(token) ?? [];
      queue.push(event.t);
      downByToken.set(token, queue);
      return;
    }

    const queue = downByToken.get(token);
    const downTs = queue?.shift();
    if (!isFiniteNumber(downTs)) return;
    if (event.t < downTs) return;

    pairs.push({
      down: downTs,
      up: event.t,
    });
  });

  return pairs.sort((left, right) => left.down - right.down);
}

export function deriveDurations(pairs: KeyPair[]): KeystrokeDurations {
  const hold = pairs.map((pair) => pair.up - pair.down).filter((value) => value >= 0);
  const dd: number[] = [];
  const ud: number[] = [];

  for (let index = 1; index < pairs.length; index += 1) {
    const current = pairs[index];
    const previous = pairs[index - 1];
    const ddValue = current.down - previous.down;
    if (ddValue >= 0) dd.push(ddValue);

    const udValue = current.down - previous.up;
    if (udValue >= 0) ud.push(udValue);
  }

  const pairsByUp = [...pairs].sort((left, right) => left.up - right.up);
  const uu: number[] = [];
  for (let index = 1; index < pairsByUp.length; index += 1) {
    const value = pairsByUp[index].up - pairsByUp[index - 1].up;
    if (value >= 0) uu.push(value);
  }

  return { hold, dd, ud, uu };
}

export function resolveTypedLength(sample: KeystrokeSample, fallback: number): number {
  if (isFiniteNumber(sample.typedLength) && sample.typedLength > 0) {
    return Math.round(sample.typedLength);
  }

  if (typeof sample.expectedText === "string" && sample.expectedText.length > 0) {
    return sample.expectedText.length;
  }

  return fallback;
}

export function resolveDurationMs(events: KeystrokeEvent[]): number {
  const normalized = normalizeEvents(events);

  if (normalized.length < 2) return 0;
  const start = normalized[0].t;
  const end = normalized[normalized.length - 1].t;
  if (end <= start) return 0;
  return toRounded(end - start);
}
