import React, { useEffect, useMemo, useState } from "react";
import type { ChallengeLang, ChallengeLength, ChallengeTextResponse } from "@securekit/web-sdk";
import { secureKitClient } from "../lib/secureKitClient.js";

type BusyAction = "idle" | "en-short" | "tr-short" | "en-medium";

async function fetchChallenge(lang: ChallengeLang, length: ChallengeLength): Promise<ChallengeTextResponse> {
  return secureKitClient.getTextChallenge({ lang, length });
}

export const ChallengeTextTester: React.FC = () => {
  const [result, setResult] = useState<ChallengeTextResponse | null>(null);
  const [busy, setBusy] = useState<BusyAction>("idle");
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const remainingSeconds = useMemo(() => {
    if (!result) return null;
    const expiresAtMs = Date.parse(result.expiresAt);
    if (!Number.isFinite(expiresAtMs)) return null;
    return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  }, [result, nowMs]);

  const run = async (action: BusyAction, lang: ChallengeLang, length: ChallengeLength) => {
    setBusy(action);
    setError(null);

    try {
      const response = await fetchChallenge(lang, length);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy("idle");
    }
  };

  const isBusy = busy !== "idle";

  return (
    <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, marginTop: 16 }}>
      <h2>Challenge Text Tester</h2>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => run("en-short", "en", "short")} disabled={isBusy}>
          {busy === "en-short" ? "Loading..." : "Get EN short"}
        </button>
        <button onClick={() => run("tr-short", "tr", "short")} disabled={isBusy}>
          {busy === "tr-short" ? "Loading..." : "Get TR short"}
        </button>
        <button onClick={() => run("en-medium", "en", "medium")} disabled={isBusy}>
          {busy === "en-medium" ? "Loading..." : "Get EN medium"}
        </button>
      </div>

      {error && <div style={{ color: "red", marginTop: 8 }}>Error: {error}</div>}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div>challengeId: {result.challengeId}</div>
          <div>lang: {result.lang}</div>
          <div>text: {result.text}</div>
          <div>expiresAt: {result.expiresAt}</div>
          <div>remaining: {remainingSeconds === null ? "-" : `${remainingSeconds}s`}</div>
        </div>
      )}
    </div>
  );
};
