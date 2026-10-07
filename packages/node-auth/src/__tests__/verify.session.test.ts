import request from "supertest";
import type { LocationResult, NetworkResult } from "@securekit/core";
import { describe, expect, it } from "vitest";
import { createApp } from "../server";
import { InMemorySessionStore } from "../session/inMemoryStore";

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

const RISKY_NETWORK: NetworkResult = {
  ok: true,
  score: 20,
  flags: {
    vpn: true,
    tor: true,
    relay: true,
    proxy: true,
    hosting: true,
  },
  reasons: ["VPN", "TOR", "DRIFT_HIGH"],
  ipInfo: {
    ip: "5.6.7.8",
    countryCode: "RU",
    timezoneOffsetMin: 0,
    clientOffsetMin: 180,
    driftMin: 180,
  },
};

const RISKY_LOCATION: LocationResult = {
  ok: true,
  countryCode: "RU",
  allowed: false,
  reasons: ["COUNTRY_NOT_ALLOWED"],
};

const BASELINE_KEYSTROKE_SAMPLE = {
  events: [
    { code: "KeyA", type: "down" as const, t: 0, expectedIndex: 0 },
    { code: "KeyA", type: "up" as const, t: 95, expectedIndex: 0 },
    { code: "KeyB", type: "down" as const, t: 140, expectedIndex: 1 },
    { code: "KeyB", type: "up" as const, t: 225, expectedIndex: 1 },
    { code: "KeyC", type: "down" as const, t: 270, expectedIndex: 2 },
    { code: "KeyC", type: "up" as const, t: 360, expectedIndex: 2 },
  ],
  expectedText: "abc",
  typedLength: 3,
  errorCount: 0,
  backspaceCount: 0,
  source: "collector_v1" as const,
};

const BASELINE_VOICE_SIGNAL = {
  similarityScore: 0.94,
  decision: "allow" as const,
  reasons: ["VOICE_MATCH"],
  transcript: {
    expectedText: "Sakin ruzgar testi.",
    transcript: "Sakin ruzgar testi.",
    similarityScore: 1,
    matched: true,
    threshold: 0.78,
  },
  runtime: {
    device: "cuda" as const,
    cudaAvailable: true,
    cudaDeviceName: "NVIDIA GeForce RTX 3050 Laptop GPU",
    fallbackReason: null,
    whisperModel: "base",
    speakerModel: "speechbrain/spkrec-ecapa-voxceleb",
  },
  thresholds: {
    matchThreshold: 0.85,
    stepUpThreshold: 0.5,
    denyThreshold: 0.35,
    transcriptThreshold: 0.78,
  },
};

function createDeterministicApp(args?: { nowMs?: number; ttlMs?: number }) {
  const nowRef = {
    value: args?.nowMs ?? Date.UTC(2026, 0, 1, 10, 0, 0),
  };

  const sessionStore = new InMemorySessionStore({
    nowFn: () => nowRef.value,
    ttlMs: args?.ttlMs ?? 15 * 60 * 1000,
  });

  const app = createApp({ sessionStore });
  return { app, nowRef };
}

async function startSession(app: ReturnType<typeof createDeterministicApp>["app"]): Promise<string> {
  const response = await request(app).post("/session/start").send({});
  expect(response.status).toBe(200);
  expect(typeof response.body.sessionId).toBe("string");
  return response.body.sessionId as string;
}

