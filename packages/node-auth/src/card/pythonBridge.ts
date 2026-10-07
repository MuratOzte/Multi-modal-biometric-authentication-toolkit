import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type {
  CardComparisonDecision,
  CardComparisonQuality,
  CardExtractedFields,
  CardMatchCandidate,
  CardVisualDetails,
  CardVerificationResult,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../../python/card_verification/main.py"
);
const DEFAULT_TIMEOUT_MS = 300_000;

export type CardPythonBridgeErrorCode =
  | "PYTHON_SPAWN_FAILED"
  | "PYTHON_DEPENDENCY_MISSING"
  | "PYTHON_TIMEOUT"
  | "PYTHON_EXIT_NON_ZERO"
  | "PYTHON_JSON_PARSE_ERROR"
  | "PYTHON_OUTPUT_INVALID"
  | "PYTHON_PROCESS_ERROR";

export class CardPythonBridgeError extends Error {
  readonly code: CardPythonBridgeErrorCode;
  readonly details?: string;

  constructor(code: CardPythonBridgeErrorCode, message: string, details?: string) {
    super(message);
    this.name = "CardPythonBridgeError";
    this.code = code;
    this.details = details;
  }
}

export interface RunCardPythonOptions {
  timeoutMs?: number;
  pythonBin?: string;
  pythonArgs?: string[];
  scriptPath?: string;
  onStderr?: (message: string) => void;
}

type PythonCommand = {
  bin: string;
  args: string[];
};

type CardPythonInput = {
  probeImagePath: string;
  referenceDir: string;
  threshold?: number;
};

type PendingRequest = {
  input: CardPythonInput;
  resolve: (result: CardVerificationResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export function buildCardPythonEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
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
    const windowsVenvPython = path.join(root, ".venv", "Scripts", "python.exe");
    const unixVenvPython = path.join(root, ".venv", "bin", "python");

    if (existsSync(windowsVenvPython)) {
      candidates.push({ bin: windowsVenvPython, args: [] });
    }

    if (existsSync(unixVenvPython)) {
      candidates.push({ bin: unixVenvPython, args: [] });
    }
  }

  return candidates;
}

function parsePythonCommand(raw: string, fallbackBin = "python3"): PythonCommand {
  const trimmed = raw.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;

  if (existsSync(unquoted)) {
    return { bin: unquoted, args: [] };
  }

  const split = trimmed
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

function buildPythonCommandCandidates(options: RunCardPythonOptions): PythonCommand[] {
  const envPythonBin =
    typeof process.env.CARD_PYTHON_BIN === "string" &&
    process.env.CARD_PYTHON_BIN.trim().length > 0
      ? process.env.CARD_PYTHON_BIN.trim()
      : typeof process.env.PYTHON_BIN === "string" && process.env.PYTHON_BIN.trim().length > 0
        ? process.env.PYTHON_BIN.trim()
      : null;

  const explicitPythonBin =
    typeof options.pythonBin === "string" && options.pythonBin.trim().length > 0
      ? options.pythonBin.trim()
      : envPythonBin;

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
  if (!(error instanceof CardPythonBridgeError)) return false;

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

function missingCardOcrDependencyFromText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = value.match(/no module named ['"](paddleocr|paddle)['"]/i);
  return match?.[1] ?? null;
}

function missingCardOcrDependencyFromResult(
  result: CardVerificationResult
): { moduleName: string; details: string } | null {
  const candidates = [
    ...(result.bestMatch ? [result.bestMatch] : []),
    ...result.candidates,
  ];

  for (const candidate of candidates) {
    if (candidate.quality.ocrAvailable) continue;

    for (const error of [
      candidate.quality.ocrErrorProbe,
      candidate.quality.ocrErrorReference,
    ]) {
      const moduleName = missingCardOcrDependencyFromText(error);
      if (moduleName) {
        return {
          moduleName,
          details: error ?? `No module named '${moduleName}'`,
        };
      }
    }
  }

  return null;
}

function missingPythonDependency(error: unknown): { moduleName: string | null; details?: string } | null {
  if (!(error instanceof CardPythonBridgeError)) return null;
  if (error.code !== "PYTHON_EXIT_NON_ZERO" && error.code !== "PYTHON_PROCESS_ERROR") return null;

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
  const expectedPackages = [
    "cv2",
    "numpy",
    "yaml",
    "paddle",
    "paddleocr",
    "torch",
    "open_clip",
    "clip",
  ];
  if (lowered.includes("importerror") && expectedPackages.some((pkg) => lowered.includes(pkg))) {
    return {
      moduleName: null,
      details,
    };
  }

  return null;
}

function mapWorkerReasonToBridgeCode(reason: string | null): CardPythonBridgeErrorCode {
  if (reason === "invalid_request") return "PYTHON_OUTPUT_INVALID";
  return "PYTHON_PROCESS_ERROR";
}

function normalizeScore(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName} must be a finite number.`
    );
  }

  if (value < 0 || value > 1) {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName} must be between 0 and 1.`
    );
  }

  return value;
}

