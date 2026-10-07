import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server";
import { closeVoicePythonWorkers } from "../src/voice/pythonBridge";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const directory = await mkdtemp(path.join(tmpdir(), "securekit-stage6-parity-"));
const python = process.env.VOICE_PYTHON_BIN ?? (process.platform === "win32" ? "py -3" : "python3");
const script = path.join(root, "packages/node-auth/scripts/fixtures/voice-stage6.py");
const nodeProfiles = path.join(directory, "node.json"); const apiProfiles = path.join(directory, "api.json");
const initial = { records: { legacy: { consentLogs: [{ userId: "legacy" }], profiles: { userId: "legacy", voiceEmbedding: [1, 0], updatedAt: "2026-10-07T00:00:00.000Z", cardReferenceImagePath: "card.jpg" } } } };
await writeFile(nodeProfiles, JSON.stringify(initial)); await writeFile(apiProfiles, JSON.stringify(initial));
const server = createApp({ profileStorePath: nodeProfiles, usersFilePath: path.join(directory, "users.json"), voiceUploadMaxBytes: 128,
  voicePythonBin: python, voicePythonScriptPath: script, voicePythonTimeoutMs: 5000, voiceDevice: "cpu", voiceRequireGpu: false }).listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const nodeUrl = `http://127.0.0.1:${address.port}`;
