import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { SecureKitClient } from "../../../packages/web-sdk/src/client";
import { HttpError } from "../../../packages/web-sdk/src/transport";
import { resolveApiTarget } from "../api-target";

assert.equal(resolveApiTarget({}), "http://localhost:3002");
assert.equal(resolveApiTarget({ VITE_SECUREKIT_API_BACKEND: " node " }), "http://localhost:3001");
assert.equal(resolveApiTarget({ VITE_SECUREKIT_API_BACKEND: "invalid", VITE_SECUREKIT_DEV_PROXY_TARGET: " http://localhost:4000 " }), "http://localhost:4000");
assert.throws(() => resolveApiTarget({ VITE_SECUREKIT_API_BACKEND: "invalid" }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const directory = await mkdtemp(path.join(tmpdir(), "securekit-stage8-demo-"));
const python = process.platform === "win32" ? "py -3" : "python3";
const fixture = (name: string) => path.join(root, `packages/node-auth/scripts/fixtures/${name}`);
await mkdir(path.join(directory, "cards"));
const child = spawn("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll"), "--urls", "http://127.0.0.1:0"], {
  cwd: path.join(root, "apps/securekit-api"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Testing", MOCK_IP_CHECK: "1",
    SECUREKIT_USERS_FILE: path.join(directory, "users.json"), SECUREKIT_PROFILE_STORE: path.join(directory, "profiles.json"),
    SECUREKIT_KEYSTROKE_STORE: path.join(directory, "keystroke"),
    FACE_PYTHON_BIN: python, FACE_PYTHON_SCRIPT_PATH: fixture("face-stage5.py"), Face__SlidingScriptPath: fixture("face-stage5.py"),
    Face__ReferenceDirectory: path.join(directory, "face"), Face__TempRoot: path.join(directory, "face-temp"),
    FACE_SLIDING_REFERENCES_ROOT: path.join(directory, "sliding"),
    VOICE_PYTHON_BIN: python, VOICE_PYTHON_SCRIPT_PATH: fixture("voice-stage6.py"), Voice__TempRoot: path.join(directory, "voice-temp"),
    CARD_PYTHON_BIN: python, CARD_PYTHON_SCRIPT_PATH: fixture("card-stage7.py"), Card__ReferenceDirectory: path.join(directory, "cards"),
    Card__UserReferenceDirectory: path.join(directory, "card-users"), Card__TempRoot: path.join(directory, "card-temp"),
  },
});
let vite: ViteDevServer | undefined;
const oldTarget = process.env.VITE_SECUREKIT_DEV_PROXY_TARGET;
try {
  const apiUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ASP.NET startup timed out")), 20000);
    let output = "";
    child.stdout.on("data", data => { output += data; const match = output.match(/Now listening on: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.stderr.on("data", data => { output += data; });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`ASP.NET exited ${code}: ${output}`)); });
  });
  process.env.VITE_SECUREKIT_DEV_PROXY_TARGET = apiUrl;
  vite = await createServer({ root: path.join(root, "apps/demo-web"), configFile: path.join(root, "apps/demo-web/vite.config.ts"),
    server: { host: "127.0.0.1", port: 0, open: false } });
  await vite.listen();
  const address = vite.httpServer!.address(); assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  for (const page of ["/", "/auth.html"]) assert.equal((await fetch(base + page)).status, 200);
  const sdk = new SecureKitClient({ baseUrl: base + "/api/securekit" });
  const userId = "stage8-demo";
  assert.equal((await sdk.health()).ok, true);
  assert.equal((await sdk.register({ userId, password: "fixture-password" })).created, true);
  await sdk.grantConsent({ userId, consentVersion: "v1" });
  await assert.rejects(sdk.login({ userId, password: "wrong" }), (error: unknown) => error instanceof HttpError && error.status === 401);
  assert.equal((await sdk.login({ userId, password: "fixture-password" })).userId, userId);
  assert((await sdk.listUsers()).users.some(user => user.userId === userId));
  const { sessionId } = await sdk.startSession();
  const network = await sdk.verifyNetwork({ clientOffsetMin: -180 });
  const location = await sdk.verifyLocation({ allowedCountries: ["TR"] });
  const events = Array.from({ length: 20 }, (_, i) => [
    { key: "a", code: "KeyA", type: "down" as const, t: i * 150, expectedIndex: i },
    { key: "a", code: "KeyA", type: "up" as const, t: i * 150 + 80, expectedIndex: i },
  ]).flat();
  const sample = { events, typedLength: 20 };
  for (let i = 0; i < 10; i++) await sdk.enrollKeystroke({ userId, sample });
  const challenge = await sdk.getTextChallenge({ text: "a simple text", sessionId });
  assert.equal((await sdk.verifyKeystroke({ userId, sessionId, challengeId: challenge.challengeId,
    sample: { ...sample, expectedText: challenge.text } })).decision, "allow");
  await assert.rejects(sdk.verifyKeystroke({ userId, sessionId, challengeId: challenge.challengeId,
    sample: { ...sample, expectedText: challenge.text } }), (error: unknown) => error instanceof HttpError && error.status === 409);
  assert.equal((await sdk.verifySession({ userId, sessionId, signals: { network, location, keystroke: sample },
    policy: { allowedCountries: ["TR"], keystroke: { enabled: true } } })).decision, "allow");
  const image = new Blob(["same"], { type: "image/jpeg" });
  await sdk.enrollFaceReference({ userId, referenceImage: image });
  assert.equal((await sdk.verifyFace({ userId, probeImage: image })).matched, true);
  assert.equal((await sdk.verifyFaceSlidingWindow({ userId, probeImage: image })).ok, true);
  for (let i = 0; i < 3; i++) {
    const voiceChallenge = await sdk.getTextChallenge({ text: "a simple text", sessionId });
    await sdk.enrollVoice({ userId, sessionId, challengeId: voiceChallenge.challengeId, audioSample: new Blob(["allow"], { type: "audio/webm" }) });
  }
  const voiceChallenge = await sdk.getTextChallenge({ text: "a simple text", sessionId });
  assert.equal((await sdk.verifyVoice({ userId, sessionId, challengeId: voiceChallenge.challengeId,
    audioSample: new Blob(["allow"], { type: "audio/webm" }) })).decision, "allow");
  await sdk.listCardReferences();
  await sdk.enrollCardReference({ userId, referenceImage: image });
  assert.equal((await sdk.verifyCard({ userId, probeImage: image })).matched, true);
  // Fixed-text endpoints retain their prefix; other endpoints strip it in Vite.
  const fixed = await fetch(base + `/api/securekit/keystroke/status?userId=${userId}&textId=test`);
  assert.equal(fixed.status, 200);
  assert.equal((await sdk.getProfiles(userId)).ok, true);
  await sdk.deleteBiometrics(userId);
  for (const folder of ["face-temp", "voice-temp", "card-temp"]) assert.deepEqual(await readdir(path.join(directory, folder)), []);
  console.log("Stage 8 demo proxy/SDK smoke passed: pages, health, register/login/consent, session, network/location, keystroke/replay, face/sliding, voice, card, fixed-text prefix and profile deletion (model-free fixtures).");
} finally {
  if (oldTarget === undefined) delete process.env.VITE_SECUREKIT_DEV_PROXY_TARGET;
  else process.env.VITE_SECUREKIT_DEV_PROXY_TARGET = oldTarget;
  await vite?.close();
  child.kill();
  await new Promise<void>(resolve => child.exitCode !== null ? resolve() : child.once("exit", () => resolve()));
  await rm(directory, { recursive: true, force: true });
}
