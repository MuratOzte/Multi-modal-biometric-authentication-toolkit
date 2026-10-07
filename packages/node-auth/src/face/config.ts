import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FACE_IMAGE_MIME_TYPES } from "./types";

const FACE_MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FACE_SAMPLE_REFERENCE_FILENAMES_BY_USER_ID: Record<string, string[]> = {
  emre: [
    "emre referans 16.05.2026.jpg",
    "emre y\u00fcz 1.jpg",
    "emre y\u00fcz 2.jpg",
    "emre y\u00fcz 3.jpg",
    "emre karanl\u0131k %20.jpg",
    "emre karanl\u0131k %50.jpg",
    "emre karanl\u0131k %80.jpg",
    "emre simsiyah.jpg",
    "emre simsiyah 2.jpg",
  ],
  murat: ["murat referans 18.05.2026.jpg", "murat y\u00fcz.jpeg", "murat y\u00fcz 2.jpg"],
  mert: ["mert y\u00fcz.jpg"],
};

function resolveSampleReferenceDir(): string {
  const candidates = Array.from(
    new Set([
      path.resolve(process.cwd(), "python", "face_verification", "images"),
      path.resolve(process.cwd(), "..", "..", "python", "face_verification", "images"),
      path.resolve(__dirname, "../../../../python/face_verification/images"),
    ])
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

export const FACE_ALLOWED_MIME_TYPES = new Set<string>(FACE_IMAGE_MIME_TYPES);
export const DEFAULT_FACE_MATCH_THRESHOLD = 0.8;
export const FACE_SAMPLE_REFERENCE_DIR = resolveSampleReferenceDir();
export const FACE_SAMPLE_REFERENCE_PATHS_BY_USER_ID = new Map<string, string[]>(
  Object.entries(FACE_SAMPLE_REFERENCE_FILENAMES_BY_USER_ID).map(([userId, fileNames]) => [
    userId,
    fileNames.map((fileName) => path.resolve(FACE_SAMPLE_REFERENCE_DIR, fileName)),
  ])
);

export function resolveDefaultReferenceDir(): string {
  return path.resolve(process.cwd(), ".securekit", "face-references");
}

export function sanitizeUserIdForFilename(userId: string): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return sanitized.length > 0 ? sanitized : "user";
}

export function mimeToExtension(mimeType: string): string {
  return FACE_MIME_TO_EXTENSION[mimeType] ?? ".img";
}

export function isSubPath(baseDir: string, candidatePath: string): boolean {
  const relative = path.relative(baseDir, candidatePath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
