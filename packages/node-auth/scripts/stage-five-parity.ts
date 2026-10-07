import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "../src/server";
import { createFaceSlidingWindowRouter } from "../src/routes/faceSlidingWindow";
import { closeFacePythonWorkers } from "../src/face/pythonBridge";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const directory = await mkdtemp(path.join(tmpdir(), "securekit-stage5-parity-"));
const imagePath = process.env.SECUREKIT_FACE_REAL_IMAGE;
const real = Boolean(imagePath);
const python = process.env.FACE_PYTHON_BIN ?? (process.platform === "win32" ? "py -3" : "python3");
const script = real ? path.join(root, "python/face_verification/face_verification.py") : path.join(root, "packages/node-auth/scripts/fixtures/face-stage5.py");
const slidingScript = real ? path.join(root, "python/face_verification/face_sliding_window.py") : script;
const bytes = real ? await readFile(imagePath!) : Buffer.from("positive-image-fixture");
const limit = real ? 5 * 1024 * 1024 : 128;
const timeout = real ? 120000 : 5000;
const nodeReferences = path.join(directory, "node-references"); const apiReferences = path.join(directory, "api-references");
const nodeProfiles = path.join(directory, "node-profiles.json"); const apiProfiles = path.join(directory, "api-profiles.json");
const nodeSliding = path.join(directory, "node-sliding"); const apiSliding = path.join(directory, "api-sliding");
const app = express();
app.use(createFaceSlidingWindowRouter({ referencesRoot: nodeSliding, maxUploadBytes: limit, defaultThreshold: .8,
  pythonOptions: { pythonBin: python, scriptPath: slidingScript, timeoutMs: timeout, device: "cpu" } }));
app.use(createApp({ profileStorePath: nodeProfiles, usersFilePath: path.join(directory, "users.json"),
  faceReferenceDir: nodeReferences, faceUploadMaxBytes: limit, facePythonBin: python, facePythonScriptPath: script,
  faceDevice: "cpu", faceRequireGpu: false, facePythonTimeoutMs: timeout }));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const nodeUrl = `http://127.0.0.1:${address.port}`;