function normalizeNullableScore(value: unknown, fieldName: string): number | null {
  if (value === null) return null;
  return normalizeScore(value, fieldName);
}

function normalizeNullableCosine(value: unknown, fieldName: string): number | null {
  if (value === null) return null;

  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName} must be null or a finite number between -1 and 1.`
    );
  }

  return value;
}

function normalizeNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;

  throw new CardPythonBridgeError(
    "PYTHON_OUTPUT_INVALID",
    `Python card output ${fieldName} must be null or a string.`
  );
}

function normalizeDecision(value: unknown, fieldName: string): CardComparisonDecision {
  if (value === "same" || value === "different" || value === "uncertain") {
    return value;
  }

  throw new CardPythonBridgeError(
    "PYTHON_OUTPUT_INVALID",
    `Python card output ${fieldName} must be same, different, or uncertain.`
  );
}

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName} must be an array of strings.`
    );
  }

  return value;
}

function normalizeExtractedFields(raw: unknown, fieldName: string): CardExtractedFields {
  if (!raw || typeof raw !== "object") {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName} must be a JSON object.`
    );
  }

  const source = raw as Record<string, unknown>;
  const name = typeof source.name === "string" ? source.name : null;
  const studentNo = typeof source.studentNo === "string" ? source.studentNo : null;
  const documentNo = typeof source.documentNo === "string" ? source.documentNo : "";
  const cardNo = typeof source.cardNo === "string" ? source.cardNo : null;
  const validThru = typeof source.validThru === "string" ? source.validThru : null;

  if (name === null || studentNo === null || cardNo === null || validThru === null) {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName} is missing required fields.`
    );
  }

  return { name, studentNo, documentNo, cardNo, validThru };
}

function normalizeQuality(raw: unknown, fieldName: string): CardComparisonQuality {
  if (!raw || typeof raw !== "object") {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName} must be a JSON object.`
    );
  }

  const source = raw as Record<string, unknown>;
  const cardDetectedProbe =
    typeof source.cardDetectedProbe === "boolean" ? source.cardDetectedProbe : null;
  const cardDetectedReference =
    typeof source.cardDetectedReference === "boolean"
      ? source.cardDetectedReference
      : null;
  const detectionConfidenceProbe =
    typeof source.detectionConfidenceProbe === "number" &&
    Number.isFinite(source.detectionConfidenceProbe)
      ? source.detectionConfidenceProbe
      : Number.NaN;
  const detectionConfidenceReference =
    typeof source.detectionConfidenceReference === "number" &&
    Number.isFinite(source.detectionConfidenceReference)
      ? source.detectionConfidenceReference
      : Number.NaN;
  const ocrAvailable = typeof source.ocrAvailable === "boolean" ? source.ocrAvailable : null;
  const ocrWeak = typeof source.ocrWeak === "boolean" ? source.ocrWeak : null;
  const ocrErrorProbe =
    typeof source.ocrErrorProbe === "string" || source.ocrErrorProbe === null
      ? source.ocrErrorProbe
      : null;
  const ocrErrorReference =
    typeof source.ocrErrorReference === "string" || source.ocrErrorReference === null
      ? source.ocrErrorReference
      : null;

  if (
    cardDetectedProbe === null ||
    cardDetectedReference === null ||
    Number.isNaN(detectionConfidenceProbe) ||
    Number.isNaN(detectionConfidenceReference) ||
    ocrAvailable === null ||
    ocrWeak === null ||
    (source.ocrErrorProbe !== null && source.ocrErrorProbe !== undefined && ocrErrorProbe === null) ||
    (source.ocrErrorReference !== null &&
      source.ocrErrorReference !== undefined &&
      ocrErrorReference === null)
  ) {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName} is missing required fields.`
    );
  }

  return {
    cardDetectedProbe,
    cardDetectedReference,
    detectionConfidenceProbe,
    detectionConfidenceReference,
    ocrAvailable,
    ocrWeak,
    ocrErrorProbe,
    ocrErrorReference,
  };
}

