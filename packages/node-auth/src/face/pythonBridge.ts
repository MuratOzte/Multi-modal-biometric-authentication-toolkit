import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { FaceRuntimeInfo, FaceVerificationResult } from "@securekit/core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../../python/face_verification/face_verification.py"
);
const DEFAULT_TIMEOUT_MS = 30_000;

export type FacePythonBridgeErrorCode =
  | "PYTHON_SPAWN_FAILED"
  | "PYTHON_TIMEOUT"
  | "PYTHON_EXIT_NON_ZERO"
  | "PYTHON_JSON_PARSE_ERROR"
  | "PYTHON_OUTPUT_INVALID"
  | "PYTHON_PROCESS_ERROR"
  | "GPU_REQUIRED";

export class FacePythonBridgeError extends Error {
  readonly code: FacePythonBridgeErrorCode;
  readonly details?: string;

  constructor(code: FacePythonBridgeErrorCode, message: string, details?: string) {
    super(message);
    this.name = "FacePythonBridgeError";
    this.code = code;
    this.details = details;
  }
}

export interface RunFacePythonOptions {
  timeoutMs?: number;
  pythonBin?: string;
  pythonArgs?: string[];
  scriptPath?: string;
  device?: "auto" | "cuda" | "cpu";
  requireGpu?: boolean;
  onStderr?: (message: string) => void;
}

type PythonCommand = {
  bin: string;
  args: string[];
};

type FacePythonInput = {
  referenceImagePath: string;
  probeImagePath: string;
  threshold?: number;
};

