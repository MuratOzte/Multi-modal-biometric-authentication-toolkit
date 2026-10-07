import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "./biometric-acceptance.mjs";

const modules = ["face", "voice", "card"];
const reasons = new Set([
  "SAMPLE_FILE_REQUIRED", "SAMPLE_TYPE_INVALID", "SAMPLE_SIZE_INVALID", "SAMPLE_TEXT_REQUIRED",
  "VOICE_THREE_SAMPLES_REQUIRED", "VOICE_WRONG_TEXT_REQUIRED",
  "FACE_DISTINCT_SAMPLES_REQUIRED", "VOICE_DISTINCT_SAMPLES_REQUIRED", "CARD_DISTINCT_SAMPLES_REQUIRED",
]);

// Only fixed codes leave this tool: filesystem errors can contain private paths.
function safeReason(error) {
  if (error.code === "ENOENT") return "SAMPLE_FILE_MISSING";
  if (reasons.has(error.message)) return error.message;
  return "SAMPLE_UNREADABLE";
}

export async function acceptanceStatus(file) {
  const report = {
    manifest: "invalid", samplesReady: false, allModulesSamplesReady: false,
    modelAcceptance: "pending", hardwareAcceptance: "pending", modules: [],
  };
  let manifest;
  try {
    manifest = JSON.parse(await readFile(file, "utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || !modules.some(module => manifest[module])) throw new Error("invalid");
  } catch {
    report.reason = "MANIFEST_UNREADABLE_OR_INVALID";
    return report;
  }
  report.manifest = "valid";
  for (const module of modules) {
    if (!manifest[module]) {
      report.modules.push({ module, status: "not-selected" });
      continue;
    }
    try {
      await validateManifest({ [module]: manifest[module] }, file);
      report.modules.push({ module, status: "ready" });
    } catch (error) {
      report.modules.push({ module, status: "blocked", reason: safeReason(error) });
    }
  }
  report.samplesReady = report.modules.filter(result => result.status !== "not-selected")
    .every(result => result.status === "ready");
  report.allModulesSamplesReady = report.modules.every(result => result.status === "ready");
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 2 || args.some(arg => arg.startsWith("--") && arg !== "--json")
    || args.filter(arg => arg !== "--json").length > 1
    || args.filter(arg => arg === "--json").length > 1) {
    console.log("Usage: node scripts/biometric-acceptance-status.mjs [local-manifest.json] [--json]");
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const file = args.find(arg => arg !== "--json") || path.join(root, ".run-logs/acceptance/manifest.json");
  const report = await acceptanceStatus(file);
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    if (report.reason) console.log(`manifest: ${report.reason}`);
    for (const result of report.modules) console.log(`${result.module}: ${result.status}${result.reason ? " (" + result.reason + ")" : ""}`);
    console.log(`Selected samples: ${report.samplesReady ? "ready" : "blocked"}; all three modules: ${report.allModulesSamplesReady ? "ready" : "pending"}.`);
    console.log("Model and camera/microphone acceptance: pending (not run by this command).");
    console.log(report.samplesReady
      ? "Next: build the API, configure Python runtimes and run test:biometric-acceptance with this manifest."
      : "Next: prepare:biometric-acceptance, add separate consented captures and update the manifest texts.");
  }
  process.exitCode = report.samplesReady ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
