import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Exclusive copies preserve observations and sample selections on every rerun.
export async function prepareAcceptance(repositoryRoot = root) {
  const directory = path.join(repositoryRoot, ".run-logs", "acceptance");
  await mkdir(path.join(directory, "samples"), { recursive: true });
  const results = [];
  for (const [source, destination] of [
    ["biometric-acceptance.example.json", "manifest.json"],
    ["biometric-manual-acceptance.example.md", "manual.md"],
  ]) {
    try {
      await copyFile(path.join(repositoryRoot, "docs", source), path.join(directory, destination), constants.COPYFILE_EXCL);
      results.push({ file: destination, created: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      results.push({ file: destination, created: false });
    }
  }
  return results;
}

async function main() {
  if (process.argv.length > 2) {
    console.log("Usage: node scripts/biometric-acceptance-prepare.mjs");
    process.exitCode = 1;
    return;
  }
  try {
    for (const result of await prepareAcceptance()) {
      console.log(`${result.file}: ${result.created ? "created" : "preserved"}`);
    }
    console.log("Workspace: .run-logs/acceptance (ignored by Git).");
    console.log("Add separate consented captures under samples and update manifest.json with the spoken texts.");
    console.log("Then: node scripts/biometric-acceptance.mjs .run-logs/acceptance/manifest.json --check");
    console.log("Models and manual hardware acceptance remain pending; record observations in manual.md.");
  } catch {
    console.log("Preparation failed. Check template availability and workspace permissions; existing files are preserved.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