const child = spawn("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll"), "--urls", "http://127.0.0.1:0"], {
  cwd: path.join(root, "apps/securekit-api"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Testing", SECUREKIT_PROFILE_STORE: apiProfiles,
    Face__ReferenceDirectory: apiReferences, FACE_SLIDING_REFERENCES_ROOT: apiSliding, Face__TempRoot: path.join(directory, "temp"),
    FACE_PYTHON_BIN: python, FACE_PYTHON_SCRIPT_PATH: script, Face__SlidingScriptPath: slidingScript,
    FACE_UPLOAD_MAX_BYTES: String(limit), FACE_PYTHON_TIMEOUT_MS: String(timeout), FACE_DEVICE: "cpu", FACE_REQUIRE_GPU: "0" },
});
type File = { field: string; bytes?: Uint8Array; mime?: string; name?: string };
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
      [key, ["updatedAt", "enrolledAt", "faceReferenceEnrolledAt", "ts", "id", "image"].includes(key) ? "<variable>" :
        ["imagePath", "faceReferenceImagePath"].includes(key) ? "<reference>" : normalize(v)]));
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
    for (const file of files) form.append(file.field, new Blob([new Uint8Array(file.bytes ?? bytes)], { type: file.mime ?? "image/jpeg" }), file.name ?? "image.jpg");
    const response = await fetch(base + route, { method: "POST", body: form });
    return { status: response.status, json: await response.json() as any };
  };
  const compare = async (route: string, fields: [string, string][] = [["unused", "1"]], files: File[] = []) => {
    const results = await Promise.all([request(nodeUrl, route, fields, files), request(apiUrl, route, fields, files)]);
    equal(normalize(results[1]), normalize(results[0]), route + " " + JSON.stringify(fields)); count++; return results;
  };
  const probe = { field: "probeImage" }; const reference = { field: "referenceImage" };
  if (!real) {
    for (const route of ["/enroll/face/reference", "/verify/face", "/verify/face-sliding"]) {
      await compare(route);
      await compare(route, [["userId", "u"]], [{ field: route.includes("enroll") ? "referenceImage" : "probeImage", mime: "text/plain" }]);
      await compare(route, [["userId", "u"]], [{ field: route.includes("enroll") ? "referenceImage" : "probeImage", bytes: Buffer.alloc(limit + 1) }]);
      await compare(route, [["userId", "u"]], [{ field: "unexpected" }]);
    }
    await compare("/enroll/face/reference", [], [reference]);
    await compare("/enroll/face/reference", [["userId", "u"]], [{ ...reference, bytes: Buffer.alloc(0) }]);
    await compare("/verify/face", [], [{ ...probe, bytes: Buffer.alloc(0) }]);
    await compare("/verify/face", [], [probe]);
    await compare("/verify/face", [["userId", "missing"]], [probe]);
    await compare("/verify/face", [["referenceImagePath", path.join(directory, "outside.jpg")]], [probe]);
    for (const value of ["NaN", "Infinity", "-1", "1.01", "0", "1", " ", "0x1", "0b0", "0o1", ".9", ""]) await compare("/verify/face", [["threshold", value]], [probe, reference]);
    await compare("/verify/face", [["threshold", "1"], ["threshold", "0"]], [probe, reference]);
    await compare("/verify/face", [], [probe, probe]);
    await compare("/verify/face", [], [probe, reference, probe]);
    await compare("/verify/face-sliding", [["userId", "u"]], [probe, probe]);
    for (const [key, value] of [["threshold", "NaN"], ["maxWindow", "NaN"], ["updateOnSuccess", "yes"]]) await compare("/verify/face-sliding", [["userId", "u"], [key, value]], [probe]);
    await compare("/verify/face-sliding", [["userId", "u"]]);
    await compare("/verify/face", [], [probe, { ...reference, mime: "image/png", name: "reference.exe" }]);
    await compare("/verify/face", [], [{ ...probe, bytes: Buffer.from("negative-image") }, reference]);
  }
  for (let i = 0; i < 2; i++) {
    const enrolled = await compare("/enroll/face/reference", [["userId", " u " ]], [reference]); assert.equal(enrolled[1].status, 200);
    assert.equal((await readdir(apiReferences)).length, 1); assert.equal((await readdir(nodeReferences)).length, 1);
  }
  const verified = await compare("/verify/face", [["userId", "u"]], [probe]);
  assert.equal(verified[1].status, 200); assert.equal(verified[1].json.matched, true);
  const precedence = await compare("/verify/face", [["userId", "missing"], ["referenceImagePath", "outside.jpg"]], [probe, reference]); assert.equal(precedence[1].json.matched, true);
  for (const value of ["false", "true", "0", "1"]) {
    const result = await compare("/verify/face-sliding", [["userId", "u"], ["maxWindow", "1"], ["updateOnSuccess", value]], [probe]);
    assert.equal(result[1].status, 200);
    if (real && value === "false") assert.equal(result[1].json.reason, "window_empty");
    if (real && value === "true") assert.equal(result[1].json.reason, "window_empty_bootstrapped");
    if (real && value === "1") { assert.equal(result[1].json.matched, true); assert.equal(result[1].json.evicted.length, 1); }
  }
  equal(normalize(JSON.parse(await readFile(apiProfiles, "utf8"))), normalize(JSON.parse(await readFile(nodeProfiles, "utf8"))), "persisted profiles");
  assert.deepEqual(await readdir(path.join(directory, "temp")), []);
  if (real) {
    const nodeManifest = JSON.parse(await readFile(path.join(nodeSliding, "u/manifest.json"), "utf8"));
    const apiManifest = JSON.parse(await readFile(path.join(apiSliding, "u/manifest.json"), "utf8"));
    equal(normalize(apiManifest), normalize(nodeManifest), "sliding manifest");
    const nodeEmbedding = await readFile(path.join(nodeSliding, "u/embeddings", nodeManifest.entries[0].id + ".npy"));
    const apiEmbedding = await readFile(path.join(apiSliding, "u/embeddings", apiManifest.entries[0].id + ".npy"));
    assert.deepEqual(apiEmbedding, nodeEmbedding);
  }
  console.log(`${count} Stage 5 Node/ASP.NET HTTP comparisons passed (${real ? "real FaceNet" : "deterministic protocol fixture"}); persisted references/profiles and temporary cleanup verified.`);
} finally {
  closeFacePythonWorkers(); child.kill();
  await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
