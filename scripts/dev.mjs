import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = process.argv[2] || process.env.VITE_SECUREKIT_API_BACKEND?.trim().toLowerCase() || "aspnet";
if (!["aspnet", "node"].includes(backend)) throw new Error("API backend must be aspnet or node.");
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}
function launch(command, args, cwd, env = process.env) {
  const child = spawn(command, args, { cwd, env, stdio: "inherit", windowsHide: true });
  children.push(child);
  child.once("error", error => { console.error(error.message); stop(1); });
  child.once("exit", code => { if (!stopping) stop(code ?? 1); });
}
console.log(`SecureKit demo backend: ${backend}.`);
if (backend === "aspnet") {
  // Start the API executable directly so stopping the launcher also stops the API on Windows.
  await new Promise((resolve, reject) => {
    const build = spawn("dotnet", ["build", "apps/securekit-api"], { cwd: root, stdio: "inherit", windowsHide: true });
    build.once("error", reject);
    build.once("exit", code => code === 0 ? resolve() : reject(new Error(`API build failed (${code}).`)));
  });
  launch("dotnet", [path.join(root, "apps/securekit-api/bin/Debug/net10.0/SecureKit.Api.dll")], path.join(root, "apps/securekit-api"),
    { ...process.env, ASPNETCORE_URLS: process.env.ASPNETCORE_URLS || "http://localhost:3002",
      ASPNETCORE_ENVIRONMENT: process.env.ASPNETCORE_ENVIRONMENT || "Development" });
}
else launch(process.execPath, ["--import", "tsx", "--watch", "src/server.ts"], path.join(root, "packages/node-auth"));
launch(process.execPath, [path.join(root, "apps/demo-web/node_modules/vite/bin/vite.js")], path.join(root, "apps/demo-web"),
  { ...process.env, VITE_SECUREKIT_API_BACKEND: backend,
    VITE_SECUREKIT_DEV_PROXY_TARGET: process.env.VITE_SECUREKIT_DEV_PROXY_TARGET?.trim() ||
      (backend === "aspnet" ? "http://localhost:3002" : "http://localhost:3001") });
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
