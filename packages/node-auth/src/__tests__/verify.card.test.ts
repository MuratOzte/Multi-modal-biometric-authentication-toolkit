import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server";

function jpegBuffer(seed: string): Buffer {
  return Buffer.from(`${seed}-image-binary`);
}

async function createReferenceDir(fileNames: string[]): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "securekit-card-test-"));
  await Promise.all(
    fileNames.map((fileName) =>
      fs.writeFile(path.join(tempDir, fileName), jpegBuffer(fileName))
    )
  );
  return tempDir;
}

function cardCandidate(referenceDir: string, fileName: string, matched = true) {
  return {
    referenceImagePath: path.join(referenceDir, fileName),
    referenceFileName: fileName,
    decision: matched ? ("same" as const) : ("different" as const),
    overallScore: matched ? 0.91 : 0.32,
    contentScore: matched ? 1 : 0,
    visualScore: matched ? 0.75 : 0.42,
    reasons: matched ? [] : ["overall_below_different_threshold"],
    fields: {
      probe: {
        name: matched ? "EMRE CAN TURGUT" : "",
        studentNo: matched ? "000000412855" : "",
        documentNo: matched ? "TR1234567" : "",
        cardNo: matched ? "5400460105016084" : "",
        validThru: matched ? "09/24" : "",
      },
      reference: {
        name: matched ? "EMRE CAN TURGUT" : "",
        studentNo: matched ? "000000412855" : "",
        documentNo: matched ? "TR1234567" : "",
        cardNo: matched ? "5400460105016084" : "",
        validThru: matched ? "09/24" : "",
      },
    },
    quality: {
      cardDetectedProbe: true,
      cardDetectedReference: true,
      detectionConfidenceProbe: 84.01,
      detectionConfidenceReference: 60.07,
      ocrAvailable: true,
      ocrWeak: false,
      ocrErrorProbe: null,
      ocrErrorReference: null,
    },
    matched,
  };
}

describe("card verification routes", () => {
  it("lists registered card references from the configured directory", async () => {
    const referenceDir = await createReferenceDir(["andrew.png", "conor.png", "notes.txt"]);

    try {
      const app = createApp({ cardReferenceDir: referenceDir });
      const response = await request(app).get("/card/references");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        referenceDir,
      });
      expect(response.body.references).toEqual([
        expect.objectContaining({ fileName: "andrew.png" }),
        expect.objectContaining({ fileName: "conor.png" }),
      ]);
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });

  it("verifies a captured card against registered references with the python runner", async () => {
    const referenceDir = await createReferenceDir(["andrew.png"]);
    const cardPythonRunner = vi.fn(async () => ({
      ok: true,
      matched: true,
      threshold: 0.7,
      checkedCount: 1,
      reason: null,
      bestMatch: cardCandidate(referenceDir, "andrew.png"),
      candidates: [cardCandidate(referenceDir, "andrew.png")],
      cardVerificationByClipOld: null,
    }));

    try {
      const app = createApp({ cardReferenceDir: referenceDir, cardPythonRunner });
      const response = await request(app)
        .post("/verify/card")
        .attach("probeImage", jpegBuffer("probe"), {
          filename: "probe.jpg",
          contentType: "image/jpeg",
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        matched: true,
        checkedCount: 1,
      });
      expect(cardPythonRunner).toHaveBeenCalledTimes(1);
      expect(cardPythonRunner).toHaveBeenCalledWith(
        expect.objectContaining({
          probeImagePath: expect.stringContaining("probe-"),
          referenceDir,
          threshold: 0.7,
        }),
        expect.objectContaining({
          timeoutMs: 300_000,
        })
      );
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });

  it("verifies only the selected card reference when referenceId is provided", async () => {
    const referenceDir = await createReferenceDir(["emre.png", "mert.png", "murat.png"]);
    const cardPythonRunner = vi.fn(async (input: { referenceDir: string }) => {
      const files = (await fs.readdir(input.referenceDir)).sort();

      return {
        ok: true,
        matched: true,
        threshold: 0.7,
        checkedCount: files.length,
        reason: null,
        bestMatch: cardCandidate(input.referenceDir, files[0] ?? "missing.png"),
        candidates: files.map((fileName) => cardCandidate(input.referenceDir, fileName)),
        cardVerificationByClipOld: null,
      };
    });

    try {
      const app = createApp({ cardReferenceDir: referenceDir, cardPythonRunner });
      const response = await request(app)
        .post("/verify/card")
        .field("referenceId", "mert.png")
        .attach("probeImage", jpegBuffer("probe-selected"), {
          filename: "probe.jpg",
          contentType: "image/jpeg",
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        matched: true,
        checkedCount: 1,
      });
      expect(response.body.bestMatch).toMatchObject({
        referenceFileName: "mert.png",
      });
      expect(cardPythonRunner).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });

  it("enrolls and verifies a user card reference", async () => {
    const referenceDir = await createReferenceDir([]);
    const userReferenceDir = await createReferenceDir([]);
    const cardPythonRunner = vi.fn(async (input: { referenceDir: string }) => {
      const files = (await fs.readdir(input.referenceDir)).sort();

      return {
        ok: true,
        matched: true,
        threshold: 0.7,
        checkedCount: files.length,
        reason: null,
        bestMatch: cardCandidate(input.referenceDir, files[0] ?? "missing.jpg"),
        candidates: files.map((fileName) => cardCandidate(input.referenceDir, fileName)),
        cardVerificationByClipOld: null,
      };
    });

    try {
      const app = createApp({
        cardReferenceDir: referenceDir,
        cardUserReferenceDir: userReferenceDir,
        cardPythonRunner,
        useInMemoryStorage: true,
      });

      const enroll = await request(app)
        .post("/enroll/card/reference")
        .field("userId", "emre")
        .attach("referenceImage", jpegBuffer("emre-card"), {
          filename: "emre-card.jpg",
          contentType: "image/jpeg",
        });

      expect(enroll.status).toBe(200);
      expect(enroll.body).toMatchObject({
        ok: true,
        userId: "emre",
        reference: {
          source: "upload",
        },
      });

      const verify = await request(app)
        .post("/verify/card")
        .field("userId", "emre")
        .attach("probeImage", jpegBuffer("probe-user-card"), {
          filename: "probe.jpg",
          contentType: "image/jpeg",
        });

      expect(verify.status).toBe(200);
      expect(verify.body).toMatchObject({
        ok: true,
        matched: true,
        checkedCount: 1,
      });
      expect(cardPythonRunner).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
      await fs.rm(userReferenceDir, { recursive: true, force: true });
    }
  });

  it("returns 404 when no registered card exists yet", async () => {
    const referenceDir = await createReferenceDir([]);

    try {
      const app = createApp({ cardReferenceDir: referenceDir });
      const response = await request(app)
        .post("/verify/card")
        .attach("probeImage", jpegBuffer("probe-empty"), {
          filename: "probe.jpg",
          contentType: "image/jpeg",
        });

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        error: {
          code: "REFERENCE_NOT_FOUND",
        },
      });
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid upload mime type", async () => {
    const referenceDir = await createReferenceDir(["andrew.png"]);

    try {
      const app = createApp({ cardReferenceDir: referenceDir });
      const response = await request(app)
        .post("/verify/card")
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
    } finally {
      await fs.rm(referenceDir, { recursive: true, force: true });
    }
  });
});
