import React, { useEffect, useState } from "react";
import type { VerifyKeystrokeResponse } from "@securekit/web-sdk";

export type SectionBusy = "idle" | "loading";

export type ChallengeProgress = {
  matchPrefix: number;
  mismatchCount: number;
  mismatchIndex: number | null;
  accuracy: number;
  progress: number;
  complete: boolean;
};

export const FIXED_CHALLENGE_SENTENCE =
  "Murat su iÃ§mek iÃ§in mutfaÄŸa gitti ama gÃ¶rdÃ¼kleri karÅŸÄ±sÄ±nda ÅŸok oldu.";

export function usePersistentState<T>(
  key: string,
  initialValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return initialValue;
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore persistence errors
    }
  }, [key, value]);

  return [value, setValue];
}

export function parseNumber(
  value: string,
  fallback: number,
  min = 0,
  max = Number.POSITIVE_INFINITY
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function toPercent(value: number): string {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

export function decisionClass(
  decision: VerifyKeystrokeResponse["decision"] | null | undefined
): string {
  if (decision === "allow") return "sk-decision sk-decision-allow";
  if (decision === "step_up") return "sk-decision sk-decision-stepup";
  if (decision === "deny") return "sk-decision sk-decision-deny";
  return "sk-decision";
}

function normalizeChallengeText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/Ä±/g, "i")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isChallengeMatch(expectedText: string, typedText: string): boolean {
  const normalizedExpected = normalizeChallengeText(expectedText);
  if (!normalizedExpected) return false;
  return normalizeChallengeText(typedText) === normalizedExpected;
}

export function computeChallengeProgress(
  expectedText: string,
  typedText: string
): ChallengeProgress {
  const normalizedExpected = normalizeChallengeText(expectedText);
  const normalizedTyped = normalizeChallengeText(typedText);

  if (!normalizedExpected) {
    return {
      matchPrefix: 0,
      mismatchCount: normalizedTyped.length,
      mismatchIndex: normalizedTyped.length > 0 ? 0 : null,
      accuracy: normalizedTyped.length > 0 ? 0 : 1,
      progress: 0,
      complete: false,
    };
  }

  let matchPrefix = 0;
  const sharedLength = Math.min(normalizedExpected.length, normalizedTyped.length);

  while (
    matchPrefix < sharedLength &&
    normalizedExpected[matchPrefix] === normalizedTyped[matchPrefix]
  ) {
    matchPrefix += 1;
  }

  let mismatchCount = 0;
  let mismatchIndex: number | null = null;

  for (let index = 0; index < sharedLength; index += 1) {
    if (normalizedExpected[index] !== normalizedTyped[index]) {
      mismatchCount += 1;
      if (mismatchIndex === null) mismatchIndex = index;
    }
  }

  if (normalizedTyped.length > normalizedExpected.length) {
    mismatchCount += normalizedTyped.length - normalizedExpected.length;
    if (mismatchIndex === null) mismatchIndex = normalizedExpected.length;
  }

  const complete = normalizedTyped === normalizedExpected;
  const progress = normalizedExpected.length > 0 ? matchPrefix / normalizedExpected.length : 0;
  const accuracy =
    normalizedTyped.length > 0
      ? clamp((normalizedTyped.length - mismatchCount) / normalizedTyped.length, 0, 1)
      : 1;

  return {
    matchPrefix,
    mismatchCount,
    mismatchIndex,
    accuracy,
    progress,
    complete,
  };
}

export function renderChallengePreview(
  expectedText: string,
  typedText: string
): React.ReactNode {
  const chars = Array.from(expectedText);

  const content = chars.map((char, index) => {
    let className = "sk-char";

    if (index < typedText.length) {
      className = typedText[index] === char ? "sk-char sk-char-ok" : "sk-char sk-char-bad";
    } else if (index === typedText.length) {
      className = "sk-char sk-char-next";
    }

    return (
      <span className={className} key={`${index}:${char}`}>
        {char === " " ? "\u00A0" : char}
      </span>
    );
  });

  if (typedText.length > expectedText.length) {
    const extra = typedText.slice(expectedText.length);
    content.push(
      <span className="sk-char sk-char-extra" key="overflow">
        {extra}
      </span>
    );
  }

  return content;
}