const child = spawn("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll"), "--urls", "http://127.0.0.1:0"], {
  cwd: path.join(root, "apps/securekit-api"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Testing", SECUREKIT_PROFILE_STORE: apiProfiles,
    Voice__TempRoot: path.join(directory, "temp"), VOICE_PYTHON_BIN: python, VOICE_PYTHON_SCRIPT_PATH: script,
    VOICE_UPLOAD_MAX_BYTES: "128", VOICE_PYTHON_TIMEOUT_MS: "5000", VOICE_DEVICE: "cpu", VOICE_REQUIRE_GPU: "0" },
});
type File = { field?: string; text?: string; mime?: string; bytes?: Uint8Array };
let count = 0;
try {
  const apiUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ASP.NET startup timed out")), 20000); let output = "";
    child.stdout.on("data", data => { output += data.toString(); const match = output.match(/Now listening on: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.stderr.on("data", data => { output += data.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`ASP.NET exited ${code}: ${output}`)); });
  });
  const normalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) =>
      [key, ["updatedAt", "enrolledAt", "timestamp", "id", "expiresAt", "expiresAtMs"].includes(key) ? "<variable>" : normalize(v)]));
    return value;
  };
  const equal = (actual: any, expected: any, label: string): void => {
    if (typeof actual === "number" && typeof expected === "number") { assert(Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} != ${expected}`); return; }
    if (actual && expected && typeof actual === "object" && typeof expected === "object") {
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), label);
      for (const key of Object.keys(expected)) equal(actual[key], expected[key], label + "." + key);
    } else assert.deepEqual(actual, expected, label);
  };
  const request = async (base: string, route: string, fields: [string, string][], files: File[]) => {
    const form = new FormData();
    for (const [key, value] of fields) form.append(key, value);
    for (const file of files) form.append(file.field ?? "audioSample", new Blob([new Uint8Array(file.bytes ?? Buffer.from(file.text ?? "allow"))], { type: file.mime ?? "audio/webm" }), "sample.exe");
    const response = await fetch(base + route, { method: "POST", body: form });
    return { status: response.status, json: await response.json() as any };
  };
  const challenge = async (base: string, sessionId?: string) => {
    const response = await fetch(base + "/challenge/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: "tr", text: "Merhaba dünya", sessionId }) });
    assert.equal(response.status, 200); return (await response.json() as any).challengeId as string;
  };
  const compare = async (route: string, fields: [string, string][] = [["unused", "1"]], files: File[] = [], fresh = false, assignedSession?: string) => {
    const results = await Promise.all([nodeUrl, apiUrl].map(async base => request(base, route, fresh ? [...fields, ["challengeId", await challenge(base, assignedSession)]] : fields, files)));
    equal(normalize(results[1]), normalize(results[0]), route + " " + JSON.stringify(fields)); count++; return results;
  };
  for (const route of ["/enroll/voice", "/verify/voice"]) {
    await compare(route); await compare(route, [["userId", "u"]]);
    await compare(route, [["userId", "u"], ["challengeId", "missing"]]);
    await compare(route, [["userId", "u"], ["challengeId", "missing"]], [{}]);
    await compare(route, [], [{ mime: "text/plain" }]);
    await compare(route, [], [{ bytes: Buffer.alloc(129) }]);
    await compare(route, [], [{ field: "unexpected" }]);
    await compare(route, [], [{}, {}]);
    await compare(route, [["userId", "u"], ["challengeId", "missing"]], [{ bytes: Buffer.alloc(0) }]);
  }
  for (const [route, key] of [["/enroll/voice", "transcriptThreshold"], ["/enroll/voice", "minEnrollmentSamples"], ["/verify/voice", "matchThreshold"], ["/verify/voice", "stepUpThreshold"], ["/verify/voice", "denyThreshold"], ["/verify/voice", "profileUpdateAlpha"]]) {
    for (const value of ["NaN", "Infinity"]) await compare(route, [["userId", "legacy"], [key, value]], [{}], true);
    await compare(route, [["userId", "legacy"], [key, "1"], [key, "0"]], [{}], true);
  }
  await compare("/verify/voice", [["userId", "legacy"], ["updateProfileOnAllow", "yes"]], [{}], true);
  await compare("/verify/voice", [["userId", "legacy"], ["challengeId", "missing"]], [{}]);
  await compare("/verify/voice", [["userId", "legacy"], ["sessionId", "other"]], [{}], true, "assigned");
  await compare("/verify/voice", [["userId", "legacy"]], [{}], true, "assigned");
  for (const sample of ["mismatch", "step", "deny", "audio_too_short", "ffmpeg_missing", "other", "allow", "dimension"])
    await compare("/verify/voice", [["userId", "legacy"], ["updateProfileOnAllow", "false"]], [{ text: sample }], true);
  await compare("/verify/voice", [["userId", "legacy"], ["profileUpdateAlpha", ".2"], ["matchThreshold", ".4"]], [{ text: "step" }], true);
  for (const value of ["", " ", "0x1", "0b0", "0o1", "-1", "2"])
    await compare("/verify/voice", [["userId", "legacy"], ["matchThreshold", value], ["updateProfileOnAllow", " FALSE "]], [{}], true);
  for (const mime of ["audio/webm", "audio/wav", "audio/wave", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/ogg"])
    await compare("/enroll/voice", [["userId", "legacy"]], [{ mime }], true);
  await compare("/enroll/voice", [["userId", "legacy"]], [{ text: "dimension" }], true);
  await compare("/enroll/voice", [["userId", "legacy"]], [{ text: "mismatch" }], true);
  for (const value of ["1", "2.5", "0", "-1", "4"])
    await compare("/enroll/voice", [["userId", "legacy"], ["minEnrollmentSamples", value]], [{}], true);
  // Replay the same challenge against each host after a successful verification.
  const ids = await Promise.all([challenge(nodeUrl), challenge(apiUrl)]);
  for (let i = 0; i < 2; i++) {
    const results = await Promise.all([nodeUrl, apiUrl].map((base, j) => request(base, "/verify/voice", [["userId", "legacy"], ["challengeId", ids[j]]], [{}])));
    equal(normalize(results[1]), normalize(results[0]), "challenge replay"); count++;
    assert.equal(results[1].status, i === 0 ? 200 : 409);
  }
  equal(normalize(JSON.parse(await readFile(apiProfiles, "utf8"))), normalize(JSON.parse(await readFile(nodeProfiles, "utf8"))), "persisted profiles");
  assert.deepEqual(await readdir(path.join(directory, "temp")), []);
  console.log(`${count} Stage 6 Node/ASP.NET HTTP comparisons passed; persisted voice profiles and temporary cleanup verified (deterministic worker fixture).`);
} finally {
  closeVoicePythonWorkers(); child.kill();
  await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
