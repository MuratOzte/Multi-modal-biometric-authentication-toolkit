import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createChallengeRouter } from "../src/routes/challenge";
import { createConsentRouter } from "../src/routes/consent";
import { createProfilesRouter } from "../src/routes/profiles";
import { FileStorageAdapter } from "../src/storage/fileAdapter";
import { InMemoryChallengeStore } from "../src/challenge/inMemoryStore";

// Run after dotnet build apps/securekit-api. Both hosts use isolated temporary data.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const directory = await mkdtemp(path.join(tmpdir(), "securekit-parity-"));
const nodeFile = path.join(directory, "node.json");
const apiFile = path.join(directory, "api.json");
const storage = new FileStorageAdapter({ filePath: nodeFile });
const app = express();
app.use(express.json());
app.use(createChallengeRouter({ challengeStore: new InMemoryChallengeStore(), ttlMs: 1000 }));
app.use(createConsentRouter({ storage }));
app.use(createProfilesRouter({ storage }));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const nodeUrl = `http://127.0.0.1:${address.port}`;
const child = spawn("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll"), "--urls", "http://127.0.0.1:0"], {
  cwd: path.join(root, "apps/securekit-api"),
  env: { ...process.env, SECUREKIT_PROFILE_STORE: apiFile, CHALLENGE_TTL_SECONDS: "1", ASPNETCORE_ENVIRONMENT: "Testing" },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let count = 0;
try {
  const apiUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ASP.NET startup timed out")), 20000);
    let output = "";
    child.stdout.on("data", data => {
      output += data.toString();
      const match = output.match(/Now listening on: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
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
      [key, ["challengeId", "expiresAt", "grantedAt", "updatedAt"].includes(key) ? "<variable>" : normalize(item)]));
    return value;
  };
  const compare = async (method: string, route: string, body?: unknown) => {
    const [expected, actual] = await Promise.all([request(nodeUrl, method, route, body), request(apiUrl, method, route, body)]);
    assert.deepEqual(normalize(actual), normalize(expected), `${method} ${route} ${JSON.stringify(body)}`);
    count++;
    return [expected, actual];
  };
  for (const body of [{ lang: "de" }, { length: null }, { wordCount: 0.49 }, { wordCount: 64.5 }, { wordCount: "4" }, { text: " " }, { sessionId: 2 }])
    await compare("POST", "/challenge/text", body);
  for (const body of [{}, { challengeId: 1 }, { challengeId: "missing" }]) await compare("POST", "/challenge/text/consume", body);
  const challenges = await compare("POST", "/challenge/text", { text: "  hello world  ", lang: "en", sessionId: " s1 " });
  for (let i = 0; i < 2; i++) {
    const results = await Promise.all([nodeUrl, apiUrl].map((url, index) => request(url, "POST", "/challenge/text/consume", { challengeId: challenges[index].json.challengeId })));
    assert.deepEqual(normalize(results[1]), normalize(results[0])); count++;
  }
  const expired = await compare("POST", "/challenge/text", { text: "expire" });
  await new Promise(resolve => setTimeout(resolve, 1100));
  for (let i = 0; i < 2; i++) {
    const results = await Promise.all([nodeUrl, apiUrl].map((url, index) => request(url, "POST", "/challenge/text/consume", { challengeId: expired[index].json.challengeId })));
    assert.deepEqual(normalize(results[1]), normalize(results[0])); count++;
  }
  await compare("GET", "/user/missing/profiles");
  await compare("GET", "/user/%20/profiles");
  for (const body of [{}, [], { userId: 4, consentVersion: "v1" }]) await compare("POST", "/consent", body);
  await compare("POST", "/consent", { userId: " u1 ", consentVersion: " v1 " });
  const profile = { userId: "u1", keystroke: { sampleCount: 3 }, faceEmbedding: [0.1, 0.2], updatedAt: "2026-10-07T00:00:00.000Z" };
  for (const file of [nodeFile, apiFile]) {
    const payload = JSON.parse(await readFile(file, "utf8"));
    payload.records.u1.profiles = profile;
    await writeFile(file, JSON.stringify(payload));
  }
  await compare("GET", "/user/u1/profiles");
  await compare("DELETE", "/user/biometrics", { userId: "u1" });
  await compare("GET", "/user/u1/profiles");
  await compare("DELETE", "/user/biometrics?deleteConsent=false&deleteConsent=TRUE", { userId: "u1" });
  await compare("DELETE", "/user/biometrics", {});
  assert.deepEqual(JSON.parse(await readFile(apiFile, "utf8")), JSON.parse(await readFile(nodeFile, "utf8")));
  console.log(`${count} Node/ASP.NET HTTP comparisons passed; persisted deletion results match.`);
} finally {
  child.kill();
  await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
