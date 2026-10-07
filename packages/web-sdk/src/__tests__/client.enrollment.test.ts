import { describe, expect, it, vi } from "vitest";
import type {
  ConsentResponse,
  DeleteBiometricsResponse,
  EnrollKeystrokeResponse,
  GetProfilesResponse,
} from "@securekit/core";
import { SecureKitClient } from "../index";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecureKitClient enrollment methods", () => {
  it("grantConsent posts expected body to /consent", async () => {
    const fixture: ConsentResponse = {
      ok: true,
      userId: "u1",
      consentVersion: "v1",
      grantedAt: "2026-02-18T12:00:00.000Z",
    };
    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const payload = {
      userId: "u1",
      consentVersion: "v1",
    };

    const result = await client.grantConsent(payload);

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/consent")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it("enrollKeystroke posts expected body to /enroll/keystroke", async () => {
    const fixture: EnrollKeystrokeResponse = {
      ok: true,
      profile: {
        userId: "u1",
        createdAt: "2026-02-18T12:00:00.000Z",
        updatedAt: "2026-02-18T12:00:00.000Z",
        sampleCount: 5,
        holdMeanMs: 95,
        holdStdMs: 0,
        flightMeanMs: 135,
        flightStdMs: 0,
      },
    };
    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const payload = {
      userId: "u1",
      events: [
        { key: "a", type: "down" as const, t: 0 },
        { key: "a", type: "up" as const, t: 100 },
      ],
    };

    const result = await client.enrollKeystroke(payload);

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/enroll/keystroke")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it("deleteBiometrics sends DELETE /user/biometrics with userId body", async () => {
    const fixture: DeleteBiometricsResponse = {
      ok: true,
      userId: "u1",
    };
    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.deleteBiometrics("u1");

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/user/biometrics")).toBe(true);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBe(JSON.stringify({ userId: "u1" }));
  });

  it("getProfiles sends GET /user/:userId/profiles", async () => {
    const fixture: GetProfilesResponse = {
      ok: true,
      profiles: {
        userId: "u1",
        keystroke: null,
        faceEmbedding: null,
        voiceEmbedding: null,
        updatedAt: "2026-02-18T12:00:00.000Z",
      },
    };
    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.getProfiles("u1");

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe("http://localhost:3001/user/u1/profiles");
    expect(init).toBeUndefined();
  });
});
