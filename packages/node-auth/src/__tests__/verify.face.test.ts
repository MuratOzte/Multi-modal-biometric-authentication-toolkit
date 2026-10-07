import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server";
import { FacePythonBridgeError } from "../face/pythonBridge";

function jpegBuffer(seed: string): Buffer {
  return Buffer.from(`${seed}-image-binary`);
}

function attachImage(
  req: request.Test,
  fieldName: string,
  fileName: string,
  seed: string,
  contentType = "image/jpeg"
): request.Test {
  return req.attach(fieldName, jpegBuffer(seed), {
    filename: fileName,
    contentType,
  });
}

async function createReferenceDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "securekit-face-test-"));
}

describe("face verification routes", () => {
  it("accepts face liveness when tasks, quality, and illumination pass", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/verify/face:liveness")
      .send({
        proof: { tasksOk: true },
        metrics: {
          quality: 0.91,
          illuminationOk: true,
          baselineY: 104,
          flashY: 121,
          deltaY: 17,
          relativeDelta: 0.16,
          sampleCount: 15,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      score: 1,
      details: { illuminationOk: true },
    });
  });

  it("rejects face liveness when illumination explicitly fails", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/verify/face:liveness")
      .send({
        proof: { tasksOk: true },
        metrics: {
          quality: 0.95,
          illuminationOk: false,
          baselineY: 180,
          flashY: 184,
          deltaY: 4,
          relativeDelta: 0.02,
          sampleCount: 15,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: false,
      score: 0,
      details: { illuminationOk: false },
    });
  });

  it("uses mapped sample reference for known user ids without enrollment", async () => {
    const facePythonRunner = vi.fn(async () => ({
      ok: true,
      matched: true,
      score: 0.88,
      reason: null,
    }));
    const app = createApp({ facePythonRunner });

    const verify = await attachImage(
      request(app).post("/verify/face").field("userId", "emre"),
      "probeImage",
      "probe.jpg",
      "probe-emre"
    );

    expect(verify.status).toBe(200);
    expect(verify.body).toEqual({
      ok: true,
      matched: true,
      score: 0.88,
      reason: null,
    });
    expect(facePythonRunner).toHaveBeenCalledTimes(1);
    expect(facePythonRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImagePath: expect.stringMatching(/emre/i),
      }),
      expect.anything()
    );
  });

  it("rejects invalid upload mime type", async () => {
    const app = createApp();

    const response = await request(app)
      .post("/verify/face")
      .field("userId", "u1")
      .attach("probeImage", Buffer.from("not-image"), {
        filename: "probe.txt",
        contentType: "text/plain",
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: "INVALID_IMAGE_TYPE",
      },
    });
  });

  it("returns success result for a matching face", async () => {
    const referenceDir = await createReferenceDir();
    const facePythonRunner = vi.fn(async () => ({
      ok: true,
      matched: true,
      score: 0.92,
      reason: null,
    }));

    try {
      const app = createApp({ facePythonRunner, faceReferenceDir: referenceDir });

      const enroll = await attachImage(
        request(app).post("/enroll/face/reference").field("userId", "u1"),
        "referenceImage",
        "reference.jpg",
        "reference"
      );
      expect(enroll.status).toBe(200);
      expect(enroll.body.ok).toBe(true);

      const verify = await attachImage(
        request(app).post("/verify/face").field("userId", "u1"),
        "probeImage",
        "probe.jpg",
        "probe"
      );

      expect(verify.status).toBe(200);
      expect(verify.body).toEqual({
        ok: true,
        matched: true,
        score: 0.92,
        reason: null,
      });
      expect(facePythonRunner).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });

  it("returns non-match result for a different face", async () => {
    const referenceDir = await createReferenceDir();
    const app = createApp({
      faceReferenceDir: referenceDir,
      facePythonRunner: vi.fn(async () => ({
        ok: true,
        matched: false,
        score: 0.22,
        reason: "score_below_threshold",
      })),
    });

    try {
      const enroll = await attachImage(
        request(app).post("/enroll/face/reference").field("userId", "u2"),
        "referenceImage",
        "reference.jpg",
        "reference-u2"
      );
      expect(enroll.status).toBe(200);

      const verify = await attachImage(
        request(app).post("/verify/face").field("userId", "u2"),
        "probeImage",
        "probe.jpg",
        "probe-u2"
      );

      expect(verify.status).toBe(200);
      expect(verify.body).toEqual({
        ok: true,
        matched: false,
        score: 0.22,
        reason: "score_below_threshold",
      });
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });

  it("maps python process failures to HTTP 502", async () => {
    const referenceDir = await createReferenceDir();
    const app = createApp({
      faceReferenceDir: referenceDir,
      facePythonRunner: vi.fn(async () => {
        throw new FacePythonBridgeError("PYTHON_EXIT_NON_ZERO", "python failed");
      }),
    });

    try {
      const enroll = await attachImage(
        request(app).post("/enroll/face/reference").field("userId", "u3"),
        "referenceImage",
        "reference.jpg",
        "reference-u3"
      );
      expect(enroll.status).toBe(200);

      const verify = await attachImage(
        request(app).post("/verify/face").field("userId", "u3"),
        "probeImage",
        "probe.jpg",
        "probe-u3"
      );

      expect(verify.status).toBe(502);
      expect(verify.body).toMatchObject({
        error: {
          code: "PYTHON_PROCESS_ERROR",
        },
      });
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });

  it("maps python timeout failures to HTTP 504", async () => {
    const referenceDir = await createReferenceDir();
    const app = createApp({
      faceReferenceDir: referenceDir,
      facePythonRunner: vi.fn(async () => {
        throw new FacePythonBridgeError("PYTHON_TIMEOUT", "python timeout");
      }),
    });

    try {
      const enroll = await attachImage(
        request(app).post("/enroll/face/reference").field("userId", "u4"),
        "referenceImage",
        "reference.jpg",
        "reference-u4"
      );
      expect(enroll.status).toBe(200);

      const verify = await attachImage(
        request(app).post("/verify/face").field("userId", "u4"),
        "probeImage",
        "probe.jpg",
        "probe-u4"
      );

      expect(verify.status).toBe(504);
      expect(verify.body).toMatchObject({
        error: {
          code: "PYTHON_TIMEOUT",
        },
      });
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });

  it("maps required GPU failures to HTTP 503", async () => {
    const referenceDir = await createReferenceDir();
    const app = createApp({
      faceReferenceDir: referenceDir,
      facePythonRunner: vi.fn(async () => {
        throw new FacePythonBridgeError("GPU_REQUIRED", "gpu required");
      }),
    });

    try {
      const enroll = await attachImage(
        request(app).post("/enroll/face/reference").field("userId", "u5"),
        "referenceImage",
        "reference.jpg",
        "reference-u5"
      );
      expect(enroll.status).toBe(200);

      const verify = await attachImage(
        request(app).post("/verify/face").field("userId", "u5"),
        "probeImage",
        "probe.jpg",
        "probe-u5"
      );

      expect(verify.status).toBe(503);
      expect(verify.body).toMatchObject({
        error: {
          code: "GPU_REQUIRED",
        },
      });
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });
});
