import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Template } from "./types";

export interface FixedTextKeystrokeTemplateMetadata {
  userId: string;
  userIdHash: string;
  textId: string;
  expectedText: string;
  expectedTextHash: string;
  sampleCount: number;
  updatedAt: number;
}

export interface KeystrokeTemplateStore {
  getTemplate(userIdHash: string, textId: string): Promise<Template | null>;
  saveTemplate(userIdHash: string, textId: string, template: Template): Promise<void>;
  getTemplateMetadata(
    userIdHash: string,
    textId: string
  ): Promise<FixedTextKeystrokeTemplateMetadata | null>;
  saveTemplateMetadata(
    userIdHash: string,
    textId: string,
    metadata: FixedTextKeystrokeTemplateMetadata
  ): Promise<void>;
  appendSampleVector?(
    userIdHash: string,
    textId: string,
    vector: number[],
    timestamp: number
  ): Promise<void>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, "../../.data/keystroke");

function cloneTemplate(template: Template): Template {
  return {
    ...template,
    mean: [...template.mean],
    std: [...template.std],
  };
}

function cloneMetadata(
  metadata: FixedTextKeystrokeTemplateMetadata
): FixedTextKeystrokeTemplateMetadata {
  return { ...metadata };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTemplate(value: unknown): value is Template {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Template;

  return (
    typeof candidate.userIdHash === "string" &&
    typeof candidate.textId === "string" &&
    typeof candidate.expectedTextHash === "string" &&
    Number.isInteger(candidate.dim) &&
    Number.isInteger(candidate.count) &&
    Array.isArray(candidate.mean) &&
    candidate.mean.every(isFiniteNumber) &&
    Array.isArray(candidate.std) &&
    candidate.std.every(isFiniteNumber) &&
    isFiniteNumber(candidate.distThreshold) &&
    isFiniteNumber(candidate.scoreK) &&
    isFiniteNumber(candidate.autoEnrollScore) &&
    isFiniteNumber(candidate.scoreThreshold) &&
    isFiniteNumber(candidate.updatedAt)
  );
}

function isTemplateMetadata(value: unknown): value is FixedTextKeystrokeTemplateMetadata {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as FixedTextKeystrokeTemplateMetadata;

  return (
    typeof candidate.userId === "string" &&
    typeof candidate.userIdHash === "string" &&
    typeof candidate.textId === "string" &&
    typeof candidate.expectedText === "string" &&
    typeof candidate.expectedTextHash === "string" &&
    Number.isInteger(candidate.sampleCount) &&
    isFiniteNumber(candidate.updatedAt)
  );
}

function safeTextIdFileName(textId: string): string {
  return `${encodeURIComponent(textId)}.json`;
}

function safeTextIdMetadataFileName(textId: string): string {
  return `${encodeURIComponent(textId)}.metadata.json`;
}

function getTemplatePath(rootDir: string, userIdHash: string, textId: string): string {
  return path.join(rootDir, encodeURIComponent(userIdHash), safeTextIdFileName(textId));
}

function getMetadataPath(rootDir: string, userIdHash: string, textId: string): string {
  return path.join(rootDir, encodeURIComponent(userIdHash), safeTextIdMetadataFileName(textId));
}

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });

  const tmpFile = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const serialized = JSON.stringify(payload, null, 2);
  await fs.writeFile(tmpFile, serialized, "utf8");

  try {
    await fs.rename(tmpFile, filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EEXIST" || nodeError.code === "EPERM") {
      await fs.rm(filePath, { force: true });
      await fs.rename(tmpFile, filePath);
      return;
    }

    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class FileKeystrokeTemplateStore implements KeystrokeTemplateStore {
  private readonly rootDir: string;

  constructor(args: { rootDir?: string } = {}) {
    this.rootDir = args.rootDir ?? DEFAULT_ROOT;
  }

  async getTemplate(userIdHash: string, textId: string): Promise<Template | null> {
    const filePath = getTemplatePath(this.rootDir, userIdHash, textId);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isTemplate(parsed)) return null;
      return cloneTemplate(parsed);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") return null;
      throw error;
    }
  }

  async saveTemplate(userIdHash: string, textId: string, template: Template): Promise<void> {
    const filePath = getTemplatePath(this.rootDir, userIdHash, textId);
    await atomicWriteJson(filePath, template);
  }

  async getTemplateMetadata(
    userIdHash: string,
    textId: string
  ): Promise<FixedTextKeystrokeTemplateMetadata | null> {
    const filePath = getMetadataPath(this.rootDir, userIdHash, textId);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isTemplateMetadata(parsed)) return null;
      return cloneMetadata(parsed);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") return null;
      throw error;
    }
  }

  async saveTemplateMetadata(
    userIdHash: string,
    textId: string,
    metadata: FixedTextKeystrokeTemplateMetadata
  ): Promise<void> {
    const filePath = getMetadataPath(this.rootDir, userIdHash, textId);
    await atomicWriteJson(filePath, metadata);
  }
}

export class InMemoryKeystrokeTemplateStore implements KeystrokeTemplateStore {
  private readonly records = new Map<string, Template>();
  private readonly metadataRecords = new Map<string, FixedTextKeystrokeTemplateMetadata>();

  async getTemplate(userIdHash: string, textId: string): Promise<Template | null> {
    const found = this.records.get(`${userIdHash}:${textId}`);
    return found ? cloneTemplate(found) : null;
  }

  async saveTemplate(userIdHash: string, textId: string, template: Template): Promise<void> {
    this.records.set(`${userIdHash}:${textId}`, cloneTemplate(template));
  }

  async getTemplateMetadata(
    userIdHash: string,
    textId: string
  ): Promise<FixedTextKeystrokeTemplateMetadata | null> {
    const found = this.metadataRecords.get(`${userIdHash}:${textId}`);
    return found ? cloneMetadata(found) : null;
  }

  async saveTemplateMetadata(
    userIdHash: string,
    textId: string,
    metadata: FixedTextKeystrokeTemplateMetadata
  ): Promise<void> {
    this.metadataRecords.set(`${userIdHash}:${textId}`, cloneMetadata(metadata));
  }
}
