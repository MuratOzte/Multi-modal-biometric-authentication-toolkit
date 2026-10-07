import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  VoicePythonBridgeError,
  type VoicePythonInput,
  type VoicePythonResult,
} from "../voice/pythonBridge";
import type { VoicePythonRunner } from "../voice/types";
import { createApp } from "../server";
import { InMemoryAdapter } from "../storage/inMemoryAdapter";

const NOW = "2026-04-28T12:00:00.000Z";
const CHALLENGE_TEXT = "Sakin ruzgar testi.";

const RUNTIME = {
  device: "cuda" as const,
  cudaAvailable: true,
  cudaDeviceName: "NVIDIA GeForce RTX 3050 Laptop GPU",
  fallbackReason: null,
  whisperModel: "base",
  speakerModel: "speechbrain/spkrec-ecapa-voxceleb",
};

function attachAudio(
  req: request.Test,
  contentType = "audio/webm",
  seed = "voice-binary"
): request.Test {
  return req.attach("audioSample", Buffer.from(seed), {
    filename: "voice.webm",
    contentType,
  });
}

async function createChallenge(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await request(app).post("/challenge/text").send({
    lang: "tr",
    text: CHALLENGE_TEXT,
  });

  expect(response.status).toBe(200);
  return response.body.challengeId as string;
}

function makeResult(input: VoicePythonInput, embedding: number[], matched = true): VoicePythonResult {
  return {
    ok: true,
    embedding,
    transcript: {
      expectedText: input.expectedText,
      transcript: matched ? input.expectedText : "baska bir metin",
      similarityScore: matched ? 1 : 0.1,
      matched,
      threshold: input.transcriptThreshold,
    },
    runtime: RUNTIME,
    reason: null,
  };
}

function queuedRunner(embeddings: number[][], matched = true): VoicePythonRunner {
  let index = 0;
  return vi.fn(async (input) => {
    const embedding = embeddings[Math.min(index, embeddings.length - 1)];
    index += 1;
    return makeResult(input, embedding, matched);
  });
}

async function grantConsent(app: ReturnType<typeof createApp>, userId: string): Promise<void> {
  const response = await request(app).post("/consent").send({
    userId,
    consentVersion: "voice-v1",
  });
  expect(response.status).toBe(200);
}

