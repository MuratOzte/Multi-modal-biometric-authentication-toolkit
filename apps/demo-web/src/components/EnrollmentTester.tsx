import React, { useState } from "react";
import type { KeystrokeEvent } from "@securekit/core";
import { secureKitClient } from "../lib/secureKitClient.js";

type BusyAction = "idle" | "consent" | "enroll" | "profiles" | "delete";

function buildSampleEvents(): KeystrokeEvent[] {
  return [
    { key: "a", type: "down", t: 0 },
    { key: "a", type: "up", t: 95 },
    { key: "b", type: "down", t: 130 },
    { key: "b", type: "up", t: 230 },
    { key: "c", type: "down", t: 270 },
    { key: "c", type: "up", t: 360 },
    { key: "d", type: "down", t: 405 },
    { key: "d", type: "up", t: 500 },
    { key: "e", type: "down", t: 545 },
    { key: "e", type: "up", t: 645 },
  ];
}

export const EnrollmentTester: React.FC = () => {
  const [userId, setUserId] = useState("demo-user-1");
  const [consentVersion, setConsentVersion] = useState("v1");
  const [busy, setBusy] = useState<BusyAction>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [lastSampleEvents, setLastSampleEvents] = useState<KeystrokeEvent[] | null>(null);

  const run = async (action: BusyAction, task: () => Promise<unknown>) => {
    setBusy(action);
    setError(null);

    try {
      const response = await task();
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy("idle");
    }
  };

  const normalizedUserId = userId.trim();
  const normalizedConsentVersion = consentVersion.trim();
  const isBusy = busy !== "idle";

  const requireUserId = (): boolean => {
    if (normalizedUserId.length > 0) return true;
    setError("userId is required.");
    return false;
  };

  const handleGrantConsent = async () => {
    if (!requireUserId()) return;
    if (normalizedConsentVersion.length === 0) {
      setError("consentVersion is required.");
      return;
    }

    await run("consent", () =>
      secureKitClient.grantConsent({
        userId: normalizedUserId,
        consentVersion: normalizedConsentVersion,
      })
    );
  };

  const handleEnroll = async () => {
    if (!requireUserId()) return;

    const events = buildSampleEvents();
    setLastSampleEvents(events);

    await run("enroll", () =>
      secureKitClient.enrollKeystroke({
        userId: normalizedUserId,
        events,
      })
    );
  };

  const handleGetProfiles = async () => {
    if (!requireUserId()) return;
    await run("profiles", () => secureKitClient.getProfiles(normalizedUserId));
  };

  const handleDelete = async () => {
    if (!requireUserId()) return;
    await run("delete", () => secureKitClient.deleteBiometrics(normalizedUserId));
  };

  return (
    <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8, marginTop: 16 }}>
      <h2>Consent + Enrollment Tester</h2>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <label>
          userId:
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            style={{ marginLeft: 8, minWidth: 180 }}
          />
        </label>

        <label>
          consentVersion:
          <input
            value={consentVersion}
            onChange={(event) => setConsentVersion(event.target.value)}
            style={{ marginLeft: 8, minWidth: 100 }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={handleGrantConsent} disabled={isBusy}>
          {busy === "consent" ? "Working..." : "Grant Consent"}
        </button>
        <button onClick={handleEnroll} disabled={isBusy}>
          {busy === "enroll" ? "Working..." : "Enroll Keystroke (sample events)"}
        </button>
        <button onClick={handleGetProfiles} disabled={isBusy}>
          {busy === "profiles" ? "Working..." : "Get Profiles"}
        </button>
        <button onClick={handleDelete} disabled={isBusy}>
          {busy === "delete" ? "Working..." : "Delete Biometrics"}
        </button>
      </div>

      {error && <div style={{ color: "red", marginTop: 8 }}>Error: {error}</div>}

      <div style={{ marginTop: 12 }}>
        <div>last userId: {normalizedUserId || "-"}</div>
        <div>last consentVersion: {normalizedConsentVersion || "-"}</div>
      </div>

      {lastSampleEvents && (
        <div style={{ marginTop: 12 }}>
          <h3>Client-side Sample Events (raw)</h3>
          <pre style={{ maxHeight: 180, overflow: "auto" }}>
            {JSON.stringify(lastSampleEvents, null, 2)}
          </pre>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          <h3>Last API Response (JSON)</h3>
          <pre style={{ maxHeight: 260, overflow: "auto" }}>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};
