import request from "supertest";
import { describe, expect, it } from "vitest";
import type { KeystrokeEvent } from "@securekit/core";
import { createApp } from "../server";
import { InMemoryAdapter } from "../storage/inMemoryAdapter";

const NOW = "2026-02-18T12:00:00.000Z";

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

describe("user biometrics delete endpoint", () => {
  it("deletes profiles while keeping consent by default", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      nowFnIso: () => NOW,
    });

    await request(app).post("/consent").send({
      userId: "u1",
      consentVersion: "v1",
    });

    await request(app).post("/enroll/keystroke").send({
      userId: "u1",
      events: EVENTS,
    });

    const beforeDelete = await request(app).get("/user/u1/profiles");
    expect(beforeDelete.status).toBe(200);
    expect(beforeDelete.body.profiles.keystroke).toBeTruthy();

    const deleted = await request(app).delete("/user/biometrics").send({
      userId: "u1",
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({
      ok: true,
      userId: "u1",
    });

    const afterDelete = await request(app).get("/user/u1/profiles");
    expect(afterDelete.status).toBe(200);
    expect(afterDelete.body.profiles.keystroke).toBeNull();

    const reEnroll = await request(app).post("/enroll/keystroke").send({
      userId: "u1",
      events: EVENTS,
    });

    expect(reEnroll.status).toBe(200);
  });

  it("can delete consent logs when deleteConsent=true is passed", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      nowFnIso: () => NOW,
    });

    await request(app).post("/consent").send({
      userId: "u2",
      consentVersion: "v1",
    });

    await request(app).post("/enroll/keystroke").send({
      userId: "u2",
      events: EVENTS,
    });

    const deleted = await request(app)
      .delete("/user/biometrics?deleteConsent=true")
      .send({
        userId: "u2",
      });

    expect(deleted.status).toBe(200);

    const enrollAgain = await request(app).post("/enroll/keystroke").send({
      userId: "u2",
      events: EVENTS,
    });

    expect(enrollAgain.status).toBe(403);
    expect(enrollAgain.body).toMatchObject({
      error: {
        code: "CONSENT_REQUIRED",
      },
    });
  });
});
