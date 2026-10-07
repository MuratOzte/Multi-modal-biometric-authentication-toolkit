import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type LocalUser = {
  id: string;
  password: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LocalUserSummary = Omit<LocalUser, "password">;

type UserStorePayload = {
  users: LocalUser[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeUserId(userId: string): string {
  return userId.trim().toLowerCase();
}

function normalizePayload(value: unknown): UserStorePayload {
  if (!isRecord(value)) {
    return { users: [] };
  }

  const rawUsers = Array.isArray(value.users) ? value.users : [];
  const users: LocalUser[] = [];
  const seen = new Set<string>();

  for (const rawUser of rawUsers) {
    if (!isRecord(rawUser)) continue;
    if (typeof rawUser.id !== "string" || typeof rawUser.password !== "string") continue;

    const id = normalizeUserId(rawUser.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    users.push({
      id,
      password: rawUser.password,
      ...(typeof rawUser.createdAt === "string" ? { createdAt: rawUser.createdAt } : {}),
      ...(typeof rawUser.updatedAt === "string" ? { updatedAt: rawUser.updatedAt } : {}),
    });
  }

  return { users };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
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

export async function resolveDefaultUsersPath(): Promise<string> {
  const envPath = process.env.SECUREKIT_USERS_FILE?.trim();
  if (envPath) return path.resolve(envPath);

  const candidates = [
    path.resolve(process.cwd(), "users.json"),
    path.resolve(process.cwd(), "..", "..", "users.json"),
    path.resolve(__dirname, "..", "..", "..", "..", "users.json"),
  ];

  for (const candidate of Array.from(new Set(candidates))) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export class FileUserStore {
  private readonly filePathPromise: Promise<string>;

  constructor(args: { filePath?: string } = {}) {
    this.filePathPromise = args.filePath
      ? Promise.resolve(path.resolve(args.filePath))
      : resolveDefaultUsersPath();
  }

  async findUser(userId: string): Promise<LocalUser | null> {
    const normalizedUserId = normalizeUserId(userId);
    const payload = await this.readPayload();
    const found = payload.users.find((user) => user.id === normalizedUserId);
    return found ? { ...found } : null;
  }

  async listUsers(): Promise<LocalUserSummary[]> {
    const payload = await this.readPayload();
    return payload.users.map((user) => ({
      id: user.id,
      ...(typeof user.createdAt === "string" ? { createdAt: user.createdAt } : {}),
      ...(typeof user.updatedAt === "string" ? { updatedAt: user.updatedAt } : {}),
    }));
  }

  async createUser(userId: string, password: string, nowIso: string): Promise<LocalUser> {
    const normalizedUserId = normalizeUserId(userId);
    const payload = await this.readPayload();
    const user: LocalUser = {
      id: normalizedUserId,
      password,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    payload.users.push(user);
    payload.users.sort((left, right) => left.id.localeCompare(right.id));
    await this.writePayload(payload);
    return { ...user };
  }

  private async readPayload(): Promise<UserStorePayload> {
    const filePath = await this.filePathPromise;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizePayload(JSON.parse(raw));
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return { users: [] };
      }
      throw error;
    }
  }

  private async writePayload(payload: UserStorePayload): Promise<void> {
    const filePath = await this.filePathPromise;
    await atomicWriteJson(filePath, normalizePayload(payload));
  }
}
