import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../../python/face_verification/face_sliding_window.py"
);
const DEFAULT_TIMEOUT_MS = 30_000;

export type SlidingWindowBridgeErrorCode =
  | "PYTHON_SPAWN_FAILED"
  | "PYTHON_TIMEOUT"
  | "PYTHON_EXIT_NON_ZERO"
  | "PYTHON_JSON_PARSE_ERROR"
  | "PYTHON_OUTPUT_INVALID";

export class SlidingWindowBridgeError extends Error {
  readonly code: SlidingWindowBridgeErrorCode;
  readonly details?: string;

  constructor(code: SlidingWindowBridgeErrorCode, message: string, details?: string) {
    super(message);
    this.name = "SlidingWindowBridgeError";
    this.code = code;
    this.details = details;
  }
}

export interface SlidingWindowEntry {
  id: string;
  ts: number;
  image?: string;
}

export interface PerReferenceScore {
  id: string;
  ts: number;
  score: number;
}

export interface SlidingWindowResult {
  ok: boolean;
  matched: boolean;
  score: number | null;
  perReferenceScores: PerReferenceScore[];
  windowSizeBefore: number;
  windowSizeAfter: number;
  threshold: number;
  reason: string | null;
  added: SlidingWindowEntry | null;
  evicted: SlidingWindowEntry[];
}

export interface RunSlidingWindowOptions {
  timeoutMs?: number;
  pythonBin?: string;
  pythonArgs?: string[];
  scriptPath?: string;
  device?: "auto" | "cuda" | "cpu";
  onStderr?: (message: string) => void;
}

export interface SlidingWindowInput {
  probeImagePath: string;
  userId: string;
  referencesRoot: string;
  threshold?: number;
  maxWindow?: number;
  updateOnSuccess?: boolean;
}

type PythonCommand = { bin: string; args: string[] };

