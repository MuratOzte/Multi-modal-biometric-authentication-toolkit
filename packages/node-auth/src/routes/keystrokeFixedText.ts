import express, { type Request, type Response } from "express";
import {
  PythonBridgeError,
  runKeystrokePython,
  type RunPythonBridgeOptions,
} from "../keystroke/pythonBridge";
import type {
  EnrollRes,
  KeystrokeSample,
  VerifyRes,
} from "../keystroke/types";
import type { KeystrokeTemplateStore } from "../keystroke/store";
import { validateAndNormalizeSample } from "../keystroke/validate";
import { parseEnrollRequest, parseVerifyRequest } from "./fixedText/parsers";
import { buildStoredTemplate } from "./fixedText/template";
import { sendError, sha256Hex } from "./fixedText/common";

const DEFAULT_MAX_SAMPLE_AGE_MS = 120_000;
const DEFAULT_STD_FLOOR_MS = 8;
const DEFAULT_MIN_ENROLL_FOR_AUTO = 10;

export function createFixedTextKeystrokeRouter(args: {
  store: KeystrokeTemplateStore;
  nowFn?: () => number;
  serverSalt?: string;
  pythonBridge?: (
    input: Parameters<typeof runKeystrokePython>[0],
    options?: RunPythonBridgeOptions
  ) => ReturnType<typeof runKeystrokePython>;
  pythonOptions?: RunPythonBridgeOptions;
}) {
  const router = express.Router();
  const nowFn = args.nowFn ?? (() => Date.now());
  const serverSalt = args.serverSalt ?? process.env.SECUREKIT_SERVER_SALT ?? "securekit-dev-salt";
  const pythonBridge = args.pythonBridge ?? runKeystrokePython;
  const pythonOptions = args.pythonOptions;

  router.get("/api/securekit/keystroke/status", async (req: Request, res: Response) => {
    const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    const textId = typeof req.query.textId === "string" ? req.query.textId.trim() : "";

    if (!userId || !textId) {
      sendError(res, 400, "INVALID_REQUEST", "userId and textId are required.");
      return;
    }

    const userIdHash = sha256Hex(`${userId}${serverSalt}`);

    try {
      const metadata = await args.store.getTemplateMetadata(userIdHash, textId);
      const template = metadata ? await args.store.getTemplate(userIdHash, textId) : null;
      const registered = metadata !== null && template !== null;

      res.status(200).json({
        ok: true,
        userId,
        textId,
        registered,
        template: registered && metadata
          ? {
              expectedText: metadata.expectedText,
              sampleCount: metadata.sampleCount,
              updatedAt: metadata.updatedAt,
            }
          : null,
      });
    } catch (error) {
      sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Failed to read fixed-text keystroke status.",
        error instanceof Error ? error.message : error
      );
    }
  });

  router.post("/api/securekit/keystroke/enroll", async (req: Request, res: Response) => {
    const { request, errors } = parseEnrollRequest(req.body);
    if (!request) {
      sendError(res, 400, "INVALID_REQUEST", "Invalid keystroke enroll request.", {
        fieldErrors: errors,
      });
      return;
    }

    const userIdHash = sha256Hex(`${request.userId}${serverSalt}`);
    const expectedTextHash = sha256Hex(request.expectedText);
    const nowMs = nowFn();
    const normalizedSamples: KeystrokeSample[] = [];

    for (const sample of request.samples) {
      const validated = validateAndNormalizeSample(sample, {
        textId: request.textId,
        expectedTextHash,
        nowMs,
      });

      if (!validated.ok || !validated.sample) {
        sendError(
          res,
          400,
          validated.error?.code ?? "INVALID_SAMPLE",
          validated.error?.message ?? "Invalid sample.",
          validated.error?.details
        );
        return;
      }

      normalizedSamples.push(validated.sample);
    }

    try {
      const pythonResult = await pythonBridge(
        {
          op: "enroll",
          template: null,
          samples: normalizedSamples,
          opts: {
            stdFloorMs: DEFAULT_STD_FLOOR_MS,
            autoEnroll: false,
            maxAgeMs: DEFAULT_MAX_SAMPLE_AGE_MS,
            nowMs,
          },
        },
        pythonOptions
      );

      if (!("template" in pythonResult) || !("recommended" in pythonResult)) {
        sendError(res, 502, "PYTHON_PROTOCOL_ERROR", "Unexpected python enroll output.");
        return;
      }

      const template = buildStoredTemplate({
        rawTemplate: pythonResult.template,
        base: {
          userIdHash,
          textId: request.textId,
          expectedTextHash,
        },
        updatedAt: nowMs,
      });

      await args.store.saveTemplate(userIdHash, request.textId, template);
      await args.store.saveTemplateMetadata(userIdHash, request.textId, {
        userId: request.userId,
        userIdHash,
        textId: request.textId,
        expectedText: request.expectedText,
        expectedTextHash,
        sampleCount: template.count,
        updatedAt: nowMs,
      });

      const response: EnrollRes = {
        ok: true,
        enrolled: true,
        template: {
          count: template.count,
          dim: template.dim,
        },
        recommended: {
          distThreshold: pythonResult.recommended.distThreshold,
          scoreThreshold: pythonResult.recommended.scoreThreshold,
          autoEnrollScore: pythonResult.recommended.autoEnrollScore,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof PythonBridgeError) {
        sendError(res, 502, error.code, error.message, error.details);
        return;
      }

      sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Failed to enroll fixed-text keystroke template.",
        error instanceof Error ? error.message : error
      );
    }
  });

  router.post("/api/securekit/keystroke/verify", async (req: Request, res: Response) => {
    const { request, errors } = parseVerifyRequest(req.body);
    if (!request) {
      sendError(res, 400, "INVALID_REQUEST", "Invalid keystroke verify request.", {
        fieldErrors: errors,
      });
      return;
    }

    const userIdHash = sha256Hex(`${request.userId}${serverSalt}`);
    const template = await args.store.getTemplate(userIdHash, request.textId);

    if (!template) {
      const response: VerifyRes = {
        ok: true,
        decision: "reject",
        score: 0,
        dist: 9999,
        autoEnrolled: false,
        reason: "not_enrolled",
        metrics: {
          count: 0,
          thresholdDist: 0,
          thresholdScore: 0,
          autoEnrollScore: 0,
        },
      };

      res.status(200).json(response);
      return;
    }

    if (
      typeof request.expectedText === "string" &&
      sha256Hex(request.expectedText) !== template.expectedTextHash
    ) {
      sendError(
        res,
        400,
        "TEXT_MISMATCH",
        "expectedText hash does not match the enrolled template."
      );
      return;
    }

    const nowMs = nowFn();
    const validated = validateAndNormalizeSample(request.sample, {
      textId: request.textId,
      expectedTextHash: template.expectedTextHash,
      nowMs,
    });
    if (!validated.ok || !validated.sample) {
      sendError(
        res,
        400,
        validated.error?.code ?? "INVALID_SAMPLE",
        validated.error?.message ?? "Invalid sample.",
        validated.error?.details
      );
      return;
    }

    try {
      const pythonResult = await pythonBridge(
        {
          op: "verify",
          template,
          samples: [validated.sample],
          opts: {
            autoEnroll: request.opts?.autoEnroll ?? false,
            stdFloorMs: DEFAULT_STD_FLOOR_MS,
            minEnroll: DEFAULT_MIN_ENROLL_FOR_AUTO,
            maxAgeMs: DEFAULT_MAX_SAMPLE_AGE_MS,
            nowMs,
          },
        },
        pythonOptions
      );

      if (!("decision" in pythonResult)) {
        sendError(res, 502, "PYTHON_PROTOCOL_ERROR", "Unexpected python verify output.");
        return;
      }

      let effectiveTemplate = template;
      if (pythonResult.autoEnrolled && pythonResult.template) {
        effectiveTemplate = buildStoredTemplate({
          rawTemplate: pythonResult.template,
          base: {
            userIdHash: template.userIdHash,
            textId: template.textId,
            expectedTextHash: template.expectedTextHash,
          },
          updatedAt: nowMs,
        });
        await args.store.saveTemplate(userIdHash, request.textId, effectiveTemplate);

        const metadata = await args.store.getTemplateMetadata(userIdHash, request.textId);
        if (metadata || typeof request.expectedText === "string") {
          const expectedText = metadata?.expectedText ?? request.expectedText ?? "";
          await args.store.saveTemplateMetadata(userIdHash, request.textId, {
            userId: metadata?.userId ?? request.userId,
            userIdHash,
            textId: request.textId,
            expectedText,
            expectedTextHash: template.expectedTextHash,
            sampleCount: effectiveTemplate.count,
            updatedAt: nowMs,
          });
        }
      }

      const response: VerifyRes = {
        ok: true,
        decision: pythonResult.decision,
        score: pythonResult.score,
        dist: pythonResult.dist,
        autoEnrolled: pythonResult.autoEnrolled,
        ...(typeof pythonResult.reason === "string" ? { reason: pythonResult.reason } : {}),
        metrics: {
          count: effectiveTemplate.count,
          thresholdDist: effectiveTemplate.distThreshold,
          thresholdScore: effectiveTemplate.scoreThreshold,
          autoEnrollScore: effectiveTemplate.autoEnrollScore,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      if (error instanceof PythonBridgeError) {
        sendError(res, 502, error.code, error.message, error.details);
        return;
      }

      sendError(
        res,
        500,
        "INTERNAL_ERROR",
        "Failed to verify fixed-text keystroke sample.",
        error instanceof Error ? error.message : error
      );
    }
  });

  return router;
}
