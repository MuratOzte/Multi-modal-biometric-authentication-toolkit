#!/usr/bin/env python3
import json
import math
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import keystroke_ml


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
RESULTS_DIR = BASE_DIR / "results"

ENROLL_COUNT = 5
THRESHOLD_MIN = 0.0
THRESHOLD_MAX = 100.0
THRESHOLD_STEP = 0.5

FRESHNESS_OVERRIDE_OPTS = {
    "nowMs": time.time() * 1000.0,
    "maxAgeMs": 10_000_000_000.0,
    "maxFutureSkewMs": 10_000_000_000.0,
}


def _load_participants(data_dir: Path) -> Dict[str, List[dict]]:
    data_dir.mkdir(parents=True, exist_ok=True)
    participants: Dict[str, List[dict]] = {}

    for file_path in sorted(data_dir.glob("*.json")):
        participant_id = file_path.stem
        try:
            with file_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception as error:
            print(f"Skipping {file_path.name}: failed to read JSON ({error})")
            continue

        if not isinstance(payload, list):
            print(f"Skipping {file_path.name}: expected a JSON array")
            continue

        samples: List[dict] = []
        for item in payload:
            if isinstance(item, dict):
                samples.append(item)
        participants[participant_id] = samples

    return participants


def _enroll_templates(participants: Dict[str, List[dict]]) -> Tuple[Dict[str, dict], Dict[str, str]]:
    templates: Dict[str, dict] = {}
    skipped: Dict[str, str] = {}

    for participant_id, samples in participants.items():
        if len(samples) < (ENROLL_COUNT + 1):
            skipped[participant_id] = "insufficient_samples"
            continue

        response = keystroke_ml.handle_enroll(
            {
                "op": "enroll",
                "samples": samples[:ENROLL_COUNT],
                "opts": FRESHNESS_OVERRIDE_OPTS,
            }
        )
        if response.get("ok") is not True:
            skipped[participant_id] = str(response.get("error", "enroll_failed"))
            continue

        template = response.get("template")
        if not isinstance(template, dict):
            skipped[participant_id] = "missing_template"
            continue

        templates[participant_id] = template

    return templates, skipped


def _verify_score(template: dict, sample: dict) -> Tuple[bool, float, str]:
    response = keystroke_ml.handle_verify(
        {
            "op": "verify",
            "template": template,
            "samples": [sample],
            "opts": FRESHNESS_OVERRIDE_OPTS,
        }
    )
    if response.get("ok") is not True:
        return False, 0.0, str(response.get("error", "verify_failed"))

    try:
        score = float(response.get("score", 0.0))
    except (TypeError, ValueError):
        return False, 0.0, "invalid_score"
    return True, score, ""


def _threshold_values() -> List[float]:
    count = int(round((THRESHOLD_MAX - THRESHOLD_MIN) / THRESHOLD_STEP)) + 1
    values: List[float] = []
    for index in range(count):
        values.append(round(THRESHOLD_MIN + (index * THRESHOLD_STEP), 3))
    return values


def _compute_far_frr(threshold: float, genuine_scores: List[float], impostor_scores: List[float]) -> Tuple[float, float]:
    total_impostor = len(impostor_scores)
    total_genuine = len(genuine_scores)

    impostor_accepted = sum(1 for score in impostor_scores if score >= threshold)
    genuine_rejected = sum(1 for score in genuine_scores if score < threshold)

    far = (impostor_accepted / float(total_impostor)) if total_impostor > 0 else 0.0
    frr = (genuine_rejected / float(total_genuine)) if total_genuine > 0 else 0.0
    return far, frr


def _compute_auc(
    threshold_metrics: List[Dict[str, float]], genuine_count: int, impostor_count: int
) -> float:
    if genuine_count <= 0 or impostor_count <= 0:
        return 0.0

    points: List[Tuple[float, float]] = [(0.0, 0.0), (1.0, 1.0)]
    for metric in threshold_metrics:
        far = max(0.0, min(1.0, float(metric["far"])))
        tar = max(0.0, min(1.0, 1.0 - float(metric["frr"])))
        points.append((far, tar))

    best_tpr_by_fpr: Dict[float, float] = {}
    for fpr, tpr in points:
        best_tpr_by_fpr[fpr] = max(best_tpr_by_fpr.get(fpr, 0.0), tpr)

    sorted_points = sorted(best_tpr_by_fpr.items(), key=lambda item: item[0])
    auc = 0.0
    for index in range(1, len(sorted_points)):
        x0, y0 = sorted_points[index - 1]
        x1, y1 = sorted_points[index]
        auc += (x1 - x0) * ((y0 + y1) * 0.5)

    return max(0.0, min(1.0, auc))


