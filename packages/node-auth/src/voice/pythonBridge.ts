import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { VoiceRuntimeInfo, VoiceTranscriptResult } from "@securekit/core";
import {
  DEFAULT_VOICE_DEVICE,
  DEFAULT_VOICE_PYTHON_TIMEOUT_MS,
  DEFAULT_VOICE_SPEAKER_MODEL,
  DEFAULT_VOICE_WHISPER_MODEL,
  resolveDefaultVoiceScriptPath,
} from "./config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type VoicePythonBridgeErrorCode =
  | "PYTHON_SPAWN_FAILED"
  | "PYTHON_DEPENDENCY_MISSING"
  | "PYTHON_TIMEOUT"
  | "PYTHON_EXIT_NON_ZERO"
  | "PYTHON_JSON_PARSE_ERROR"
  | "PYTHON_OUTPUT_INVALID"
  | "PYTHON_PROCESS_ERROR"
  | "GPU_REQUIRED";

export class VoicePythonBridgeError extends Error {
  readonly code: VoicePythonBridgeErrorCode;
  readonly details?: string;

  constructor(code: VoicePythonBridgeErrorCode, message: string, details?: string) {
    super(message);
    this.name = "VoicePythonBridgeError";
    this.code = code;
    this.details = details;
  }
}

export interface RunVoicePythonOptions {
  timeoutMs?: number;
  pythonBin?: string;
  pythonArgs?: string[];
  scriptPath?: string;
  device?: "auto" | "cuda" | "cpu";
  requireGpu?: boolean;
  whisperModel?: string;
  speakerModel?: string;
  onStderr?: (message: string) => void;
}

export type VoicePythonInput = {
  audioPath: string;
  expectedText: string;
  transcriptThreshold: number;
};

export type VoicePythonResult = {
  ok: boolean;
  embedding: number[] | null;
  transcript: VoiceTranscriptResult;
  runtime: VoiceRuntimeInfo;
  reason: string | null;
};

type PythonCommand = {
  bin: string;
  args: string[];
};

export function buildVoicePythonEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
}