function normalizeVisualDetails(raw: unknown, fieldName: string): CardVisualDetails | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName} must be a JSON object when provided.`
    );
  }

  const source = raw as Record<string, unknown>;
  if (source.activeMethod !== "clip") {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName}.activeMethod must be clip.`
    );
  }

  const clipScore = normalizeNullableScore(source.clipScore, `${fieldName}.clipScore`);
  const clipCosine = normalizeNullableCosine(source.clipCosine, `${fieldName}.clipCosine`);
  const clipAvailable =
    typeof source.clipAvailable === "boolean" ? source.clipAvailable : null;
  const clipModel = normalizeNullableString(source.clipModel, `${fieldName}.clipModel`);
  const clipDevice = normalizeNullableString(source.clipDevice, `${fieldName}.clipDevice`);
  const clipError = normalizeNullableString(source.clipError, `${fieldName}.clipError`);

  if (clipAvailable === null) {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output ${fieldName}.clipAvailable must be a boolean.`
    );
  }

  return {
    activeMethod: "clip",
    clipScore,
    clipCosine,
    clipAvailable,
    clipModel,
    clipDevice,
    clipError,
  };
}

function normalizeCandidate(raw: unknown, index: number): CardMatchCandidate {
  if (!raw || typeof raw !== "object") {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output candidate #${index + 1} must be a JSON object.`
    );
  }

  const source = raw as Record<string, unknown>;

  const referenceImagePath =
    typeof source.referenceImagePath === "string" ? source.referenceImagePath : null;
  const referenceFileName =
    typeof source.referenceFileName === "string" ? source.referenceFileName : null;
  const decision = normalizeDecision(source.decision, `candidate #${index + 1} decision`);
  const overallScore = normalizeScore(
    source.overallScore,
    `candidate #${index + 1} overallScore`
  );
  const contentScore = normalizeScore(
    source.contentScore,
    `candidate #${index + 1} contentScore`
  );
  const visualScore = normalizeScore(source.visualScore, `candidate #${index + 1} visualScore`);
  const reasons = normalizeStringArray(source.reasons, `candidate #${index + 1} reasons`);
  const matched = typeof source.matched === "boolean" ? source.matched : null;
  const fieldsSource =
    source.fields && typeof source.fields === "object"
      ? (source.fields as Record<string, unknown>)
      : null;
  const fields =
    fieldsSource === null
      ? null
      : {
          probe: normalizeExtractedFields(
            fieldsSource.probe,
            `candidate #${index + 1} fields.probe`
          ),
          reference: normalizeExtractedFields(
            fieldsSource.reference,
            `candidate #${index + 1} fields.reference`
          ),
        };
  const quality = normalizeQuality(source.quality, `candidate #${index + 1} quality`);
  const visualDetails = normalizeVisualDetails(
    source.visualDetails,
    `candidate #${index + 1} visualDetails`
  );

  if (
    !referenceImagePath ||
    !referenceFileName ||
    fields === null ||
    matched === null
  ) {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      `Python card output candidate #${index + 1} is missing required fields.`
    );
  }

  return {
    referenceImagePath,
    referenceFileName,
    decision,
    overallScore,
    contentScore,
    visualScore,
    ...(visualDetails !== undefined ? { visualDetails } : {}),
    reasons,
    fields,
    quality,
    matched,
  };
}

