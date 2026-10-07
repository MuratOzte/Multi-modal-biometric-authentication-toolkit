import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile, stat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mimeTypes = { ".wav": "audio/wav", ".webm": "audio/webm", ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function requireValue(condition, code) { if (!condition) throw new Error(code); }

export async function loadManifest(file) {
  const manifest = JSON.parse(await readFile(file, "utf8"));
  requireValue(manifest && (manifest.face || manifest.voice || manifest.card), "MANIFEST_MODULE_REQUIRED");
  const base = path.dirname(path.resolve(file));
  const sample = async (value, kind) => {
    requireValue(value && typeof value.file === "string", "SAMPLE_FILE_REQUIRED");
    const filename = path.resolve(base, value.file);
    const mime = mimeTypes[path.extname(filename).toLowerCase()];
    requireValue(mime?.startsWith(kind + "/"), "SAMPLE_TYPE_INVALID");
    const info = await stat(filename);
    requireValue(info.isFile() && info.size > 0 && info.size <= (kind === "audio" ? 12 : 5) * 1024 * 1024, "SAMPLE_SIZE_INVALID");
    if (kind === "audio") requireValue(typeof value.text === "string" && value.text.trim().length > 0, "SAMPLE_TEXT_REQUIRED");
    return { file: filename, mime, text: value.text };
  };
  const requireDistinct = async (samples, code) => {
    requireValue(new Set(samples.map(v => v.file)).size === samples.length, code);
    const hashes = await Promise.all(samples.map(async value => createHash("sha256").update(await readFile(value.file)).digest("hex")));
    requireValue(new Set(hashes).size === samples.length, code);
  };
  const result = {};
  if (manifest.face) {
    result.face = Object.fromEntries(await Promise.all(["reference", "samePerson", "differentPerson"].map(async key => [key, await sample(manifest.face[key], "image")])));
    await requireDistinct(Object.values(result.face), "FACE_DISTINCT_SAMPLES_REQUIRED");
  }
  if (manifest.voice) {
    const voice = manifest.voice;
    requireValue(Array.isArray(voice.enrollment) && voice.enrollment.length === 3, "VOICE_THREE_SAMPLES_REQUIRED");
    result.voice = { enrollment: await Promise.all(voice.enrollment.map(v => sample(v, "audio"))),
      sameSpeaker: await sample(voice.sameSpeaker, "audio"), differentSpeaker: await sample(voice.differentSpeaker, "audio") };
    await requireDistinct([...result.voice.enrollment, result.voice.sameSpeaker, result.voice.differentSpeaker], "VOICE_DISTINCT_SAMPLES_REQUIRED");
    requireValue(typeof voice.wrongText === "string" && voice.wrongText.trim().length > 0 && voice.wrongText.trim() !== result.voice.sameSpeaker.text.trim(), "VOICE_WRONG_TEXT_REQUIRED");
    result.voice.wrongText = voice.wrongText;
  }
  if (manifest.card) {
    result.card = Object.fromEntries(await Promise.all(["reference", "sameCard", "differentCard"].map(async key => [key, await sample(manifest.card[key], "image")])));
    await requireDistinct(Object.values(result.card), "CARD_DISTINCT_SAMPLES_REQUIRED");
  }
  return result;
}

// Persist only fixed check names and booleans. Never copy API/worker responses.
export function accepted(name, result) {
  if (result.status !== 200 || result.body?.ok !== true) return false;
  const body = result.body;
  switch (name) {
    case "face-enrollment": return Boolean(body.reference);
    case "face-same-person": return body.matched === true && Number.isFinite(body.score) && !body.failureCode;
    case "face-different-person": return body.matched === false && Number.isFinite(body.score) && !body.failureCode;
    case "voice-enrollment": return body.enrollmentProgress?.complete === true && body.enrollmentProgress?.sampleCount >= 3;
    case "voice-same-speaker": return body.matched === true && body.decision === "allow" && body.transcript?.matched === true;
    case "voice-different-speaker": return body.matched === false && body.decision === "deny" && body.transcript?.matched === true;
    case "voice-wrong-text": return body.matched === false && body.decision === "deny" && body.transcript?.matched === false;
    case "card-enrollment": return Boolean(body.reference);
    case "card-same": return body.matched === true && body.bestMatch?.decision === "same" && cardBackendsPassed(body.bestMatch);
    case "card-different": return body.matched === false && body.bestMatch?.decision === "different" && cardBackendsPassed(body.bestMatch);
    default: return false;
  }
}

function cardBackendsPassed(candidate) {
  return candidate?.quality?.ocrAvailable === true && !candidate.quality.ocrErrorProbe && !candidate.quality.ocrErrorReference
    && candidate?.visualDetails?.clipAvailable === true && !candidate.visualDetails.clipError;
}

async function startApi(directory) {
  const child = spawn("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll"), "--urls", "http://127.0.0.1:0"], {
    cwd: path.join(root, "apps/securekit-api"), windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Testing", MOCK_IP_CHECK: "1",
      SECUREKIT_PROFILE_STORE: path.join(directory, "profiles.json"), SECUREKIT_USERS_FILE: path.join(directory, "users.json"),
      SECUREKIT_KEYSTROKE_STORE: path.join(directory, "keystroke"),
      Face__TempRoot: path.join(directory, "face-temp"), Face__ReferenceDirectory: path.join(directory, "face-references"),
      FACE_SLIDING_REFERENCES_ROOT: path.join(directory, "face-sliding"),
      Voice__TempRoot: path.join(directory, "voice-temp"), VOICE_MIN_ENROLLMENT_SAMPLES: "3",
      Card__TempRoot: path.join(directory, "card-temp"), Card__ReferenceDirectory: path.join(directory, "references"),
      Card__UserReferenceDirectory: path.join(directory, "user-references"),
      // Always use production workers; inherited fixture overrides must not pass as real acceptance.
      FACE_PYTHON_SCRIPT_PATH: path.join(root, "python/face_verification/face_verification.py"),
      VOICE_PYTHON_SCRIPT_PATH: path.join(root, "python/voice_verification/voice_worker.py"),
      CARD_PYTHON_SCRIPT_PATH: path.join(root, "python/card_verification/main.py") },
  });
  const closed = once(child, "close").catch(() => []);
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; };
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("API_START_TIMEOUT")), 20000);
      let output = "";
      child.stdout.on("data", data => {
        output = (output + data.toString()).slice(-8192);
        const match = output.match(/Now listening on: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once("error", () => { clearTimeout(timer); reject(new Error("API_START_FAILED")); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("API_EXITED")); });
    });
    return { url, stop };
  } catch (error) { await stop(); throw error; }
}

