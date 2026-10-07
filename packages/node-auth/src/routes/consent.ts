import express, { type Request, type Response } from "express";
import type { ConsentLog, ConsentRequest, ConsentResponse, VerifyError } from "@securekit/core";
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

function parseConsentRequest(body: unknown): {
  request: ConsentRequest | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isRecord(body)) {
    fieldErrors.body = "Request body must be an object.";
    return { request: null, fieldErrors };
  }

  const userId = readRequiredStringField(body, "userId", fieldErrors);
  const consentVersion = readRequiredStringField(body, "consentVersion", fieldErrors);

  if (Object.keys(fieldErrors).length > 0) {
    return { request: null, fieldErrors };
  }

  return {
    request: {
      userId,
      consentVersion,
    },
    fieldErrors,
  };
}

function makeError(error: VerifyError): { error: VerifyError } {
  return { error };
}

function sendValidationError(
  res: Response,
  message: string,
  fieldErrors: Record<string, string>
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

export function createConsentRouter(args: {
  storage: StorageAdapter;
  nowFnIso?: () => string;
}) {
  const router = express.Router();
  const nowFnIso = args.nowFnIso ?? (() => new Date().toISOString());

  router.post("/consent", async (req: Request, res: Response) => {
    const { request: parsed, fieldErrors } = parseConsentRequest(req.body);
    if (!parsed) {
      sendValidationError(res, "Invalid consent request.", fieldErrors);
      return;
    }

    const grantedAt = nowFnIso();
    const log: ConsentLog = {
      userId: parsed.userId,
      consentVersion: parsed.consentVersion,
      grantedAt,
    };

    try {
      await args.storage.appendConsentLog(log);

      const response: ConsentResponse = {
        ok: true,
        userId: parsed.userId,
        consentVersion: parsed.consentVersion,
        grantedAt,
      };

      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to persist consent.",
        error instanceof Error ? error.message : error
      );
    }
  });

  return router;
}
