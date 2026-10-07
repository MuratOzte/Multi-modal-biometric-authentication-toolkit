import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acceptanceStatus } from "./biometric-acceptance-status.mjs";

async function workspace(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "securekit-status-test-"));
  try { await run(directory, path.join(directory, "manifest.json")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function cardSamples(directory) {
  const samples = ["private-reference.jpg", "private-positive.jpg", "private-negative.jpg"];
  for (const file of samples) await writeFile(path.join(directory, file), file);
  return { reference: { file: samples[0] }, sameCard: { file: samples[1] }, differentCard: { file: samples[2] } };
}

test("a missing face and invalid voice do not hide a ready card or expose private details", async () => {
  await workspace(async (directory, file) => {
    const manifest = {
      face: { reference: { file: "private-missing.jpg" }, samePerson: { file: "private-missing.jpg" }, differentPerson: { file: "private-missing.jpg" } },
      voice: { enrollment: [] }, card: await cardSamples(directory),
    };
    await writeFile(file, JSON.stringify(manifest));
    const report = await acceptanceStatus(file);
    assert.deepEqual(report.modules, [
      { module: "face", status: "blocked", reason: "SAMPLE_FILE_MISSING" },
      { module: "voice", status: "blocked", reason: "VOICE_THREE_SAMPLES_REQUIRED" },
      { module: "card", status: "ready" },
    ]);
    assert.equal(report.samplesReady, false);
    assert.equal(report.allModulesSamplesReady, false);
    assert.equal(JSON.stringify(report).includes("private"), false);
    assert.equal(JSON.stringify(report).includes(directory), false);
  });
});

test("partial readiness keeps omitted modules and real acceptance pending; renamed copies block readiness", async () => {
  await workspace(async (directory, file) => {
    const card = await cardSamples(directory);
    await writeFile(file, JSON.stringify({ card }));
    const report = await acceptanceStatus(file);
    assert.equal(report.samplesReady, true);
    assert.equal(report.allModulesSamplesReady, false);
    assert.deepEqual(report.modules.slice(0, 2), [
      { module: "face", status: "not-selected" }, { module: "voice", status: "not-selected" },
    ]);
    assert.equal(report.modelAcceptance, "pending");
    assert.equal(report.hardwareAcceptance, "pending");
    await writeFile(path.join(directory, card.sameCard.file), card.reference.file);
    const blocked = await acceptanceStatus(file);
    assert.equal(blocked.samplesReady, false);
    assert.equal(blocked.modules[2].reason, "CARD_DISTINCT_SAMPLES_REQUIRED");
  });
});

test("missing, malformed and module-free manifests fail safely, including JSON CLI exit status", async () => {
  await workspace(async (directory, file) => {
    const cli = fileURLToPath(new URL("./biometric-acceptance-status.mjs", import.meta.url));
    for (const content of [null, '{"private-recording":', "{}", "null", "[]"]) {
      if (content !== null) await writeFile(file, content);
      const report = await acceptanceStatus(file);
      assert.equal(report.manifest, "invalid");
      assert.equal(report.samplesReady, false);
      assert.equal(report.reason, "MANIFEST_UNREADABLE_OR_INVALID");
      assert.throws(() => execFileSync(process.execPath, [cli, file, "--json"], { encoding: "utf8" }), error => {
        assert.equal(error.status, 1);
        assert.deepEqual(JSON.parse(error.stdout), report);
        assert.equal(error.stdout.includes(directory), false);
        return true;
      });
    }
    await writeFile(file, JSON.stringify({ card: await cardSamples(directory) }));
    const output = execFileSync(process.execPath, [cli, file, "--json"], { encoding: "utf8" });
    assert.equal(JSON.parse(output).samplesReady, true);
    assert.throws(() => execFileSync(process.execPath, [cli, file, "--unknown"], { encoding: "utf8" }), { status: 1 });
  });
});

test("all-module sample readiness never claims model or hardware acceptance", async () => {
  await workspace(async (directory, file) => {
    const card = await cardSamples(directory);
    const audio = [];
    for (let index = 0; index < 5; index++) {
      const name = `voice-${index}.wav`;
      await writeFile(path.join(directory, name), name);
      audio.push({ file: name, text: "private spoken words" });
    }
    await writeFile(file, JSON.stringify({
      face: { reference: card.reference, samePerson: card.sameCard, differentPerson: card.differentCard },
      voice: { enrollment: audio.slice(0, 3), sameSpeaker: audio[3], differentSpeaker: audio[4], wrongText: "different private words" },
      card,
    }));
    const report = await acceptanceStatus(file);
    assert.equal(report.samplesReady, true);
    assert.equal(report.allModulesSamplesReady, true);
    assert.equal(report.modelAcceptance, "pending");
    assert.equal(report.hardwareAcceptance, "pending");
    assert.equal(JSON.stringify(report).includes("private"), false);
  });
});
