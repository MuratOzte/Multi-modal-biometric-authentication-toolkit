import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server";
import { FileKeystrokeTemplateStore } from "../src/keystroke/store";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const directory = await mkdtemp(path.join(tmpdir(), "securekit-stage4-parity-"));
const nodeProfiles = path.join(directory, "node-profiles.json");
const apiProfiles = path.join(directory, "api-profiles.json");
const nodeFixed = path.join(directory, "node-fixed"); const apiFixed = path.join(directory, "api-fixed");
const python = process.env.PYTHON_BIN ?? (process.platform === "win32" ? "py -3" : "python3");
const app = createApp({ profileStorePath: nodeProfiles, usersFilePath: path.join(directory, "users.json"),
  fixedTextKeystrokeStore: new FileKeystrokeTemplateStore({ rootDir: nodeFixed }), fixedTextKeystrokePythonBin: python });
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const nodeUrl = `http://127.0.0.1:${address.port}`;
const child = spawn("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll"), "--urls", "http://127.0.0.1:0"], {
  cwd: path.join(root, "apps/securekit-api"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PYTHON_BIN: python, SECUREKIT_PROFILE_STORE: apiProfiles, SECUREKIT_KEYSTROKE_STORE: apiFixed, ASPNETCORE_ENVIRONMENT: "Testing" },
});
let count = 0;
try {
  const apiUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ASP.NET startup timed out")), 20000); let output = "";
    child.stdout.on("data", data => { output += data.toString(); const match = output.match(/Now listening on: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.stderr.on("data", data => { output += data.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`ASP.NET exited ${code}: ${output}`)); });
  });
  const request = async (base: string, route: string, body?: unknown) => {
    const response = await fetch(base + route, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() as any };
  };
  const normalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ["createdAt", "updatedAt", "grantedAt", "challengeId", "expiresAt", "timestamp", "ageMs"].includes(k) ? "<variable>" : normalize(v)]));
    return value;
  };
  // JSON numeric values have a 1e-6 absolute tolerance; all other fields and statuses must match.
  const equal = (actual: any, expected: any, label: string) => {
    if (typeof actual === "number" && typeof expected === "number") { assert(Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} != ${expected}`); return; }
    if (actual && expected && typeof actual === "object" && typeof expected === "object") {
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), label);
      for (const key of Object.keys(expected)) equal(actual[key], expected[key], label + "." + key);
    } else assert.deepEqual(actual, expected, label);
  };
  const compare = async (route: string, body?: unknown) => {
    const results = await Promise.all([request(nodeUrl, route, body), request(apiUrl, route, body)]);
    equal(normalize(results[1]), normalize(results[0]), route + " " + JSON.stringify(body)); count++; return results;
  };
  const events = Array.from({ length: 20 }, (_, i) => [
    { key: i % 7 === 0 ? " " : "a", code: i % 7 === 0 ? "Space" : "KeyA", type: "down", t: 50 + i * 150, expectedIndex: i },
    { key: i % 7 === 0 ? " " : "a", code: i % 7 === 0 ? "Space" : "KeyA", type: "up", t: 130 + i * 150, expectedIndex: i },
  ]).flat();
  for (const route of ["/enroll/keystroke", "/verify/keystroke"])
    for (const body of [{}, [], { userId: " " }, { userId: "u", events: [] }, { userId: "u", sample: {} }, { userId: "u", sample: { events: [] } }, { userId: "u", sample: [] }, { userId: "u", sample: null }, { userId: "u", sample: { events: [null, {}, { type: "invalid", t: "1", key: null, code: " ", isRepeat: 1, location: null, expectedIndex: .1 }] }, policy: 4 }, { userId: "u", sample: { events, expectedText: "abc" } }]) await compare(route, body);
  await compare("/enroll/keystroke", { userId: "u", events }); // Consent gate
  assert.equal((await compare("/consent", { userId: "u", consentVersion: "v1" }))[1].status, 200);
  for (let i = 0; i < 10; i++) await compare("/enroll/keystroke", { userId: "u", sample: { events: events.map(e => ({ ...e, t: e.t * (1 + i / 50) })), typedLength: 20, source: "collector_v1" }, errorCount: i % 3 });
  for (const sample of [{ events }, { events: events.map(e => ({ ...e, expectedIndex: undefined })) }, { events: [...events, { key: "Shift", code: "ShiftLeft", type: "down", t: 1, expectedIndex: 99 }], imeCompositionUsed: true }, { events: events.map(e => ({ ...e, t: e.t * 5 })) }])
    await compare("/enroll/keystroke", { userId: "u", sample });
  const verify = async (userId: string, scale: number, policy: object = {}, wrongText = false, wrongSession = false) => {
    const challenge = await compare("/challenge/text", { text: "a simple text", sessionId: "session" });
    const results = await Promise.all([nodeUrl, apiUrl].map((url, i) => request(url, "/verify/keystroke", { userId, sessionId: wrongSession ? "other" : "session", challengeId: challenge[i].json.challengeId, sample: { events: events.map(e => ({ ...e, t: e.t * scale })), expectedText: wrongText ? "wrong" : "a simple text" }, policy })));
    equal(normalize(results[1]), normalize(results[0]), "dynamic verify"); count++;
    const used = await Promise.all([nodeUrl, apiUrl].map((url, i) => request(url, "/verify/keystroke", { userId, challengeId: challenge[i].json.challengeId, sample: { events, expectedText: "a simple text" } })));
    equal(normalize(used[1]), normalize(used[0]), "consumed challenge"); assert.equal(used[1].status, 409); count++;
    return results[1];
  };
  await verify("missing", 1); await verify("u", 1, {}, true); await verify("u", 1, {}, false, true);
  await verify("u", 1); await verify("u", 1, { updateProfileOnAllow: false }); await verify("u", 5);
  await compare("/verify/keystroke", { userId: "u", challengeId: "missing", sample: { events, expectedText: "x" } });
  equal(normalize(JSON.parse(await readFile(apiProfiles, "utf8"))), normalize(JSON.parse(await readFile(nodeProfiles, "utf8"))), "dynamic persisted profiles");
  const fixtures = JSON.parse(await readFile(path.join(root, "apps/securekit-api.tests/Fixtures/keystroke-stage4.json"), "utf8"));
  for (const [index, fixture] of fixtures.entries()) {
    const userId = `fixture-${index}`;
    await compare("/consent", { userId, consentVersion: "v1" });
    const enrolled = await compare("/enroll/keystroke", { userId, sample: fixture.sample });
    equal(enrolled[1].json.sampleMetrics, fixture.metrics, fixture.name);
    // Exercise both weighted merging and top-level overrides on the same fixture.
    await compare("/enroll/keystroke", { userId, sample: fixture.sample, typedLength: 30, errorCount: 1 });
  }
  const text = "alpha beta gamma"; const textId = "text/ş?1";
  const sample = () => ({ textId, text, holdMs: Array(16).fill(90), ddMs: Array(15).fill(180), udMs: Array(15).fill(90), meta: { timestamp: Date.now(), durationMs: 3000 } });
  const status = `/api/securekit/keystroke/status?userId=u&textId=${encodeURIComponent(textId)}`;
  await compare("/api/securekit/keystroke/status"); await compare(status);
  for (const route of ["/api/securekit/keystroke/enroll", "/api/securekit/keystroke/verify"])
    for (const body of [{}, [], { userId: "u", textId, samples: [{}], sample: {} }, { userId: "u", textId, expectedText: text, samples: [null], sample: null }, { userId: "u", textId, expectedText: text, samples: [{ ...sample(), corrections: { events: [{ type: "what", t: -1, index: .5 }], mismatchCount: -1, extraCount: "1", backspaceCount: 0 } }], sample: sample(), opts: { autoEnroll: "true" } }]) await compare(route, body);
  await compare("/api/securekit/keystroke/verify", { userId: "u", textId, sample: sample() });
  for (const patch of [{ textId: "other" }, { text: "different text here" }, { holdMs: [1] }, { ddMs: [1] }, { holdMs: Array(16).fill(-1) }, { ddMs: Array(15).fill(-1) }, { meta: { timestamp: Date.now(), durationMs: 799 } }, { meta: { timestamp: Date.now() - 140000, durationMs: 3000 } }, { meta: { timestamp: Date.now() + 30000, durationMs: 3000 } }, { meta: { timestamp: Date.now(), durationMs: 3000, invalid: true } }])
    await compare("/api/securekit/keystroke/enroll", { userId: "u", textId, expectedText: text, samples: [{ ...sample(), ...patch }] });
  await compare("/api/securekit/keystroke/enroll", { userId: "u", textId, expectedText: text, samples: Array.from({ length: 10 }, sample) });
  await compare(status);
  await compare("/api/securekit/keystroke/verify", { userId: "u", textId, expectedText: "wrong", sample: sample() });
  for (const autoEnroll of [false, true]) await compare("/api/securekit/keystroke/verify", { userId: "u", textId, expectedText: text, sample: sample(), opts: { autoEnroll } });
  await compare("/api/securekit/keystroke/verify", { userId: "u", textId, sample: { ...sample(), udMs: Array(15).fill(-10) } });
  await compare("/api/securekit/keystroke/verify", { userId: "u", textId, sample: { ...sample(), holdMs: Array(16).fill(900) } });
  await compare(status);
  const hashDirs = await readdir(nodeFixed);
  for (const hash of hashDirs) for (const file of await readdir(path.join(nodeFixed, hash)))
    equal(normalize(JSON.parse(await readFile(path.join(apiFixed, hash, file), "utf8"))), normalize(JSON.parse(await readFile(path.join(nodeFixed, hash, file), "utf8"))), "fixed persisted " + file);
  console.log(`${count} Stage 4 Node/ASP.NET HTTP comparisons passed; dynamic profiles and Python templates match (numeric tolerance 1e-6).`);
} finally {
  child.kill(); await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
