import React, { useState } from "react";
import {
  checkLocationCountryWithPolicy,
  type LocationCheckWithDecision,
} from "../lib/secureKitClient.js";

export const LocationCheckTester: React.FC = () => {
  const [result, setResult] = useState<LocationCheckWithDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAutoCheckWithPolicy = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await checkLocationCountryWithPolicy(undefined);
      setResult(res);
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  };

  const handleManualTRWithPolicy = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await checkLocationCountryWithPolicy("TR");
      setResult(res);
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  };

  const decision = result?.decision;
  const raw = result?.raw;

  return (
    <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8 }}>
      <h2>Location Country Check Tester (Policy'li)</h2>

      <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 8 }}>
        <button onClick={handleAutoCheckWithPolicy} disabled={loading}>
          {loading
            ? "Kontrol ediliyor..."
            : "Auto (navigator) + policy ile kontrol et"}
        </button>

        <button onClick={handleManualTRWithPolicy} disabled={loading}>
          {loading
            ? "Kontrol ediliyor..."
            : 'Manuel: allowed "TR" + policy'}
        </button>
      </div>

      {error && <div style={{ color: "red", marginTop: 8 }}>Hata: {error}</div>}

      {result && (
        <div style={{ marginTop: 8 }}>
          <h3>Policy Karari</h3>
          <div>allowed: {String(decision?.allowed)}</div>
          <div>reason: {decision?.reason}</div>
          <div>effectiveScore: {decision?.effectiveScore}</div>

          <h3 style={{ marginTop: 8 }}>Ham Sonuc (backend)</h3>
          <div>ok: {String(raw?.ok)}</div>
          <div>allowed: {String(raw?.allowed)}</div>
          <div>countryCode: {raw?.countryCode ?? "-"}</div>
          <div>reasons: {(raw?.reasons ?? []).join(", ") || "-"}</div>

          <pre style={{ marginTop: 8, maxHeight: 300, overflow: "auto" }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