function resolveLocalVenvPythonCandidates(): PythonCommand[] {
  const workspaceRoot = path.resolve(__dirname, "../../../../");
  const roots = Array.from(new Set([process.cwd(), workspaceRoot]));
  const candidates: PythonCommand[] = [];

  for (const root of roots) {
    for (const rel of [
      [".venv-face", "Scripts", "python.exe"],
      [".venv-face", "bin", "python"],
      [".venv", "Scripts", "python.exe"],
      [".venv", "bin", "python"],
    ]) {
      const candidate = path.join(root, ...rel);
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

function buildPythonCommandCandidates(options: RunSlidingWindowOptions): PythonCommand[] {
  const envBin =
    (process.env.FACE_PYTHON_BIN || process.env.PYTHON_BIN || "").trim() || null;

  const explicit =
    typeof options.pythonBin === "string" && options.pythonBin.trim().length > 0
      ? options.pythonBin.trim()
      : envBin;

  const base = parsePythonCommand(explicit ?? "python3");
  if (explicit) return [base];

  const fallback: PythonCommand[] = [
    ...resolveLocalVenvPythonCandidates(),
    base,
    parsePythonCommand("py -3"),
    parsePythonCommand("python3"),
    parsePythonCommand("python"),
  ];

  const seen = new Set<string>();
  const unique: PythonCommand[] = [];
  for (const command of fallback) {
    const key = `${command.bin}::${command.args.join("::")}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(command);
    }
  }
  return unique;
}

function isMissingPythonRuntimeError(error: unknown): boolean {
  if (!(error instanceof SlidingWindowBridgeError)) return false;
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function normalizeEntry(raw: unknown): SlidingWindowEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const id = asString(source.id);
  const ts = asNumber(source.ts);
  if (!id || ts === null) return null;
  const entry: SlidingWindowEntry = { id, ts };
  const image = asString(source.image);
  if (image) entry.image = image;
  return entry;
}

function normalizePerRefScores(raw: unknown): PerReferenceScore[] {
  if (!Array.isArray(raw)) return [];
  const result: PerReferenceScore[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const id = asString(source.id);
    const ts = asNumber(source.ts);
    const score = asNumber(source.score);
    if (id && ts !== null && score !== null) {
      result.push({ id, ts, score });
    }
  }
  return result;
}

function normalizeResult(raw: unknown): SlidingWindowResult {
  if (!raw || typeof raw !== "object") {
    throw new SlidingWindowBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Sliding window output must be a JSON object."
    );
  }

  const source = raw as Record<string, unknown>;
  if (typeof source.ok !== "boolean" || typeof source.matched !== "boolean") {
    throw new SlidingWindowBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Sliding window output missing ok/matched booleans."
    );
  }

  const before = asNumber(source.windowSizeBefore);
  const after = asNumber(source.windowSizeAfter);
  const threshold = asNumber(source.threshold);
  if (before === null || after === null || threshold === null) {
    throw new SlidingWindowBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Sliding window output missing numeric window/threshold fields."
    );
  }

  return {
    ok: source.ok,
    matched: source.matched,
    score: asNumber(source.score),
    perReferenceScores: normalizePerRefScores(source.perReferenceScores),
    windowSizeBefore: before,
    windowSizeAfter: after,
    threshold,
    reason: asString(source.reason) ?? null,
    added: normalizeEntry(source.added),
    evicted: Array.isArray(source.evicted)
      ? source.evicted
          .map(normalizeEntry)
          .filter((entry): entry is SlidingWindowEntry => entry !== null)
      : [],
  };
}

async function runOnce(
  input: SlidingWindowInput,
  command: PythonCommand,
  options: {
    timeoutMs: number;
    pythonArgs: string[];
    scriptPath: string;
    device: "auto" | "cuda" | "cpu";
    onStderr: (message: string) => void;
  }
): Promise<SlidingWindowResult> {
  const args = [
    ...command.args,
    ...options.pythonArgs,
    options.scriptPath,
    "--probe",
    input.probeImagePath,
    "--user-id",
    input.userId,
    "--references-root",
    input.referencesRoot,
    ...(input.threshold !== undefined && Number.isFinite(input.threshold)
      ? ["--threshold", String(input.threshold)]
      : []),
    ...(input.maxWindow !== undefined && Number.isFinite(input.maxWindow)
      ? ["--max-window", String(input.maxWindow)]
      : []),
    ...(input.updateOnSuccess === false ? ["--no-update"] : []),
    ...(options.device !== "auto" ? ["--device", options.device] : []),
    "--json",
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn(command.bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let settled = false;
    let stdout = "";
    let stderr = "";

    const finishResolve = (value: SlidingWindowResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(value);
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    };

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      finishReject(
        new SlidingWindowBridgeError(
          "PYTHON_TIMEOUT",
          `Sliding window process timed out after ${options.timeoutMs}ms.`,
          stderr.trim() || undefined
        )
      );
    }, options.timeoutMs);

    child.on("error", (error) => {
      finishReject(
        new SlidingWindowBridgeError(
          "PYTHON_SPAWN_FAILED",
          `Failed to spawn python process (${command.bin}).`,
          error.message
        )
      );
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const message = chunk.toString();
      stderr += message;
      options.onStderr(`[face-sliding] ${message.trimEnd()}`);
    });

    child.on("close", (code, signal) => {
      const trimmed = stdout.trim();
      let parsed: SlidingWindowResult | null = null;

      if (trimmed.length > 0) {
        try {
          parsed = normalizeResult(JSON.parse(trimmed));
        } catch (error) {
          if (error instanceof SlidingWindowBridgeError) {
            finishReject(error);
            return;
          }
          finishReject(
            new SlidingWindowBridgeError(
              "PYTHON_JSON_PARSE_ERROR",
              "Failed to parse sliding window output as JSON.",
              error instanceof Error ? error.message : String(error)
            )
          );
          return;
        }
      }

      if (code !== 0) {
        if (parsed) {
          finishResolve(parsed);
          return;
        }
        finishReject(
          new SlidingWindowBridgeError(
            "PYTHON_EXIT_NON_ZERO",
            `Sliding window process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}.`,
            stderr.trim() || undefined
          )
        );
        return;
      }

      if (!parsed) {
        finishReject(
          new SlidingWindowBridgeError("PYTHON_OUTPUT_INVALID", "Sliding window output is empty.")
        );
        return;
      }

      finishResolve(parsed);
    });
  });
}

export async function runFaceSlidingWindow(
  input: SlidingWindowInput,
  options: RunSlidingWindowOptions = {}
): Promise<SlidingWindowResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pythonCommands = buildPythonCommandCandidates(options);
  const scriptPath = options.scriptPath ?? DEFAULT_SCRIPT_PATH;
  const pythonArgs = options.pythonArgs ?? [];
  const device = options.device ?? "auto";
  const onStderr = options.onStderr ?? ((message: string) => console.error(message));
  let lastError: unknown = null;

  for (let index = 0; index < pythonCommands.length; index += 1) {
    const command = pythonCommands[index];
    try {
      return await runOnce(input, command, {
        timeoutMs,
        pythonArgs,
        scriptPath,
        device,
        onStderr,
      });
    } catch (error) {
      lastError = error;
      const canFallback = isMissingPythonRuntimeError(error) && index < pythonCommands.length - 1;
      if (!canFallback) break;

      const next = pythonCommands[index + 1];
      onStderr(
        `[face-sliding] Python command unavailable (${command.bin}); trying fallback (${next.bin}).`
      );
    }
  }

  if (isMissingPythonRuntimeError(lastError)) {
    throw new SlidingWindowBridgeError(
      "PYTHON_SPAWN_FAILED",
      'Python runtime not found. Install Python 3 or set FACE_PYTHON_BIN/PYTHON_BIN.',
      lastError instanceof SlidingWindowBridgeError ? lastError.details : undefined
    );
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