type PendingRequest = {
  resolve: (result: VoicePythonResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

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

function resolveLocalVenvPythonCandidates(): PythonCommand[] {
  const workspaceRoot = path.resolve(__dirname, "../../../../");
  const roots = Array.from(new Set([process.cwd(), workspaceRoot]));
  const candidates: PythonCommand[] = [];

  for (const root of roots) {
    const voiceVenvWindows = path.join(root, ".venv-voice", "Scripts", "python.exe");
    const voiceVenvUnix = path.join(root, ".venv-voice", "bin", "python");
    const defaultVenvWindows = path.join(root, ".venv", "Scripts", "python.exe");
    const defaultVenvUnix = path.join(root, ".venv", "bin", "python");

    for (const candidate of [
      voiceVenvWindows,
      voiceVenvUnix,
      defaultVenvWindows,
      defaultVenvUnix,
    ]) {
      if (existsSync(candidate)) {
        candidates.push({ bin: candidate, args: [] });
      }
    }
  }

  return candidates;
}

function buildPythonCommandCandidates(options: RunVoicePythonOptions): PythonCommand[] {
  const envVoicePythonBin =
    typeof process.env.VOICE_PYTHON_BIN === "string" &&
    process.env.VOICE_PYTHON_BIN.trim().length > 0
      ? process.env.VOICE_PYTHON_BIN.trim()
      : null;
  const envPythonBin =
    typeof process.env.PYTHON_BIN === "string" && process.env.PYTHON_BIN.trim().length > 0
      ? process.env.PYTHON_BIN.trim()
      : null;
  const explicitPythonBin =
    typeof options.pythonBin === "string" && options.pythonBin.trim().length > 0
      ? options.pythonBin.trim()
      : envVoicePythonBin ?? envPythonBin;

  const base = parsePythonCommand(explicitPythonBin ?? "python3");
  if (explicitPythonBin) return [base];

  const fallbackCommands: PythonCommand[] = [
    ...resolveLocalVenvPythonCandidates(),
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
  if (!(error instanceof VoicePythonBridgeError)) return false;

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

function missingPythonDependency(error: unknown): { moduleName: string | null; details?: string } | null {
  if (!(error instanceof VoicePythonBridgeError)) return null;
  if (error.code !== "PYTHON_EXIT_NON_ZERO") return null;

  const details = error.details ?? error.message;
  const moduleMatch = details.match(
    /(?:ModuleNotFoundError|ImportError): No module named ['"]([^'"]+)['"]/i
  );
  if (moduleMatch) {
    return {
      moduleName: moduleMatch[1] ?? null,
      details,
    };
  }

  const lowered = details.toLowerCase();
  const expectedPackages = ["whisper", "speechbrain", "torch", "torchaudio", "numpy"];
  if (lowered.includes("importerror") && expectedPackages.some((pkg) => lowered.includes(pkg))) {
    return {
      moduleName: null,
      details,
    };
  }

  return null;
}

function parseDevice(value: unknown): "cuda" | "cpu" {
  return value === "cuda" ? "cuda" : "cpu";
}

function parseNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeEmbedding(value: unknown): number[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new VoicePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python voice output embedding must be an array or null."
    );
  }

  const embedding = value.map((entry) =>
    typeof entry === "number" && Number.isFinite(entry) ? entry : Number.NaN
  );

  if (embedding.some((entry) => Number.isNaN(entry))) {
    throw new VoicePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python voice output embedding must contain only finite numbers."
    );
  }

  return embedding;
}

export function normalizeVoicePythonResult(raw: unknown): VoicePythonResult {
  if (!raw || typeof raw !== "object") {
    throw new VoicePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python voice output must be a JSON object."
    );
  }

  const source = raw as Record<string, unknown>;
  if (typeof source.ok !== "boolean") {
    throw new VoicePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python voice output must include boolean ok field."
    );
  }

  const transcriptSource =
    source.transcript && typeof source.transcript === "object"
      ? (source.transcript as Record<string, unknown>)
      : null;
  if (!transcriptSource) {
    throw new VoicePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python voice output must include transcript object."
    );
  }

  const runtimeSource =
    source.runtime && typeof source.runtime === "object"
      ? (source.runtime as Record<string, unknown>)
      : null;
  if (!runtimeSource) {
    throw new VoicePythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python voice output must include runtime object."
    );
  }

  const runtime: VoiceRuntimeInfo = {
    device: parseDevice(runtimeSource.device),
    cudaAvailable: runtimeSource.cudaAvailable === true,
    cudaDeviceName: parseNullableString(runtimeSource.cudaDeviceName),
    fallbackReason: parseNullableString(runtimeSource.fallbackReason),
    whisperModel: parseNullableString(runtimeSource.whisperModel) ?? DEFAULT_VOICE_WHISPER_MODEL,
    speakerModel: parseNullableString(runtimeSource.speakerModel) ?? DEFAULT_VOICE_SPEAKER_MODEL,
  };

  const transcript: VoiceTranscriptResult = {
    expectedText:
      typeof transcriptSource.expectedText === "string" ? transcriptSource.expectedText : "",
    transcript: parseNullableString(transcriptSource.transcript),
    similarityScore: parseFiniteNumber(transcriptSource.similarityScore),
    matched: transcriptSource.matched === true,
    threshold: parseFiniteNumber(transcriptSource.threshold),
  };

  return {
    ok: source.ok,
    embedding: normalizeEmbedding(source.embedding),
    transcript,
    runtime,
    reason: parseNullableString(source.reason),
  };
}

function mapWorkerReasonToBridgeCode(reason: string | null): VoicePythonBridgeErrorCode {
  if (reason === "gpu_required") return "GPU_REQUIRED";
  if (reason === "python_output_invalid") return "PYTHON_OUTPUT_INVALID";
  return "PYTHON_PROCESS_ERROR";
}

