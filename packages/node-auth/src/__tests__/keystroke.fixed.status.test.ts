import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type {
  PythonBridgeInput,
  PythonEnrollOutput,
  PythonVerifyOutput,
} from "../keystroke/types";
import { InMemoryKeystrokeTemplateStore } from "../keystroke/store";
import { createFixedTextKeystrokeRouter } from "../routes/keystrokeFixedText";
import {
  createSyntheticFixedTextSample,
  createSyntheticFixedTextSamples,
} from "./helpers/fixedTextSynthetic";

const NOW = 1_700_000_000_000;
const NOW_2 = NOW + 1_000;
const USER_ID = "mert";
const TEXT_ID = "tr-medium-fixed-v1";
const EXPECTED_TEXT = "securekit typing shield";

function createRawTemplate(count: number): PythonEnrollOutput["template"] {
  return {
    dim: 3,
    count,
    mean: [95, 150, 55],
    std: [10, 12, 8],
    distThreshold: 2.5,
    scoreK: 1.2,
    autoEnrollScore: 82,
    scoreThreshold: 70,
  };
}

function createMockedApp(args: {
  nowRef?: { value: number };
  pythonBridge?: (input: PythonBridgeInput) => Promise<PythonEnrollOutput | PythonVerifyOutput>;
} = {}) {
  const nowRef = args.nowRef ?? { value: NOW };
  const store = new InMemoryKeystrokeTemplateStore();
  const pythonBridge =
    args.pythonBridge ??
    vi.fn(async (input: PythonBridgeInput): Promise<PythonEnrollOutput | PythonVerifyOutput> => {
      if (input.op === "enroll") {
        return {
          ok: true,
          template: createRawTemplate(input.samples.length),
          recommended: {
            distThreshold: 2.5,
            scoreThreshold: 70,
            autoEnrollScore: 82,
          },
        };
      }

      return {
        ok: true,
        score: 91,
        dist: 0.4,
        decision: "accept",
        autoEnrolled: false,
      };
    });

  const app = express();
  app.use(express.json());
  app.use(
    createFixedTextKeystrokeRouter({
      store,
      nowFn: () => nowRef.value,
      serverSalt: "test-salt",
      pythonBridge,
    })
  );

  return { app, store, pythonBridge };
}

