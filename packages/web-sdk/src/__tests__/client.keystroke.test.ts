import { describe, expect, it, vi } from "vitest";
import type { VerifyKeystrokeResponse } from "@securekit/core";
import { buildKeystrokeSample, SecureKitClient } from "../index";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecureKitClient keystroke methods", () => {
  it("buildKeystrokeSample maps metadata deterministically", () => {
    const sample = buildKeystrokeSample(
      [
        { code: "KeyA", type: "down", t: 10, expectedIndex: 0 },
        { code: "KeyA", type: "up", t: 100, expectedIndex: 0 },
      ],
      "abc",
      {
        challengeId: "c1",
        typedLength: 3,
        errorCount: 1,
        backspaceCount: 1,
        ignoredEventCount: 2,
        imeCompositionUsed: false,
      }
    );

    expect(sample).toEqual({
      events: [
        { code: "KeyA", type: "down", t: 10, expectedIndex: 0 },
        { code: "KeyA", type: "up", t: 100, expectedIndex: 0 },
      ],
      expectedText: "abc",
      challengeId: "c1",
      typedLength: 3,
      errorCount: 1,
      backspaceCount: 1,
      ignoredEventCount: 2,
      imeCompositionUsed: false,
      source: "collector_v1",
    });
  });

  it("verifyKeystroke posts expected body to /verify/keystroke", async () => {
    const fixture: VerifyKeystrokeResponse = {
      ok: true,
      userId: "u1",
      similarityScore: 0.81,
      distance: 0.22,
      decision: "allow",
      reasons: [],
      sampleMetrics: {
        holdMeanMs: 90,
        holdStdMs: 10,
        holdMedianMs: 88,
        flightMeanMs: 45,
        flightStdMs: 8,
        flightMedianMs: 44,
        ddMeanMs: 50,
        ddStdMs: 7,
        ddMedianMs: 49,
        udMeanMs: 42,
        udStdMs: 6,
        udMedianMs: 41,
        uuMeanMs: 52,
        uuStdMs: 7,
        uuMedianMs: 50,
        typingSpeedCharsPerSec: 4.3,
        errorRate: 0.02,
        backspaceRate: 0.01,
        digraphCount: 12,
        keystrokeCount: 14,
        eventCount: 28,
        durationMs: 800,
        startDelayMs: 60,
        interWordPauseMeanMs: 0,
        interWordPauseStdMs: 0,
        interWordPauseMedianMs: 0,
        interWordPauseCount: 0,
        longPauseRate: 0,
        correctionBurstRate: 0,
      },
      profile: null,
      profileUpdated: false,
      signalsUsed: {
        keystroke: {
          similarityScore: 0.81,
          distance: 0.22,
          decision: "allow",
          reasons: [],
          sampleMetrics: {
            holdMeanMs: 90,
            holdStdMs: 10,
            holdMedianMs: 88,
            flightMeanMs: 45,
            flightStdMs: 8,
            flightMedianMs: 44,
            ddMeanMs: 50,
            ddStdMs: 7,
            ddMedianMs: 49,
            udMeanMs: 42,
            udStdMs: 6,
            udMedianMs: 41,
            uuMeanMs: 52,
            uuStdMs: 7,
            uuMedianMs: 50,
            typingSpeedCharsPerSec: 4.3,
            errorRate: 0.02,
            backspaceRate: 0.01,
            digraphCount: 12,
            keystrokeCount: 14,
            eventCount: 28,
            durationMs: 800,
            startDelayMs: 60,
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
    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const payload = {
      userId: "u1",
      sample: buildKeystrokeSample(
        [
          { code: "KeyA", type: "down" as const, t: 0, expectedIndex: 0 },
          { code: "KeyA", type: "up" as const, t: 100, expectedIndex: 0 },
        ],
        "a",
        { typedLength: 1 }
      ),
    };

    const result = await client.verifyKeystroke(payload);

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/verify/keystroke")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(payload));
  });
});
