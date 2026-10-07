import type {
  ConsentLog,
  KeystrokeProfile,
  UserProfiles,
  VoiceEnrollmentProfile,
} from "@securekit/core";
import type { StorageAdapter } from "./adapter";
import type { StoredUserData } from "./types";

function cloneConsentLog(log: ConsentLog): ConsentLog {
  return {
    userId: log.userId,
    consentVersion: log.consentVersion,
    grantedAt: log.grantedAt,
    ...(log.ip !== undefined ? { ip: log.ip } : {}),
    ...(log.userAgent !== undefined ? { userAgent: log.userAgent } : {}),
  };
}

function cloneKeystrokeProfile(profile: KeystrokeProfile): KeystrokeProfile {
  return { ...profile };
}

function cloneVoiceProfile(profile: VoiceEnrollmentProfile): VoiceEnrollmentProfile {
  return {
    ...profile,
    embedding: [...profile.embedding],
  };
}

function cloneProfiles(profiles: UserProfiles): UserProfiles {
  return {
    userId: profiles.userId,
    updatedAt: profiles.updatedAt,
    ...(profiles.keystroke !== undefined
      ? {
          keystroke: profiles.keystroke ? cloneKeystrokeProfile(profiles.keystroke) : null,
        }
      : {}),
    ...(profiles.faceReferenceImagePath !== undefined
      ? {
          faceReferenceImagePath: profiles.faceReferenceImagePath ?? null,
        }
      : {}),
    ...(profiles.faceReferenceEnrolledAt !== undefined
      ? {
          faceReferenceEnrolledAt: profiles.faceReferenceEnrolledAt ?? null,
        }
      : {}),
    ...(profiles.faceEmbedding !== undefined
      ? {
          faceEmbedding: profiles.faceEmbedding ? [...profiles.faceEmbedding] : null,
        }
      : {}),
    ...(profiles.cardReferenceImagePath !== undefined
      ? {
          cardReferenceImagePath: profiles.cardReferenceImagePath ?? null,
        }
      : {}),
    ...(profiles.cardReferenceEnrolledAt !== undefined
      ? {
          cardReferenceEnrolledAt: profiles.cardReferenceEnrolledAt ?? null,
        }
      : {}),
    ...(profiles.voice !== undefined
      ? {
          voice: profiles.voice ? cloneVoiceProfile(profiles.voice) : null,
        }
      : {}),
    ...(profiles.voiceEmbedding !== undefined
      ? {
          voiceEmbedding: profiles.voiceEmbedding ? [...profiles.voiceEmbedding] : null,
        }
      : {}),
  };
}

export class InMemoryAdapter implements StorageAdapter {
  private readonly records = new Map<string, StoredUserData>();

  async appendConsentLog(log: ConsentLog): Promise<void> {
    const record = this.getOrCreate(log.userId);
    record.consentLogs.push(cloneConsentLog(log));
  }

  async getLatestConsent(userId: string): Promise<ConsentLog | null> {
    const logs = this.records.get(userId)?.consentLogs ?? [];
    if (logs.length === 0) return null;
    return cloneConsentLog(logs[logs.length - 1]);
  }

  async listConsentLogs(userId: string): Promise<ConsentLog[]> {
    const logs = this.records.get(userId)?.consentLogs ?? [];
    return logs.map(cloneConsentLog);
  }

  async getProfiles(userId: string): Promise<UserProfiles | null> {
    const profiles = this.records.get(userId)?.profiles ?? null;
    if (!profiles) return null;
    return cloneProfiles(profiles);
  }

  async saveProfiles(userId: string, profiles: UserProfiles): Promise<void> {
    const record = this.getOrCreate(userId);
    record.profiles = cloneProfiles(profiles);
  }

  async deleteProfiles(userId: string): Promise<void> {
    const record = this.records.get(userId);
    if (!record) return;

    record.profiles = null;
    if (record.consentLogs.length === 0) {
      this.records.delete(userId);
    }
  }

  async deleteConsentLogs(userId: string): Promise<void> {
    const record = this.records.get(userId);
    if (!record) return;

    record.consentLogs = [];
    if (!record.profiles) {
      this.records.delete(userId);
    }
  }

  private getOrCreate(userId: string): StoredUserData {
    const existing = this.records.get(userId);
    if (existing) return existing;

    const created: StoredUserData = {
      profiles: null,
      consentLogs: [],
    };
    this.records.set(userId, created);
    return created;
  }
}
