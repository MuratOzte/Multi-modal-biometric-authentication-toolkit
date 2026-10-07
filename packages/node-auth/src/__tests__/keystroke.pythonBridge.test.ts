import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { PythonBridgeInput } from "../keystroke/types";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { PythonBridgeError, runKeystrokePython } from "../keystroke/pythonBridge";

function createMockChildProcess(): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter() as ChildProcessWithoutNullStreams;
  (emitter as unknown as { stdout: PassThrough }).stdout = new PassThrough();
  (emitter as unknown as { stderr: PassThrough }).stderr = new PassThrough();
  (emitter as unknown as { stdin: PassThrough }).stdin = new PassThrough();
  (emitter as unknown as { kill: ReturnType<typeof vi.fn> }).kill = vi.fn(() => true);
  return emitter;
}

const BASE_INPUT: PythonBridgeInput = {
  op: "verify",
  template: null,
  samples: [],
  opts: {
    autoEnroll: false,
  },
};

describe("runKeystrokePython", () => {
  const originalPythonBinEnv = process.env.PYTHON_BIN;

  afterEach(() => {
    if (originalPythonBinEnv === undefined) {
      delete process.env.PYTHON_BIN;
    } else {
      process.env.PYTHON_BIN = originalPythonBinEnv;
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns parsed JSON output from python stdout", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    let stdinPayload = "";
    child.stdin.on("data", (chunk: Buffer | string) => {
      stdinPayload += chunk.toString();
    });

    const promise = runKeystrokePython(BASE_INPUT, {
      timeoutMs: 500,
      pythonBin: "python3",
      scriptPath: "/tmp/keystroke_ml.py",
      onStderr: () => undefined,
    });

    (child.stdout as PassThrough).write(
      JSON.stringify({
        ok: true,
        score: 95.1,
        dist: 0.27,
        decision: "accept",
        autoEnrolled: false,
      })
    );
    child.emit("close", 0, null);

    await expect(promise).resolves.toEqual({
      ok: true,
      score: 95.1,
      dist: 0.27,
      decision: "accept",
      autoEnrolled: false,
    });

    expect(spawnMock).toHaveBeenCalledWith("python3", ["/tmp/keystroke_ml.py"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    expect(JSON.parse(stdinPayload)).toEqual(BASE_INPUT);
  });

  it("rejects with timeout error and kills process", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    await expect(
      runKeystrokePython(BASE_INPUT, {
        timeoutMs: 20,
        onStderr: () => undefined,
      })
    ).rejects.toMatchObject({
      name: "PythonBridgeError",
      code: "PYTHON_TIMEOUT",
    });

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("rejects when stdout is not JSON", async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValueOnce(child);

    const promise = runKeystrokePython(BASE_INPUT, {
      timeoutMs: 200,
      onStderr: () => undefined,
    });

    (child.stdout as PassThrough).write("not-json");
    child.emit("close", 0, null);

    await expect(promise).rejects.toMatchObject({
      name: "PythonBridgeError",
      code: "PYTHON_JSON_PARSE_ERROR",
    });
  });

  it("falls back to alternate python command when default command is unavailable", async () => {
    const first = createMockChildProcess();
    const second = createMockChildProcess();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    delete process.env.PYTHON_BIN;

    const promise = runKeystrokePython(BASE_INPUT, {
      timeoutMs: 500,
      scriptPath: "/tmp/keystroke_ml.py",
      onStderr: () => undefined,
    });

    first.emit("close", 9009, null);
    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });
    (second.stdout as PassThrough).write(
      JSON.stringify({
        ok: true,
        score: 91.5,
        dist: 0.44,
        decision: "accept",
        autoEnrolled: false,
      })
    );
    second.emit("close", 0, null);

    await expect(promise).resolves.toEqual({
      ok: true,
      score: 91.5,
      dist: 0.44,
      decision: "accept",
      autoEnrolled: false,
    });

    expect(spawnMock).toHaveBeenNthCalledWith(1, "python3", ["/tmp/keystroke_ml.py"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    expect(spawnMock).toHaveBeenNthCalledWith(2, "py", ["-3", "/tmp/keystroke_ml.py"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  });
});
