import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_IMAGE_MIME_TYPES } from "./types";

const CARD_MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const CARD_IMAGE_EXTENSIONS = new Set<string>([".jpg", ".jpeg", ".png", ".webp"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveSampleReferenceDir(): string {
  const candidates = Array.from(
    new Set([
      path.resolve(process.cwd(), "python", "card_verification", "images"),
      path.resolve(process.cwd(), "..", "..", "python", "card_verification", "images"),
      path.resolve(__dirname, "../../../../python/card_verification/images"),
    ])
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export const CARD_ALLOWED_MIME_TYPES = new Set<string>(CARD_IMAGE_MIME_TYPES);
export const CARD_ALLOWED_EXTENSIONS = CARD_IMAGE_EXTENSIONS;
export const DEFAULT_CARD_MATCH_THRESHOLD = 0.7;
export const CARD_SAMPLE_REFERENCE_DIR = resolveSampleReferenceDir();

export function resolveDefaultReferenceDir(): string {
  return CARD_SAMPLE_REFERENCE_DIR;
}

export function resolveDefaultUserReferenceDir(): string {
  return path.resolve(process.cwd(), ".securekit", "card-references");
}

export function mimeToExtension(mimeType: string): string {
  return CARD_MIME_TO_EXTENSION[mimeType] ?? ".img";
}

export function isCardReferenceFile(fileName: string): boolean {
  return CARD_ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function humanizeReferenceLabel(fileName: string): string {
  const baseName = path.basename(fileName, path.extname(fileName));
  return baseName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
