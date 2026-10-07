import express, { type Request, type Response } from "express";
import type {
  DeleteBiometricsRequest,
  DeleteBiometricsResponse,
  GetProfilesResponse,
  UserProfiles,
  VerifyError,
} from "@securekit/core";
import type { StorageAdapter } from "../storage/adapter";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredStringField(
  source: Record<string, unknown>,
  field: string,
  fieldErrors: Record<string, string>
): string {
  const value = source[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    fieldErrors[field] = `${field} is required.`;
    return "";
  }

  return value.trim();
}

function parseDeleteBiometricsRequest(body: unknown): {
  request: DeleteBiometricsRequest | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isRecord(body)) {
    fieldErrors.body = "Request body must be an object.";
    return { request: null, fieldErrors };
  }

  const userId = readRequiredStringField(body, "userId", fieldErrors);
  if (Object.keys(fieldErrors).length > 0) {
    return { request: null, fieldErrors };
  }

  return {
    request: { userId },
    fieldErrors,
  };
}

function makeError(error: VerifyError): { error: VerifyError } {
  return { error };
}

function sendValidationError(
  res: Response,
  message: string,
  fieldErrors: Record<string, string> = {}
): void {
  const details = Object.keys(fieldErrors).length > 0 ? { fieldErrors } : undefined;
  const error: VerifyError = details
    ? { code: "VALIDATION_ERROR", message, details }
    : { code: "VALIDATION_ERROR", message };

  res.status(400).json(makeError(error));
}

function sendInternalError(res: Response, message: string, details?: unknown): void {
  const error: VerifyError =
    details === undefined
      ? { code: "INTERNAL_ERROR", message }
      : { code: "INTERNAL_ERROR", message, details };

  res.status(500).json(makeError(error));
}

function buildEmptyProfiles(userId: string, nowIso: string): UserProfiles {
  return {
    userId,
    keystroke: null,
    faceReferenceImagePath: null,
    faceReferenceEnrolledAt: null,
    faceEmbedding: null,
    cardReferenceImagePath: null,
    cardReferenceEnrolledAt: null,
    voice: null,
    voiceEmbedding: null,
    updatedAt: nowIso,
  };
}

export function createProfilesRouter(args: {
  storage: StorageAdapter;
  nowFnIso?: () => string;
}) {
  const router = express.Router();
  const nowFnIso = args.nowFnIso ?? (() => new Date().toISOString());

  router.get("/user/:userId/profiles", async (req: Request, res: Response) => {
    const userId = typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!userId) {
      sendValidationError(res, "Invalid user profile request.", {
        userId: "userId is required.",
      });
      return;
    }

    try {
      const profiles = (await args.storage.getProfiles(userId)) ?? buildEmptyProfiles(userId, nowFnIso());
      const response: GetProfilesResponse = {
        ok: true,
        profiles,
      };

      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to read user profiles.",
        error instanceof Error ? error.message : error
      );
    }
  });

  router.delete("/user/biometrics", async (req: Request, res: Response) => {
    const { request: parsed, fieldErrors } = parseDeleteBiometricsRequest(req.body);
    if (!parsed) {
      sendValidationError(res, "Invalid delete biometrics request.", fieldErrors);
      return;
    }

    const deleteConsentRaw = req.query.deleteConsent;
    const deleteConsent =
      typeof deleteConsentRaw === "string"
        ? deleteConsentRaw.toLowerCase() === "true"
        : Array.isArray(deleteConsentRaw)
          ? deleteConsentRaw.some((value) => String(value).toLowerCase() === "true")
          : false;

    try {
      await args.storage.deleteProfiles(parsed.userId);

      if (deleteConsent) {
        const storageWithDeleteConsent = args.storage as StorageAdapter & {
          deleteConsentLogs?: (userId: string) => Promise<void>;
        };

        if (typeof storageWithDeleteConsent.deleteConsentLogs === "function") {
          await storageWithDeleteConsent.deleteConsentLogs(parsed.userId);
        }
      }

      const response: DeleteBiometricsResponse = {
        ok: true,
        userId: parsed.userId,
      };

      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to delete biometrics.",
        error instanceof Error ? error.message : error
      );
    }
  });

  return router;
}
