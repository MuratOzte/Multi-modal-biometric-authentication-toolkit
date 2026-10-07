import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileStorageAdapter } from "../storage/fileAdapter";

describe("FileStorageAdapter", () => {
  it("persists profiles and consent logs across adapter instances", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "securekit-profile-test-"));
    const filePath = path.join(tempDir, "profiles.json");

    const first = new FileStorageAdapter({ filePath });
    await first.appendConsentLog({
      userId: "emre",
      consentVersion: "main-flow-v1",
      grantedAt: "2026-05-21T10:00:00.000Z",
    });
    await first.saveProfiles("emre", {
      userId: "emre",
      faceReferenceImagePath: "face.jpg",
      faceReferenceEnrolledAt: "2026-05-21T10:01:00.000Z",
      faceEmbedding: null,
      cardReferenceImagePath: "card.jpg",
      cardReferenceEnrolledAt: "2026-05-21T10:02:00.000Z",
      keystroke: null,
      voice: null,
      voiceEmbedding: null,
      updatedAt: "2026-05-21T10:02:00.000Z",
    });

    const second = new FileStorageAdapter({ filePath });
    await expect(second.getLatestConsent("emre")).resolves.toMatchObject({
      userId: "emre",
      consentVersion: "main-flow-v1",
    });
    await expect(second.getProfiles("emre")).resolves.toMatchObject({
      userId: "emre",
      faceReferenceImagePath: "face.jpg",
      cardReferenceImagePath: "card.jpg",
    });
  });
});