export async function runAcceptance(manifest) {
  const report = { checkedAt: new Date().toISOString(), modelAcceptance: "pending", hardwareAcceptance: "pending",
    scope: Object.keys(manifest), checks: [] };
  const directory = await mkdtemp(path.join(tmpdir(), "securekit-biometric-acceptance-"));
  let api;
  try {
    api = await startApi(directory);
    const request = async (route, body) => {
      const response = await fetch(api.url + route, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body),
        headers: body instanceof FormData ? {} : { "Content-Type": "application/json" }, signal: AbortSignal.timeout(660000) });
      return { status: response.status, body: await response.json() };
    };
    const check = (name, result) => {
      const passed = accepted(name, result);
      report.checks.push({ name, passed });
      console.log(`${name}: ${passed ? "PASS" : "FAIL"}`);
      return passed;
    };
    const upload = async (route, sample, field, fields) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      form.append(field, new Blob([await readFile(sample.file)], { type: sample.mime }), "sample" + path.extname(sample.file));
      return request(route, form);
    };
    const voice = async (route, sample, text = sample.text) => {
      const challenge = await request("/challenge/text", { lang: "tr", text });
      requireValue(challenge.status === 200 && challenge.body.challengeId, "CHALLENGE_FAILED");
      return upload(route, sample, "audioSample", { userId: "acceptance", challengeId: challenge.body.challengeId, updateProfileOnAllow: "false" });
    };
    if (manifest.face) {
      if (check("face-enrollment", await upload("/enroll/face/reference", manifest.face.reference, "referenceImage", { userId: "acceptance" }))) {
        check("face-same-person", await upload("/verify/face", manifest.face.samePerson, "probeImage", { userId: "acceptance" }));
        check("face-different-person", await upload("/verify/face", manifest.face.differentPerson, "probeImage", { userId: "acceptance" }));
      }
    }
    if (manifest.voice) {
      const consent = await request("/consent", { userId: "acceptance", consentVersion: "acceptance-v1" });
      requireValue(consent.status === 200 && consent.body.ok === true, "CONSENT_FAILED");
      let enrollment;
      for (const sample of manifest.voice.enrollment) {
        enrollment = await voice("/enroll/voice", sample);
        if (enrollment.status !== 200 || enrollment.body.ok !== true) break;
      }
      if (check("voice-enrollment", enrollment)) {
        check("voice-same-speaker", await voice("/verify/voice", manifest.voice.sameSpeaker));
        check("voice-different-speaker", await voice("/verify/voice", manifest.voice.differentSpeaker));
        check("voice-wrong-text", await voice("/verify/voice", manifest.voice.sameSpeaker, manifest.voice.wrongText));
      }
    }
    if (manifest.card) {
      if (check("card-enrollment", await upload("/enroll/card/reference", manifest.card.reference, "referenceImage", { userId: "acceptance" }))) {
        check("card-same", await upload("/verify/card", manifest.card.sameCard, "probeImage", { userId: "acceptance" }));
        check("card-different", await upload("/verify/card", manifest.card.differentCard, "probeImage", { userId: "acceptance" }));
      }
    }
    report.modelAcceptance = report.checks.length > 0 && report.checks.every(c => c.passed) ? "passed-for-selected-samples" : "failed";
  } catch {
    report.checks.push({ name: "execution", passed: false });
    report.modelAcceptance = "failed";
    console.log("execution: FAIL (check runtimes, build and local samples)");
  } finally {
    await api?.stop();
    await rm(directory, { recursive: true, force: true });
  }
  return report;
}

async function main() {
  const [file, option] = process.argv.slice(2);
  if (!file || (option && option !== "--check")) {
    console.log("Usage: node scripts/biometric-acceptance.mjs <local-manifest.json> [--check]");
    process.exitCode = 1; return;
  }
  let manifest;
  try { manifest = await loadManifest(file); }
  catch { console.log("Manifest invalid: check sample files, types, sizes and texts. No sample details logged."); process.exitCode = 1; return; }
  if (option === "--check") { console.log("Manifest valid. Models and hardware remain pending."); return; }
  const report = await runAcceptance(manifest);
  await mkdir(path.join(root, ".run-logs"), { recursive: true });
  await writeFile(path.join(root, ".run-logs/biometric-acceptance.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("Report: .run-logs/biometric-acceptance.json; manual hardware acceptance remains pending.");
  process.exitCode = report.modelAcceptance === "passed-for-selected-samples" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