describe("fixed-text keystroke status endpoint", () => {
  it("returns registered template metadata after enrollment", async () => {
    const { app } = createMockedApp();

    const enroll = await request(app).post("/api/securekit/keystroke/enroll").send({
      userId: USER_ID,
      textId: TEXT_ID,
      expectedText: EXPECTED_TEXT,
      samples: createSyntheticFixedTextSamples({
        textId: TEXT_ID,
        text: EXPECTED_TEXT,
        profile: "A",
        sampleCount: 10,
        timestampMs: NOW - 100,
      }),
    });

    expect(enroll.status).toBe(200);

    const status = await request(app).get("/api/securekit/keystroke/status").query({
      userId: USER_ID,
      textId: TEXT_ID,
    });

    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      ok: true,
      userId: USER_ID,
      textId: TEXT_ID,
      registered: true,
      template: {
        expectedText: EXPECTED_TEXT,
        sampleCount: 10,
        updatedAt: NOW,
      },
    });
  });

  it("returns unregistered when metadata is missing", async () => {
    const { app } = createMockedApp();

    const status = await request(app).get("/api/securekit/keystroke/status").query({
      userId: "emre",
      textId: TEXT_ID,
    });

    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      ok: true,
      userId: "emre",
      textId: TEXT_ID,
      registered: false,
      template: null,
    });
  });

  it("updates template metadata when verification auto-enrolls", async () => {
    const nowRef = { value: NOW };
    const pythonBridge = vi.fn(
      async (input: PythonBridgeInput): Promise<PythonEnrollOutput | PythonVerifyOutput> => {
        if (input.op === "enroll") {
          return {
            ok: true,
            template: createRawTemplate(input.samples.length),
            recommended: {
              distThreshold: 2.5,
              scoreThreshold: 70,
              autoEnrollScore: 82,
            },
          };
        }

        return {
          ok: true,
          score: 96,
          dist: 0.2,
          decision: "accept",
          autoEnrolled: true,
          template: createRawTemplate((input.template?.count ?? 0) + 1),
        };
      }
    );
    const { app } = createMockedApp({ nowRef, pythonBridge });

    await request(app).post("/api/securekit/keystroke/enroll").send({
      userId: USER_ID,
      textId: TEXT_ID,
      expectedText: EXPECTED_TEXT,
      samples: createSyntheticFixedTextSamples({
        textId: TEXT_ID,
        text: EXPECTED_TEXT,
        profile: "A",
        sampleCount: 10,
        timestampMs: NOW - 100,
      }),
    });

    nowRef.value = NOW_2;

    const verify = await request(app).post("/api/securekit/keystroke/verify").send({
      userId: USER_ID,
      textId: TEXT_ID,
      expectedText: EXPECTED_TEXT,
      sample: createSyntheticFixedTextSample({
        textId: TEXT_ID,
        text: EXPECTED_TEXT,
        profile: "A",
        seed: 777,
        timestampMs: NOW_2 - 100,
      }),
      opts: {
        autoEnroll: true,
      },
    });

    expect(verify.status).toBe(200);
    expect(verify.body.metrics.count).toBe(11);

    const status = await request(app).get("/api/securekit/keystroke/status").query({
      userId: USER_ID,
      textId: TEXT_ID,
    });

    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      registered: true,
      template: {
        expectedText: EXPECTED_TEXT,
        sampleCount: 11,
        updatedAt: NOW_2,
      },
    });
  });

  it("passes fixed-text correction metadata through to the python bridge", async () => {
    const pythonBridge = vi.fn(
      async (input: PythonBridgeInput): Promise<PythonEnrollOutput | PythonVerifyOutput> => ({
        ok: true,
        template: createRawTemplate(input.samples.length),
        recommended: {
          distThreshold: 2.5,
          scoreThreshold: 70,
          autoEnrollScore: 82,
        },
      })
    );
    const { app } = createMockedApp({ pythonBridge });
    const sample = createSyntheticFixedTextSample({
      textId: TEXT_ID,
      text: EXPECTED_TEXT,
      profile: "A",
      seed: 111,
      timestampMs: NOW - 100,
    });
    sample.corrections = {
      events: [
        {
          type: "mismatch",
          t: 120,
          index: 1,
          key: "x",
          expected: "e",
        },
        {
          type: "backspace",
          t: 150,
          index: 1,
          removed: "x",
        },
      ],
      mismatchCount: 1,
      extraCount: 0,
      backspaceCount: 1,
    };

    const enroll = await request(app).post("/api/securekit/keystroke/enroll").send({
      userId: USER_ID,
      textId: TEXT_ID,
      expectedText: EXPECTED_TEXT,
      samples: [sample],
    });

    expect(enroll.status).toBe(200);
    expect(pythonBridge).toHaveBeenCalledTimes(1);
    const [input] = pythonBridge.mock.calls[0];
    expect(input.samples[0].corrections).toEqual(sample.corrections);
  });

  it("rejects malformed fixed-text correction metadata before python runs", async () => {
    const { app, pythonBridge } = createMockedApp();
    const sample = createSyntheticFixedTextSample({
      textId: TEXT_ID,
      text: EXPECTED_TEXT,
      profile: "A",
      seed: 111,
      timestampMs: NOW - 100,
    });
    sample.corrections = {
      events: [
        {
          type: "oops",
          t: 120,
          index: 1,
        },
      ],
      mismatchCount: 0,
      extraCount: 0,
      backspaceCount: 0,
    } as unknown as typeof sample.corrections;

    const enroll = await request(app).post("/api/securekit/keystroke/enroll").send({
      userId: USER_ID,
      textId: TEXT_ID,
      expectedText: EXPECTED_TEXT,
      samples: [sample],
    });

    expect(enroll.status).toBe(400);
    expect(enroll.body.error.details.fieldErrors).toMatchObject({
      "samples[0].corrections.events[0].type": "type must be mismatch, extra, or backspace.",
    });
    expect(pythonBridge).not.toHaveBeenCalled();
  });
});
