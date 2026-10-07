import { describe, expect, it } from "vitest";
import {
  VoicePythonBridgeError,
  buildVoicePythonEnv,
  normalizeVoicePythonResult,
} from "../voice/pythonBridge";

describe("voice python bridge parsing", () => {
  it("forces UTF-8 stdio for Python workers", () => {
    const env = buildVoicePythonEnv({
      PATH: "test-path",
      PYTHONIOENCODING: "cp1254",
      PYTHONUTF8: "0",
    });

    expect(env.PATH).toBe("test-path");
    expect(env.PYTHONIOENCODING).toBe("utf-8");
    expect(env.PYTHONUTF8).toBe("1");
  });

  it("normalizes CUDA runtime and embedding output", () => {
    const result = normalizeVoicePythonResult({
      ok: true,
      embedding: [0.1, 0.2, 0.3],
      transcript: {
        expectedText: "Sakin ruzgar testi.",
        transcript: "Sakin ruzgar testi.",
        similarityScore: 1,
        matched: true,
        threshold: 0.78,
      },
      runtime: {
        device: "cuda",
        cudaAvailable: true,
        cudaDeviceName: "NVIDIA GeForce RTX 3050 Laptop GPU",
        fallbackReason: null,
        whisperModel: "base",
        speakerModel: "speechbrain/spkrec-ecapa-voxceleb",
      },
      reason: null,
    });

    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.runtime).toMatchObject({
      device: "cuda",
      cudaAvailable: true,
    });
  });

  it("preserves Turkish transcript text during normalization", () => {
    const result = normalizeVoicePythonResult({
      ok: true,
      embedding: null,
      transcript: {
        expectedText: "Denge, yankı, orman, şehir, bulut, pencere, nehir, yağmur.",
        transcript: "Denge, yankı, orman, şehir, bulut, pencere, nehir, yağmur.",
        similarityScore: 1,
        matched: true,
        threshold: 0.78,
      },
      runtime: {
        device: "cpu",
        cudaAvailable: false,
      },
      reason: null,
    });

    expect(result.transcript.transcript).toBe(
      "Denge, yankı, orman, şehir, bulut, pencere, nehir, yağmur."
    );
  });

  it("rejects malformed embedding output", () => {
    expect(() =>
      normalizeVoicePythonResult({
        ok: true,
        embedding: [0.1, "bad"],
        transcript: {
          expectedText: "x",
          transcript: "x",
          similarityScore: 1,
          matched: true,
          threshold: 0.78,
        },
        runtime: {
          device: "cpu",
          cudaAvailable: false,
        },
        reason: null,
      })
    ).toThrow(VoicePythonBridgeError);
  });
});
