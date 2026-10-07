import type { ChallengeStore, ChallengeConsumeResult } from "./store";
import type { ChallengeRecord } from "./types";

function cloneRecord(record: ChallengeRecord): ChallengeRecord {
  return {
    ...record,
  };
}

export class InMemoryChallengeStore implements ChallengeStore {
  private readonly records = new Map<string, ChallengeRecord>();

  async create(record: ChallengeRecord): Promise<void> {
    this.records.set(record.id, cloneRecord(record));
  }

  async get(id: string): Promise<ChallengeRecord | null> {
    const record = this.records.get(id);
    if (!record) return null;
    return cloneRecord(record);
  }

  async consume(id: string, nowMs: number): Promise<ChallengeConsumeResult> {
    const record = this.records.get(id);
    if (!record) return null;

    if (typeof record.usedAtMs === "number") {
      return "USED";
    }

    if (nowMs > record.expiresAtMs) {
      this.records.delete(id);
      return "EXPIRED";
    }

    const updated: ChallengeRecord = {
      ...record,
      usedAtMs: nowMs,
    };

    this.records.set(id, updated);
    return cloneRecord(updated);
  }

  async purgeExpired(nowMs: number): Promise<void> {
    for (const [challengeId, record] of this.records.entries()) {
      if (nowMs > record.expiresAtMs) {
        this.records.delete(challengeId);
      }
    }
  }
}
