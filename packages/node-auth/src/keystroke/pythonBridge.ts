import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PythonBridgeInput, PythonBridgeOutput } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCRIPT_PATH = path.resolve(__dirname, "./python/keystroke_ml.py");
const DEFAULT_TIMEOUT_MS = 2_000;

export type PythonBridgeErrorCode =
  | "PYTHON_SPAWN_FAILED"
  | "PYTHON_TIMEOUT"
  | "PYTHON_EXIT_NON_ZERO"
  | "PYTHON_JSON_PARSE_ERROR"
  | "PYTHON_REPORTED_ERROR";

export class PythonBridgeError extends Error {
  readonly code: PythonBridgeErrorCode;
  readonly details?: string;

  constructor(code: PythonBridgeErrorCode, message: string, details?: string) {
    super(message);
    this.name = "PythonBridgeError";
    this.code = code;
    this.details = details;
  }
}

export interface RunPythonBridgeOptions {
  timeoutMs?: number;
  pythonBin?: string;
  pythonArgs?: string[];
  scriptPath?: string;
  onStderr?: (message: string) => void;
}

function safeStringify(input: unknown): string {
  return JSON.stringify(input);
}

type PythonCommand = {
  bin: string;
  args: string[];
};

function parsePythonCommand(raw: string, fallbackBin = "python3"): PythonCommand {
  const split = raw.trim().split(/\s+/).filter((part) => part.length > 0);
  const bin = split[0] ?? fallbackBin;
  const args = split.length > 1 ? split.slice(1) : [];

  if (bin === "py" && !args.some((arg) => arg.startsWith("-"))) {
    args.unshift("-3");
  }

  return {
    bin,
    args,
  };
}

function buildPythonCommandCandidates(options: RunPythonBridgeOptions): PythonCommand[] {
  const envPythonBin =
    typeof process.env.PYTHON_BIN === "string" && process.env.PYTHON_BIN.trim().length > 0
      ? process.env.PYTHON_BIN.trim()
      : null;

  const explicitPythonBin =
    typeof options.pythonBin === "string" && options.pythonBin.trim().length > 0
      ? options.pythonBin.trim()
      : envPythonBin;

  const base = parsePythonCommand(explicitPythonBin ?? "python3");
  if (explicitPythonBin) {
    return [base];
  }

  const fallbackCommands: PythonCommand[] = [
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
  if (!(error instanceof PythonBridgeError)) return false;

  if (error.code === "PYTHON_SPAWN_FAILED") {
    const details = (error.details ?? "").toLowerCase();
    return details.includes("enoent") || details.includes("not found");
  }

  if (error.code === "PYTHON_EXIT_NON_ZERO") {
    return error.message.includes("code 9009") || error.message.includes("code 127");
  }

  return false;
}

async function runPythonCommandOnce(
  input: PythonBridgeInput,
  command: PythonCommand,
  options: {
    timeoutMs: number;
    scriptPath: string;
    onStderr: (message: string) => void;
    pythonArgs: string[];
  }
): Promise<Exclude<PythonBridgeOutput, { ok: false }>> {
  const { timeoutMs, scriptPath, onStderr, pythonArgs } = options;

  return await new Promise((resolve, reject) => {
    const child = spawn(command.bin, [...command.args, ...pythonArgs, scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let settled = false;
    let stdout = "";
    let stderr = "";

    const finishResolve = (value: Exclude<PythonBridgeOutput, { ok: false }>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(value);
    };

    const finishReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    };

    const timeoutHandle = setTimeout(() => {
      child.kill("SIGKILL");
      finishReject(
        new PythonBridgeError(
          "PYTHON_TIMEOUT",
          `Python keystroke process timed out after ${timeoutMs}ms.`,
          stderr.trim() || undefined
        )
      );
    }, timeoutMs);

    child.on("error", (error) => {
      finishReject(
        new PythonBridgeError(
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
      const value = chunk.toString();
      stderr += value;
      onStderr(`[keystroke-python] ${value.trimEnd()}`);
    });

    child.on("close", (code, signal) => {
      if (code !== 0) {
        finishReject(
          new PythonBridgeError(
            "PYTHON_EXIT_NON_ZERO",
            `Python keystroke process exited with code ${code} ${signal ? `(signal: ${signal})` : ""}.`,
            stderr.trim() || stdout.trim() || undefined
          )
        );
        return;
      }

      let parsed: PythonBridgeOutput;
      try {
        parsed = JSON.parse(stdout.trim()) as PythonBridgeOutput;
      } catch (error) {
        finishReject(
          new PythonBridgeError(
            "PYTHON_JSON_PARSE_ERROR",
            "Failed to parse python keystroke output as JSON.",
            error instanceof Error ? error.message : String(error)
          )
        );
        return;
      }

      if (parsed.ok === false) {
        finishReject(
          new PythonBridgeError(
            "PYTHON_REPORTED_ERROR",
            parsed.error,
            parsed.details
          )
        );
        return;
      }

      finishResolve(parsed);
    });

    child.stdin.write(safeStringify(input));
    child.stdin.end();
  });
}

export async function runKeystrokePython(
  input: PythonBridgeInput,
  options: RunPythonBridgeOptions = {}
): Promise<Exclude<PythonBridgeOutput, { ok: false }>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pythonCommands = buildPythonCommandCandidates(options);
  const providedPythonArgs = options.pythonArgs ?? [];
  const scriptPath = options.scriptPath ?? DEFAULT_SCRIPT_PATH;
  const onStderr = options.onStderr ?? ((message: string) => console.error(message));
  let lastError: unknown = null;

  for (let index = 0; index < pythonCommands.length; index += 1) {
    const command = pythonCommands[index];
    try {
      return await runPythonCommandOnce(input, command, {
        timeoutMs,
        scriptPath,
        onStderr,
        pythonArgs: providedPythonArgs,
      });
    } catch (error) {
      lastError = error;
      const canFallback = isMissingPythonRuntimeError(error) && index < pythonCommands.length - 1;
      if (!canFallback) break;

      const next = pythonCommands[index + 1];
      onStderr(
        `[keystroke-python] Python command unavailable (${command.bin}); trying fallback (${next.bin}).`
      );
    }
  }

  if (isMissingPythonRuntimeError(lastError)) {
    throw new PythonBridgeError(
      "PYTHON_SPAWN_FAILED",
      'Python runtime not found. Install Python 3 or set PYTHON_BIN (Windows example: "py -3").',
      lastError instanceof PythonBridgeError ? lastError.details : undefined
    );
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
}
