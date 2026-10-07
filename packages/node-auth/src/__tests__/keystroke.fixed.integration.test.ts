import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server";
import {
  createSyntheticFixedTextSample,
  createSyntheticFixedTextSamples,
} from "./helpers/fixedTextSynthetic";
import { InMemoryKeystrokeTemplateStore } from "../keystroke/store";

const RUN_PYTHON_TESTS = process.env.RUN_PYTHON_TESTS === "1";

describe.runIf(RUN_PYTHON_TESTS)("fixed-text keystroke integration (real python)", () => {
  it("supports enroll -> verify accept/reject and auto-enroll update", async () => {
    const nowRef = { value: 1_700_000_000_000 };
    const store = new InMemoryKeystrokeTemplateStore();

    const app = createApp({
      nowFn: () => nowRef.value,
      fixedTextKeystrokeStore: store,
      ...(typeof process.env.PYTHON_BIN === "string" && process.env.PYTHON_BIN.trim().length > 0
        ? { fixedTextKeystrokePythonBin: process.env.PYTHON_BIN.trim() }
        : {}),
    });

    const userId = "fixed-user-1";
    const textId = "tr-medium-fixed-v1";
    const expectedText = "securekit typing shield";

    const enrollSamples = createSyntheticFixedTextSamples({
      textId,
      text: expectedText,
      profile: "A",
      sampleCount: 10,
      startSeed: 100,
      noiseLevel: 1,
      timestampMs: nowRef.value - 400,
    });

    const enroll = await request(app).post("/api/securekit/keystroke/enroll").send({
      userId,
      textId,
      expectedText,
      samples: enrollSamples,
    });

    expect(enroll.status).toBe(200);
    expect(enroll.body.ok).toBe(true);
    expect(enroll.body.enrolled).toBe(true);
    expect(enroll.body.template.count).toBe(10);
    expect(enroll.body.template.dim).toBeGreaterThan(0);

    const verifyAcceptSample = createSyntheticFixedTextSample({
      textId,
      text: expectedText,
      profile: "A",
      seed: 777,
      noiseLevel: 0.9,
      timestampMs: nowRef.value - 300,
    });

    const verifyAccept = await request(app).post("/api/securekit/keystroke/verify").send({
      userId,
      textId,
      sample: verifyAcceptSample,
      opts: {
        autoEnroll: false,
      },
    });

    expect(verifyAccept.status).toBe(200);
    expect(verifyAccept.body.ok).toBe(true);
    expect(verifyAccept.body.decision).toBe("accept");

    const verifyRejectSample = createSyntheticFixedTextSample({
      textId,
      text: expectedText,
      profile: "B",
      seed: 888,
      noiseLevel: 1.1,
      timestampMs: nowRef.value - 250,
    });

    const verifyReject = await request(app).post("/api/securekit/keystroke/verify").send({
      userId,
      textId,
      sample: verifyRejectSample,
      opts: {
        autoEnroll: false,
      },
    });

    expect(verifyReject.status).toBe(200);
    expect(verifyReject.body.ok).toBe(true);
    expect(verifyReject.body.decision).toBe("reject");

    nowRef.value += 1000;
    const verifyAutoEnrollSample = createSyntheticFixedTextSample({
      textId,
      text: expectedText,
      profile: "A",
      seed: 1,
      noiseLevel: 0,
      timestampMs: nowRef.value - 100,
    });

    const verifyAutoEnroll = await request(app).post("/api/securekit/keystroke/verify").send({
      userId,
      textId,
      sample: verifyAutoEnrollSample,
      opts: {
        autoEnroll: true,
      },
    });

    expect(verifyAutoEnroll.status).toBe(200);
    expect(verifyAutoEnroll.body.ok).toBe(true);
    expect(verifyAutoEnroll.body.decision).toBe("accept");
    expect(verifyAutoEnroll.body.autoEnrolled).toBe(true);
    expect(verifyAutoEnroll.body.metrics.count).toBe(11);
  }, 15_000);
});
