import express, { type Request, type Response } from "express";
import type {
  EnrollKeystrokeResponse,
  KeystrokeProfile,
  UserProfiles,
  VerifyKeystrokeResponse,
} from "@securekit/core";
import { buildKeystrokeProfile } from "../../../core/src/biometrics/keystrokeProfile";
import { verifyKeystrokeAgainstProfile } from "../services/keystrokeVerification";
import type { ChallengeStore } from "../challenge/store";
import type { StorageAdapter } from "../storage/adapter";
import { makeError, sendConsentRequired, sendInternalError, sendValidationError } from "./keystroke/errors";
import {
  parseEnrollKeystrokeRequest,
  parseVerifyKeystrokeRequest,
} from "./keystroke/parsers";

export function createKeystrokeRouter(args: {
  storage: StorageAdapter;
  challengeStore: ChallengeStore;
  nowFn?: () => number;
  nowFnIso?: () => string;
  enrollmentMinRounds: number;
  enrollmentMinKeystrokes: number;
}) {
  const router = express.Router();
  const nowFn = args.nowFn ?? (() => Date.now());
  const nowFnIso = args.nowFnIso ?? (() => new Date().toISOString());

  router.post("/enroll/keystroke", async (req: Request, res: Response) => {
    const { request: parsed, fieldErrors } = parseEnrollKeystrokeRequest(req.body);
    if (!parsed) {
      sendValidationError(res, "Invalid keystroke enrollment request.", fieldErrors);
      return;
    }

    try {
      const latestConsent = await args.storage.getLatestConsent(parsed.userId);
      if (!latestConsent) {
        sendConsentRequired(res);
        return;
      }

      const nowIso = nowFnIso();
      const existingProfiles = await args.storage.getProfiles(parsed.userId);
      const built = buildKeystrokeProfile({
        userId: parsed.userId,
        nowIso,
        existingProfile: existingProfiles?.keystroke ?? null,
        sample: parsed.sample,
        events: parsed.events,
        expectedText: parsed.expectedText,
        typedLength: parsed.typedLength,
        errorCount: parsed.errorCount,
        backspaceCount: parsed.backspaceCount,
        imeCompositionUsed: parsed.imeCompositionUsed,
        enrollmentTargets: {
          minRounds: args.enrollmentMinRounds,
          minKeystrokes: args.enrollmentMinKeystrokes,
        },
      });

      const profile: KeystrokeProfile = built.profile;
      const nextProfiles: UserProfiles = {
        userId: parsed.userId,
        keystroke: profile,
        faceReferenceImagePath: existingProfiles?.faceReferenceImagePath ?? null,
        faceReferenceEnrolledAt: existingProfiles?.faceReferenceEnrolledAt ?? null,
        faceEmbedding: existingProfiles?.faceEmbedding ?? null,
        cardReferenceImagePath: existingProfiles?.cardReferenceImagePath ?? null,
        cardReferenceEnrolledAt: existingProfiles?.cardReferenceEnrolledAt ?? null,
        voice: existingProfiles?.voice ?? null,
        voiceEmbedding: existingProfiles?.voiceEmbedding ?? null,
        updatedAt: nowIso,
      };

      await args.storage.saveProfiles(parsed.userId, nextProfiles);

      const response: EnrollKeystrokeResponse = {
        ok: true,
        profile,
        sampleMetrics: built.sampleMetrics,
        enrollmentProgress: built.enrollmentProgress,
        reasons: built.reasons,
      };

      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to enroll keystroke profile.",
        error instanceof Error ? error.message : error
      );
    }
  });

  router.post("/verify/keystroke", async (req: Request, res: Response) => {
    const { request: parsed, fieldErrors } = parseVerifyKeystrokeRequest(req.body);
    if (!parsed) {
      sendValidationError(res, "Invalid keystroke verification request.", fieldErrors);
      return;
    }

    try {
      const challengeId = parsed.challengeId;
      if (typeof challengeId !== "string" || challengeId.trim().length === 0) {
        sendValidationError(res, "Invalid keystroke verification request.", {
          challengeId: "challengeId is required for verification.",
        });
        return;
      }

      const consumedChallenge = await args.challengeStore.consume(challengeId, nowFn());
      if (consumedChallenge === null) {
        res.status(404).json(
          makeError({
            code: "CHALLENGE_NOT_FOUND",
            message: "Challenge was not found.",
          })
        );
        return;
      }

      if (consumedChallenge === "EXPIRED") {
        res.status(410).json(
          makeError({
            code: "CHALLENGE_EXPIRED",
            message: "Challenge has expired.",
          })
        );
        return;
      }

      if (consumedChallenge === "USED") {
        res.status(409).json(
          makeError({
            code: "CHALLENGE_ALREADY_USED",
            message: "Challenge has already been consumed.",
          })
        );
        return;
      }

      if (consumedChallenge.text !== parsed.sample.expectedText) {
        sendValidationError(res, "Invalid keystroke verification request.", {
          "sample.expectedText":
            "sample.expectedText must match the challenge text associated with challengeId.",
        });
        return;
      }

      if (
        typeof consumedChallenge.sessionId === "string" &&
        typeof parsed.sessionId === "string" &&
        consumedChallenge.sessionId !== parsed.sessionId
      ) {
        sendValidationError(res, "Invalid keystroke verification request.", {
          sessionId: "sessionId must match the session assigned to this challenge.",
        });
        return;
      }

      const verified = await verifyKeystrokeAgainstProfile({
        userId: parsed.userId,
        sample: parsed.sample,
        policy: parsed.policy,
        storage: args.storage,
        nowIso: nowFnIso(),
      });

      const response: VerifyKeystrokeResponse = {
        ok: true,
        userId: parsed.userId,
        similarityScore: verified.signal.similarityScore,
        distance: verified.signal.distance,
        decision: verified.signal.decision,
        reasons: verified.signal.reasons,
        sampleMetrics: verified.signal.sampleMetrics,
        profile: verified.profile ?? null,
        profileUpdated: verified.profileUpdated,
        signalsUsed: {
          keystroke: verified.signal,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to verify keystroke sample.",
        error instanceof Error ? error.message : error
      );
    }
  });

  return router;
}