type PendingRequest = {
  resolve: (result: FaceVerificationResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export function buildFacePythonEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
}

function resolveLocalVenvPythonCandidates(): PythonCommand[] {
  const workspaceRoot = path.resolve(__dirname, "../../../../");
  const roots = Array.from(new Set([process.cwd(), workspaceRoot]));
  const candidates: PythonCommand[] = [];

  for (const root of roots) {
    const faceVenvWindows = path.join(root, ".venv-face", "Scripts", "python.exe");
    const faceVenvUnix = path.join(root, ".venv-face", "bin", "python");
    const windowsVenvPython = path.join(root, ".venv", "Scripts", "python.exe");
    const unixVenvPython = path.join(root, ".venv", "bin", "python");

    for (const candidate of [
      faceVenvWindows,
      faceVenvUnix,
      windowsVenvPython,
      unixVenvPython,
    ]) {
      if (existsSync(candidate)) {
        candidates.push({ bin: candidate, args: [] });
      }
    }
  }

  return candidates;
}

function parsePythonCommand(raw: string, fallbackBin = "python3"): PythonCommand {
  const split = raw
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const bin = split[0] ?? fallbackBin;
  const args = split.length > 1 ? split.slice(1) : [];

  if (bin === "py" && !args.some((arg) => arg.startsWith("-"))) {
    args.unshift("-3");
  }

  return { bin, args };
}

function buildPythonCommandCandidates(options: RunFacePythonOptions): PythonCommand[] {
  const envFacePythonBin =
    typeof process.env.FACE_PYTHON_BIN === "string" &&
    process.env.FACE_PYTHON_BIN.trim().length > 0
      ? process.env.FACE_PYTHON_BIN.trim()
      : null;
  const envPythonBin =
    typeof process.env.PYTHON_BIN === "string" && process.env.PYTHON_BIN.trim().length > 0
      ? process.env.PYTHON_BIN.trim()
      : null;

  const explicitPythonBin =
    typeof options.pythonBin === "string" && options.pythonBin.trim().length > 0
      ? options.pythonBin.trim()
      : envFacePythonBin ?? envPythonBin;

  const base = parsePythonCommand(explicitPythonBin ?? "python3");
  if (explicitPythonBin) return [base];

  const localVenvCommands = resolveLocalVenvPythonCandidates();
  const fallbackCommands: PythonCommand[] = [
    ...localVenvCommands,
    base,
    parsePythonCommand("py -3"),
    parsePythonCommand("python3"),
    parsePythonCommand("python"),
  ];

  const seen = new Set<string>();
  const unique: PythonCommand[] = [];

  for (const command of fallbackCommands) {
    const key = `${command.bin}::${command.args.join("::")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(command);
  }

  return unique;
}

function isMissingPythonRuntimeError(error: unknown): boolean {
  if (!(error instanceof FacePythonBridgeError)) return false;

  if (error.code === "PYTHON_SPAWN_FAILED") {
    const details = (error.details ?? "").toLowerCase();
    return details.includes("enoent") || details.includes("not found");
  }

  if (error.code === "PYTHON_EXIT_NON_ZERO") {
    const message = error.message.toLowerCase();
    return message.includes("code 9009") || message.includes("code 127");
  }

  return false;
}

function resolveDevice(value: unknown): "auto" | "cuda" | "cpu" {
  return value === "cuda" || value === "cpu" || value === "auto" ? value : "auto";
}

function resolveBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;

  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function parseDevice(value: unknown): "cuda" | "cpu" {
  return value === "cuda" ? "cuda" : "cpu";
}

function parseNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeFaceRuntime(raw: unknown): FaceRuntimeInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const source = raw as Record<string, unknown>;
  return {
    device: parseDevice(source.device),
    cudaAvailable: source.cudaAvailable === true,
    cudaDeviceName: parseNullableString(source.cudaDeviceName),
    fallbackReason: parseNullableString(source.fallbackReason),
    model: parseNullableString(source.model) ?? undefined,
  };
}

function normalizePythonResult(raw: unknown): FaceVerificationResult {
  if (!raw || typeof raw !== "object") {
    throw new FacePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python face output must be a JSON object."
    );
  }

  const source = raw as {
    ok?: unknown;
    matched?: unknown;
    score?: unknown;
    reason?: unknown;
    runtime?: unknown;
  };

  if (typeof source.ok !== "boolean") {
    throw new FacePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python face output must include boolean ok field."
    );
  }

  if (typeof source.matched !== "boolean") {
    throw new FacePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python face output must include boolean matched field."
    );
  }

  const score =
    typeof source.score === "number" && Number.isFinite(source.score)
      ? source.score
      : source.score === null || source.score === undefined
        ? null
        : Number.NaN;

  if (Number.isNaN(score)) {
    throw new FacePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python face output score must be a finite number or null."
    );
  }

  const reason =
    typeof source.reason === "string" ? source.reason : source.reason == null ? null : null;

  const result: FaceVerificationResult = {
    ok: source.ok,
    matched: source.matched,
    score,
    reason,
  };

  const runtime = normalizeFaceRuntime(source.runtime);
  if (runtime) {
    result.runtime = runtime;
  }

  return result;
}

type RequiredWorkerOptions = {
  timeoutMs: number;
  pythonArgs: string[];
  scriptPath: string;
  device: "auto" | "cuda" | "cpu";
  requireGpu: boolean;
  onStderr: (message: string) => void;
};

function mapWorkerReasonToBridgeCode(reason: string | null): FacePythonBridgeErrorCode {
  if (reason === "gpu_required") return "GPU_REQUIRED";
  if (reason === "invalid_request") return "PYTHON_OUTPUT_INVALID";
  return "PYTHON_PROCESS_ERROR";
}

function buildWorkerArgs(options: RequiredWorkerOptions, command: PythonCommand): string[] {
  const args = [
    ...command.args,
    ...options.pythonArgs,
    options.scriptPath,
    "--worker",
  ];

  if (options.device !== "auto") {
    args.push("--device", options.device);
  }

  if (options.requireGpu) {
    args.push("--require-gpu");
  }

  return args;
}

export class FacePythonWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private startPromise: Promise<void> | null = null;
  private commandIndex = 0;

  constructor(
    private readonly commands: PythonCommand[],
    private readonly options: RequiredWorkerOptions
  ) {}

  async run(input: FacePythonInput): Promise<FaceVerificationResult> {
    await this.ensureStarted();

    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) {
      throw new FacePythonBridgeError("PYTHON_PROCESS_ERROR", "Python face worker is not running.");
    }

    const id = String(this.nextId++);
    const timeout = setTimeout(() => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.reject(
        new FacePythonBridgeError(
          "PYTHON_TIMEOUT",
          `Python face process timed out after ${this.options.timeoutMs}ms.`
        )
      );
    }, this.options.timeoutMs);

    const promise = new Promise<FaceVerificationResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, timeout });
    });

    const threshold =
      typeof input.threshold === "number" && Number.isFinite(input.threshold)
        ? input.threshold
        : undefined;
    const payload = {
      id,
      referenceImagePath: input.referenceImagePath,
      probeImagePath: input.probeImagePath,
      ...(threshold !== undefined ? { threshold } : {}),
    };

    try {
      child.stdin.write(JSON.stringify(payload) + "\n");
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        clearTimeout(pending.timeout);
        pending.reject(
          new FacePythonBridgeError(
            "PYTHON_PROCESS_ERROR",
            "Failed to write request to Python face worker.",
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }

    return promise;
  }

  close(): void {
    const child = this.child;
    this.child = null;
    this.startPromise = null;
    this.rejectAll(
      new FacePythonBridgeError("PYTHON_PROCESS_ERROR", "Python face worker was closed.")
    );

    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed && this.child.stdin.writable) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.start();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async start(): Promise<void> {
    let lastError: unknown = null;

    for (; this.commandIndex < this.commands.length; this.commandIndex += 1) {
      const command = this.commands[this.commandIndex];
      try {
        await this.startWithCommand(command);
        return;
      } catch (error) {
        lastError = error;
        const canFallback =
          isMissingPythonRuntimeError(error) && this.commandIndex < this.commands.length - 1;
        if (!canFallback) break;

        const next = this.commands[this.commandIndex + 1];
        this.options.onStderr(
          `[face-python] Python command unavailable (${command.bin}); trying fallback (${next.bin}).`
        );
      }
    }

    if (isMissingPythonRuntimeError(lastError)) {
      throw new FacePythonBridgeError(
        "PYTHON_SPAWN_FAILED",
        'Python runtime not found. Install Python 3 or set FACE_PYTHON_BIN/PYTHON_BIN (Windows example: ".venv-face\\\\Scripts\\\\python.exe").',
        lastError instanceof FacePythonBridgeError ? lastError.details : undefined
      );
    }

    throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
  }

  private async startWithCommand(command: PythonCommand): Promise<void> {
    const args = buildWorkerArgs(this.options, command);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: buildFacePythonEnv(),
        windowsHide: true,
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      let stderr = "";
      let settled = false;
      const startupTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        reject(
          new FacePythonBridgeError(
            "PYTHON_TIMEOUT",
            `Python face worker startup timed out after ${this.options.timeoutMs}ms.`,
            stderr.trim() || undefined
          )
        );
      }, this.options.timeoutMs);

      const finishResolve = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimeout);
        this.child = child;
        resolve();
      };

      const finishReject = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimeout);
        child.kill("SIGKILL");
        reject(error);
      };

      child.on("error", (error) => {
        finishReject(
          new FacePythonBridgeError(
            "PYTHON_SPAWN_FAILED",
            `Failed to spawn python process (${command.bin}).`,
            error.message
          )
        );
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        const message = chunk.toString();
        stderr += message;
        this.options.onStderr(`[face-python] ${message.trimEnd()}`);
      });

      child.on("close", (code, signal) => {
        const isCurrentChild = this.child === child;
        if (isCurrentChild) {
          this.child = null;
        }

        const error = new FacePythonBridgeError(
          "PYTHON_EXIT_NON_ZERO",
          `Python face worker exited with code ${code}${signal ? ` (signal: ${signal})` : ""}.`,
          stderr.trim() || undefined
        );
        if (isCurrentChild) {
          this.rejectAll(error);
        }

        if (!settled) {
          finishReject(error);
        }
      });

      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          this.options.onStderr(`[face-python stdout] ${trimmed}`);
          return;
        }

        if (parsed.event === "ready") {
          if (parsed.ok === false) {
            const reason = typeof parsed.reason === "string" ? parsed.reason : null;
            finishReject(
              new FacePythonBridgeError(
                mapWorkerReasonToBridgeCode(reason),
                reason === "gpu_required"
                  ? "GPU is required for face verification but CUDA is unavailable."
                  : "Python face worker failed to start.",
                stderr.trim() || reason || undefined
              )
            );
            return;
          }

          finishResolve();
          return;
        }

        this.handleWorkerMessage(parsed);
      });
    });
  }

  private handleWorkerMessage(message: Record<string, unknown>): void {
    const id = typeof message.id === "string" ? message.id : null;
    if (!id) return;

    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);
    clearTimeout(pending.timeout);

    try {
      const result = normalizePythonResult(message);
      if (!result.ok && result.reason === "gpu_required") {
        pending.reject(
          new FacePythonBridgeError(
            "GPU_REQUIRED",
            "GPU is required for face verification but CUDA is unavailable."
          )
        );
        return;
      }

      pending.resolve(result);
    } catch (error) {
      pending.reject(
        error instanceof Error
          ? error
          : new FacePythonBridgeError("PYTHON_OUTPUT_INVALID", String(error))
      );
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }
}

const workers = new Map<string, FacePythonWorker>();

function buildRequiredOptions(options: RunFacePythonOptions): RequiredWorkerOptions {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    pythonArgs: options.pythonArgs ?? [],
    scriptPath: options.scriptPath ?? DEFAULT_SCRIPT_PATH,
    device: resolveDevice(options.device ?? process.env.FACE_DEVICE),
    requireGpu: options.requireGpu ?? resolveBooleanEnv("FACE_REQUIRE_GPU", false),
    onStderr: options.onStderr ?? ((message: string) => console.error(message)),
  };
}

function workerKey(options: RequiredWorkerOptions, commands: PythonCommand[]): string {
  return JSON.stringify({
    commands,
    scriptPath: options.scriptPath,
    device: options.device,
    requireGpu: options.requireGpu,
    pythonArgs: options.pythonArgs,
  });
}

export async function runFacePython(
  input: FacePythonInput,
  options: RunFacePythonOptions = {}
): Promise<FaceVerificationResult> {
  const requiredOptions = buildRequiredOptions(options);
  const commands = buildPythonCommandCandidates(options);
  const key = workerKey(requiredOptions, commands);
  let worker = workers.get(key);

  if (!worker) {
    worker = new FacePythonWorker(commands, requiredOptions);
    workers.set(key, worker);
  }

  return worker.run(input);
}

export function closeFacePythonWorkers(): void {
  for (const worker of workers.values()) {
    worker.close();
  }
  workers.clear();
}
