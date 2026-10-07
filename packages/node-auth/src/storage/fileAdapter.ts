import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ConsentLog,
  KeystrokeProfile,
  UserProfiles,
  VoiceEnrollmentProfile,
} from "@securekit/core";
import type { StorageAdapter } from "./adapter";
import type { StoredUserData } from "./types";

type FileStoragePayload = {
  records: Record<string, StoredUserData>;
};

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
      ? { keystroke: profiles.keystroke ? cloneKeystrokeProfile(profiles.keystroke) : null }
      : {}),
    ...(profiles.faceReferenceImagePath !== undefined
      ? { faceReferenceImagePath: profiles.faceReferenceImagePath ?? null }
      : {}),
    ...(profiles.faceReferenceEnrolledAt !== undefined
      ? { faceReferenceEnrolledAt: profiles.faceReferenceEnrolledAt ?? null }
      : {}),
    ...(profiles.faceEmbedding !== undefined
      ? { faceEmbedding: profiles.faceEmbedding ? [...profiles.faceEmbedding] : null }
      : {}),
    ...(profiles.cardReferenceImagePath !== undefined
      ? { cardReferenceImagePath: profiles.cardReferenceImagePath ?? null }
      : {}),
    ...(profiles.cardReferenceEnrolledAt !== undefined
      ? { cardReferenceEnrolledAt: profiles.cardReferenceEnrolledAt ?? null }
      : {}),
    ...(profiles.voice !== undefined
      ? { voice: profiles.voice ? cloneVoiceProfile(profiles.voice) : null }
      : {}),
    ...(profiles.voiceEmbedding !== undefined
      ? { voiceEmbedding: profiles.voiceEmbedding ? [...profiles.voiceEmbedding] : null }
      : {}),
  };
}

function cloneRecord(record: StoredUserData): StoredUserData {
  return {
    profiles: record.profiles ? cloneProfiles(record.profiles) : null,
    consentLogs: record.consentLogs.map(cloneConsentLog),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeStoredRecord(value: unknown): StoredUserData {
  if (!isRecord(value)) {
    return { profiles: null, consentLogs: [] };
  }

  const profiles = isRecord(value.profiles) ? (value.profiles as UserProfiles) : null;
  const consentLogs = Array.isArray(value.consentLogs)
    ? value.consentLogs.filter(isRecord).map((log) => log as ConsentLog)
    : [];

  return {
    profiles: profiles ? cloneProfiles(profiles) : null,
    consentLogs: consentLogs.map(cloneConsentLog),
  };
}

function normalizePayload(value: unknown): FileStoragePayload {
  if (!isRecord(value) || !isRecord(value.records)) {
    return { records: {} };
  }

  const records: Record<string, StoredUserData> = {};
  for (const [userId, record] of Object.entries(value.records)) {
    records[userId] = normalizeStoredRecord(record);
  }

  return { records };
}

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  try {
    await fs.rename(tmpFile, filePath);
  } catch (error) {
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function resolveDefaultProfileStorePath(): string {
  const envPath = process.env.SECUREKIT_PROFILE_STORE?.trim();
  if (envPath) return path.resolve(envPath);
  return path.resolve(process.cwd(), ".securekit", "user-profiles.json");
}

export class FileStorageAdapter implements StorageAdapter {
  private readonly filePath: string;

  constructor(args: { filePath?: string } = {}) {
    this.filePath = path.resolve(args.filePath ?? resolveDefaultProfileStorePath());
  }

  async appendConsentLog(log: ConsentLog): Promise<void> {
    const payload = await this.readPayload();
    const record = this.getOrCreate(payload, log.userId);
    record.consentLogs.push(cloneConsentLog(log));
    await this.writePayload(payload);
  }

  async getLatestConsent(userId: string): Promise<ConsentLog | null> {
    const logs = (await this.readPayload()).records[userId]?.consentLogs ?? [];
    if (logs.length === 0) return null;
    return cloneConsentLog(logs[logs.length - 1]);
  }

  async listConsentLogs(userId: string): Promise<ConsentLog[]> {
    const logs = (await this.readPayload()).records[userId]?.consentLogs ?? [];
    return logs.map(cloneConsentLog);
  }

  async getProfiles(userId: string): Promise<UserProfiles | null> {
    const profiles = (await this.readPayload()).records[userId]?.profiles ?? null;
    return profiles ? cloneProfiles(profiles) : null;
  }

  async saveProfiles(userId: string, profiles: UserProfiles): Promise<void> {
    const payload = await this.readPayload();
    const record = this.getOrCreate(payload, userId);
    record.profiles = cloneProfiles(profiles);
    await this.writePayload(payload);
  }

  async deleteProfiles(userId: string): Promise<void> {
    const payload = await this.readPayload();
    const record = payload.records[userId];
    if (!record) return;

    record.profiles = null;
    if (record.consentLogs.length === 0) {
      delete payload.records[userId];
    }

    await this.writePayload(payload);
  }

  async deleteConsentLogs(userId: string): Promise<void> {
    const payload = await this.readPayload();
    const record = payload.records[userId];
    if (!record) return;

    record.consentLogs = [];
    if (!record.profiles) {
      delete payload.records[userId];
    }

    await this.writePayload(payload);
  }

  private async readPayload(): Promise<FileStoragePayload> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return normalizePayload(JSON.parse(raw));
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return { records: {} };
      }
      throw error;
    }
  }

  private async writePayload(payload: FileStoragePayload): Promise<void> {
    const safePayload: FileStoragePayload = { records: {} };
    for (const [userId, record] of Object.entries(payload.records)) {
      safePayload.records[userId] = cloneRecord(record);
    }
    await atomicWriteJson(this.filePath, safePayload);
  }

  private getOrCreate(payload: FileStoragePayload, userId: string): StoredUserData {
    const existing = payload.records[userId];
    if (existing) return existing;

    const created: StoredUserData = { profiles: null, consentLogs: [] };
    payload.records[userId] = created;
    return created;
  }
}
