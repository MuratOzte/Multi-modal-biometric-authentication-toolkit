import React, { useMemo, useState } from "react";
import type {
  LocationResult,
  NetworkResult,
  VerifySessionResponse,
} from "@securekit/web-sdk";
import { secureKitClient } from "../lib/secureKitClient.js";

function parseAllowedCountries(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((part) => part.trim().toUpperCase())
        .filter((part) => part.length > 0)
    )
  );
}

type BusyState = "idle" | "start" | "network" | "location" | "verify";

export const SessionFlowTester: React.FC = () => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkResult | null>(null);
  const [location, setLocation] = useState<LocationResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifySessionResponse | null>(null);
  const [allowedCountriesInput, setAllowedCountriesInput] = useState("TR,US");
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState<string | null>(null);

  const allowedCountries = useMemo(
    () => parseAllowedCountries(allowedCountriesInput),
    [allowedCountriesInput]
  );

  const startSession = async () => {
    setBusy("start");
    setError(null);
    setVerifyResult(null);
    try {
      const started = await secureKitClient.startSession();
      setSessionId(started.sessionId);
      setExpiresAt(started.expiresAt);
      setNetwork(null);
      setLocation(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy("idle");
    }
  };

  const runNetwork = async () => {
    setBusy("network");
    setError(null);
    try {
      const result = await secureKitClient.verifyNetwork();
      setNetwork(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy("idle");
    }
  };

  const runLocation = async () => {
    setBusy("location");
    setError(null);
    try {
      const result = await secureKitClient.verifyLocation({
        allowedCountries: allowedCountries.length > 0 ? allowedCountries : undefined,
      });
      setLocation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy("idle");
    }
  };

  const runVerifySession = async () => {
    if (!sessionId) {
      setError("Start a session first.");
      return;
    }

    setBusy("verify");
    setError(null);
    try {
      const result = await secureKitClient.verifySession({
        sessionId,
        policy: {
          allowMaxRisk: 30,
          denyMinRisk: 85,
          stepUpSteps: ["keystroke"],
          allowedCountries: allowedCountries.length > 0 ? allowedCountries : undefined,
        },
        signals: {
          network: network ?? undefined,
          location: location ?? undefined,
        },
      });
      setVerifyResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy("idle");
    }
  };

  const isBusy = busy !== "idle";

  return (
    <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, marginTop: 16 }}>
      <h2>Session Flow Tester</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <button onClick={startSession} disabled={isBusy}>
          {busy === "start" ? "Starting..." : "1. Start Session"}
        </button>
        <button onClick={runNetwork} disabled={isBusy || !sessionId}>
          {busy === "network" ? "Checking..." : "2. Verify Network"}
        </button>
        <button onClick={runLocation} disabled={isBusy || !sessionId}>
          {busy === "location" ? "Checking..." : "3. Verify Location"}
        </button>
        <button onClick={runVerifySession} disabled={isBusy || !sessionId}>
          {busy === "verify" ? "Evaluating..." : "4. Verify Session"}
        </button>
      </div>

      <label style={{ display: "block", marginBottom: 8 }}>
        Allowed Countries (comma-separated):
        <input
          value={allowedCountriesInput}
          onChange={(event) => setAllowedCountriesInput(event.target.value)}
          style={{ marginLeft: 8, minWidth: 180 }}
        />
      </label>

      {error && <div style={{ color: "red" }}>Error: {error}</div>}

      <div style={{ marginTop: 8 }}>
        <div>sessionId: {sessionId ?? "-"}</div>
        <div>expiresAt: {expiresAt ?? "-"}</div>
        <div>network score: {network ? String(network.score) : "-"}</div>
        <div>location country: {location?.countryCode ?? "-"}</div>
      </div>

      {verifyResult && (
        <div style={{ marginTop: 12 }}>
          <h3>Session Decision</h3>
          <div>riskScore: {verifyResult.riskScore}</div>
          <div>decision: {verifyResult.decision}</div>
          <div>
            requiredSteps:{" "}
            {verifyResult.requiredSteps.length > 0
              ? verifyResult.requiredSteps.map((step) => step.step).join(", ")
              : "-"}
          </div>
          <div>reasons: {verifyResult.reasons.join(", ") || "-"}</div>

          <pre style={{ marginTop: 8, maxHeight: 300, overflow: "auto" }}>
            {JSON.stringify(verifyResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
