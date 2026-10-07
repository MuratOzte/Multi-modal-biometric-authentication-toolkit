import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCardPythonWorkers, runCardPython } from "../card/pythonBridge";

async function createScript(contents: string): Promise<{ dir: string; scriptPath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "securekit-card-bridge-test-"));
  const scriptPath = path.join(dir, "fake-card-worker.mjs");
  await fs.writeFile(scriptPath, contents);
  return { dir, scriptPath };
}

function nodeBridgeOptions(scriptPath: string) {
  return {
    pythonBin: process.execPath,
    scriptPath,
    timeoutMs: 5_000,
    onStderr: () => {},
  };
}

function workerScriptForPayload(payload: unknown): string {
  return `
import readline from "node:readline";

const payload = ${JSON.stringify(payload)};

console.log(JSON.stringify({ event: "ready", ok: true }));

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  console.log(JSON.stringify({ id: request.id, ...payload }));
});
`;
}

describe("card python bridge", () => {
  afterEach(() => {
    closeCardPythonWorkers();
  });

  it("normalizes the new card verification JSON payload", async () => {
    const candidate = {
      referenceImagePath: "refs/emre.jpeg",
      referenceFileName: "emre.jpeg",
      decision: "same",
      overallScore: 0.9135,
      contentScore: 1,
      visualScore: 0.8388,
      visualDetails: {
        activeMethod: "clip",
        clipScore: 0.8388,
        clipCosine: 0.8388,
        clipAvailable: true,
        clipModel: "ViT-B-32/laion2b_s34b_b79k",
        clipDevice: "cuda",
        clipError: null,
      },
      reasons: [],
      fields: {
        probe: {
          name: "EMRE CAN TURGUT",
          studentNo: "000000412855",
          documentNo: "",
          cardNo: "5400460105016084",
          validThru: "09/24",
        },
        reference: {
          name: "EMRE CAN TURGUT",
          studentNo: "000000412855",
          documentNo: "",
          cardNo: "5400460105016084",
          validThru: "09/24",
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
      matched: true,
    };
    const payload = {
      ok: true,
      matched: true,
      threshold: 0.7,
      checkedCount: 1,
      reason: null,
      bestMatch: candidate,
      candidates: [candidate],
    };
    const { dir, scriptPath } = await createScript(workerScriptForPayload(payload));

    try {
      const result = await runCardPython(
        {
          probeImagePath: "probe.jpeg",
          referenceDir: "refs",
          threshold: 0.7,
        },
        nodeBridgeOptions(scriptPath)
      );

      expect(result).toMatchObject({
        ok: true,
        matched: true,
        checkedCount: 1,
        bestMatch: {
          referenceFileName: "emre.jpeg",
          decision: "same",
          overallScore: 0.9135,
          contentScore: 1,
          visualScore: 0.8388,
          visualDetails: {
            activeMethod: "clip",
            clipScore: 0.8388,
            clipAvailable: true,
          },
        },
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reuses the same persistent card worker for matching options", async () => {
    const candidate = {
      referenceImagePath: "refs/emre.jpeg",
      referenceFileName: "emre.jpeg",
      decision: "same",
      overallScore: 0.9,
      contentScore: 0.95,
      visualScore: 0.82,
      reasons: [],
      fields: {
        probe: { name: "A", studentNo: "1", documentNo: "", cardNo: "2", validThru: "09/24" },
        reference: { name: "A", studentNo: "1", documentNo: "", cardNo: "2", validThru: "09/24" },
      },
      quality: {
        cardDetectedProbe: true,
        cardDetectedReference: true,
        detectionConfidenceProbe: 80,
        detectionConfidenceReference: 80,
        ocrAvailable: true,
        ocrWeak: false,
        ocrErrorProbe: null,
        ocrErrorReference: null,
      },
      matched: true,
    };
    const payload = {
      ok: true,
      matched: true,
      threshold: 0.7,
      checkedCount: 1,
      reason: null,
      bestMatch: candidate,
      candidates: [candidate],
    };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "securekit-card-bridge-test-"));
    const scriptPath = path.join(dir, "fake-card-worker.mjs");
    const startLogPath = path.join(dir, "starts.log");
    await fs.writeFile(
      scriptPath,
      `
import fs from "node:fs";
import readline from "node:readline";

fs.appendFileSync(${JSON.stringify(startLogPath)}, "start\\n");
const payload = ${JSON.stringify(payload)};

console.log(JSON.stringify({ event: "ready", ok: true }));

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  console.log(JSON.stringify({ id: request.id, ...payload }));
});
`
    );

    try {
      await runCardPython(
        {
          probeImagePath: "probe-1.jpeg",
          referenceDir: "refs",
          threshold: 0.7,
        },
        nodeBridgeOptions(scriptPath)
      );
      await runCardPython(
        {
          probeImagePath: "probe-2.jpeg",
          referenceDir: "refs",
          threshold: 0.7,
        },
        nodeBridgeOptions(scriptPath)
      );

      const starts = (await fs.readFile(startLogPath, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean);
      expect(starts).toHaveLength(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects card output with missing new score fields", async () => {
    const { dir, scriptPath } = await createScript(
      workerScriptForPayload({
        ok: true,
        matched: true,
        threshold: 0.7,
        checkedCount: 1,
        candidates: [{}],
      })
    );

    try {
      await expect(
        runCardPython(
          {
            probeImagePath: "probe.jpeg",
            referenceDir: "refs",
            threshold: 0.7,
          },
          nodeBridgeOptions(scriptPath)
        )
      ).rejects.toMatchObject({
        code: "PYTHON_OUTPUT_INVALID",
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects OCR-missing card output instead of treating it as a mismatch", async () => {
    const candidate = {
      referenceImagePath: "refs/emre.jpeg",
      referenceFileName: "emre.jpeg",
      decision: "different",
      overallScore: 0.02,
      contentScore: 0,
      visualScore: 0.07,
      reasons: ["ocr_weak", "overall_below_different_threshold"],
      fields: {
        probe: { name: "", studentNo: "", documentNo: "", cardNo: "", validThru: "" },
        reference: { name: "", studentNo: "", documentNo: "", cardNo: "", validThru: "" },
      },
      quality: {
        cardDetectedProbe: true,
        cardDetectedReference: true,
        detectionConfidenceProbe: 70.2,
        detectionConfidenceReference: 84.01,
        ocrAvailable: false,
        ocrWeak: true,
        ocrErrorProbe: "PaddleOCR import failed: No module named 'paddleocr'",
        ocrErrorReference: "PaddleOCR import failed: No module named 'paddleocr'",
      },
      matched: false,
    };
    const payload = {
      ok: true,
      matched: false,
      threshold: 0.7,
      checkedCount: 1,
      reason: "ocr_weak, overall_below_different_threshold",
      bestMatch: candidate,
      candidates: [candidate],
    };
    const { dir, scriptPath } = await createScript(workerScriptForPayload(payload));

    try {
      await expect(
        runCardPython(
          {
            probeImagePath: "probe.jpeg",
            referenceDir: "refs",
            threshold: 0.7,
          },
          nodeBridgeOptions(scriptPath)
        )
      ).rejects.toMatchObject({
        code: "PYTHON_DEPENDENCY_MISSING",
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects when the card worker exits after malformed output", async () => {
    const { dir, scriptPath } = await createScript(`
import readline from "node:readline";

console.log(JSON.stringify({ event: "ready", ok: true }));

readline.createInterface({ input: process.stdin }).on("line", () => {
  console.log("{not-json");
  process.exit(1);
});
`);

    try {
      await expect(
        runCardPython(
          {
            probeImagePath: "probe.jpeg",
            referenceDir: "refs",
            threshold: 0.7,
          },
          nodeBridgeOptions(scriptPath)
        )
      ).rejects.toMatchObject({
        code: "PYTHON_EXIT_NON_ZERO",
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
