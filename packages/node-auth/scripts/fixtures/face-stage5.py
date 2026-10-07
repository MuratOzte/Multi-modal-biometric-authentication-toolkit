"""Deterministic protocol fixture; no model or biometric data is included."""
import argparse
import json
import sys
from pathlib import Path


def face(probe):
    negative = Path(probe).read_bytes().startswith(b"negative")
    return {"ok": not negative, "matched": not negative, "score": None if negative else 0.91,
            "reason": "probe_face_not_detected" if negative else None,
            "runtime": {"device": "cpu", "cudaAvailable": False, "cudaDeviceName": None,
                        "fallbackReason": None, "model": "fixture"}}


if "--worker" in sys.argv:
    print(json.dumps({"event": "ready", "ok": True}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        print(json.dumps({"id": request["id"], **face(request["probeImagePath"])}), flush=True)
else:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", required=True)
    parser.add_argument("--reference")
    parser.add_argument("--user-id")
    parser.add_argument("--references-root")
    parser.add_argument("--threshold", type=float, default=0.8)
    parser.add_argument("--max-window", type=int, default=3)
    parser.add_argument("--no-update", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--device")
    parser.add_argument("--require-gpu", action="store_true")
    args = parser.parse_args()
    if args.reference:
        result = face(args.probe)
    else:
        # Fixed wire examples exercise normalization without reimplementing FaceNet.
        result = {"ok": True, "matched": args.user_id != "bootstrap", "score": 0.91,
                  "perReferenceScores": [{"id": "r1", "ts": 100, "score": 0.91}, {"id": "invalid"}],
                  "windowSizeBefore": 1, "windowSizeAfter": 1 if args.no_update else 2,
                  "threshold": args.threshold, "reason": None,
                  "added": None if args.no_update else {"id": "r2", "ts": 200, "image": "r2.jpg"},
                  "evicted": [{"id": "r0", "ts": 50}, {}] if args.max_window == 1 else []}
    print(json.dumps(result), flush=True)
    sys.exit(0 if result["ok"] else 1)
