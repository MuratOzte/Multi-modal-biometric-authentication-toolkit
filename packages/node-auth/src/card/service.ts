import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CardPythonBridgeError,
  runCardPython,
  type RunCardPythonOptions,
} from "./pythonBridge";
import {
  DEFAULT_CARD_MATCH_THRESHOLD,
  humanizeReferenceLabel,
  isCardReferenceFile,
  mimeToExtension,
  resolveDefaultReferenceDir,
  resolveDefaultUserReferenceDir,
} from "./config";
import type { StorageAdapter } from "../storage/adapter";
import { assertValidUpload, resolveMaxUploadBytes, resolveThreshold } from "./uploads";
import {
  type CardEnrollmentInput,
  CardServiceError,
  type CardPythonRunner,
  type CardReferenceSummary,
  type CardReferencesResponse,
  type CardUploadFile,
  type CardVerificationResult,
  type CardVerifyInput,
} from "./types";

export interface CardVerificationServiceOptions {
  storage?: StorageAdapter;
  nowFnIso?: () => string;
  referenceDir?: string;
  userReferenceDir?: string;
  maxUploadBytes?: number;
  defaultThreshold?: number;
  pythonRunner?: CardPythonRunner;
  pythonOptions?: RunCardPythonOptions;
}

export class CardVerificationService {
  private readonly storage?: StorageAdapter;
  private readonly nowFnIso: () => string;
  private readonly referenceDir: string;
  private readonly userReferenceDir: string;
  private readonly maxUploadBytes: number;
  private readonly defaultThreshold: number;
  private readonly pythonRunner: CardPythonRunner;
  private readonly pythonOptions?: RunCardPythonOptions;

  constructor(options: CardVerificationServiceOptions = {}) {
    this.storage = options.storage;
    this.nowFnIso = options.nowFnIso ?? (() => new Date().toISOString());
    this.referenceDir = path.resolve(options.referenceDir ?? resolveDefaultReferenceDir());
    this.userReferenceDir = path.resolve(
      options.userReferenceDir ?? resolveDefaultUserReferenceDir()
    );
    this.maxUploadBytes = resolveMaxUploadBytes(options.maxUploadBytes);
    this.defaultThreshold = options.defaultThreshold ?? DEFAULT_CARD_MATCH_THRESHOLD;
    this.pythonRunner = options.pythonRunner ?? runCardPython;
    this.pythonOptions = options.pythonOptions;
  }

  async listReferences(): Promise<CardReferencesResponse> {
    const references = await this.readReferenceFiles();
    return {
      ok: true,
      referenceDir: this.referenceDir,
      references,
    };
  }

  async enrollReference(input: CardEnrollmentInput): Promise<{
    ok: true;
    userId: string;
    reference: { imagePath: string; enrolledAt: string; source: "upload" };
  }> {
    if (!this.storage) {
      throw new CardServiceError(
        "INTERNAL_ERROR",
        "Storage is required for card enrollment.",
        500
      );
    }

    const userId = input.userId.trim().toLowerCase();
    if (!userId) {
      throw new CardServiceError("INVALID_REQUEST", "userId is required.", 400);
    }

    assertValidUpload(input.referenceImage, "referenceImage", this.maxUploadBytes);
    await fs.mkdir(this.userReferenceDir, { recursive: true });

    const fileName = `${sanitizeUserIdForFilename(userId)}-${Date.now()}-${randomUUID()}${mimeToExtension(
      input.referenceImage.mimeType
    )}`;
    const nextReferencePath = path.join(this.userReferenceDir, fileName);

    await fs.writeFile(nextReferencePath, input.referenceImage.buffer, { flag: "wx" });
    const nowIso = this.nowFnIso();

    try {
      const existingProfiles = await this.storage.getProfiles(userId);
      const previousReferencePath = existingProfiles?.cardReferenceImagePath ?? null;
      await this.storage.saveProfiles(userId, {
        userId,
        keystroke: existingProfiles?.keystroke ?? null,
        faceReferenceImagePath: existingProfiles?.faceReferenceImagePath ?? null,
        faceReferenceEnrolledAt: existingProfiles?.faceReferenceEnrolledAt ?? null,
        faceEmbedding: existingProfiles?.faceEmbedding ?? null,
        cardReferenceImagePath: nextReferencePath,
        cardReferenceEnrolledAt: nowIso,
        voice: existingProfiles?.voice ?? null,
        voiceEmbedding: existingProfiles?.voiceEmbedding ?? null,
        updatedAt: nowIso,
      });

      if (
        previousReferencePath &&
        previousReferencePath !== nextReferencePath &&
        this.isManagedUserReferencePath(previousReferencePath)
      ) {
        await fs.rm(previousReferencePath, { force: true });
      }

      return {
        ok: true,
        userId,
        reference: {
          imagePath: nextReferencePath,
          enrolledAt: nowIso,
          source: "upload",
        },
      };
    } catch (error) {
      await fs.rm(nextReferencePath, { force: true });
      throw new CardServiceError(
        "INTERNAL_ERROR",
        "Failed to persist enrolled card reference.",
        500,
        error instanceof Error ? error.message : error
      );
    }
  }

