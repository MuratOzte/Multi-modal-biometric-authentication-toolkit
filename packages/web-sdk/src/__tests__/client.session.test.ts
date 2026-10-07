import { describe, expect, it, vi } from "vitest";
import type { LocationResult, NetworkResult, VerifySessionResponse } from "@securekit/core";
import { SecureKitClient } from "../index";

const CLEAN_NETWORK: NetworkResult = {
  ok: true,
  score: 95,
  flags: {
    vpn: false,
    tor: false,
    proxy: false,
    relay: false,
    hosting: false,
  },
  reasons: [],
  ipInfo: {
    ip: "1.2.3.4",
    countryCode: "TR",
    timezoneOffsetMin: 180,
    clientOffsetMin: 180,
    driftMin: 0,
  },
};

const CLEAN_LOCATION: LocationResult = {
  ok: true,
  countryCode: "TR",
  allowed: true,
  reasons: [],
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecureKitClient session methods", () => {
  it("startSession posts to /session/start", async () => {
    const payload = {
      sessionId: "s1",
      expiresAt: "2026-01-01T00:15:00.000Z",
    };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.startSession();

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/session/start",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("verifySession posts expected body to /verify/session", async () => {
    const responseFixture: VerifySessionResponse = {
      sessionId: "s1",
      riskScore: 10,
      decision: "allow",
      requiredSteps: [],
      reasons: ["RISK_WITHIN_ALLOW_MAX"],
      signalsUsed: {
        network: CLEAN_NETWORK,
        location: CLEAN_LOCATION,
        keystroke: {
          similarityScore: 0.82,
          distance: 0.2,
          decision: "allow",
          reasons: [],
          sampleMetrics: {
            holdMeanMs: 90,
            holdStdMs: 10,
            holdMedianMs: 89,
            flightMeanMs: 50,
            flightStdMs: 9,
            flightMedianMs: 48,
            ddMeanMs: 51,
            ddStdMs: 8,
            ddMedianMs: 50,
            udMeanMs: 45,
            udStdMs: 7,
            udMedianMs: 44,
            uuMeanMs: 53,
            uuStdMs: 8,
            uuMedianMs: 52,
            typingSpeedCharsPerSec: 4,
            errorRate: 0.01,
            backspaceRate: 0.02,
            digraphCount: 11,
            keystrokeCount: 12,
            eventCount: 24,
            durationMs: 700,
            startDelayMs: 50,
            interWordPauseMeanMs: 0,
            interWordPauseStdMs: 0,
            interWordPauseMedianMs: 0,
            interWordPauseCount: 0,
            longPauseRate: 0,
            correctionBurstRate: 0,
          },
          thresholds: {
            allowThreshold: 0.76,
            stepUpThreshold: 0.56,
            denyThreshold: 0.36,
          },
        },
      },
    };
    const fetchMock = vi.fn(async () => jsonResponse(responseFixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const payload = {
      sessionId: "s1",
      userId: "u1",
      policy: { allowedCountries: ["TR"] },
      signals: {
        network: CLEAN_NETWORK,
        location: CLEAN_LOCATION,
        keystroke: {
          events: [
            { code: "KeyA", type: "down" as const, t: 0, expectedIndex: 0 },
            { code: "KeyA", type: "up" as const, t: 100, expectedIndex: 0 },
          ],
          expectedText: "a",
          typedLength: 1,
        },
      },
    };

    const result = await client.verifySession(payload);

    expect(result).toEqual(responseFixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/verify/session")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(payload));
  });
});
