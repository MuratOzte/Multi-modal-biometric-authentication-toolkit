import type { Response } from "express";
import type { VerifyError } from "@securekit/core";

export function makeError(error: VerifyError): { error: VerifyError } {
  return { error };
}

export function sendValidationError(
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

export function sendInternalError(res: Response, message: string, details?: unknown): void {
  const error: VerifyError =
    details === undefined
      ? { code: "INTERNAL_ERROR", message }
      : { code: "INTERNAL_ERROR", message, details };

  res.status(500).json(makeError(error));
}

export function sendConsentRequired(res: Response): void {
  res.status(403).json(
    makeError({
      code: "CONSENT_REQUIRED",
      message: "Consent required before enrollment.",
    })
  );
}
