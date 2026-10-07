import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, ".run-logs", "biometric-preflight.json");
const report = { checkedAt: new Date().toISOString(), dependenciesPassed: false,
  modelAcceptance: "pending", hardwareAcceptance: "pending", modules: [] };

function probe(command, args, module) {
  return new Promise(resolve => {
    const child = spawn(command, [...args, path.join(root, "scripts/biometric-preflight.py"), module], {
      cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
    });
    let output = "";
    let failure;
    const timer = setTimeout(() => { failure = "timeout"; child.kill(); }, 45000);
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.length > 65536) { failure = "output-limit"; child.kill(); }
    });
    child.once("error", () => { failure = "runtime-unavailable"; });
    child.once("close", code => {
      clearTimeout(timer);
      if (!failure && code === 0) {
        try {
          const result = JSON.parse(output);
          if (result.module === module && Array.isArray(result.checks)) return resolve(result);
        } catch { /* Return a safe failure summary. */ }
      }
      resolve({ module, checks: [{ name: "runtime", passed: false, errorType: failure || "probe-failed" }] });
    });
  });
}

for (const module of ["face", "voice", "card"]) {
  const prefix = module.toUpperCase();
  const configured = process.env[`${prefix}_PYTHON_BIN`] || process.env.PYTHON_BIN || process.env[`${module[0].toUpperCase() + module.slice(1)}__PythonCommand`];
  const local = path.join(root, `.venv-${module}`, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  // Local environments are suggestions; starting the API still requires exporting
  // the corresponding *_PYTHON_BIN. Never silently claim API config was checked.
  const command = configured || (existsSync(local) ? local : process.platform === "win32" ? "py" : "python3");
  const launcher = command.match(/^py\s+(-3(?:\.\d+)?)$/);
  const result = await probe(launcher ? "py" : command,
    launcher ? [launcher[1]] : command === "py" ? ["-3"] : [], module);
  result.runtimeSource = configured ? "environment" : existsSync(local) ? "local-venv-suggestion" : "system-python";
  report.modules.push(result);
  const failures = result.checks.filter(check => !check.passed && !check.optional);
  console.log(`${module}: ${failures.length ? "FAIL " + failures.map(c => `${c.name} (${c.errorType || "unavailable"})`).join(", ") : "PASS dependencies"}`);
  if (result.runtimeSource === "local-venv-suggestion") console.log(`  Export ${prefix}_PYTHON_BIN to use .venv-${module} in the API.`);
  for (const check of result.checks.filter(c => c.optional && !c.passed)) console.log(`  Optional: ${check.name} unavailable.`);
}
report.dependenciesPassed = report.modules.every(result => result.checks.every(c => c.passed || c.optional));
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log("Model and camera/microphone acceptance remain pending. Report: .run-logs/biometric-preflight.json");
process.exitCode = report.dependenciesPassed ? 0 : 1;
