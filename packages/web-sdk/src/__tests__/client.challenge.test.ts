import { describe, expect, it, vi } from "vitest";
import type { ChallengeTextResponse } from "@securekit/core";
import { SecureKitClient } from "../index";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecureKitClient challenge methods", () => {
  it("getTextChallenge posts expected body to /challenge/text", async () => {
    const fixture: ChallengeTextResponse = {
      challengeId: "c1",
      text: "deniz orman ruzgar bahar yol",
      lang: "tr",
      expiresAt: "2026-01-01T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.getTextChallenge({
      lang: "tr",
      length: "short",
      wordCount: 6,
    });

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/challenge/text")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ lang: "tr", length: "short", wordCount: 6 }));
  });
});
