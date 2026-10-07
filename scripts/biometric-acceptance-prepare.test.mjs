import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareAcceptance } from "./biometric-acceptance-prepare.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("preparation copies current templates and preserves edited records and captures on rerun", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "securekit-prepare-test-"));
  try {
    await mkdir(path.join(directory, "docs"));
    for (const name of ["biometric-acceptance.example.json", "biometric-manual-acceptance.example.md"]) {
      await writeFile(path.join(directory, "docs", name), await readFile(path.join(root, "docs", name)));
    }
    const workspace = path.join(directory, ".run-logs", "acceptance");
    assert.deepEqual(await prepareAcceptance(directory), [
      { file: "manifest.json", created: true }, { file: "manual.md", created: true },
    ]);
    assert.equal(await readFile(path.join(workspace, "manifest.json"), "utf8"),
      await readFile(path.join(root, "docs", "biometric-acceptance.example.json"), "utf8"));
    assert.equal(await readFile(path.join(workspace, "manual.md"), "utf8"),
      await readFile(path.join(root, "docs", "biometric-manual-acceptance.example.md"), "utf8"));
    for (const [name, contents] of [["manifest.json", "private selection"], ["manual.md", "actual observations"], ["samples/local.wav", "private recording"]]) {
      await writeFile(path.join(workspace, name), contents);
    }
    assert.deepEqual(await prepareAcceptance(directory), [
      { file: "manifest.json", created: false }, { file: "manual.md", created: false },
    ]);
    assert.equal(await readFile(path.join(workspace, "manifest.json"), "utf8"), "private selection");
    assert.equal(await readFile(path.join(workspace, "manual.md"), "utf8"), "actual observations");
    assert.equal(await readFile(path.join(workspace, "samples/local.wav"), "utf8"), "private recording");
    // A partially prepared workspace recovers the missing template only.
    await rm(path.join(workspace, "manual.md"));
    assert.deepEqual(await prepareAcceptance(directory), [
      { file: "manifest.json", created: false }, { file: "manual.md", created: true },
    ]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing source templates fail preparation instead of claiming success", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "securekit-prepare-missing-test-"));
  try {
    await assert.rejects(prepareAcceptance(directory), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
