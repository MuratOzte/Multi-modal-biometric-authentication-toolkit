import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { closeFacePythonWorkers, runFacePython } from "../face/pythonBridge";

function createMockChildProcess(): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter() as ChildProcessWithoutNullStreams;
  (emitter as unknown as { stdout: PassThrough }).stdout = new PassThrough();
  (emitter as unknown as { stderr: PassThrough }).stderr = new PassThrough();
  (emitter as unknown as { stdin: PassThrough }).stdin = new PassThrough();
  Object.defineProperty(emitter, "killed", { value: false, writable: true });
  (emitter as unknown as { kill: ReturnType<typeof vi.fn> }).kill = vi.fn(() => {
    (emitter as unknown as { killed: boolean }).killed = true;
    return true;
  });
  return emitter;
}

function writeWorkerLine(child: ChildProcessWithoutNullStreams, payload: unknown): void {
  (child.stdout as PassThrough).write(`${JSON.stringify(payload)}\n`);
}

async function waitForWorkerRequest(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

const BASE_INPUT = {
  referenceImagePath: "/tmp/reference.jpg",
  probeImagePath: "/tmp/probe.jpg",
  threshold: 0.8,
};

describe("runFacePython", () => {
  afterEach(() => {
    closeFacePythonWorkers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns parsed JSON output from the persistent python worker", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    const promise = runFacePython(BASE_INPUT, {
      timeoutMs: 500,
      pythonBin: "python3",
      scriptPath: "/tmp/face_verification.py",
      onStderr: () => undefined,
    });

    writeWorkerLine(child, { event: "ready", ok: true });
    await waitForWorkerRequest();
    writeWorkerLine(child, {
      id: "1",
      ok: true,
      matched: true,
      score: 0.93,
      reason: null,
    });

    await expect(promise).resolves.toEqual({
      ok: true,
      matched: true,
      score: 0.93,
      reason: null,
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      "python3",
      ["/tmp/face_verification.py", "--worker"],
      expect.objectContaining({
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        }),
        windowsHide: true,
      })
    );
  });

  it("passes CUDA device options to the python worker", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    const promise = runFacePython(BASE_INPUT, {
      timeoutMs: 500,
      pythonBin: "python3",
      scriptPath: "/tmp/face_verification.py",
      device: "cuda",
      requireGpu: true,
      onStderr: () => undefined,
    });

    writeWorkerLine(child, { event: "ready", ok: true });
    await waitForWorkerRequest();
    writeWorkerLine(child, {
      id: "1",
      ok: true,
      matched: true,
      score: 0.93,
      reason: null,
      runtime: {
        device: "cuda",
        cudaAvailable: true,
        cudaDeviceName: "NVIDIA GeForce RTX 3050 Laptop GPU",
        fallbackReason: null,
        model: "facenet-pytorch/InceptionResnetV1(vggface2)",
      },
    });

    await expect(promise).resolves.toMatchObject({
      ok: true,
      runtime: {
        device: "cuda",
        cudaAvailable: true,
      },
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "python3",
      ["/tmp/face_verification.py", "--worker", "--device", "cuda", "--require-gpu"],
      expect.objectContaining({
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      })
    );
  });

  it("reuses the same persistent face worker for matching options", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    const first = runFacePython(BASE_INPUT, {
      timeoutMs: 500,
      pythonBin: "python3",
      scriptPath: "/tmp/face_verification.py",
      onStderr: () => undefined,
    });
    writeWorkerLine(child, { event: "ready", ok: true });
    await waitForWorkerRequest();
    writeWorkerLine(child, {
      id: "1",
      ok: true,
      matched: true,
      score: 0.91,
      reason: null,
    });
    await expect(first).resolves.toMatchObject({ score: 0.91 });

    const second = runFacePython(
      { ...BASE_INPUT, probeImagePath: "/tmp/probe-2.jpg" },
      {
        timeoutMs: 500,
        pythonBin: "python3",
        scriptPath: "/tmp/face_verification.py",
        onStderr: () => undefined,
      }
    );
    await waitForWorkerRequest();
    writeWorkerLine(child, {
      id: "2",
      ok: true,
      matched: false,
      score: 0.4,
      reason: "score_below_threshold",
    });

    await expect(second).resolves.toMatchObject({
      matched: false,
      score: 0.4,
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("rejects with timeout error and kills the worker on startup timeout", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    await expect(
      runFacePython(BASE_INPUT, {
        timeoutMs: 20,
        onStderr: () => undefined,
      })
    ).rejects.toMatchObject({
      name: "FacePythonBridgeError",
      code: "PYTHON_TIMEOUT",
    });

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("returns parsed failure JSON from the worker", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    const promise = runFacePython(BASE_INPUT, {
      timeoutMs: 500,
      onStderr: () => undefined,
    });

    writeWorkerLine(child, { event: "ready", ok: true });
    await waitForWorkerRequest();
    writeWorkerLine(child, {
      id: "1",
      ok: false,
      matched: false,
      score: null,
      reason: "probe_face_not_detected",
    });

    await expect(promise).resolves.toEqual({
      ok: false,
      matched: false,
      score: null,
      reason: "probe_face_not_detected",
    });
  });

  it("rejects with GPU_REQUIRED when CUDA is required but unavailable", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    const promise = runFacePython(BASE_INPUT, {
      timeoutMs: 500,
      device: "cuda",
      requireGpu: true,
      onStderr: () => undefined,
    });

    writeWorkerLine(child, {
      event: "ready",
      ok: false,
      reason: "gpu_required",
      runtime: {
        device: "cuda",
        cudaAvailable: false,
        cudaDeviceName: null,
        fallbackReason: "gpu_required",
      },
    });

    await expect(promise).rejects.toMatchObject({
      name: "FacePythonBridgeError",
      code: "GPU_REQUIRED",
    });
  });

  it("rejects when worker exits non-zero without JSON output", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    const promise = runFacePython(BASE_INPUT, {
      timeoutMs: 500,
      onStderr: () => undefined,
    });

    (child.stderr as PassThrough).write("python crashed");
    child.emit("close", 1, null);

    await expect(promise).rejects.toEqual(
      expect.objectContaining({
        name: "FacePythonBridgeError",
        code: "PYTHON_EXIT_NON_ZERO",
      })
    );
  });
});