def _build_ascii_roc(threshold_metrics: List[Dict[str, float]], width: int = 20, height: int = 10) -> Tuple[str, List[str]]:
    grid = [["." for _ in range(width)] for _ in range(height)]

    for metric in threshold_metrics:
        x = max(0.0, min(1.0, float(metric["far"])))
        y = max(0.0, min(1.0, 1.0 - float(metric["frr"])))
        col = int(round(x * (width - 1)))
        row = int(round((1.0 - y) * (height - 1)))
        row = max(0, min(height - 1, row))
        col = max(0, min(width - 1, col))
        grid[row][col] = "*"

    lines = ["".join(row) for row in grid]
    return "\n".join(lines), lines


def main() -> int:
    participants = _load_participants(DATA_DIR)
    templates, skipped = _enroll_templates(participants)

    genuine_scores: List[float] = []
    impostor_scores: List[float] = []
    genuine_attempts: List[Dict[str, Any]] = []
    impostor_attempts: List[Dict[str, Any]] = []

    for participant_id, template in templates.items():
        participant_samples = participants[participant_id]
        for sample_index, sample in enumerate(participant_samples[ENROLL_COUNT:], start=ENROLL_COUNT):
            ok, score, error = _verify_score(template, sample)
            if not ok:
                print(
                    f"Skipping genuine verify for participant={participant_id} sampleIndex={sample_index}: {error}"
                )
                continue
            genuine_scores.append(score)
            genuine_attempts.append(
                {
                    "participantId": participant_id,
                    "sampleIndex": sample_index,
                    "score": score,
                }
            )

    enrolled_ids = sorted(templates.keys())
    for impostor_id in enrolled_ids:
        impostor_sample = participants[impostor_id][ENROLL_COUNT]
        for target_id in enrolled_ids:
            if target_id == impostor_id:
                continue
            ok, score, error = _verify_score(templates[target_id], impostor_sample)
            if not ok:
                print(f"Skipping impostor verify {impostor_id}->{target_id}: {error}")
                continue
            impostor_scores.append(score)
            impostor_attempts.append(
                {
                    "impostorId": impostor_id,
                    "targetId": target_id,
                    "sampleIndex": ENROLL_COUNT,
                    "score": score,
                }
            )

    thresholds = _threshold_values()
    threshold_metrics: List[Dict[str, float]] = []

    best_threshold = 0.0
    best_far = 0.0
    best_frr = 0.0
    best_diff = math.inf

    for threshold in thresholds:
        far, frr = _compute_far_frr(threshold, genuine_scores, impostor_scores)
        threshold_metrics.append(
            {
                "threshold": threshold,
                "far": far,
                "frr": frr,
                "tar": 1.0 - frr,
            }
        )

        diff = abs(far - frr)
        if diff < best_diff:
            best_diff = diff
            best_threshold = threshold
            best_far = far
            best_frr = frr

    eer = ((best_far + best_frr) * 0.5) * 100.0
    auc = _compute_auc(threshold_metrics, len(genuine_scores), len(impostor_scores))
    roc_ascii, roc_lines = _build_ascii_roc(threshold_metrics)

    print(f"Number of participants loaded: {len(participants)}")
    print(f"Participants enrolled: {len(templates)}")
    print(f"Total genuine attempts: {len(genuine_scores)}")
    print(f"Total impostor attempts: {len(impostor_scores)}")
    print(f"EER: {eer:.4f}% at threshold {best_threshold:.1f}")
    print(f"AUC: {auc:.6f}")
    print(f"FAR at EER threshold: {best_far:.6f}")
    print(f"FRR at EER threshold: {best_frr:.6f}")
    print("ASCII ROC (20x10, x=FAR, y=TAR):")
    print(roc_ascii)

    report = {
        "participantsLoaded": len(participants),
        "participantsEnrolled": len(templates),
        "skippedParticipants": skipped,
        "enrollCount": ENROLL_COUNT,
        "totalGenuineAttempts": len(genuine_scores),
        "totalImpostorAttempts": len(impostor_scores),
        "genuineScores": genuine_scores,
        "impostorScores": impostor_scores,
        "genuineAttempts": genuine_attempts,
        "impostorAttempts": impostor_attempts,
        "thresholdMetrics": threshold_metrics,
        "eer": {
            "percent": eer,
            "threshold": best_threshold,
            "far": best_far,
            "frr": best_frr,
            "absDiff": best_diff,
        },
        "auc": auc,
        "asciiRoc": roc_lines,
    }

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = RESULTS_DIR / "eer_report.json"
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)

    print(f"Report saved to: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
