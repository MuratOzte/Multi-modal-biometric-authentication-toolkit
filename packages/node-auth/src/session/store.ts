import type { SessionLookupResult, SessionRecord } from "./types";

export type SessionPatchFn = (record: SessionRecord) => SessionRecord;

export interface SessionStore {
  get(sessionId: string): Promise<SessionRecord | null>;
  set(record: SessionRecord): Promise<void>;
  update(sessionId: string, patchFn: SessionPatchFn): Promise<SessionRecord | null>;
  delete(sessionId: string): Promise<void>;
  purgeExpired(nowMs?: number): Promise<void>;
  lookup?(sessionId: string): Promise<SessionLookupResult>;
  getNowMs?(): number;
  getTtlMs?(): number;
}
