import type { ChallengeRecord } from "./types";

export type ChallengeConsumeResult = ChallengeRecord | null | "USED" | "EXPIRED";

export interface ChallengeStore {
  create(record: ChallengeRecord): Promise<void>;
  get(id: string): Promise<ChallengeRecord | null>;
  consume(id: string, nowMs: number): Promise<ChallengeConsumeResult>;
  purgeExpired?(nowMs: number): Promise<void>;
}
