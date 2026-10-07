import type { ChallengeLang, ChallengeLength } from "@securekit/core";

const EN_WORDS = [
  "silver",
  "garden",
  "puzzle",
  "window",
  "planet",
  "signal",
  "forest",
  "camera",
  "bridge",
  "winter",
  "market",
  "rocket",
  "stream",
  "thunder",
  "velvet",
  "ticket",
  "memory",
  "travel",
  "shadow",
  "motion",
  "breeze",
  "stable",
  "anchor",
  "fluent",
  "candle",
  "voyage",
  "harbor",
  "mirror",
  "pocket",
  "rescue",
  "copper",
  "meadow",
];

const TR_SENTENCE_WORDS = [
  "sabah",
  "serin",
  "r\u00fczgar",
  "yumu\u015fak",
  "\u0131\u015f\u0131k",
  "sessiz",
  "yol",
  "ince",
  "ya\u011fmur",
  "uzak",
  "\u015fehir",
  "sakin",
  "orman",
  "k\u0131y\u0131",
  "g\u00f6lge",
  "umut",
  "denge",
  "k\u0131r",
  "iz",
  "s\u00f6z",
  "ad\u0131m",
  "g\u00fcne\u015f",
  "ak\u015fam",
  "duru",
  "nehir",
  "bulut",
  "kumsal",
  "kap\u0131",
  "pencere",
  "toprak",
  "y\u0131ld\u0131z",
  "yank\u0131",
];

const TR_SENTENCE_MIN_LETTERS = 40;
const TR_SENTENCE_MAX_LETTERS = 50;

const LENGTH_RANGE: Record<ChallengeLength, [number, number]> = {
  short: [5, 7],
  medium: [10, 12],
  long: [16, 20],
};

export type Rng = () => number;
const MAX_WORD_COUNT = 64;

function toRandomUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 0.999999999;
  return value;
}

function pickIndex(maxExclusive: number, rng: Rng): number {
  return Math.floor(toRandomUnit(rng()) * maxExclusive);
}

function pickCount(length: ChallengeLength, rng: Rng): number {
  const [min, max] = LENGTH_RANGE[length];
  return min + pickIndex(max - min + 1, rng);
}

function normalizeWordCount(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.round(value);
  if (normalized < 1 || normalized > MAX_WORD_COUNT) return undefined;
  return normalized;
}

function countLetters(text: string): number {
  return Array.from(text).filter((char) => /\p{L}/u.test(char)).length;
}

function capitalizeFirst(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function generateTurkishSentence(rng: Rng): string {
  const parts: string[] = [];

  while (true) {
    const current = parts.join(" ").trim();
    const currentLetters = countLetters(current);
    if (
      currentLetters >= TR_SENTENCE_MIN_LETTERS &&
      currentLetters <= TR_SENTENCE_MAX_LETTERS
    ) {
      break;
    }

    const allowed = TR_SENTENCE_WORDS.filter((word) => {
      const next = current.length > 0 ? `${current} ${word}` : word;
      return countLetters(next) <= TR_SENTENCE_MAX_LETTERS;
    });

    if (allowed.length === 0) {
      break;
    }

    parts.push(allowed[pickIndex(allowed.length, rng)]);
  }

  let sentence = parts.join(" ").trim();
  if (!sentence) {
    sentence = "Sakin r\u00fczgar sessiz k\u0131y\u0131da usulca iz b\u0131rak\u0131r";
  }

  sentence = capitalizeFirst(sentence);
  return `${sentence}.`;
}

export function generateChallengeText(opts: {
  lang: ChallengeLang;
  length: ChallengeLength;
  rng: Rng;
  wordCount?: number;
}): string {
  if (opts.lang === "tr") {
    return generateTurkishSentence(opts.rng);
  }

  const words = EN_WORDS;
  const count = normalizeWordCount(opts.wordCount) ?? pickCount(opts.length, opts.rng);
  const parts: string[] = [];

  for (let i = 0; i < count; i += 1) {
    parts.push(words[pickIndex(words.length, opts.rng)]);
  }

  return parts.join(" ").trim();
}
