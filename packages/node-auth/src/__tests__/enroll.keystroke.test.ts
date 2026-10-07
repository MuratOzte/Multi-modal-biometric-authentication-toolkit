import request from "supertest";
import { describe, expect, it } from "vitest";
import type { KeystrokeEvent } from "@securekit/core";
import { createApp } from "../server";
import { InMemoryAdapter } from "../storage/inMemoryAdapter";

const NOW = "2026-02-18T12:00:00.000Z";
const NOW_2 = "2026-02-18T12:05:00.000Z";

const EVENTS: KeystrokeEvent[] = [
  { key: "a", type: "down", t: 0 },
  { key: "a", type: "up", t: 100 },
  { key: "b", type: "down", t: 140 },
  { key: "b", type: "up", t: 230 },
  { key: "c", type: "down", t: 270 },
  { key: "c", type: "up", t: 360 },
  { key: "d", type: "down", t: 400 },
  { key: "d", type: "up", t: 500 },
  { key: "e", type: "down", t: 540 },
  { key: "e", type: "up", t: 630 },
];

const SPACE_EVENTS: KeystrokeEvent[] = [
  { key: "h", type: "down", t: 0 },
  { key: "h", type: "up", t: 70 },
  { key: " ", code: "Space", type: "down", t: 110 },
  { key: " ", code: "Space", type: "up", t: 150 },
  { key: "i", type: "down", t: 200 },
  { key: "i", type: "up", t: 290 },
];

describe("keystroke enrollment endpoint", () => {
  it("returns CONSENT_REQUIRED when enrollment is attempted without consent", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      nowFnIso: () => NOW,
    });

    const response = await request(app).post("/enroll/keystroke").send({
      userId: "u1",
      events: EVENTS,
    });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: {
        code: "CONSENT_REQUIRED",
      },
    });
  });

  it("enrolls keystroke profile after consent and does not return raw events", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      nowFnIso: () => NOW,
    });

    await request(app).post("/consent").send({
      userId: "u1",
      consentVersion: "v1",
    });

    const response = await request(app).post("/enroll/keystroke").send({
      userId: "u1",
      events: EVENTS,
    });

    expect(response.status).toBe(200);
    expect(response.body.profile.userId).toBe("u1");
    expect(response.body.profile.createdAt).toBe(NOW);
    expect(response.body.profile.updatedAt).toBe(NOW);
    expect(response.body.profile.sampleCount).toBeGreaterThan(0);
    expect(typeof response.body.profile.holdMeanMs).toBe("number");
    expect(typeof response.body.profile.flightMeanMs).toBe("number");
    expect(response.body.profile).not.toHaveProperty("events");
  });

  it("re-enroll keeps createdAt and updates updatedAt", async () => {
    const timeline = [NOW, NOW, NOW_2];
    let cursor = 0;

    const app = createApp({
      storage: new InMemoryAdapter(),
      nowFnIso: () => {
        const value = timeline[Math.min(cursor, timeline.length - 1)];
        cursor += 1;
        return value;
      },
    });

    await request(app).post("/consent").send({
      userId: "u1",
      consentVersion: "v1",
    });

    const first = await request(app).post("/enroll/keystroke").send({
      userId: "u1",
      events: EVENTS,
    });

    const second = await request(app).post("/enroll/keystroke").send({
      userId: "u1",
      events: EVENTS,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.profile.createdAt).toBe(NOW);
    expect(first.body.profile.updatedAt).toBe(NOW);
    expect(second.body.profile.createdAt).toBe(NOW);
    expect(second.body.profile.updatedAt).toBe(NOW_2);
  });

  it("accepts raw space key events in sample payload", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      nowFnIso: () => NOW,
    });

    await request(app).post("/consent").send({
      userId: "u1",
      consentVersion: "v1",
    });

    const response = await request(app).post("/enroll/keystroke").send({
      userId: "u1",
      sample: {
        events: SPACE_EVENTS,
        expectedText: "h i",
        typedLength: 3,
        source: "collector_v1",
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
