import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FaceEnrollmentReferenceResponse } from "@securekit/core";
import type { StorageAdapter } from "../storage/adapter";
import {
  FacePythonBridgeError,
  runFacePython,
  type RunFacePythonOptions,
} from "./pythonBridge";
import {
  DEFAULT_FACE_MATCH_THRESHOLD,
  FACE_SAMPLE_REFERENCE_DIR,
  FACE_SAMPLE_REFERENCE_PATHS_BY_USER_ID,
  isSubPath,
  mimeToExtension,
  resolveDefaultReferenceDir,
  sanitizeUserIdForFilename,
} from "./config";
import {
  buildNextProfiles,
  mapPythonBridgeError,
  normalizePythonResult,
} from "./results";
import {
  assertValidUpload,
  normalizeRequiredUserId,
  resolveMaxUploadBytes,
  resolveThreshold,
} from "./uploads";
import {
  FaceServiceError,
  type FaceEnrollmentInput,
  type FacePythonRunner,
  type FaceVerificationServiceResult,
  type FaceVerifyInput,
  type FaceUploadFile,
} from "./types";

export interface FaceVerificationServiceOptions {
  storage: StorageAdapter;
  nowFnIso?: () => string;
  referenceDir?: string;
  allowedReferenceRoots?: string[];
  maxUploadBytes?: number;
  defaultThreshold?: number;
  pythonRunner?: FacePythonRunner;
  pythonOptions?: RunFacePythonOptions;
}

export class FaceVerificationService {
  private readonly storage: StorageAdapter;
  private readonly nowFnIso: () => string;
  private readonly referenceDir: string;
  private readonly allowedReferenceRoots: string[];
  private readonly maxUploadBytes: number;
  private readonly defaultThreshold: number;
  private readonly pythonRunner: FacePythonRunner;
  private readonly pythonOptions?: RunFacePythonOptions;

  constructor(options: FaceVerificationServiceOptions) {
    this.storage = options.storage;
    this.nowFnIso = options.nowFnIso ?? (() => new Date().toISOString());
    this.referenceDir = path.resolve(options.referenceDir ?? resolveDefaultReferenceDir());
    this.allowedReferenceRoots = Array.from(
      new Set(
        [this.referenceDir, FACE_SAMPLE_REFERENCE_DIR, ...(options.allowedReferenceRoots ?? [])].map((entry) =>
          path.resolve(entry)
        )
      )
    );
    this.maxUploadBytes = resolveMaxUploadBytes(options.maxUploadBytes);
    this.defaultThreshold = options.defaultThreshold ?? DEFAULT_FACE_MATCH_THRESHOLD;
    this.pythonRunner = options.pythonRunner ?? runFacePython;
    this.pythonOptions = options.pythonOptions;
  }

  async enrollReference(input: FaceEnrollmentInput): Promise<FaceEnrollmentReferenceResponse> {
    const userId = normalizeRequiredUserId(input.userId);
    assertValidUpload(input.referenceImage, "referenceImage", this.maxUploadBytes);

    await fs.mkdir(this.referenceDir, { recursive: true });

    const fileName = `${sanitizeUserIdForFilename(userId)}-${Date.now()}-${randomUUID()}${mimeToExtension(
      input.referenceImage.mimeType
    )}`;
    const nextReferencePath = path.join(this.referenceDir, fileName);

    await fs.writeFile(nextReferencePath, input.referenceImage.buffer, { flag: "wx" });

    const nowIso = this.nowFnIso();

    try {
      const existingProfiles = await this.storage.getProfiles(userId);
      const previousReferencePath = existingProfiles?.faceReferenceImagePath ?? null;
      const nextProfiles = buildNextProfiles({
        userId,
        existingProfiles,
        nowIso,
        updates: {
          faceReferenceImagePath: nextReferencePath,
          faceReferenceEnrolledAt: nowIso,
        },
      });

      await this.storage.saveProfiles(userId, nextProfiles);

      if (
        previousReferencePath &&
        previousReferencePath !== nextReferencePath &&
        this.isManagedReferencePath(path.resolve(previousReferencePath))
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
      throw new FaceServiceError(
        "INTERNAL_ERROR",
        "Failed to persist enrolled face reference.",
        500,
        error instanceof Error ? error.message : error
      );
    }
  }

  async verify(input: FaceVerifyInput): Promise<FaceVerificationServiceResult> {
    assertValidUpload(input.probeImage, "probeImage", this.maxUploadBytes);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "securekit-face-"));

