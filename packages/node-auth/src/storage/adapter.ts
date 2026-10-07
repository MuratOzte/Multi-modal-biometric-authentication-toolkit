import type { ConsentLog, UserProfiles } from "@securekit/core";

export interface StorageAdapter {
  appendConsentLog(log: ConsentLog): Promise<void>;
  getLatestConsent(userId: string): Promise<ConsentLog | null>;
  listConsentLogs(userId: string): Promise<ConsentLog[]>;
  getProfiles(userId: string): Promise<UserProfiles | null>;
  saveProfiles(userId: string, profiles: UserProfiles): Promise<void>;
  deleteProfiles(userId: string): Promise<void>;
  deleteConsentLogs?(userId: string): Promise<void>;
}
