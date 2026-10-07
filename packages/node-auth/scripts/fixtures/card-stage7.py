"""Deterministic card JSONL protocol fixture; no OCR/model dependencies."""
import json
import pathlib
import sys
import time

def emit(value):
    print(json.dumps(value), flush=True)

emit({"event": "ready", "ok": True})
for line in sys.stdin:
    request = json.loads(line)
    mode = pathlib.Path(request["probeImagePath"]).read_text()
    if mode == "timeout":
        time.sleep(30)
    if mode == "invalid":
        print("not json", flush=True)
        continue
    if mode == "stdout":
        print("x" * 1100000, flush=True)
        continue
    if mode == "stderr":
        print("x" * 1100000, file=sys.stderr, flush=True)
        time.sleep(30)
    if mode == "exit":
        sys.exit(2)
    references = sorted(p for p in pathlib.Path(request["referenceDir"]).iterdir()
                        if p.is_file() and p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))
    fields = {"name": "Test", "studentNo": "123", "cardNo": "456", "validThru": "2027"}
    score = {"different": .2, "uncertain": .6}.get(mode, .95)
    decision = mode if mode in ("different", "uncertain") else "same"
    candidates = []
    for reference in references:
        candidates.append({"referenceImagePath": str(reference), "referenceFileName": reference.name,
            "decision": decision, "overallScore": score, "contentScore": score, "visualScore": score,
            "visualDetails": {"activeMethod": "clip", "clipScore": score, "clipCosine": .9,
                "clipAvailable": True, "clipModel": "fixture", "clipDevice": "cpu", "clipError": None},
            "reasons": [], "fields": {"probe": fields, "reference": fields},
            "quality": {"cardDetectedProbe": True, "cardDetectedReference": True,
                "detectionConfidenceProbe": .9, "detectionConfidenceReference": .9,
                "ocrAvailable": mode != "dependency", "ocrWeak": False,
                "ocrErrorProbe": "No module named 'paddleocr'" if mode == "dependency" else None,
                "ocrErrorReference": None}, "matched": decision == "same" and score >= request["threshold"]})
    result = {"id": request["id"], "ok": mode != "failure", "matched": any(c["matched"] for c in candidates),
        "threshold": request["threshold"], "checkedCount": len(candidates),
        "reason": "python_process_error" if mode == "failure" else None,
        "bestMatch": candidates[0] if candidates else None, "candidates": candidates,
        "cardVerificationByClipOld": {"ok": True, "clipScore": score, "isSameCard": score > .7}}
    if mode == "empty":
        result.update(checkedCount=0, bestMatch=None, candidates=[])
    if mode == "schema":
        result["candidates"][0]["overallScore"] = 2
    emit(result)
