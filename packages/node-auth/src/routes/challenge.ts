import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import type {
  ChallengeLang,
  ChallengeLength,
  ChallengeTextRequest,
  ChallengeTextResponse,
  ConsumeChallengeRequest,
  ConsumeChallengeResponse,
  VerifyError,
} from "@securekit/core";
import { generateChallengeText, type Rng } from "../challenge/generateText";
import type { ChallengeStore } from "../challenge/store";
import type { ChallengeRecord } from "../challenge/types";

const DEFAULT_CHALLENGE_TTL_SECONDS = 120;
const MAX_WORD_COUNT = 64;

export interface CreateChallengeRouterArgs {
  challengeStore: ChallengeStore;
  nowFn?: () => number;
  rng?: Rng;
  ttlMs?: number;
  idFactory?: () => string;
}

function makeError(error: VerifyError): { error: VerifyError } {
  return { error };
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const payload: VerifyError = details === undefined ? { code, message } : { code, message, details };
  res.status(status).json(makeError(payload));
}

export function resolveChallengeTtlMs(ttlSecondsOverride?: number): number {
  if (typeof ttlSecondsOverride === "number" && Number.isFinite(ttlSecondsOverride) && ttlSecondsOverride > 0) {
    return Math.round(ttlSecondsOverride * 1000);
  }

  const raw = process.env.CHALLENGE_TTL_SECONDS;
  if (!raw) return DEFAULT_CHALLENGE_TTL_SECONDS * 1000;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CHALLENGE_TTL_SECONDS * 1000;
  }

  return Math.round(parsed * 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLang(value: unknown): ChallengeLang | null {
  return value === "en" || value === "tr" ? value : null;
}

function parseLength(value: unknown): ChallengeLength | null {
  return value === "short" || value === "medium" || value === "long" ? value : null;
}

function parseWordCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.round(value);
  if (normalized < 1 || normalized > MAX_WORD_COUNT) return null;
  return normalized;
}

function parseChallengeTextRequest(body: unknown): ChallengeTextRequest | null {
  if (body === undefined || body === null) return {};
  if (!isRecord(body)) return null;

  const request: ChallengeTextRequest = {};

  if (body.lang !== undefined) {
    const lang = parseLang(body.lang);
    if (!lang) return null;
    request.lang = lang;
  }

  if (body.length !== undefined) {
    const length = parseLength(body.length);
    if (!length) return null;
    request.length = length;
  }

  if (body.wordCount !== undefined) {
    const wordCount = parseWordCount(body.wordCount);
    if (!wordCount) return null;
    request.wordCount = wordCount;
  }

  if (body.sessionId !== undefined) {
    if (typeof body.sessionId !== "string" || body.sessionId.trim().length === 0) {
      return null;
    }
    request.sessionId = body.sessionId.trim();
  }

  if (body.text !== undefined) {
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      return null;
    }
    request.text = body.text.trim();
  }

  return request;
}

function parseConsumeChallengeRequest(body: unknown): ConsumeChallengeRequest | null {
  if (!isRecord(body)) return null;
  if (typeof body.challengeId !== "string") return null;

  const challengeId = body.challengeId.trim();
  if (!challengeId) return null;

  return { challengeId };
}

function buildRecord(args: {
  challengeId: string;
  text: string;
  lang: ChallengeLang;
  nowMs: number;
  ttlMs: number;
  sessionId?: string;
}): ChallengeRecord {
  return {
    id: args.challengeId,
    text: args.text,
    lang: args.lang,
    createdAtMs: args.nowMs,
    expiresAtMs: args.nowMs + args.ttlMs,
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
  };
}

export function createChallengeRouter(args: CreateChallengeRouterArgs) {
  const router = express.Router();
  const challengeStore = args.challengeStore;
  const nowFn = args.nowFn ?? (() => Date.now());
  const rng = args.rng ?? (() => Math.random());
  const ttlMs = args.ttlMs ?? resolveChallengeTtlMs();
  const idFactory = args.idFactory ?? (() => randomUUID());

  router.post("/challenge/text", async (req: Request, res: Response) => {
    const requestBody = parseChallengeTextRequest(req.body);
    if (!requestBody) {
      sendError(res, 400, "INVALID_REQUEST", "A valid challenge text request body is required.");
      return;
    }

    const lang = requestBody.lang ?? "tr";
    const length = requestBody.length ?? "short";
    const nowMs = nowFn();
    const challengeId = idFactory();
    const text =
      requestBody.text ??
      generateChallengeText({
        lang,
        length,
        rng,
        wordCount: requestBody.wordCount,
      });
    const record = buildRecord({
      challengeId,
      text,
      lang,
      nowMs,
      ttlMs,
      sessionId: requestBody.sessionId,
    });

    await challengeStore.create(record);

    const response: ChallengeTextResponse = {
      challengeId: record.id,
      text: record.text,
      lang: record.lang,
      expiresAt: new Date(record.expiresAtMs).toISOString(),
    };

    res.status(200).json(response);
  });

  router.post("/challenge/text/consume", async (req: Request, res: Response) => {
    const requestBody = parseConsumeChallengeRequest(req.body);
    if (!requestBody) {
      sendError(res, 400, "INVALID_REQUEST", "A valid consume challenge request body is required.");
      return;
    }

    const consumed = await challengeStore.consume(requestBody.challengeId, nowFn());

    if (consumed === null) {
      sendError(res, 404, "CHALLENGE_NOT_FOUND", "Challenge was not found.");
      return;
    }

    if (consumed === "EXPIRED") {
      sendError(res, 410, "CHALLENGE_EXPIRED", "Challenge has expired.");
      return;
    }

    if (consumed === "USED") {
      sendError(res, 409, "CHALLENGE_ALREADY_USED", "Challenge has already been consumed.");
      return;
    }

    const response: ConsumeChallengeResponse = {
      ok: true,
      challengeId: consumed.id,
    };

    res.status(200).json(response);
  });

  return router;
}
