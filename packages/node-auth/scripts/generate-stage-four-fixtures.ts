import { writeFile } from "node:fs/promises";
import { computeKeystrokeMetrics } from "../../core/src/biometrics/keystrokeMetrics";
import { buildKeystrokeProfile } from "../../core/src/biometrics/keystrokeProfile";
import { scoreKeystrokeSample } from "../../core/src/biometrics/keystrokeScoring";
import type { KeystrokeSample } from "../../core/src/contracts/enrollment";
import path from "node:path";
import { fileURLToPath } from "node:url";

const samples: KeystrokeSample[] = Array.from({ length: 12 }, (_, seed) => ({ events: Array.from({ length: 25 }, (_, i) => {
  const key = i % 7 === 0 ? " " : i % 9 === 0 ? "Backspace" : "a";
  const code = key === " " ? "Space" : key === "Backspace" ? "Backspace" : "KeyA";
  const t = i * (100 + seed * 13); const hold = i === 24 ? 900 : 30 + ((i * 17 + seed) % 110);
  return [{ key, code, type: "down" as const, t, expectedIndex: i }, { key, code, type: "up" as const, t: t + hold, expectedIndex: i }];
}).flat().reverse(), typedLength: 20, errorCount: 2, backspaceCount: 3, imeCompositionUsed: seed % 2 === 0 }));
const baseline = buildKeystrokeProfile({ userId: "fixture", nowIso: "2026-10-07T09:00:00.000Z", sample: samples[0] }).profile;
const fixtures = samples.map((sample, i) => {
  const computed = computeKeystrokeMetrics(sample);
  return { name: `metrics-${i}`, sample, metrics: computed.metrics, reasons: computed.reasons,
    profile: buildKeystrokeProfile({ userId: "fixture", nowIso: "2026-10-07T09:00:00.000Z", sample }).profile,
    baseline, scored: scoreKeystrokeSample({ profile: baseline, sampleMetrics: computed.metrics }) };
});
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/securekit-api.tests/Fixtures/keystroke-stage4.json");
await writeFile(output, JSON.stringify(fixtures, null, 2) + "\n");
console.log(`Wrote ${fixtures.length} shared Node/C# fixtures.`);
