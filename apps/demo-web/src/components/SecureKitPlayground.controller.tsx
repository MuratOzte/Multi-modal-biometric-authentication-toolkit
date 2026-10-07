import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChallengeLang,
  ChallengeTextResponse,
  KeystrokeEvent,
  KeystrokeSampleMetrics,
} from "@securekit/core";
import {
  buildKeystrokeSample,
  createKeystrokeCollector,
  HttpError,
  type ConsentResponse,
  type DeleteBiometricsResponse,
  type EnrollKeystrokeResponse,
  type GetProfilesResponse,
  type VerifyKeystrokeResponse,
  type VerifySessionRequest,
  type VerifySessionResponse,
} from "@securekit/web-sdk";
import {
  createSecureKitClient,
  deleteSecureKitJson,
  formatSecureKitError,
  resolveSecureKitBaseUrl,
} from "../lib/secureKitClient.js";
import {
  type SectionBusy,
  FIXED_CHALLENGE_SENTENCE,
  computeChallengeProgress,
  isChallengeMatch,
  parseNumber,
  usePersistentState,
} from "./SecureKitPlayground.utils.js";

type CollectorApi = ReturnType<typeof createKeystrokeCollector>;

export function useSecureKitPlaygroundController() {
  const baseUrl = resolveSecureKitBaseUrl();
  const client = useMemo(() => createSecureKitClient(baseUrl), [baseUrl]);

  const [userId, setUserId] = usePersistentState("securekit.playground.userId", "demo-user-1");
  const [consentVersion, setConsentVersion] = usePersistentState(
    "securekit.playground.consentVersion",
    "v1"
  );
  const [targetRoundsInput, setTargetRoundsInput] = usePersistentState(
    "securekit.playground.targetRounds",
    "8"
  );
  const [showRawEvents, setShowRawEvents] = usePersistentState(
    "securekit.playground.showRawEvents",
    false
  );
  const [deleteConsent, setDeleteConsent] = usePersistentState(
    "securekit.playground.deleteConsent",
    false
  );
  const [allowThresholdInput, setAllowThresholdInput] = usePersistentState(
    "securekit.playground.allowThreshold",
    "0.77"
  );
  const [stepUpThresholdInput, setStepUpThresholdInput] = usePersistentState(
    "securekit.playground.stepUpThreshold",
    "0.56"
  );
  const [denyThresholdInput, setDenyThresholdInput] = usePersistentState(
    "securekit.playground.denyThreshold",
    "0.36"
  );
  const [sessionId, setSessionId] = usePersistentState("securekit.playground.sessionId", "");

  const [sessionResult, setSessionResult] = useState<VerifySessionResponse | null>(null);
  const [sessionBusy, setSessionBusy] = useState<SectionBusy>("idle");
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [consentBusy, setConsentBusy] = useState<SectionBusy>("idle");
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentResult, setConsentResult] = useState<ConsentResponse | null>(null);

  const [enrollBusy, setEnrollBusy] = useState<SectionBusy>("idle");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollResult, setEnrollResult] = useState<EnrollKeystrokeResponse | null>(null);
  const [enrollChallenge, setEnrollChallenge] = useState<ChallengeTextResponse | null>(null);
  const [stableSentence, setStableSentence] = useState<string | null>(null);
  const [enrollTyped, setEnrollTyped] = useState("");
  const [enrollRoundsCompleted, setEnrollRoundsCompleted] = useState(0);

  const [verifyBusy, setVerifyBusy] = useState<SectionBusy>("idle");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyKeystrokeResponse | null>(null);
  const [verifyChallenge, setVerifyChallenge] = useState<ChallengeTextResponse | null>(null);
  const [verifyTyped, setVerifyTyped] = useState("");

  const [profilesBusy, setProfilesBusy] = useState<SectionBusy>("idle");
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [profilesResult, setProfilesResult] = useState<GetProfilesResponse | null>(null);

  const [deleteBusy, setDeleteBusy] = useState<SectionBusy>("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeleteBiometricsResponse | null>(null);

  const [lastMetrics, setLastMetrics] = useState<KeystrokeSampleMetrics | null>(null);
  const [lastRawEvents, setLastRawEvents] = useState<KeystrokeEvent[] | null>(null);

  const enrollInputRef = useRef<HTMLTextAreaElement | null>(null);
  const verifyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const enrollCollectorRef = useRef<CollectorApi | null>(null);
  const verifyCollectorRef = useRef<CollectorApi | null>(null);

  const targetRounds = Math.max(1, Math.round(parseNumber(targetRoundsInput, 8, 1, 50)));
  const allowThreshold = parseNumber(allowThresholdInput, 0.77, 0, 1);
  const stepUpThreshold = parseNumber(stepUpThresholdInput, 0.56, 0, 1);
  const denyThreshold = parseNumber(denyThresholdInput, 0.36, 0, 1);

  const enrollProgress = useMemo(
    () => computeChallengeProgress(enrollChallenge?.text ?? "", enrollTyped),
    [enrollChallenge?.text, enrollTyped]
  );
  const verifyProgress = useMemo(
    () => computeChallengeProgress(verifyChallenge?.text ?? "", verifyTyped),
    [verifyChallenge?.text, verifyTyped]
  );

  const enrollChallengeId = enrollChallenge?.challengeId;
  const enrollChallengeText = enrollChallenge?.text ?? null;
  const verifyChallengeId = verifyChallenge?.challengeId;
  const verifyChallengeText = verifyChallenge?.text ?? null;

  useEffect(() => {
    const input = enrollInputRef.current;
    if (!input || !enrollChallengeText) return undefined;

    const collector = createKeystrokeCollector(input, {
      expectedText: enrollChallengeText,
      includeBackspace: true,
      includeEnter: false,
      includeRawKey: showRawEvents,
    });

    enrollCollectorRef.current = collector;
    collector.start();
    input.focus();

    return () => {
      collector.stop();
      if (enrollCollectorRef.current === collector) {
        enrollCollectorRef.current = null;
      }
    };
  }, [enrollChallengeId, enrollChallengeText, showRawEvents]);

  useEffect(() => {
    const input = verifyInputRef.current;
    if (!input || !verifyChallengeText) return undefined;

    const collector = createKeystrokeCollector(input, {
      expectedText: verifyChallengeText,
      includeBackspace: true,
      includeEnter: false,
      includeRawKey: showRawEvents,
    });

    verifyCollectorRef.current = collector;
    collector.start();
    input.focus();

    return () => {
      collector.stop();
      if (verifyCollectorRef.current === collector) {
        verifyCollectorRef.current = null;
      }
    };
  }, [verifyChallengeId, verifyChallengeText, showRawEvents]);

  const runConsent = async () => {
    const normalizedUserId = userId.trim();
    const normalizedConsentVersion = consentVersion.trim();

    if (!normalizedUserId) {
      setConsentError("userId is required.");
      return;
    }
    if (!normalizedConsentVersion) {
      setConsentError("consentVersion is required.");
      return;
    }

    setConsentBusy("loading");
    setConsentError(null);
    setConsentResult(null);

    try {
      setConsentResult(
        await client.grantConsent({
          userId: normalizedUserId,
          consentVersion: normalizedConsentVersion,
        })
      );
    } catch (error) {
      setConsentError(formatSecureKitError(error, baseUrl));
    } finally {
      setConsentBusy("idle");
    }
  };

  const getChallenge = async (text?: string) =>
    client.getTextChallenge({
      lang: "tr" as ChallengeLang,
      ...(text ? { text } : {}),
    });

  const startEnrollment = async () => {
    setEnrollBusy("loading");
    setEnrollError(null);
    setEnrollResult(null);
    setVerifyResult(null);
    setEnrollRoundsCompleted(0);

    try {
      const challenge = await getChallenge(FIXED_CHALLENGE_SENTENCE);
      setStableSentence(challenge.text);
      setEnrollChallenge(challenge);
      setVerifyChallenge(null);
      setEnrollTyped("");
      enrollCollectorRef.current?.reset();
    } catch (error) {
      setEnrollError(formatSecureKitError(error, baseUrl));
    } finally {
      setEnrollBusy("idle");
    }
  };

  const submitEnrollment = async (typedTextOverride?: string) => {
    const normalizedUserId = userId.trim();
    const challenge = enrollChallenge;
    const collector = enrollCollectorRef.current;
    if (!normalizedUserId || !challenge || !collector) return;

    const typedText = typeof typedTextOverride === "string" ? typedTextOverride : enrollTyped;
    if (!isChallengeMatch(challenge.text, typedText)) {
      setEnrollError(
        "Ayni cumleyi yazin. Buyuk-kucuk harf, noktalama ve fazla bosluk fark etmez."
      );
      return;
    }

    setEnrollBusy("loading");
    setEnrollError(null);

    try {
      collector.stop();
      const snapshot = collector.getSnapshot();

      if (snapshot.events.length === 0) {
        setEnrollError("No keystroke events captured. Keep the textarea focused while typing.");
        collector.start();
        enrollInputRef.current?.focus();
        return;
      }

      const typedLength = typedText.length;
      const sample = buildKeystrokeSample(snapshot.events, challenge.text, {
        challengeId: challenge.challengeId,
        typedLength,
        errorCount: snapshot.errorCount,
        backspaceCount: snapshot.backspaceCount,
        ignoredEventCount: snapshot.ignoredEventCount,
        imeCompositionUsed: snapshot.imeCompositionUsed,
      });

      const result = await client.enrollKeystroke({
        userId: normalizedUserId,
        challengeId: challenge.challengeId,
        sample,
        expectedText: challenge.text,
        typedLength,
        errorCount: snapshot.errorCount,
        backspaceCount: snapshot.backspaceCount,
        imeCompositionUsed: snapshot.imeCompositionUsed,
      });

      setEnrollResult(result);
      setLastMetrics(result.sampleMetrics ?? null);
      setLastRawEvents(showRawEvents ? snapshot.events : null);

      const completed = enrollRoundsCompleted + 1;
      setEnrollRoundsCompleted(completed);

      if (completed >= targetRounds) {
        setEnrollChallenge(null);
        setEnrollTyped("");
        return;
      }

      setEnrollTyped("");
      collector.reset();
      collector.start();
      enrollInputRef.current?.focus();
    } catch (error) {
      setEnrollError(formatSecureKitError(error, baseUrl));
      collector.reset();
      collector.start();
      enrollInputRef.current?.focus();
    } finally {
      setEnrollBusy("idle");
    }
  };

  const startVerification = async () => {
    setVerifyBusy("loading");
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const sentence = stableSentence ?? FIXED_CHALLENGE_SENTENCE;
      const challenge = await getChallenge(sentence);
      setVerifyChallenge(challenge);
      setVerifyTyped("");
      verifyCollectorRef.current?.reset();
    } catch (error) {
      setVerifyError(formatSecureKitError(error, baseUrl));
    } finally {
      setVerifyBusy("idle");
    }
  };

  const submitVerification = async (typedTextOverride?: string) => {
    const normalizedUserId = userId.trim();
    const challenge = verifyChallenge;
    const collector = verifyCollectorRef.current;
    if (!normalizedUserId || !challenge || !collector) return;

    const typedText = typeof typedTextOverride === "string" ? typedTextOverride : verifyTyped;
    if (!isChallengeMatch(challenge.text, typedText)) {
      setVerifyError(
        "Ayni cumleyi yazin. Buyuk-kucuk harf, noktalama ve fazla bosluk fark etmez."
      );
      return;
    }

    setVerifyBusy("loading");
    setVerifyError(null);

    try {
      collector.stop();
      const snapshot = collector.getSnapshot();

      if (snapshot.events.length === 0) {
        setVerifyError("No keystroke events captured.");
        collector.start();
        verifyInputRef.current?.focus();
        return;
      }

      const typedLength = typedText.length;
      const sample = buildKeystrokeSample(snapshot.events, challenge.text, {
        challengeId: challenge.challengeId,
        typedLength,
        errorCount: snapshot.errorCount,
        backspaceCount: snapshot.backspaceCount,
        ignoredEventCount: snapshot.ignoredEventCount,
        imeCompositionUsed: snapshot.imeCompositionUsed,
      });

      const result = await client.verifyKeystroke({
        userId: normalizedUserId,
        challengeId: challenge.challengeId,
        sample,
        policy: {
          enabled: true,
          allowThreshold,
          stepUpThreshold,
          denyThreshold,
          updateProfileOnAllow: true,
        },
      });

      setVerifyResult(result);
      setLastMetrics(result.sampleMetrics ?? null);
      setLastRawEvents(showRawEvents ? snapshot.events : null);

      if (sessionId.trim()) {
        setSessionBusy("loading");
        setSessionError(null);

        try {
          const payload: Omit<VerifySessionRequest, "sessionId"> = {
            userId: normalizedUserId,
            policy: {
              stepUpSteps: ["keystroke"],
              keystroke: {
                enabled: true,
                allowThreshold,
                stepUpThreshold,
                denyThreshold,
                updateProfileOnAllow: true,
              },
            },
            signals: {
              keystroke: sample,
            },
          };

          const verifyWithSession = (activeSessionId: string) =>
            client.verifySession({
              sessionId: activeSessionId,
              ...payload,
            });

          const currentSessionId = sessionId.trim();
          let sessionResponse: VerifySessionResponse;

          try {
            sessionResponse = await verifyWithSession(currentSessionId);
          } catch (error) {
            if (error instanceof HttpError && (error.status === 404 || error.status === 410)) {
              const started = await client.startSession();
              setSessionId(started.sessionId);
              sessionResponse = await verifyWithSession(started.sessionId);
            } else {
              throw error;
            }
          }

          setSessionResult(sessionResponse);
        } catch (error) {
          setSessionError(formatSecureKitError(error, baseUrl));
        } finally {
          setSessionBusy("idle");
        }
      }

      setVerifyChallenge(null);
      setVerifyTyped("");
    } catch (error) {
      setVerifyError(formatSecureKitError(error, baseUrl));
      collector.reset();
      collector.start();
      verifyInputRef.current?.focus();
    } finally {
      setVerifyBusy("idle");
    }
  };

  const runProfiles = async () => {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      setProfilesError("userId is required.");
      return;
    }

    setProfilesBusy("loading");
    setProfilesError(null);
    setProfilesResult(null);

    try {
      setProfilesResult(await client.getProfiles(normalizedUserId));
    } catch (error) {
      setProfilesError(formatSecureKitError(error, baseUrl));
    } finally {
      setProfilesBusy("idle");
    }
  };

  const runDelete = async () => {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      setDeleteError("userId is required.");
      return;
    }

    setDeleteBusy("loading");
    setDeleteError(null);
    setDeleteResult(null);

    try {
      const path = deleteConsent ? "/user/biometrics?deleteConsent=true" : "/user/biometrics";
      setDeleteResult(
        await deleteSecureKitJson<DeleteBiometricsResponse>(
          path,
          { userId: normalizedUserId },
          baseUrl
        )
      );

      setEnrollRoundsCompleted(0);
      setEnrollChallenge(null);
      setStableSentence(null);
      setEnrollResult(null);
      setEnrollTyped("");
      setVerifyChallenge(null);
      setVerifyResult(null);
      setVerifyTyped("");
      setSessionResult(null);
      setLastMetrics(null);
      setLastRawEvents(null);
    } catch (error) {
      setDeleteError(formatSecureKitError(error, baseUrl));
    } finally {
      setDeleteBusy("idle");
    }
  };

  const onEnrollChange = (value: string) => {
    setEnrollTyped(value);
    if (enrollError) setEnrollError(null);

    if (enrollBusy === "idle" && enrollChallenge && isChallengeMatch(enrollChallenge.text, value)) {
      window.setTimeout(() => {
        void submitEnrollment(value);
      }, 0);
    }
  };

  const onVerifyChange = (value: string) => {
    setVerifyTyped(value);
    if (verifyError) setVerifyError(null);

    if (verifyBusy === "idle" && verifyChallenge && isChallengeMatch(verifyChallenge.text, value)) {
      window.setTimeout(() => {
        void submitVerification(value);
      }, 0);
    }
  };

  const onTypingKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
    }
  };

  return {
    allowThresholdInput,
    baseUrl,
    consentBusy,
    consentError,
    consentResult,
    consentVersion,
    deleteBusy,
    deleteConsent,
    deleteError,
    deleteResult,
    denyThresholdInput,
    enrollBusy,
    enrollChallenge,
    enrollCollectorRef,
    enrollError,
    enrollInputRef,
    enrollProgress,
    enrollResult,
    enrollRoundsCompleted,
    enrollTyped,
    lastMetrics,
    lastRawEvents,
    onEnrollChange,
    onTypingKeyDown,
    onVerifyChange,
    profilesBusy,
    profilesError,
    profilesResult,
    runConsent,
    runDelete,
    runProfiles,
    sessionBusy,
    sessionError,
    sessionId,
    sessionResult,
    setAllowThresholdInput,
    setConsentVersion,
    setDeleteConsent,
    setDenyThresholdInput,
    setEnrollTyped,
    setSessionId,
    setStepUpThresholdInput,
    setTargetRoundsInput,
    setUserId,
    setVerifyTyped,
    showRawEvents,
    stableSentence,
    startEnrollment,
    startVerification,
    stepUpThresholdInput,
    submitEnrollment,
    submitVerification,
    targetRounds,
    targetRoundsInput,
    userId,
    verifyBusy,
    verifyChallenge,
    verifyCollectorRef,
    verifyError,
    verifyInputRef,
    verifyProgress,
    verifyResult,
    verifyTyped,
    setShowRawEvents,
    verifyChallengeText,
    enrollChallengeText,
    setDeleteResult,
  };
}

export type SecureKitPlaygroundController = ReturnType<typeof useSecureKitPlaygroundController>;
