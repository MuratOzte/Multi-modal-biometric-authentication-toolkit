import { describe, expect, it, vi } from "vitest";
import type {
  VoiceEnrollmentResponse,
  VoiceVerificationResult,
} from "@securekit/core";
import { SecureKitClient } from "../index";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const runtime = {
  device: "cuda" as const,
  cudaAvailable: true,
  cudaDeviceName: "NVIDIA GeForce RTX 3050 Laptop GPU",
  fallbackReason: null,
  whisperModel: "base",
  speakerModel: "speechbrain/spkrec-ecapa-voxceleb",
};

const transcript = {
  expectedText: "Sakin ruzgar testi.",
  transcript: "Sakin ruzgar testi.",
  similarityScore: 1,
  matched: true,
  threshold: 0.78,
};

describe("SecureKitClient voice methods", () => {
  it("enrollVoice posts multipart form data to /enroll/voice", async () => {
    const fixture: VoiceEnrollmentResponse = {
      ok: true,
      userId: "u1",
      profile: {
        embedding: [1, 0],
        sampleCount: 1,
        embeddingDim: 2,
        enrolledAt: "2026-04-28T12:00:00.000Z",
        updatedAt: "2026-04-28T12:00:00.000Z",
        model: "speechbrain/spkrec-ecapa-voxceleb",
      },
      enrollmentProgress: {
        sampleCount: 1,
        requiredSamples: 3,
        complete: false,
      },
      transcript,
      runtime,
      reasons: ["VOICE_ENROLLMENT_IN_PROGRESS"],
    };

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const audio = new Blob(["voice"], { type: "audio/webm" });
    const result = await client.enrollVoice({
      userId: "u1",
      challengeId: "c1",
      audioSample: audio,
      audioFileName: "voice.webm",
      minEnrollmentSamples: 3,
    });

    expect(result).toEqual(fixture);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/enroll/voice");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get("userId")).toBe("u1");
    expect(body.get("challengeId")).toBe("c1");
    expect(body.get("audioSample")).toBeInstanceOf(Blob);
    expect(body.get("minEnrollmentSamples")).toBe("3");
  });

  it("verifyVoice posts multipart form data to /verify/voice", async () => {
    const fixture: VoiceVerificationResult = {
      ok: true,
      userId: "u1",
      matched: true,
      similarityScore: 0.94,
      decision: "allow",
      reasons: ["VOICE_MATCH"],
      transcript,
      runtime,
      profile: null,
      profileUpdated: false,
      signalsUsed: {
        voice: {
          similarityScore: 0.94,
          decision: "allow",
          reasons: ["VOICE_MATCH"],
          transcript,
          runtime,
          thresholds: {
            matchThreshold: 0.85,
            stepUpThreshold: 0.5,
            denyThreshold: 0.35,
            transcriptThreshold: 0.78,
          },
        },
      },
    };

    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const audio = new Blob(["voice"], { type: "audio/webm" });
    const result = await client.verifyVoice({
      userId: "u1",
      challengeId: "c2",
      audioSample: audio,
      matchThreshold: 0.85,
      transcriptThreshold: 0.78,
    });

    expect(result).toEqual(fixture);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/verify/voice");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);

    const body = init.body as FormData;
    expect(body.get("userId")).toBe("u1");
    expect(body.get("challengeId")).toBe("c2");
    expect(body.get("audioSample")).toBeInstanceOf(Blob);
    expect(body.get("matchThreshold")).toBe("0.85");
    expect(body.get("transcriptThreshold")).toBe("0.78");
  });
});
