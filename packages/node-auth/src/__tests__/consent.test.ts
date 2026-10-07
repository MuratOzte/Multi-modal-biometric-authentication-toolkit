import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server";
import { InMemoryAdapter } from "../storage/inMemoryAdapter";

const NOW = "2026-02-18T12:00:00.000Z";

describe("consent endpoint", () => {
  it("POST /consent stores consent log and returns deterministic grantedAt", async () => {
    const storage = new InMemoryAdapter();
    const app = createApp({
      storage,
      nowFnIso: () => NOW,
    });

    const response = await request(app).post("/consent").send({
      userId: "u1",
      consentVersion: "v1",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      userId: "u1",
      consentVersion: "v1",
      grantedAt: NOW,
    });

    const logs = await storage.listConsentLogs("u1");
    expect(logs).toEqual([
      {
        userId: "u1",
        consentVersion: "v1",
        grantedAt: NOW,
      },
    ]);
  });

  it("POST /consent returns validation error for missing userId", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      nowFnIso: () => NOW,
    });

    const response = await request(app).post("/consent").send({
      consentVersion: "v1",
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
  });
});
