import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, ".run-logs", "aspnet-parity.json");
const report = { startedAt: new Date().toISOString(), passed: false, stages: [] };
await mkdir(path.dirname(reportPath), { recursive: true });
try {
  for (const stage of ["one", "two", "three", "four", "five", "six", "seven"]) {
    const started = Date.now();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", `packages/node-auth/scripts/stage-${stage}-parity.ts`], {
        cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { output += chunk; });
      child.once("error", reject);
      child.once("exit", code => resolve({ code, output }));
    });
    // Save summaries only: full worker logs can contain local paths or biometric results.
    const summary = result.output.split(/\r?\n/).filter(line => /comparisons passed/.test(line)).join("\n");
    report.stages.push({ stage, passed: result.code === 0, durationMs: Date.now() - started, summary });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    if (result.code !== 0) {
      process.stderr.write(result.output);
      throw new Error(`Stage ${stage} parity failed (exit ${result.code})`);
    }
    console.log(summary || `Stage ${stage} passed.`);
  }
  report.passed = true;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`Parity report: ${reportPath}`);
}
