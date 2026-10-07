import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server";
import { InMemoryChallengeStore } from "../challenge/inMemoryStore";
import { generateChallengeText } from "../challenge/generateText";

const NOW_BASE_MS = 1700000000000;

function createDeterministicRng() {
  let index = 0;
  const sequence = [0.1, 0.5, 0.9, 0.2, 0.7];
  return () => {
    const value = sequence[index % sequence.length];
    index += 1;
    return value;
  };
}

function createDeterministicApp(args: { ttlSeconds?: number } = {}) {
  const nowRef = { value: NOW_BASE_MS };

  const app = createApp({
    challengeRng: createDeterministicRng(),
    nowFn: () => nowRef.value,
    challengeStore: new InMemoryChallengeStore(),
    challengeTtlSeconds: args.ttlSeconds ?? 120,
  });

  return { app, nowRef };
}

describe("challenge text endpoints", () => {
  it("POST /challenge/text returns deterministic default Turkish sentence", async () => {
    const { app } = createDeterministicApp();

    const response = await request(app).post("/challenge/text").send({});
    const expectedText = generateChallengeText({
      lang: "tr",
      length: "short",
      rng: createDeterministicRng(),
    });

    expect(response.status).toBe(200);
    expect(response.body.challengeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(response.body.lang).toBe("tr");
    expect(response.body.text).toBe(expectedText);
    const letterCount = Array.from(String(response.body.text)).filter((char) =>
      /\p{L}/u.test(char)
    ).length;
    expect(letterCount).toBeGreaterThanOrEqual(40);
    expect(letterCount).toBeLessThanOrEqual(50);
    expect(Date.parse(response.body.expiresAt)).toBe(NOW_BASE_MS + 120_000);
  });

  it("POST /challenge/text returns 40-50 letter Turkish sentence for tr medium", async () => {
    const { app } = createDeterministicApp();

    const response = await request(app).post("/challenge/text").send({
      lang: "tr",
      length: "medium",
    });

    const letterCount = Array.from(String(response.body.text)).filter((char) =>
      /\p{L}/u.test(char)
    ).length;

    expect(response.status).toBe(200);
    expect(response.body.lang).toBe("tr");
    expect(letterCount).toBeGreaterThanOrEqual(40);
    expect(letterCount).toBeLessThanOrEqual(50);
    expect(Date.parse(response.body.expiresAt)).toBe(NOW_BASE_MS + 120_000);
  });

  it("POST /challenge/text supports numeric wordCount", async () => {
    const { app } = createDeterministicApp();

    const response = await request(app).post("/challenge/text").send({
      lang: "en",
      wordCount: 4,
    });

    const words = String(response.body.text)
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);

    expect(response.status).toBe(200);
    expect(response.body.lang).toBe("en");
    expect(words).toHaveLength(4);
  });

  it("POST /challenge/text uses provided text when text is given", async () => {
    const { app } = createDeterministicApp();
    const providedText = "Sakin rüzgar sessiz kıyıda usulca iz bırakır.";

    const response = await request(app).post("/challenge/text").send({
      lang: "tr",
      text: providedText,
    });

    expect(response.status).toBe(200);
    expect(response.body.lang).toBe("tr");
    expect(response.body.text).toBe(providedText);
  });

  it("POST /challenge/text/consume enforces single-use behavior", async () => {
    const { app } = createDeterministicApp();

    const created = await request(app).post("/challenge/text").send({});
    const challengeId = created.body.challengeId as string;

    const firstConsume = await request(app).post("/challenge/text/consume").send({
      challengeId,
    });

    expect(firstConsume.status).toBe(200);
    expect(firstConsume.body).toEqual({
      ok: true,
      challengeId,
    });

    const secondConsume = await request(app).post("/challenge/text/consume").send({
      challengeId,
    });

    expect(secondConsume.status).toBe(409);
    expect(secondConsume.body).toMatchObject({
      error: { code: "CHALLENGE_ALREADY_USED" },
    });
  });

  it("POST /challenge/text/consume returns CHALLENGE_EXPIRED when ttl is exceeded", async () => {
    const { app, nowRef } = createDeterministicApp({ ttlSeconds: 1 });

    const created = await request(app).post("/challenge/text").send({});
    const challengeId = created.body.challengeId as string;

    nowRef.value = NOW_BASE_MS + 2_000;

    const response = await request(app).post("/challenge/text/consume").send({
      challengeId,
    });

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({
      error: { code: "CHALLENGE_EXPIRED" },
    });
  });

  it("POST /challenge/text/consume returns CHALLENGE_NOT_FOUND for unknown id", async () => {
    const { app } = createDeterministicApp();

    const response = await request(app).post("/challenge/text/consume").send({
      challengeId: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: "CHALLENGE_NOT_FOUND" },
    });
  });
});