function normalizePythonResult(raw: unknown): CardVerificationResult {
  if (!raw || typeof raw !== "object") {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python card output must be a JSON object."
    );
  }

  const source = raw as Record<string, unknown>;

  if (typeof source.ok !== "boolean") {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python card output must include boolean ok field."
    );
  }

  if (typeof source.matched !== "boolean") {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python card output must include boolean matched field."
    );
  }

  const threshold =
    typeof source.threshold === "number" && Number.isFinite(source.threshold)
      ? source.threshold
      : Number.NaN;
  const checkedCount =
    typeof source.checkedCount === "number" && Number.isFinite(source.checkedCount)
      ? source.checkedCount
      : Number.NaN;
  const reason =
    typeof source.reason === "string" ? source.reason : source.reason == null ? null : null;
  const candidates = Array.isArray(source.candidates)
    ? source.candidates.map((candidate, index) => normalizeCandidate(candidate, index))
    : null;
  const bestMatch =
    source.bestMatch == null ? null : normalizeCandidate(source.bestMatch, 0);

  if (Number.isNaN(threshold) || Number.isNaN(checkedCount) || candidates === null) {
    throw new CardPythonBridgeError(
      "PYTHON_OUTPUT_INVALID",
      "Python card output is missing required verification fields."
    );
  }

  return {
    ok: source.ok,
    matched: source.matched,
    threshold,
    checkedCount,
    reason,
    bestMatch,
    candidates,
    cardVerificationByClipOld:
      source.cardVerificationByClipOld &&
      typeof source.cardVerificationByClipOld === "object"
        ? (source.cardVerificationByClipOld as CardVerificationResult["cardVerificationByClipOld"])
        : null,
  };
}

async function runCardPythonOnce(
  input: {
    probeImagePath: string;
    referenceDir: string;
    threshold?: number;
  },
  command: PythonCommand,
  options: {
    timeoutMs: number;
    pythonArgs: string[];
    scriptPath: string;
    onStderr: (message: string) => void;
  }
): Promise<CardVerificationResult> {
  const threshold =
    typeof input.threshold === "number" && Number.isFinite(input.threshold)
      ? input.threshold
      : undefined;

  const args = [
    ...command.args,
    ...options.pythonArgs,
    options.scriptPath,
    "--probe",
    input.probeImagePath,
    "--references-dir",
    input.referenceDir,
    "--json",
    ...(threshold !== undefined ? ["--threshold", String(threshold)] : []),
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn(command.bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let settled = false;
    let stdout = "";
    let stderr = "";

    const finishResolve = (value: CardVerificationResult): void => {
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
        new CardPythonBridgeError(
          "PYTHON_TIMEOUT",
          `Python card process timed out after ${options.timeoutMs}ms.`,
          stderr.trim() || undefined
        )
      );
    }, options.timeoutMs);

    child.on("error", (error) => {
      finishReject(
        new CardPythonBridgeError(
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
      options.onStderr(`[card-python] ${message.trimEnd()}`);
    });

    child.on("close", (code, signal) => {
      const trimmedStdout = stdout.trim();
      let parsedPayload: CardVerificationResult | null = null;

      if (trimmedStdout.length > 0) {
        try {
          parsedPayload = normalizePythonResult(JSON.parse(trimmedStdout));
        } catch (error) {
          if (error instanceof CardPythonBridgeError) {
            finishReject(error);
            return;
          }

          finishReject(
            new CardPythonBridgeError(
              "PYTHON_JSON_PARSE_ERROR",
              "Failed to parse python card output as JSON.",
              error instanceof Error ? error.message : String(error)
            )
          );
          return;
        }
      }

      if (code !== 0) {
        if (parsedPayload) {
          finishResolve(parsedPayload);
          return;
        }

        finishReject(
          new CardPythonBridgeError(
            "PYTHON_EXIT_NON_ZERO",
            `Python card process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}.`,
            stderr.trim() || undefined
          )
        );
        return;
      }

      if (!parsedPayload) {
        finishReject(
          new CardPythonBridgeError(
            "PYTHON_OUTPUT_INVALID",
            "Python card output is empty."
          )
        );
        return;
      }

      finishResolve(parsedPayload);
    });
  });
}

