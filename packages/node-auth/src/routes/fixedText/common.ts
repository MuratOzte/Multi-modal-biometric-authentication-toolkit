import { createHash } from "node:crypto";
import type { Response } from "express";

export interface RouterErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function makeError(code: string, message: string, details?: unknown): RouterErrorPayload {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  res.status(status).json(makeError(code, message, details));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
