"""Model-free fixture implementing the production voice worker JSON-lines protocol."""
import json
import pathlib
import sys

runtime = {"device": "cpu", "cudaAvailable": False, "cudaDeviceName": None,
           "fallbackReason": None, "whisperModel": "base",
           "speakerModel": "speechbrain/spkrec-ecapa-voxceleb"}
print(json.dumps({"event": "ready", "ok": True, "runtime": runtime}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    sample = pathlib.Path(request["audioPath"]).read_bytes().decode("utf-8")
    embedding = {"allow": [1, 0], "step": [0, 1], "deny": [-1, 0], "dimension": [1, 0, 0]}.get(sample, [1, 0])
    reason = sample if sample in ("audio_too_short", "ffmpeg_missing", "other") else None
    result = {"id": request["id"], "ok": reason is None, "embedding": embedding,
              "transcript": {"expectedText": request["expectedText"], "transcript": request["expectedText"] if sample != "mismatch" else "wrong text",
                             "similarityScore": 1 if sample != "mismatch" else 0,
                             "matched": sample != "mismatch", "threshold": request["transcriptThreshold"]},
              "runtime": runtime, "reason": reason}
    print(json.dumps(result, ensure_ascii=False), flush=True)