type RequiredWorkerOptions = {
  timeoutMs: number;
  pythonArgs: string[];
  scriptPath: string;
  onStderr: (message: string) => void;
};

function buildWorkerArgs(options: RequiredWorkerOptions, command: PythonCommand): string[] {
  return [...command.args, ...options.pythonArgs, options.scriptPath, "--worker"];
}

export class CardPythonWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private startPromise: Promise<void> | null = null;
  private commandIndex = 0;

  constructor(
    private readonly commands: PythonCommand[],
    private readonly options: RequiredWorkerOptions
  ) {}

  async run(input: CardPythonInput): Promise<CardVerificationResult> {
    await this.ensureStarted();

    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) {
      throw new CardPythonBridgeError("PYTHON_PROCESS_ERROR", "Python card worker is not running.");
    }

    const id = String(this.nextId++);
    const timeout = setTimeout(() => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.reject(
        new CardPythonBridgeError(
          "PYTHON_TIMEOUT",
          `Python card process timed out after ${this.options.timeoutMs}ms.`
        )
      );
    }, this.options.timeoutMs);

    const promise = new Promise<CardVerificationResult>((resolve, reject) => {
      this.pending.set(id, { input, resolve, reject, timeout });
    });

    const threshold =
      typeof input.threshold === "number" && Number.isFinite(input.threshold)
        ? input.threshold
        : undefined;
    const payload = {
      id,
      probeImagePath: input.probeImagePath,
      referenceDir: input.referenceDir,
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
          new CardPythonBridgeError(
            "PYTHON_PROCESS_ERROR",
            "Failed to write request to Python card worker.",
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
      new CardPythonBridgeError("PYTHON_PROCESS_ERROR", "Python card worker was closed.")
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
          `[card-python] Python ${reason} in ${command.bin}; trying fallback (${next.bin}).`
        );
      }
    }

    const dependency = missingPythonDependency(lastError);
    if (dependency) {
      const moduleName = dependency.moduleName ?? "one or more required card packages";
      throw new CardPythonBridgeError(
        "PYTHON_DEPENDENCY_MISSING",
        `Python card dependency is missing: ${moduleName}. Install python/card_verification/requirements.txt in the selected Python environment or set CARD_PYTHON_BIN to a configured card environment.`,
        dependency.details
      );
    }

    if (isMissingPythonRuntimeError(lastError)) {
      throw new CardPythonBridgeError(
        "PYTHON_SPAWN_FAILED",
        'Python runtime not found. Install Python 3 or set CARD_PYTHON_BIN/PYTHON_BIN (Windows example: "py -3").',
        lastError instanceof CardPythonBridgeError ? lastError.details : undefined
      );
    }

    throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
  }

  private async startWithCommand(command: PythonCommand): Promise<void> {
    const args = buildWorkerArgs(this.options, command);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(command.bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: buildCardPythonEnv(),
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
          new CardPythonBridgeError(
            "PYTHON_TIMEOUT",
            `Python card worker startup timed out after ${this.options.timeoutMs}ms.`,
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
          new CardPythonBridgeError(
            "PYTHON_SPAWN_FAILED",
            `Failed to spawn python process (${command.bin}).`,
            error.message
          )
        );
      });

      child.stderr.on("data", (chunk: Buffer | string) => {
        const message = chunk.toString();
        stderr += message;
        this.options.onStderr(`[card-python] ${message.trimEnd()}`);
      });

      child.on("close", (code, signal) => {
        const isCurrentChild = this.child === child;
        if (isCurrentChild) {
          this.child = null;
        }

        const error = new CardPythonBridgeError(
          "PYTHON_EXIT_NON_ZERO",
          `Python card worker exited with code ${code}${signal ? ` (signal: ${signal})` : ""}.`,
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
          this.options.onStderr(`[card-python stdout] ${trimmed}`);
          return;
        }

        if (parsed.event === "ready") {
          if (parsed.ok === false) {
            const reason = typeof parsed.reason === "string" ? parsed.reason : null;
            const errorDetail =
              typeof parsed.error === "string" && parsed.error.trim().length > 0
                ? parsed.error.trim()
                : null;
            const details = [stderr.trim(), reason, errorDetail]
              .filter((value) => value && value.length > 0)
              .join("\n");
            finishReject(
              new CardPythonBridgeError(
                mapWorkerReasonToBridgeCode(reason),
                "Python card worker failed to start.",
                details || undefined
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
      const missingDependency = missingCardOcrDependencyFromResult(result);

      if (missingDependency) {
        if (this.commandIndex < this.commands.length - 1) {
          const command = this.commands[this.commandIndex];
          const next = this.commands[this.commandIndex + 1];
          this.options.onStderr(
            `[card-python] OCR dependency missing in ${command.bin}; trying fallback (${next.bin}).`
          );
          this.restartWithNextCommand();
          this.run(pending.input).then(pending.resolve, pending.reject);
          return;
        }

        pending.reject(
          new CardPythonBridgeError(
            "PYTHON_DEPENDENCY_MISSING",
            `Python card OCR dependency is missing: ${missingDependency.moduleName}. Install python/card_verification/requirements.txt in the selected Python environment or set CARD_PYTHON_BIN to an environment with PaddleOCR and PaddlePaddle.`,
            missingDependency.details
          )
        );
        return;
      }

      if (!result.ok && result.reason) {
        pending.reject(
          new CardPythonBridgeError(
            mapWorkerReasonToBridgeCode(result.reason),
            "Python card worker failed to process request.",
            result.reason
          )
        );
        return;
      }

      pending.resolve(result);
    } catch (error) {
      pending.reject(
        error instanceof Error
          ? error
          : new CardPythonBridgeError("PYTHON_OUTPUT_INVALID", String(error))
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

  private restartWithNextCommand(): void {
    const child = this.child;
    this.child = null;
    this.startPromise = null;
    this.commandIndex += 1;

    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }
}

const workers = new Map<string, CardPythonWorker>();

function buildRequiredOptions(options: RunCardPythonOptions): RequiredWorkerOptions {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    pythonArgs: options.pythonArgs ?? [],
    scriptPath: options.scriptPath ?? DEFAULT_SCRIPT_PATH,
    onStderr: options.onStderr ?? ((message: string) => console.error(message)),
  };
}

function workerKey(options: RequiredWorkerOptions, commands: PythonCommand[]): string {
  return JSON.stringify({
    commands,
    scriptPath: options.scriptPath,
    pythonArgs: options.pythonArgs,
  });
}

export async function runCardPython(
  input: {
    probeImagePath: string;
    referenceDir: string;
    threshold?: number;
  },
  options: RunCardPythonOptions = {}
): Promise<CardVerificationResult> {
  const requiredOptions = buildRequiredOptions(options);
  const commands = buildPythonCommandCandidates(options);
  const key = workerKey(requiredOptions, commands);
  let worker = workers.get(key);

  if (!worker) {
    worker = new CardPythonWorker(commands, requiredOptions);
    workers.set(key, worker);
  }

  return worker.run(input);
}

export function closeCardPythonWorkers(): void {
  for (const worker of workers.values()) {
    worker.close();
  }
  workers.clear();
}
