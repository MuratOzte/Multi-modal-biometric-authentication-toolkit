import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server";
import { InMemorySessionStore } from "../session/inMemoryStore";

describe("session start endpoint", () => {
  it("POST /session/start returns session id and expiry", async () => {
    const nowMs = Date.UTC(2026, 0, 1, 10, 0, 0);
    const ttlMs = 15 * 60 * 1000;
    const store = new InMemorySessionStore({
      nowFn: () => nowMs,
      ttlMs,
    });

    const app = createApp({ sessionStore: store });
    const response = await request(app).post("/session/start").send({});

    expect(response.status).toBe(200);
    expect(response.body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(typeof response.body.expiresAt).toBe("string");
    expect(Date.parse(response.body.expiresAt)).toBe(nowMs + ttlMs);
  });
});
