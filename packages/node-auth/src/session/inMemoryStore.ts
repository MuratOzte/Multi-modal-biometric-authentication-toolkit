import type { SessionStore } from "./store";
import type { SessionLookupResult, SessionRecord } from "./types";

const DEFAULT_TTL_SECONDS = 15 * 60;

function resolveTtlMsFromEnv(): number {
  const raw = process.env.SESSION_TTL_SECONDS;
  if (!raw) return DEFAULT_TTL_SECONDS * 1000;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TTL_SECONDS * 1000;
  }

  return Math.round(parsed * 1000);
}

export interface InMemorySessionStoreOptions {
  ttlMs?: number;
  nowFn?: () => number;
}

export class InMemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionRecord>();
  private readonly nowFn: () => number;
  private readonly ttlMs: number;

  constructor(options: InMemorySessionStoreOptions = {}) {
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? resolveTtlMsFromEnv();
  }

  getNowMs(): number {
    return this.nowFn();
  }

  getTtlMs(): number {
    return this.ttlMs;
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    const record = this.records.get(sessionId);
    if (!record) return null;

    if (this.isExpired(record)) {
      this.records.delete(sessionId);
      return null;
    }

    return { ...record, signals: { ...record.signals } };
  }

  async set(record: SessionRecord): Promise<void> {
    this.records.set(record.sessionId, { ...record, signals: { ...record.signals } });
  }

  async update(sessionId: string, patchFn: (record: SessionRecord) => SessionRecord): Promise<SessionRecord | null> {
    const record = this.records.get(sessionId);
    if (!record) return null;

    if (this.isExpired(record)) {
      this.records.delete(sessionId);
      return null;
    }

    const next = patchFn({ ...record, signals: { ...record.signals } });
    this.records.set(sessionId, { ...next, signals: { ...next.signals } });
    return { ...next, signals: { ...next.signals } };
  }

  async delete(sessionId: string): Promise<void> {
    this.records.delete(sessionId);
  }

  async purgeExpired(nowMs = this.nowFn()): Promise<void> {
    for (const [sessionId, record] of this.records.entries()) {
      if (record.expiresAt <= nowMs) {
        this.records.delete(sessionId);
      }
    }
  }

  async lookup(sessionId: string): Promise<SessionLookupResult> {
    const record = this.records.get(sessionId);
    if (!record) {
      return { state: "missing" };
    }

    if (this.isExpired(record)) {
      this.records.delete(sessionId);
      return {
        state: "expired",
        record: { ...record, signals: { ...record.signals } },
      };
    }

    return {
      state: "active",
      record: { ...record, signals: { ...record.signals } },
    };
  }

  private isExpired(record: SessionRecord): boolean {
    return record.expiresAt <= this.nowFn();
  }
}
