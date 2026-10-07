import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createAuthRouter } from "../src/routes/auth";
import { createSessionRouter } from "../src/routes/session";
import { FileUserStore } from "../src/auth/userStore";
import { FileStorageAdapter } from "../src/storage/fileAdapter";
import { InMemorySessionStore } from "../src/session/inMemoryStore";
import { buildKeystrokeProfile } from "../../core/src/biometrics/keystrokeProfile";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const directory = await mkdtemp(path.join(tmpdir(), "securekit-stage2-parity-"));
const nodeProfiles = path.join(directory, "node-profiles.json");
const apiProfiles = path.join(directory, "api-profiles.json");
const nodeUsers = path.join(directory, "node-users.json");
const apiUsers = path.join(directory, "api-users.json");
const fixedNow = "2026-10-07T09:00:00.000Z";
const storage = new FileStorageAdapter({ filePath: nodeProfiles });
const app = express();
app.use(express.json());
app.use(createAuthRouter({ userStore: new FileUserStore({ filePath: nodeUsers }) }));
app.use(createSessionRouter({ sessionStore: new InMemorySessionStore({ ttlMs: 3000 }), storage }));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const nodeUrl = `http://127.0.0.1:${address.port}`;
const child = spawn("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll"), "--urls", "http://127.0.0.1:0"], {
  cwd: path.join(root, "apps/securekit-api"), windowsHide: true,
  env: { ...process.env, SECUREKIT_PROFILE_STORE: apiProfiles, SECUREKIT_USERS_FILE: apiUsers, SESSION_TTL_SECONDS: "3", ASPNETCORE_ENVIRONMENT: "Testing" },
  stdio: ["ignore", "pipe", "pipe"],
});
let count = 0;
try {
  const apiUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ASP.NET startup timed out")), 20000); let output = "";
    child.stdout.on("data", data => { output += data.toString(); const match = output.match(/Now listening on: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`ASP.NET exited ${code}: ${output}`)); });
  });
  const request = async (base: string, method: string, route: string, body?: unknown) => {
    const response = await fetch(base + route, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, json: await response.json() as any };
  };
  const normalize = (value: any): any => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, ["sessionId", "expiresAt", "createdAt", "updatedAt"].includes(key) ? "<variable>" : normalize(item)]));
    return value;
  };
  const compare = async (method: string, route: string, body?: unknown) => {
    const results = await Promise.all([request(nodeUrl, method, route, body), request(apiUrl, method, route, body)]);
    assert.deepEqual(normalize(results[1]), normalize(results[0]), `${method} ${route} ${JSON.stringify(body)}`); count++; return results;
  };
  const start = async () => {
    const results = await compare("POST", "/session/start", {});
    return results.map(r => r.json.sessionId as string);
  };
  const verify = async (ids: string[], body: object, label: string) => {
    const results = await Promise.all([nodeUrl, apiUrl].map((url, index) => request(url, "POST", "/verify/session", { ...body, sessionId: ids[index] })));
    assert.deepEqual(normalize(results[1]), normalize(results[0]), label); count++; return results[1];
  };
  await compare("GET", "/auth/users");
  for (const route of ["/auth/register", "/auth/login"])
    for (const body of [{}, [], { userId: " ", password: 4 }, { userId: "u1" }]) await compare("POST", route, body);
  for (const body of [{ userId: " UserA ", password: " pass " }, { userId: "usera", password: " pass " }, { userId: "USERA", password: "other" }, { userId: "b", password: " " }]) await compare("POST", "/auth/register", body);
  for (const body of [{ userId: "USERA", password: " pass " }, { userId: "usera", password: "pass" }, { userId: "missing", password: "p" }]) await compare("POST", "/auth/login", body);
  await compare("GET", "/auth/users");
  for (const body of [{}, { sessionId: " " }, { sessionId: "missing" }, { sessionId: 1 }]) await compare("POST", "/verify/session", body);
  const fixtures = JSON.parse((await readFile(path.join(root, "apps/securekit-api.tests/Fixtures/session-risk.json"), "utf8")).replace(/^\uFEFF/, ""));
  for (const fixture of fixtures) {
    const result = await verify(await start(), { signals: fixture.signals, policy: fixture.policy }, fixture.name);
    assert.equal(result.json.riskScore, fixture.riskScore); assert.equal(result.json.decision, fixture.decision);
  }
  const persistent = await start();
  await verify(persistent, { signals: { network: { score: 95, flags: {}, reasons: [] } } }, "persist network");
  await verify(persistent, { signals: { location: { countryCode: "TR", allowed: true, reasons: [] } }, policy: { allowedCountries: ["TR"] } }, "merge location");
  await verify(persistent, {}, "retain all signals");
  const emptySample = { events: [] };
  await verify(await start(), { signals: { keystroke: emptySample }, policy: { keystroke: { enabled: true } } }, "keystroke no user");
  await verify(await start(), { userId: "u1", signals: { keystroke: emptySample }, policy: { keystroke: { enabled: true } } }, "keystroke no profile");
  const baseline = { events: [
    { code: "KeyA", type: "down" as const, t: 0, expectedIndex: 0 }, { code: "KeyA", type: "up" as const, t: 95, expectedIndex: 0 },
    { code: "KeyB", type: "down" as const, t: 140, expectedIndex: 1 }, { code: "KeyB", type: "up" as const, t: 225, expectedIndex: 1 },
    { code: "KeyC", type: "down" as const, t: 270, expectedIndex: 2 }, { code: "KeyC", type: "up" as const, t: 360, expectedIndex: 2 }
  ], expectedText: "abc", typedLength: 3, errorCount: 0, backspaceCount: 0 };
  const profile = buildKeystrokeProfile({ userId: "u1", sample: baseline, nowIso: fixedNow }).profile;
  const seed = async () => { const payload = { records: { u1: { profiles: { userId: "u1", keystroke: profile, faceEmbedding: [0.1, 0.2], updatedAt: fixedNow }, consentLogs: [] } } }; for (const file of [nodeProfiles, apiProfiles]) await writeFile(file, JSON.stringify(payload)); };
  const policy = { enabled: true, minEnrollmentRounds: 1, minEnrollmentKeystrokes: 3, minDigraphCount: 1, allowThreshold: .5, stepUpThreshold: .3, denyThreshold: .2 };
  await seed();
  const keyAllow = await verify(await start(), { userId: "u1", signals: { keystroke: baseline }, policy: { keystroke: policy } }, "keystroke allow and EMA");
  assert.equal(keyAllow.json.decision, "allow");
  assert.equal(keyAllow.json.signalsUsed.keystroke.decision, "allow");
  assert.deepEqual(normalize(JSON.parse(await readFile(apiProfiles, "utf8"))), normalize(JSON.parse(await readFile(nodeProfiles, "utf8"))), "EMA persisted profiles");
  await seed();
  assert.equal((await verify(await start(), { userId: "u1", signals: { keystroke: { ...baseline, events: baseline.events.map(e => ({ ...e, t: e.t * 10 })) } }, policy: { keystroke: policy } }, "keystroke deny")).json.decision, "deny");
  await seed();
  assert.equal((await verify(await start(), { userId: "u1", signals: { keystroke: baseline }, policy: { keystroke: { enabled: true } } }, "keystroke readiness step-up")).json.decision, "step-up");
  // Longer and unusual samples exercise filtering, pairing, trimming, word pauses and corrections.
  for (let seedIndex = 0; seedIndex < 12; seedIndex++) {
    const events = Array.from({ length: 25 }, (_, i) => {
      const key = i % 7 === 0 ? " " : i % 9 === 0 ? "Backspace" : "a";
      const t = i * (100 + seedIndex * 13); const hold = i === 24 ? 900 : 30 + ((i * 17 + seedIndex) % 110);
      return [{ key, code: key === " " ? "Space" : key === "Backspace" ? "Backspace" : "KeyA", type: "down", t, expectedIndex: i }, { key, code: key === " " ? "Space" : key === "Backspace" ? "Backspace" : "KeyA", type: "up", t: t + hold, expectedIndex: i }];
    }).flat();
    events.push({ key: "Shift", code: "ShiftLeft", type: "down", t: 1, expectedIndex: 26 });
    await verify(await start(), { userId: "missing", signals: { keystroke: { events: events.reverse(), typedLength: 20, errorCount: 2, backspaceCount: 3, imeCompositionUsed: seedIndex % 2 === 0 } }, policy: { keystroke: { enabled: true } } }, `metric fixture ${seedIndex}`);
  }
  const expired = await start(); await new Promise(resolve => setTimeout(resolve, 3100));
  assert.equal((await verify(expired, {}, "expired session")).status, 410);
  assert.equal((await verify(expired, {}, "expired then missing")).status, 404);
  const seeded = { users: [{ id: " Bob ", password: "x" }, { id: "bob", password: "y" }, { id: 4, password: "z" }] };
  for (const file of [nodeUsers, apiUsers]) await writeFile(file, JSON.stringify(seeded));
  await compare("GET", "/auth/users"); await compare("POST", "/auth/login", { userId: "BOB", password: "x" });
  console.log(`${count} Stage 2 Node/ASP.NET HTTP comparisons passed; keystroke EMA profiles match.`);
} finally {
  child.kill(); await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