  async verify(input: CardVerifyInput): Promise<CardVerificationResult> {
    assertValidUpload(input.probeImage, "probeImage", this.maxUploadBytes);

    const selectedReferences = input.userId
      ? [await this.resolveUserReference(input.userId)]
      : this.resolveSelectedReferences(await this.readReferenceFiles(), input.referenceId);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "securekit-card-"));

    try {
      const probeImagePath = await this.writeTempImage(tempDir, "probe", input.probeImage);
      const threshold = resolveThreshold(this.defaultThreshold, input.threshold);
      const referenceDir =
        input.referenceId == null && !input.userId
          ? this.referenceDir
          : await this.writeReferenceSubset(tempDir, selectedReferences);
      const result = await this.pythonRunner(
        {
          probeImagePath,
          referenceDir,
          threshold,
        },
        this.pythonOptions
      );

      if (result.checkedCount === 0) {
        throw new CardServiceError(
          "REFERENCE_NOT_FOUND",
          input.referenceId == null
            ? `No usable card references found in ${this.referenceDir}.`
            : `Selected card reference (${input.referenceId}) could not be processed from ${this.referenceDir}.`,
          404
        );
      }

      return result;
    } catch (error) {
      if (error instanceof CardServiceError) {
        throw error;
      }

      if (error instanceof CardPythonBridgeError) {
        throw this.mapPythonBridgeError(error);
      }

      throw new CardServiceError(
        "INTERNAL_ERROR",
        "Card verification failed unexpectedly.",
        500
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async readReferenceFiles(): Promise<CardReferenceSummary[]> {
    await fs.mkdir(this.referenceDir, { recursive: true });
    const entries = await fs.readdir(this.referenceDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && isCardReferenceFile(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const fileName = entry.name;
        return {
          id: fileName,
          fileName,
          label: humanizeReferenceLabel(fileName),
          imagePath: path.join(this.referenceDir, fileName),
        };
      });
  }

  private async writeTempImage(
    tempDir: string,
    prefix: string,
    file: CardUploadFile
  ): Promise<string> {
    const filePath = path.join(tempDir, `${prefix}-${randomUUID()}${mimeToExtension(file.mimeType)}`);
    await fs.writeFile(filePath, file.buffer, { flag: "wx" });
    return filePath;
  }

  private resolveSelectedReferences(
    references: CardReferenceSummary[],
    referenceId?: string
  ): CardReferenceSummary[] {
    if (references.length === 0) {
      throw new CardServiceError(
        "REFERENCE_NOT_FOUND",
        `No registered card references found in ${this.referenceDir}.`,
        404
      );
    }

    if (referenceId == null) {
      return references;
    }

    const selected = references.filter(
      (reference) => reference.id === referenceId || reference.fileName === referenceId
    );

    if (selected.length === 0) {
      throw new CardServiceError(
        "REFERENCE_NOT_FOUND",
        `Selected card reference (${referenceId}) was not found in ${this.referenceDir}.`,
        404
      );
    }

    return selected;
  }

  private async writeReferenceSubset(
    tempDir: string,
    references: CardReferenceSummary[]
  ): Promise<string> {
    const subsetDir = path.join(tempDir, "references");
    await fs.mkdir(subsetDir, { recursive: true });

    await Promise.all(
      references.map((reference) =>
        fs.copyFile(reference.imagePath, path.join(subsetDir, reference.fileName))
      )
    );

    return subsetDir;
  }

  private async resolveUserReference(userIdInput: string): Promise<CardReferenceSummary> {
    if (!this.storage) {
      throw new CardServiceError(
        "INTERNAL_ERROR",
        "Storage is required for user card verification.",
        500
      );
    }

    const userId = userIdInput.trim().toLowerCase();
    if (!userId) {
      throw new CardServiceError("INVALID_REQUEST", "userId is required.", 400);
    }

    const profiles = await this.storage.getProfiles(userId);
    const imagePath = profiles?.cardReferenceImagePath ?? null;
    if (!imagePath) {
      throw new CardServiceError("REFERENCE_NOT_FOUND", "No enrolled card reference found for user.", 404);
    }

    const resolved = path.resolve(imagePath);
    await this.assertFileExists(resolved, "Stored card reference was not found.");
    const fileName = path.basename(resolved);

    return {
      id: fileName,
      fileName,
      label: humanizeReferenceLabel(fileName),
      imagePath: resolved,
    };
  }

  private async assertFileExists(filePath: string, message: string): Promise<void> {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) return;
    } catch {
      // mapped below
    }

    throw new CardServiceError("REFERENCE_NOT_FOUND", message, 404);
  }

  private isManagedUserReferencePath(candidatePath: string): boolean {
    const normalizedRoot = path.resolve(this.userReferenceDir);
    const normalizedCandidate = path.resolve(candidatePath);
    const relative = path.relative(normalizedRoot, normalizedCandidate);
    return (
      normalizedCandidate === normalizedRoot ||
      (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }

  private mapPythonBridgeError(error: CardPythonBridgeError): CardServiceError {
    if (error.code === "PYTHON_SPAWN_FAILED") {
      return new CardServiceError(
        "PYTHON_RUNTIME_UNAVAILABLE",
        "Python runtime is not available for card verification.",
        503
      );
    }

    if (error.code === "PYTHON_TIMEOUT") {
      return new CardServiceError("PYTHON_TIMEOUT", "Card verification process timed out.", 504);
    }

    if (error.code === "PYTHON_DEPENDENCY_MISSING") {
      return new CardServiceError(
        "PYTHON_PROCESS_ERROR",
        error.message,
        502,
        error.details
      );
    }

    if (error.code === "PYTHON_JSON_PARSE_ERROR" || error.code === "PYTHON_OUTPUT_INVALID") {
      return new CardServiceError(
        "PYTHON_OUTPUT_INVALID",
        "Invalid response received from card verification process.",
        502
      );
    }

    return new CardServiceError("PYTHON_PROCESS_ERROR", "Card verification process failed.", 502);
  }
}

function sanitizeUserIdForFilename(userId: string): string {
  const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, "-");
  return sanitized.length > 0 ? sanitized : "user";
}
