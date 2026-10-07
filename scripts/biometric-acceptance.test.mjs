import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { accepted, loadManifest, runAcceptance } from "./biometric-acceptance.mjs";

test("uncertain cards and unavailable model backends cannot pass quality acceptance", () => {
  const body = { ok: true, matched: false, bestMatch: { decision: "uncertain", quality: { ocrAvailable: true }, visualDetails: { clipAvailable: true } } };
  assert.equal(accepted("card-different", { status: 200, body }), false);
  body.bestMatch.decision = "different";
  assert.equal(accepted("card-different", { status: 200, body }), true);
  body.bestMatch.visualDetails.clipAvailable = false;
  assert.equal(accepted("card-different", { status: 200, body }), false);
  body.bestMatch.visualDetails.clipAvailable = true;
  body.bestMatch.quality.ocrErrorProbe = "backend failed";
  assert.equal(accepted("card-different", { status: 200, body }), false);
});

test("different speaker requires correct transcript and deny, while wrong text requires mismatch", () => {
  const body = { ok: true, matched: false, decision: "deny", transcript: { matched: false } };
  assert.equal(accepted("voice-different-speaker", { status: 200, body }), false);
  assert.equal(accepted("voice-wrong-text", { status: 200, body }), true);
  body.transcript.matched = true;
  assert.equal(accepted("voice-different-speaker", { status: 200, body }), true);
  body.decision = "step_up";
  assert.equal(accepted("voice-different-speaker", { status: 200, body }), false);
  assert.equal(accepted("voice-enrollment", { status: 422, body: { ok: true, enrollmentProgress: { complete: true, sampleCount: 3 } } }), false);
});

test("manifest resolves local paths and rejects reuse of the reference as a positive probe", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "securekit-manifest-test-"));
  try {
    for (const name of ["reference.jpg", "same.jpg", "different.jpg"]) await writeFile(path.join(directory, name), "local test bytes");
    const manifest = { card: { reference: { file: "reference.jpg" }, sameCard: { file: "same.jpg" }, differentCard: { file: "different.jpg" } } };
    const file = path.join(directory, "manifest.json");
    await writeFile(file, JSON.stringify(manifest));
    assert.equal((await loadManifest(file)).card.reference.file, path.join(directory, "reference.jpg"));
    manifest.card.sameCard.file = "reference.jpg";
    await writeFile(file, JSON.stringify(manifest));
    await assert.rejects(loadManifest(file), /CARD_DISTINCT_SAMPLES_REQUIRED/);
    await writeFile(file, "{}");
    await assert.rejects(loadManifest(file), /MANIFEST_MODULE_REQUIRED/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("real ASP.NET harness reports unavailable runtime safely and removes its isolated stores", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "securekit-harness-test-"));
  const before = new Set(await readdir(tmpdir()));
  const previous = process.env.CARD_PYTHON_BIN;
  try {
    process.env.CARD_PYTHON_BIN = path.join(directory, "missing-python");
    const file = path.join(directory, "private-personal-name.jpg");
    await writeFile(file, "test");
    const sample = { file, mime: "image/jpeg" };
    const report = await runAcceptance({ card: { reference: sample, sameCard: sample, differentCard: sample } });
    assert.deepEqual(report.checks, [
      { name: "card-enrollment", passed: true }, { name: "card-same", passed: false }, { name: "card-different", passed: false },
    ]);
    assert.equal(report.modelAcceptance, "failed");
    assert.equal(report.hardwareAcceptance, "pending");
    assert.equal(JSON.stringify(report).includes(directory), false);
    assert.equal(JSON.stringify(report).includes("private-personal-name"), false);
    assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith("securekit-biometric-acceptance-") && !before.has(name)), []);
  } finally {
    if (previous === undefined) delete process.env.CARD_PYTHON_BIN; else process.env.CARD_PYTHON_BIN = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
