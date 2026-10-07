import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server";
import { closeCardPythonWorkers } from "../src/card/pythonBridge";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const directory = await mkdtemp(path.join(tmpdir(), "securekit-stage7-parity-"));
const references = path.join(directory, "references"); await mkdir(references);
for (const name of ["a-card.jpg", "B_card.PNG", "Türkçe kart.webp", "ignored.txt"]) await writeFile(path.join(references, name), "reference");
await mkdir(path.join(references, "directory.jpg"));
const python = process.env.CARD_PYTHON_BIN ?? (process.platform === "win32" ? "py -3" : "python3");
const script = path.join(root, "packages/node-auth/scripts/fixtures/card-stage7.py");
const nodeProfiles = path.join(directory, "node.json"); const apiProfiles = path.join(directory, "api.json");
const initial = { records: { u: { consentLogs: [], profiles: { userId: "u", keystroke: null,
  faceReferenceImagePath: "face.jpg", faceReferenceEnrolledAt: null, faceEmbedding: [1, 0],
  voice: null, voiceEmbedding: [0, 1], updatedAt: "2026-10-07T00:00:00.000Z" } } } };
await writeFile(nodeProfiles, JSON.stringify(initial)); await writeFile(apiProfiles, JSON.stringify(initial));
const server = createApp({ profileStorePath: nodeProfiles, usersFilePath: path.join(directory, "users.json"),
  cardReferenceDir: references, cardUserReferenceDir: path.join(directory, "node-users"), cardUploadMaxBytes: 128,
  cardPythonBin: python, cardPythonScriptPath: script, cardPythonTimeoutMs: 5000 }).listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const nodeUrl = `http://127.0.0.1:${address.port}`;
const child = spawn("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll"), "--urls", "http://127.0.0.1:0"], {
  cwd: path.join(root, "apps/securekit-api"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Testing", SECUREKIT_PROFILE_STORE: apiProfiles,
    Card__ReferenceDirectory: references, Card__UserReferenceDirectory: path.join(directory, "api-users"),
    Card__TempRoot: path.join(directory, "temp"), CARD_PYTHON_BIN: python, CARD_PYTHON_SCRIPT_PATH: script,
    CARD_UPLOAD_MAX_BYTES: "128", CARD_PYTHON_TIMEOUT_MS: "5000", CARD_MATCH_THRESHOLD: "0.7" },
});
type File = { field?: string; text?: string; mime?: string };
let count = 0;
const variablePaths = new Map<string, string>();
try {
  const apiUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ASP.NET startup timed out")), 20000); let output = "";
    child.stdout.on("data", data => { output += data.toString(); const match = output.match(/Now listening on: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.stderr.on("data", data => { output += data.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`ASP.NET exited ${code}: ${output}`)); });
  });
  const normalize = (value: any, key = ""): any => {
    if (Array.isArray(value)) return value.map(v => normalize(v));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
    if (["updatedAt", "enrolledAt", "cardReferenceEnrolledAt"].includes(key)) return "<time>";
    if (typeof value === "string") {
      // Map each persisted random filename consistently; preserve static ids and paths.
      for (const [name, replacement] of variablePaths) value = value.split(name).join(replacement);
      value = value.replace(/[^\s"']*securekit-card-[^/\\\s"']+[\\/]/g, "<temp>/").replaceAll("\\", "/");
      if (["label", "referenceFileName"].includes(key) && value.startsWith("u ")) return "<user-reference>";
    }
    return value;
  };
  const request = async (base: string, route: string, fields: [string, string][], files: File[]) => {
    const form = new FormData(); for (const [key, value] of fields) form.append(key, value);
    for (const file of files) form.append(file.field ?? "probeImage", new Blob([file.text ?? "same"], { type: file.mime ?? "image/jpeg" }), "sample.exe");
    const response = await fetch(base + route, { method: "POST", body: form }); return { status: response.status, json: await response.json() as any };
  };
  const compare = async (route: string, fields: [string, string][] = [], files: File[] = []) => {
    const results = await Promise.all([nodeUrl, apiUrl].map(base => request(base, route, fields, files)));
    if (route === "/enroll/card/reference" && results[0].status === 200) for (const result of results) {
      const name = path.basename(result.json.reference.imagePath); variablePaths.set(name, "<user-reference>");
      variablePaths.set(path.dirname(result.json.reference.imagePath), "<user-directory>");
    }
    assert.deepEqual(normalize(results[1]), normalize(results[0]), route + " " + JSON.stringify(fields)); count++; return results;
  };
  const lists = await Promise.all([nodeUrl, apiUrl].map(async base => { const response = await fetch(base + "/card/references"); return { status: response.status, json: await response.json() }; }));
  assert.deepEqual(lists[1], lists[0]); count++;
  for (const route of ["/enroll/card/reference", "/verify/card"]) {
    const field = route.startsWith("/enroll") ? "referenceImage" : "probeImage";
    await compare(route); await compare(route, [["userId", "u"]]);
    await compare(route, [], [{ field, mime: "text/plain" }]);
    await compare(route, [], [{ field: "unexpected" }]);
    await compare(route, [], [{ field }, { field }]);
    await compare(route, [["userId", "u"]], [{ field, text: "" }]);
    await compare(route, [], [{ field, text: "x".repeat(129) }]);
    await compare(route, [["userId", "u"], ["userId", "v"]], [{ field }]);
  }
  for (const value of ["NaN", "Infinity", "-1", "2", "0", "1", "", " ", "0x1", "0b0", "0o1", ".8"])
    await compare("/verify/card", [["threshold", value]], [{}]);
  for (const key of ["threshold", "referenceId", "userId"])
    await compare("/verify/card", [[key, "u"], [key, "v"]], [{}]);
  for (const id of ["missing", "../a-card.jpg", "B_card.PNG", " Türkçe kart.webp ", ""])
    await compare("/verify/card", [["referenceId", id]], [{}]);
  for (const mode of ["same", "different", "uncertain", "empty", "schema", "exit", "failure", "dependency"])
    await compare("/verify/card", [], [{ text: mode }]);
  for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
    const results = await compare("/enroll/card/reference", [["userId", " U "]], [{ field: "referenceImage", mime }]);
    for (const [i, result] of results.entries()) {
      assert.equal(path.extname(result.json.reference.imagePath), { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[mime]);
      assert.deepEqual(await readdir(path.join(directory, i === 0 ? "node-users" : "api-users")), [path.basename(result.json.reference.imagePath)]);
      assert.equal(await readFile(result.json.reference.imagePath, "utf8"), "same");
    }
    await compare("/verify/card", [["userId", " U "], ["referenceId", "ignored"]], [{}]);
  }
  await compare("/verify/card", [["userId", "missing"]], [{}]);
  // JSON invalid field types have the same validation precedence before missing files.
  for (const route of ["/verify/card", "/enroll/card/reference"]) for (const body of [{ userId: 1 }, { referenceId: [] }, { threshold: true }, {}]) {
    const results = await Promise.all([nodeUrl, apiUrl].map(async base => { const response = await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, json: await response.json() }; }));
    assert.deepEqual(results[1], results[0]); count++;
  }
  assert.deepEqual(normalize(JSON.parse(await readFile(apiProfiles, "utf8"))), normalize(JSON.parse(await readFile(nodeProfiles, "utf8"))), "persisted profiles");
  assert.deepEqual(await readdir(path.join(directory, "temp")), []);
  console.log(`${count} Stage 7 Node/ASP.NET HTTP comparisons passed; profiles, reference replacement and temporary cleanup verified (deterministic card worker).`);
} finally {
  closeCardPythonWorkers(); child.kill();
  await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