    try {
      const referenceImagePath = await this.resolveReferenceImagePath(input, tempDir);
      const probeImagePath = await this.writeTempImage(tempDir, "probe", input.probeImage);
      const threshold = resolveThreshold(this.defaultThreshold, input.threshold);
      const result = await this.pythonRunner(
        {
          referenceImagePath,
          probeImagePath,
          threshold,
        },
        this.pythonOptions
      );

      return normalizePythonResult(result, referenceImagePath);
    } catch (error) {
      if (error instanceof FaceServiceError) {
        throw error;
      }
      if (error instanceof FacePythonBridgeError) {
        throw mapPythonBridgeError(error);
      }

      throw new FaceServiceError("INTERNAL_ERROR", "Face verification failed unexpectedly.", 500);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async resolveReferenceImagePath(
    input: FaceVerifyInput,
    tempDir: string
  ): Promise<string> {
    if (input.referenceImage) {
      assertValidUpload(input.referenceImage, "referenceImage", this.maxUploadBytes);
      return this.writeTempImage(tempDir, "reference", input.referenceImage);
    }

    if (typeof input.referenceImagePath === "string" && input.referenceImagePath.trim().length > 0) {
      const resolved = path.resolve(input.referenceImagePath.trim());
      if (!this.isAllowedReferencePath(resolved)) {
        throw new FaceServiceError(
          "REFERENCE_PATH_INVALID",
          "referenceImagePath is not within allowed directories.",
          400
        );
      }

      await this.assertPathExists(resolved, "REFERENCE_NOT_FOUND", "reference image was not found.");
      return resolved;
    }

    if (typeof input.userId === "string" && input.userId.trim().length > 0) {
      const userId = input.userId.trim();
      const profiles = await this.storage.getProfiles(userId);
      const storedPath = profiles?.faceReferenceImagePath ?? null;

      if (storedPath && storedPath.trim().length > 0) {
        const resolved = path.resolve(storedPath);
        if (!this.isAllowedReferencePath(resolved)) {
          throw new FaceServiceError(
            "REFERENCE_PATH_INVALID",
            "Stored face reference path is outside allowed directories.",
            400
          );
        }

        await this.assertPathExists(resolved, "REFERENCE_NOT_FOUND", "stored face reference was not found.");
        return resolved;
      }

      const sampleReferencePath = await this.resolveSampleReferencePathForUser(userId);
      if (sampleReferencePath) {
        return sampleReferencePath;
      }

      throw new FaceServiceError("REFERENCE_NOT_FOUND", "No enrolled face reference found for user.", 404);
    }

    throw new FaceServiceError(
      "REFERENCE_REQUIRED",
      "Provide userId, referenceImagePath, or referenceImage.",
      400
    );
  }

  private async writeTempImage(
    tempDir: string,
    prefix: "reference" | "probe",
    file: FaceUploadFile
  ): Promise<string> {
    const filePath = path.join(tempDir, `${prefix}-${randomUUID()}${mimeToExtension(file.mimeType)}`);
    await fs.writeFile(filePath, file.buffer, { flag: "wx" });
    return filePath;
  }

  private async assertPathExists(
    filePath: string,
    failureCode: import("@securekit/core").FaceVerificationFailureCode,
    message: string
  ): Promise<void> {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        throw new FaceServiceError(failureCode, message, 404);
      }
    } catch {
      throw new FaceServiceError(failureCode, message, 404);
    }
  }

  private isAllowedReferencePath(candidatePath: string): boolean {
    return this.allowedReferenceRoots.some((root) => {
      const normalizedRoot = path.resolve(root);
      const normalizedCandidate = path.resolve(candidatePath);

      if (normalizedCandidate === normalizedRoot) return true;
      return isSubPath(normalizedRoot, normalizedCandidate);
    });
  }

  private isManagedReferencePath(candidatePath: string): boolean {
    const normalizedReferenceRoot = path.resolve(this.referenceDir);
    const normalizedCandidate = path.resolve(candidatePath);
    return (
      normalizedCandidate === normalizedReferenceRoot ||
      isSubPath(normalizedReferenceRoot, normalizedCandidate)
    );
  }

  private async resolveSampleReferencePathForUser(userId: string): Promise<string | null> {
    const candidates = FACE_SAMPLE_REFERENCE_PATHS_BY_USER_ID.get(userId.toLowerCase()) ?? [];

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (!this.isAllowedReferencePath(resolved)) {
        continue;
      }

      try {
        const stat = await fs.stat(resolved);
        if (stat.isFile()) {
          return resolved;
        }
      } catch {
        // Continue to next mapped sample image path.
      }
    }

    return null;
  }
}