describe("voice verification routes", () => {
  it("enrolls three voice samples and stores only the embedding profile", async () => {
    const storage = new InMemoryAdapter();
    const app = createApp({
      storage,
      nowFnIso: () => NOW,
      voicePythonRunner: queuedRunner([
        [1, 0],
        [1, 0],
        [1, 0],
      ]),
    });

    await grantConsent(app, "u1");

    for (let round = 1; round <= 3; round += 1) {
      const challengeId = await createChallenge(app);
      const response = await attachAudio(
        request(app)
          .post("/enroll/voice")
          .field("userId", "u1")
          .field("challengeId", challengeId)
      );

      expect(response.status).toBe(200);
      expect(response.body.enrollmentProgress.sampleCount).toBe(round);
      expect(response.body.enrollmentProgress.requiredSamples).toBe(3);
    }

    const profiles = await request(app).get("/user/u1/profiles");
    expect(profiles.status).toBe(200);
    expect(profiles.body.profiles.voice).toMatchObject({
      sampleCount: 3,
      embeddingDim: 2,
    });
    expect(profiles.body.profiles.voiceEmbedding).toEqual([1, 0]);
  });

  it("verifies same speaker as allow and different speaker as deny", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      nowFnIso: () => NOW,
      voicePythonRunner: queuedRunner([
        [1, 0],
        [1, 0],
        [0, 1],
      ]),
    });

    await grantConsent(app, "u2");

    const enrollChallengeId = await createChallenge(app);
    const enroll = await attachAudio(
      request(app)
        .post("/enroll/voice")
        .field("userId", "u2")
        .field("challengeId", enrollChallengeId)
    );
    expect(enroll.status).toBe(200);

    const allowChallengeId = await createChallenge(app);
    const allow = await attachAudio(
      request(app)
        .post("/verify/voice")
        .field("userId", "u2")
        .field("challengeId", allowChallengeId)
        .field("matchThreshold", "0.85")
        .field("stepUpThreshold", "0.5")
    );
    expect(allow.status).toBe(200);
    expect(allow.body.decision).toBe("allow");
    expect(allow.body.runtime.device).toBe("cuda");

    const denyChallengeId = await createChallenge(app);
    const deny = await attachAudio(
      request(app)
        .post("/verify/voice")
        .field("userId", "u2")
        .field("challengeId", denyChallengeId)
        .field("matchThreshold", "0.9")
        .field("stepUpThreshold", "0.7")
    );
    expect(deny.status).toBe(200);
    expect(deny.body.decision).toBe("deny");
    expect(deny.body.reasons).toContain("LOW_SIMILARITY");
  });

  it("rejects enrollment when the spoken transcript does not match the challenge", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      voicePythonRunner: queuedRunner([[1, 0]], false),
    });
    await grantConsent(app, "u3");

    const challengeId = await createChallenge(app);
    const response = await attachAudio(
      request(app)
        .post("/enroll/voice")
        .field("userId", "u3")
        .field("challengeId", challengeId)
    );

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: {
        code: "TRANSCRIPT_MISMATCH",
      },
    });
  });

  it("returns PROFILE_NOT_FOUND when verifying before enrollment", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      voicePythonRunner: queuedRunner([[1, 0]]),
    });
    const challengeId = await createChallenge(app);

    const response = await attachAudio(
      request(app)
        .post("/verify/voice")
        .field("userId", "missing")
        .field("challengeId", challengeId)
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: {
        code: "PROFILE_NOT_FOUND",
      },
    });
  });

  it("rejects invalid audio MIME types", async () => {
    const app = createApp({ storage: new InMemoryAdapter() });
    const challengeId = await createChallenge(app);

    const response = await attachAudio(
      request(app)
        .post("/enroll/voice")
        .field("userId", "u4")
        .field("challengeId", challengeId),
      "text/plain"
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: "INVALID_AUDIO_TYPE",
      },
    });
  });

  it("reports missing voice Python dependencies with a setup-oriented error", async () => {
    const runner: VoicePythonRunner = vi.fn(async () => {
      throw new VoicePythonBridgeError(
        "PYTHON_DEPENDENCY_MISSING",
        "Python voice dependency is missing: whisper.",
        "ModuleNotFoundError: No module named 'whisper'"
      );
    });
    const app = createApp({
      storage: new InMemoryAdapter(),
      voicePythonRunner: runner,
    });
    await grantConsent(app, "u-deps");

    const challengeId = await createChallenge(app);
    const response = await attachAudio(
      request(app)
        .post("/enroll/voice")
        .field("userId", "u-deps")
        .field("challengeId", challengeId)
    );

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      error: {
        code: "PYTHON_DEPENDENCY_MISSING",
        message: "Python voice dependency is missing: whisper.",
        details: "ModuleNotFoundError: No module named 'whisper'",
      },
    });
  });

  it("rejects already consumed voice challenges", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      voicePythonRunner: queuedRunner([
        [1, 0],
        [1, 0],
      ]),
    });
    await grantConsent(app, "u5");

    const challengeId = await createChallenge(app);
    const first = await attachAudio(
      request(app)
        .post("/enroll/voice")
        .field("userId", "u5")
        .field("challengeId", challengeId)
    );
    expect(first.status).toBe(200);

    const second = await attachAudio(
      request(app)
        .post("/enroll/voice")
        .field("userId", "u5")
        .field("challengeId", challengeId)
    );
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CHALLENGE_ALREADY_USED");
  });

  it("removes temporary audio after the Python runner returns", async () => {
    let capturedAudioPath = "";
    const runner: VoicePythonRunner = vi.fn(async (input) => {
      capturedAudioPath = input.audioPath;
      expect(existsSync(input.audioPath)).toBe(true);
      return makeResult(input, [1, 0]);
    });
    const app = createApp({
      storage: new InMemoryAdapter(),
      voicePythonRunner: runner,
    });
    await grantConsent(app, "u6");

    const challengeId = await createChallenge(app);
    const response = await attachAudio(
      request(app)
        .post("/enroll/voice")
        .field("userId", "u6")
        .field("challengeId", challengeId)
    );

    expect(response.status).toBe(200);
    await expect(access(capturedAudioPath)).rejects.toThrow();
  });
});
