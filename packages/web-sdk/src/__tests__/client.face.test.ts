import { describe, expect, it, vi } from "vitest";
import type {
  FaceEnrollmentReferenceResponse,
  FaceSlidingWindowVerificationResult,
  FaceVerificationResult,
} from "@securekit/core";
import { SecureKitClient } from "../index";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecureKitClient face methods", () => {
  it("enrollFaceReference posts multipart form data to /enroll/face/reference", async () => {
    const fixture: FaceEnrollmentReferenceResponse = {
      ok: true,
      userId: "u1",
      reference: {
        imagePath: "/tmp/reference-u1.jpg",
        enrolledAt: "2026-03-06T12:00:00.000Z",
        source: "upload",
      },
    };

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const referenceBlob = new Blob(["reference"], { type: "image/jpeg" });
    const result = await client.enrollFaceReference({
      userId: "u1",
      referenceImage: referenceBlob,
      referenceFileName: "reference.jpg",
    });

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/enroll/face/reference");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get("userId")).toBe("u1");
    expect(body.get("referenceImage")).toBeInstanceOf(Blob);
  });

  it("verifyFace posts multipart form data to /verify/face", async () => {
    const fixture: FaceVerificationResult = {
      ok: true,
      matched: true,
      score: 0.91,
      reason: null,
    };

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const probeBlob = new Blob(["probe"], { type: "image/jpeg" });
    const result = await client.verifyFace({
      userId: "u1",
      probeImage: probeBlob,
      threshold: 0.8,
    });

    expect(result).toEqual(fixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/verify/face");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get("userId")).toBe("u1");
    expect(body.get("probeImage")).toBeInstanceOf(Blob);
    expect(body.get("threshold")).toBe("0.8");
  });

  it("verifyFace rejects when no reference source is provided", async () => {
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    await expect(
      client.verifyFace({
        probeImage: new Blob(["probe"], { type: "image/jpeg" }),
      })
    ).rejects.toThrow("verifyFace requires one reference source");
  });

  it("verifyFaceLiveness posts illumination metrics", async () => {
    const fixture = {
      ok: true,
      score: 1,
      details: { illuminationOk: true },
    };

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.verifyFaceLiveness({
      proof: { tasksOk: true },
      metrics: {
        quality: 0.92,
        illuminationOk: true,
        baselineY: 101,
        flashY: 116,
        deltaY: 15,
        relativeDelta: 0.15,
        sampleCount: 15,
      },
    });

    expect(result).toEqual(fixture);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/verify/face:liveness");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      proof: { tasksOk: true },
      metrics: {
        quality: 0.92,
        illuminationOk: true,
        deltaY: 15,
        sampleCount: 15,
      },
    });
  });

  it("verifyFaceSlidingWindow posts multipart form data to /verify/face-sliding", async () => {
    const fixture: FaceSlidingWindowVerificationResult = {
      ok: true,
      matched: true,
      score: 0.9,
      reason: null,
      perReferenceScores: [
        { id: "a", ts: 1, score: 0.89 },
        { id: "b", ts: 2, score: 0.91 },
        { id: "c", ts: 3, score: 0.9 },
      ],
      windowSizeBefore: 3,
      windowSizeAfter: 3,
      threshold: 0.8,
      added: { id: "d", ts: 4, image: "d.jpg" },
      evicted: [{ id: "a", ts: 1, image: "a.jpg" }],
    };

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.verifyFaceSlidingWindow({
      userId: "u1",
      probeImage: new Blob(["probe"], { type: "image/jpeg" }),
      threshold: 0.8,
      maxWindow: 3,
      updateOnSuccess: true,
    });

    expect(result).toEqual(fixture);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/verify/face-sliding");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get("userId")).toBe("u1");
    expect(body.get("probeImage")).toBeInstanceOf(Blob);
    expect(body.get("threshold")).toBe("0.8");
    expect(body.get("maxWindow")).toBe("3");
    expect(body.get("updateOnSuccess")).toBe("true");
  });
});
