import type { ChallengeLang } from "@securekit/core";

export type ChallengeRecord = {
  id: string;
  text: string;
  lang: ChallengeLang;
  createdAtMs: number;
  expiresAtMs: number;
  usedAtMs?: number;
  sessionId?: string;
};
