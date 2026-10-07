import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createLegacyVerificationRouter } from "../src/routes/legacyVerification";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
process.env.MOCK_IP_CHECK = "1";
const app = express();
app.use(express.json());
app.use(createLegacyVerificationRouter({}));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const nodeUrl = `http://127.0.0.1:${address.port}`;
const child = spawn("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll"), "--urls", "http://127.0.0.1:0"], {
  cwd: path.join(root, "apps/securekit-api"),
  env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Testing" },
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
    child.stderr.on("data", data => { output += data.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`ASP.NET exited ${code}: ${output}`)); });
  });
  const request = async (base: string, route: string, body: unknown, ip: string) => {
    const response = await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  const compare = async (route: string, body: unknown, ip = "1.2.3.4, 5.6.7.8") => {
    const [expected, actual] = await Promise.all([request(nodeUrl, route, body, ip), request(apiUrl, route, body, ip)]);
    assert.deepEqual(actual, expected, `${route} ${JSON.stringify(body)} ip=${ip}`);
    count++;
  };
  for (const scenario of ["clean", "risky", "ignored"]) {
    for (const offset of [null, 180, 240, 241, 360, 361, 540, 541, -200])
      await compare("/verify/network", { scenario, clientOffsetMin: offset });
    for (const allowedCountries of [undefined, [], [" tr ", "TR", 4, null], ["US"], "TR"])
      await compare("/verify/location", { scenario, allowedCountries });
    for (const expectedCountryCode of [null, " tr ", "RU", "US", 4])
      for (const clientCountryCode of [null, "TR", "RU"])
        await compare("/verify/location:country", { scenario, expectedCountryCode, clientCountryCode });
  }
  for (const key of ["clientOffsetMin", "clientTimeOffsetMinutes", "clientTimezoneOffset", "tzOffset", "clientOffset"])
    for (const value of [180, 400, "180", null])
      await compare("/verify/vpn:check", { [key]: value, clientTimezone: "Europe/Istanbul", scenario: "risky" });
  for (const body of [{}, [], { proof: true }, { proof: false }, { proof: {} }, { proof: [] }, { proof: 0 }, { proof: "false" }])
    await compare("/verify/webauthn:passkey", body);
  for (const proof of [undefined, {}, { tasksOk: true }, { tasksOk: 1 }])
    for (const metrics of [undefined, { quality: .8 }, { quality: .81 }, { quality: .9, illuminationOk: false }, { quality: .9, illuminationOk: true }, { quality: "1", illuminationOk: "false" }])
      await compare("/verify/face:liveness", { proof, metrics });
  for (const route of ["/verify/network", "/verify/location", "/verify/vpn:check", "/verify/location:country"])
    for (const ip of [" ", "::1", "127.0.0.1", "::ffff:127.0.0.1"])
      await compare(route, {}, ip);
  console.log(`${count} Node/ASP.NET stage 3 HTTP comparisons passed.`);
} finally {
  child.kill();
  await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once("exit", () => resolve()); });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