describe("verify session endpoint", () => {
  it("returns SESSION_NOT_FOUND for unknown session", async () => {
    const { app } = createDeterministicApp();
    const response = await request(app).post("/verify/session").send({
      sessionId: "unknown-session-id",
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: "SESSION_NOT_FOUND" },
    });
  });

  it("returns allow decision on clean fixtures", async () => {
    const { app } = createDeterministicApp();
    const sessionId = await startSession(app);

    const response = await request(app).post("/verify/session").send({
      sessionId,
      signals: {
        network: CLEAN_NETWORK,
        location: CLEAN_LOCATION,
      },
      policy: {
        allowedCountries: ["TR", "US"],
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toBe(sessionId);
    expect(response.body.decision).toBe("allow");
    expect(response.body.riskScore).toBeLessThanOrEqual(30);
    expect(response.body.requiredSteps).toEqual([]);
    expect(response.body.reasons).not.toContain("COUNTRY_NOT_ALLOWED");
  });

  it("returns step-up decision with keystroke step on risky fixtures", async () => {
    const { app } = createDeterministicApp();
    const sessionId = await startSession(app);

    const response = await request(app).post("/verify/session").send({
      sessionId,
      signals: {
        network: RISKY_NETWORK,
        location: RISKY_LOCATION,
      },
      policy: {
        allowedCountries: ["TR"],
        stepUpSteps: ["keystroke"],
        allowMaxRisk: 30,
        denyMinRisk: 85,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.decision).toBe("step-up");
    expect(response.body.riskScore).toBeGreaterThan(30);
    expect(response.body.riskScore).toBeLessThan(85);
    expect(response.body.requiredSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "keystroke",
          ui: {
            title: "Typing Check",
            instruction: "Type the shown text naturally.",
          },
        }),
      ])
    );
    expect(response.body.reasons).toEqual(
      expect.arrayContaining(["COUNTRY_NOT_ALLOWED", "VPN_DETECTED"])
    );
  });

  it("returns deny when treatVpnAsFailure is true", async () => {
    const { app } = createDeterministicApp();
    const sessionId = await startSession(app);

    const response = await request(app).post("/verify/session").send({
      sessionId,
      signals: {
        network: RISKY_NETWORK,
        location: CLEAN_LOCATION,
      },
      policy: {
        allowMaxRisk: 30,
        denyMinRisk: 85,
        treatVpnAsFailure: true,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.decision).toBe("deny");
    expect(response.body.reasons).toContain("VPN_TREATED_AS_FAILURE");
  });

  it("returns SESSION_EXPIRED for expired sessions", async () => {
    const { app, nowRef } = createDeterministicApp({ ttlMs: 1000 });
    const sessionId = await startSession(app);

    nowRef.value += 2_000;

    const response = await request(app).post("/verify/session").send({
      sessionId,
      signals: {
        network: CLEAN_NETWORK,
      },
    });

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({
      error: { code: "SESSION_EXPIRED" },
    });
  });

  it("persists signals across verify/session calls", async () => {
    const { app } = createDeterministicApp();
    const sessionId = await startSession(app);

    const first = await request(app).post("/verify/session").send({
      sessionId,
      signals: { network: CLEAN_NETWORK },
    });
    expect(first.status).toBe(200);
    expect(first.body.signalsUsed.network).toMatchObject({
      ipInfo: { ip: "1.2.3.4" },
    });
    expect(first.body.signalsUsed.location).toBeUndefined();

    const second = await request(app).post("/verify/session").send({
      sessionId,
      signals: { location: CLEAN_LOCATION },
      policy: { allowedCountries: ["TR"] },
    });
    expect(second.status).toBe(200);
    expect(second.body.signalsUsed.network).toMatchObject({
      ipInfo: { ip: "1.2.3.4" },
    });
    expect(second.body.signalsUsed.location).toMatchObject({
      countryCode: "TR",
    });

    const third = await request(app).post("/verify/session").send({
      sessionId,
    });
    expect(third.status).toBe(200);
    expect(third.body.signalsUsed.network).toMatchObject({
      ipInfo: { ip: "1.2.3.4" },
    });
    expect(third.body.signalsUsed.location).toMatchObject({
      countryCode: "TR",
    });
  });

  it("accepts optional keystroke signal in verify/session when policy enables it", async () => {
    const { app } = createDeterministicApp();

    await request(app).post("/consent").send({
      userId: "u1",
      consentVersion: "v1",
    });

    await request(app).post("/enroll/keystroke").send({
      userId: "u1",
      sample: BASELINE_KEYSTROKE_SAMPLE,
      expectedText: "abc",
      typedLength: 3,
      errorCount: 0,
      backspaceCount: 0,
    });

    const sessionId = await startSession(app);

    const response = await request(app).post("/verify/session").send({
      sessionId,
      userId: "u1",
      signals: {
        network: CLEAN_NETWORK,
        location: CLEAN_LOCATION,
        keystroke: BASELINE_KEYSTROKE_SAMPLE,
      },
      policy: {
        allowedCountries: ["TR"],
        keystroke: {
          enabled: true,
          minEnrollmentRounds: 1,
          minEnrollmentKeystrokes: 3,
          minDigraphCount: 1,
          allowThreshold: 0.5,
          stepUpThreshold: 0.3,
          denyThreshold: 0.2,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.signalsUsed.keystroke).toMatchObject({
      decision: "allow",
    });
    expect(response.body.decision).toBe("allow");
  });

  it("accepts optional voice signal in verify/session when policy enables it", async () => {
    const { app } = createDeterministicApp();
    const sessionId = await startSession(app);

    const response = await request(app).post("/verify/session").send({
      sessionId,
      signals: {
        network: CLEAN_NETWORK,
        location: CLEAN_LOCATION,
        voice: BASELINE_VOICE_SIGNAL,
      },
      policy: {
        allowedCountries: ["TR"],
        voice: {
          enabled: true,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.signalsUsed.voice).toMatchObject({
      decision: "allow",
      runtime: {
        device: "cuda",
      },
    });
    expect(response.body.decision).toBe("allow");
  });

  it("lets a deny voice signal force a session deny", async () => {
    const { app } = createDeterministicApp();
    const sessionId = await startSession(app);

    const response = await request(app).post("/verify/session").send({
      sessionId,
      signals: {
        network: CLEAN_NETWORK,
        voice: {
          ...BASELINE_VOICE_SIGNAL,
          similarityScore: 0.1,
          decision: "deny",
          reasons: ["LOW_SIMILARITY"],
        },
      },
      policy: {
        voice: {
          enabled: true,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.decision).toBe("deny");
    expect(response.body.reasons).toContain("VOICE_DENY");
  });

  it("turns an allow session into step-up for a step-up voice signal", async () => {
    const { app } = createDeterministicApp();
    const sessionId = await startSession(app);

    const response = await request(app).post("/verify/session").send({
      sessionId,
      signals: {
        network: CLEAN_NETWORK,
        voice: {
          ...BASELINE_VOICE_SIGNAL,
          similarityScore: 0.55,
          decision: "step_up",
          reasons: ["VOICE_STEP_UP"],
        },
      },
      policy: {
        voice: {
          enabled: true,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.decision).toBe("step-up");
    expect(response.body.requiredSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: "voice",
        }),
      ])
    );
  });
});