function buildWorkerArgs(options: RequiredWorkerOptions, command: PythonCommand): string[] {
  const args = [
    ...command.args,
    ...options.pythonArgs,
    options.scriptPath,
    "--device",
    options.device,
    "--whisper-model",
    options.whisperModel,
    "--speaker-model",
    options.speakerModel,
  ];

  if (options.requireGpu) {
    args.push("--require-gpu");
  }

  return args;
}

type RequiredWorkerOptions = {
  timeoutMs: number;
  pythonArgs: string[];
  scriptPath: string;
  device: "auto" | "cuda" | "cpu";
  requireGpu: boolean;
  whisperModel: string;
  speakerModel: string;
  onStderr: (message: string) => void;
};

export class VoicePythonWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private startPromise: Promise<void> | null = null;
  private commandIndex = 0;

  constructor(
    private readonly commands: PythonCommand[],
    private readonly options: RequiredWorkerOptions
  ) {}

  async run(input: VoicePythonInput): Promise<VoicePythonResult> {
    await this.ensureStarted();

    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) {
      throw new VoicePythonBridgeError("PYTHON_PROCESS_ERROR", "Python voice worker is not running.");
    }

    const id = String(this.nextId++);
    const timeout = setTimeout(() => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.reject(
        new VoicePythonBridgeError(
          "PYTHON_TIMEOUT",
          `Python voice process timed out after ${this.options.timeoutMs}ms.`
        )
      );
    }, this.options.timeoutMs);

    const promise = new Promise<VoicePythonResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, timeout });
    });

    child.stdin.write(JSON.stringify({ id, ...input }) + "\n");
    return promise;
  }

  close(): void {
    const child = this.child;
    this.child = null;
    this.startPromise = null;

    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return;
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
        const dependency = missingPythonDependency(error);
        const canFallback =
          (isMissingPythonRuntimeError(error) || dependency !== null) &&
          this.commandIndex < this.commands.length - 1;
        if (!canFallback) break;

        const next = this.commands[this.commandIndex + 1];
        const reason = dependency
          ? `missing package${dependency.moduleName ? ` (${dependency.moduleName})` : ""}`
          : "command unavailable";
        this.options.onStderr(
          `[voice-python] Python ${reason} in ${command.bin}; trying fallback (${next.bin}).`
        );
      }
    }

    const dependency = missingPythonDependency(lastError);
    if (dependency) {
      const moduleName = dependency.moduleName ?? "one or more required voice packages";
      throw new VoicePythonBridgeError(
        "PYTHON_DEPENDENCY_MISSING",
        `Python voice dependency is missing: ${moduleName}. Install python/voice_verification/requirements.txt in .venv-voice or set VOICE_PYTHON_BIN to a configured voice environment.`,
        dependency.details
      );
    }

    if (isMissingPythonRuntimeError(lastError)) {
      throw new VoicePythonBridgeError(
        "PYTHON_SPAWN_FAILED",
        'Python runtime not found. Install Python 3 or set VOICE_PYTHON_BIN (Windows example: ".venv-voice\\\\Scripts\\\\python.exe").',
        lastError instanceof VoicePythonBridgeError ? lastError.details : undefined
      );
    }

    throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
  }

  private async startWithCommand(command: PythonCommand): Promise<void> {
    const args = buildWorkerArgs(this.options, command);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: buildVoicePythonEnv(),
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
          new VoicePythonBridgeError(
            "PYTHON_TIMEOUT",
            `Python voice worker startup timed out after ${this.options.timeoutMs}ms.`,
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
          new VoicePythonBridgeError(
            "PYTHON_SPAWN_FAILED",
            `Failed to spawn python process (${command.bin}).`,
            error.message
          )
        );
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        const message = chunk.toString();
        stderr += message;
        this.options.onStderr(`[voice-python] ${message.trimEnd()}`);
      });

      child.on("close", (code, signal) => {
        this.rejectAll(
          new VoicePythonBridgeError(
            "PYTHON_EXIT_NON_ZERO",
            `Python voice worker exited with code ${code}${signal ? ` (signal: ${signal})` : ""}.`,
            stderr.trim() || undefined
          )
        );

        if (!settled) {
          finishReject(
            new VoicePythonBridgeError(
              "PYTHON_EXIT_NON_ZERO",
              `Python voice worker exited with code ${code}${signal ? ` (signal: ${signal})` : ""}.`,
              stderr.trim() || undefined
            )
          );
        }
      });

      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch (error) {
          this.options.onStderr(`[voice-python stdout] ${trimmed}`);
          return;
        }

        if (parsed.event === "ready") {
          if (parsed.ok === false) {
            const reason = typeof parsed.reason === "string" ? parsed.reason : null;
            finishReject(
              new VoicePythonBridgeError(
                mapWorkerReasonToBridgeCode(reason),
                reason === "gpu_required"
                  ? "GPU is required for voice verification but CUDA is unavailable."
                  : "Python voice worker failed to start.",
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
      const result = normalizeVoicePythonResult(message);
      if (!result.ok && result.reason) {
        const code = mapWorkerReasonToBridgeCode(result.reason);
        if (code === "GPU_REQUIRED") {
          pending.reject(
            new VoicePythonBridgeError(
              "GPU_REQUIRED",
              "GPU is required for voice verification but CUDA is unavailable."
            )
          );
          return;
        }
      }

      pending.resolve(result);
    } catch (error) {
      pending.reject(
        error instanceof Error
          ? error
          : new VoicePythonBridgeError("PYTHON_OUTPUT_INVALID", String(error))
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

const workers = new Map<string, VoicePythonWorker>();

function buildRequiredOptions(options: RunVoicePythonOptions): RequiredWorkerOptions {
  const resolveDevice = (value: unknown): "auto" | "cuda" | "cpu" =>
    value === "cuda" || value === "cpu" || value === "auto" ? value : DEFAULT_VOICE_DEVICE;

  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_VOICE_PYTHON_TIMEOUT_MS,
    pythonArgs: options.pythonArgs ?? [],
    scriptPath: options.scriptPath ?? resolveDefaultVoiceScriptPath(),
    device: resolveDevice(options.device ?? process.env.VOICE_DEVICE),
    requireGpu:
      options.requireGpu ??
      (typeof process.env.VOICE_REQUIRE_GPU === "string" &&
        process.env.VOICE_REQUIRE_GPU.toLowerCase() === "true"),
    whisperModel:
      options.whisperModel ??
      (typeof process.env.VOICE_WHISPER_MODEL === "string" &&
      process.env.VOICE_WHISPER_MODEL.trim().length > 0
        ? process.env.VOICE_WHISPER_MODEL.trim()
        : DEFAULT_VOICE_WHISPER_MODEL),
    speakerModel:
      options.speakerModel ??
      (typeof process.env.VOICE_SPEAKER_MODEL === "string" &&
      process.env.VOICE_SPEAKER_MODEL.trim().length > 0
        ? process.env.VOICE_SPEAKER_MODEL.trim()
        : DEFAULT_VOICE_SPEAKER_MODEL),
    onStderr: options.onStderr ?? ((message: string) => console.error(message)),
  };
}

function workerKey(options: RequiredWorkerOptions, commands: PythonCommand[]): string {
  return JSON.stringify({
    commands,
    scriptPath: options.scriptPath,
    device: options.device,
    requireGpu: options.requireGpu,
    whisperModel: options.whisperModel,
    speakerModel: options.speakerModel,
    pythonArgs: options.pythonArgs,
  });
}

export async function runVoicePython(
  input: VoicePythonInput,
  options: RunVoicePythonOptions = {}
): Promise<VoicePythonResult> {
  const requiredOptions = buildRequiredOptions(options);
  const commands = buildPythonCommandCandidates(options);
  const key = workerKey(requiredOptions, commands);
  let worker = workers.get(key);

  if (!worker) {
    worker = new VoicePythonWorker(commands, requiredOptions);
    workers.set(key, worker);
  }

  return worker.run(input);
}

export function closeVoicePythonWorkers(): void {
  for (const worker of workers.values()) {
    worker.close();
  }
  workers.clear();
}
