import type { VerifyError as BaseVerifyError } from "./verify";

export type ChallengeLang = "tr" | "en";
export type ChallengeLength = "short" | "medium" | "long";

export type ChallengeTextRequest = {
  lang?: ChallengeLang;
  length?: ChallengeLength;
  wordCount?: number;
  sessionId?: string;
  text?: string;
};

export type ChallengeTextResponse = {
  challengeId: string;
  text: string;
  lang: ChallengeLang;
  expiresAt: string;
};

export type ConsumeChallengeRequest = {
  challengeId: string;
};

export type ConsumeChallengeResponse = {
  ok: true;
  challengeId: string;
};

export type VerifyError = BaseVerifyError;
