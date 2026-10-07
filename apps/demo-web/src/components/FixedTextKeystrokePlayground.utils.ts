import { HttpError, type FixedTextInvalidReason } from "@securekit/web-sdk";
import { formatSecureKitError } from "../lib/secureKitClient.js";

export type BusyState = "idle" | "loading";

export type CaptureStatus = {
  complete: boolean;
  invalidReason: FixedTextInvalidReason | null;
};

export type FixedTextEnrollResponse = {
  ok: true;
  enrolled: true;
  template: {
    count: number;
    dim: number;
  };
  recommended: {
    distThreshold: number;
    scoreThreshold: number;
    autoEnrollScore: number;
  };
};

export type FixedTextVerifyResponse = {
  ok: true;
  decision: "accept" | "reject";
  score: number;
  dist: number;
  autoEnrolled: boolean;
  reason?: string;
  metrics: {
    count: number;
    thresholdDist: number;
    thresholdScore: number;
    autoEnrollScore: number;
  };
};

export type ResetCaptureOptions = {
  preserveSpaceKeyupSkip?: boolean;
  focus?: boolean;
};

export type AddEnrollmentSampleOptions = {
  preserveSpaceKeyupSkip?: boolean;
};

export const MIN_EXPECTED_WORD_COUNT = 3;
export const MIN_EXPECTED_LENGTH = 15;
export const MAX_EXPECTED_LENGTH = 30;
export const DEFAULT_EXPECTED_TEXT = "securekit typing shield";
export const TYPING_DNA_BARS = [0.44, 0.3, 0.52, 0.22, 0.66, 0.38, 0.58];

export type TypingPreviewTokenState = "typed" | "active" | "pending" | "mismatch" | "extra";

export type TypingPreviewToken = {
  key: string;
  char: string;
  state: TypingPreviewTokenState;
};

export function focusTypingInputSoon(ref: React.RefObject<HTMLInputElement | null>): void {
  const focus = () => ref.current?.focus();
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(focus);
    return;
  }
  setTimeout(focus, 0);
}

export function parseIntInRange(
  value: string,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function countWords(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((word) => word.length > 0).length;
}

export function getExpectedTextValidationMessage(
  expectedWordCount: number,
  expectedLength: number
): string | null {
  if (expectedWordCount < MIN_EXPECTED_WORD_COUNT) {
    return `Klavye kismina en az ${MIN_EXPECTED_WORD_COUNT} kelime yazilmasi gerekiyor.`;
  }

  if (expectedLength < MIN_EXPECTED_LENGTH || expectedLength > MAX_EXPECTED_LENGTH) {
    return `Klavye metni ${MIN_EXPECTED_LENGTH}-${MAX_EXPECTED_LENGTH} karakter arasinda olmali.`;
  }

  return null;
}

export function invalidReasonMessage(reason: FixedTextInvalidReason | null): string | null {
  if (reason === null) return null;

  switch (reason) {
    case "invalid_expected_text":
      return "Klavye metni gecersiz. Bos olmayan sabit bir metin kullan.";
    case "modifier_or_control_key":
      return "Bu turda sadece metindeki karakterleri ve sondan duzeltmek icin Backspace kullan.";
    case "non_character_key":
      return "Sadece metindeki karakterleri yaz.";
    case "key_repeat":
      return "Tekrar eden tus basimi algilandi. Metni normal tus vuruslariyla tekrar yaz.";
    case "text_mismatch":
      return "Yazilan karakter kayit metniyle eslesmedi.";
    case "extra_input":
      return "Metin bittikten sonra fazla karakter algilandi.";
    case "keyup_without_keydown":
      return "Tus sirasi gecersiz algilandi. Turu yeniden dene.";
    case "duplicate_keyup":
      return "Ayni tus birakma olayi iki kez algilandi. Turu yeniden dene.";
    default:
      return "Gecersiz klavye ornegi.";
  }
}

export function invalidAutoRestartMessage(reason: FixedTextInvalidReason): string {
  const detail = invalidReasonMessage(reason) ?? "Gecersiz klavye ornegi.";
  return `${detail} Cumleyi bastan yaz.`;
}

export function buildTypingPreviewTokens(
  expectedText: string,
  typedText: string
): TypingPreviewToken[] {
  const expectedChars = Array.from(expectedText);
  const typedChars = Array.from(typedText);
  const tokenCount = Math.max(expectedChars.length, typedChars.length);
  const tokens: TypingPreviewToken[] = [];

  for (let index = 0; index < tokenCount; index += 1) {
    const expectedChar = expectedChars[index];
    const typedChar = typedChars[index];
    let state: TypingPreviewTokenState = "pending";

    if (typedChar !== undefined && expectedChar === undefined) {
      state = "extra";
    } else if (typedChar !== undefined && typedChar !== expectedChar) {
      state = "mismatch";
    } else if (typedChar !== undefined) {
      state = "typed";
    } else if (index === typedChars.length) {
      state = "active";
    }

    tokens.push({
      key: `${index}:${typedChar ?? expectedChar ?? ""}`,
      char: typedChar ?? expectedChar ?? "",
      state,
    });
  }

  return tokens;
}

export function hasTypingPreviewError(tokens: TypingPreviewToken[]): boolean {
  return tokens.some((token) => token.state === "mismatch" || token.state === "extra");
}

export function fixedDecisionClass(decision: FixedTextVerifyResponse["decision"] | null): string {
  if (decision === "accept") return "sk-decision sk-decision-allow";
  if (decision === "reject") return "sk-decision sk-decision-deny";
  return "sk-decision";
}

export function formatFixedTextError(error: unknown, baseUrl: string): string {
  if (error instanceof HttpError) {
    const body = error.body as { error?: { code?: unknown; message?: unknown } } | undefined;
    const serverCode = typeof body?.error?.code === "string" ? body.error.code : null;
    const serverMessage =
      typeof body?.error?.message === "string" && body.error.message.trim().length > 0
        ? body.error.message
        : null;

    if (
      serverCode === "TEXT_MISMATCH" ||
      serverMessage === "expectedText hash does not match the enrolled template."
    ) {
      return "Kayitli klavye metni ile dogrulama metni uyusmuyor. Kayitli metinle tekrar dogrula veya Yeni kayit baslat ile bu metni yeniden kaydet.";
    }

    return `Request failed (HTTP ${error.status}) at ${baseUrl}${serverMessage ? `: ${serverMessage}` : "."}`;
  }

  return formatSecureKitError(error, baseUrl);
}
