#!/usr/bin/env python3
import json
import math
import sys
import time
from typing import Any, Dict, List, Optional, Tuple


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def percentile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(float(v) for v in values)
    if p <= 0:
        return sorted_values[0]
    if p >= 100:
        return sorted_values[-1]

    position = (len(sorted_values) - 1) * (p / 100.0)
    left = int(math.floor(position))
    right = int(math.ceil(position))
    if left == right:
        return sorted_values[left]

    weight = position - left
    return sorted_values[left] + (sorted_values[right] - sorted_values[left]) * weight


def vector_mean(vectors: List[List[float]]) -> List[float]:
    dim = len(vectors[0])
    count = float(len(vectors))
    means: List[float] = []
    for i in range(dim):
        total = 0.0
        for vector in vectors:
            total += vector[i]
        means.append(total / count)
    return means


def vector_sample_std(vectors: List[List[float]], means: List[float]) -> List[float]:
    dim = len(vectors[0])
    count = len(vectors)
    if count <= 1:
        return [0.0 for _ in range(dim)]

    stds: List[float] = []
    for i in range(dim):
        total = 0.0
        for vector in vectors:
            delta = vector[i] - means[i]
            total += delta * delta
        stds.append(math.sqrt(total / float(count - 1)))
    return stds


def with_std_floor(stds: List[float], std_floor: float) -> List[float]:
    return [max(float(value), std_floor) for value in stds]


def _round_ms(value: float) -> float:
    # Mirror JS Math.round(value * 1000) / 1000 used by the WebSDK.
    return math.floor((float(value) * 1000.0) + 0.5) / 1000.0


def derive_uu_ms(hold_ms: List[float], dd_ms: List[float]) -> List[float]:
    if len(dd_ms) != len(hold_ms) - 1:
        raise ValueError("uu_dim_mismatch")

    return [_round_ms(dd_ms[i] + hold_ms[i] - hold_ms[i + 1]) for i in range(len(dd_ms))]


def flatten_sample(sample: Dict[str, Any]) -> List[float]:
    hold = sample.get("holdMs", [])
    dd = sample.get("ddMs", [])
    ud = sample.get("udMs", [])

    if not isinstance(hold, list) or not isinstance(dd, list) or not isinstance(ud, list):
        raise ValueError("sample arrays must be lists")

    normalized_hold: List[float] = []
    normalized_dd: List[float] = []
    normalized_ud: List[float] = []
    for value in hold:
        if not _is_finite_number(value):
            raise ValueError("sample contains non-finite feature value")
        normalized_hold.append(float(value))
    for value in dd:
        if not _is_finite_number(value):
            raise ValueError("sample contains non-finite feature value")
        normalized_dd.append(float(value))
    for value in ud:
        if not _is_finite_number(value):
            raise ValueError("sample contains non-finite feature value")
        normalized_ud.append(float(value))

    uu: List[float] = []
    if len(normalized_hold) > 1 and len(normalized_dd) > 0:
        uu = derive_uu_ms(normalized_hold, normalized_dd)

    vector: List[float] = []
    for value in normalized_hold + normalized_dd + normalized_ud + uu:
        vector.append(value)

    return vector


def dist_from_template(vector: List[float], mean: List[float], std: List[float]) -> float:
    dim = len(vector)
    if dim == 0:
        return 0.0

    total = 0.0
    for i in range(dim):
        denominator = std[i] if std[i] > 0 else 1.0
        total += abs((vector[i] - mean[i]) / denominator)
    return total / float(dim)


def score_from_dist(dist: float, score_k: float) -> float:
    return _clamp(100.0 - (score_k * dist), 0.0, 100.0)


def _extract_timestamp(sample: Dict[str, Any]) -> Optional[float]:
    meta = sample.get("meta")
    if not isinstance(meta, dict):
        return None
    timestamp = meta.get("timestamp")
    if not _is_finite_number(timestamp):
        return None
    return float(timestamp)


def _validate_freshness(
    samples: List[Dict[str, Any]],
    now_ms: float,
    max_age_ms: float,
    max_future_skew_ms: float,
) -> Optional[str]:
    for index, sample in enumerate(samples):
        timestamp = _extract_timestamp(sample)
        if timestamp is None:
            return f"missing_timestamp:{index}"

        age = now_ms - timestamp
        if age > max_age_ms:
            return f"stale_sample:{index}"
        if age < -max_future_skew_ms:
            return f"future_timestamp:{index}"

    return None


def _validate_vectors(vectors: List[List[float]]) -> Tuple[bool, Optional[str], int]:
    if not vectors:
        return False, "empty_vectors", 0

    dim = len(vectors[0])
    if dim <= 0:
        return False, "zero_dim", 0

    for vector in vectors:
        if len(vector) != dim:
            return False, "dim_mismatch", dim
        for value in vector:
            if not _is_finite_number(value):
                return False, "non_finite_feature", dim

    return True, None, dim


def build_template(
    vectors: List[List[float]],
    std_floor_ms: float,
    score_k: float,
) -> Tuple[Dict[str, Any], Dict[str, float]]:
    mean = vector_mean(vectors)
    std = with_std_floor(vector_sample_std(vectors, mean), std_floor_ms)
    dim = len(mean)

    genuine_dists: List[float] = []
    if len(vectors) > 1:
        for i in range(len(vectors)):
            others = [vectors[j] for j in range(len(vectors)) if j != i]
            other_mean = vector_mean(others)
            other_std = with_std_floor(vector_sample_std(others, other_mean), std_floor_ms)
            genuine_dists.append(dist_from_template(vectors[i], other_mean, other_std))
    else:
        genuine_dists = [dist_from_template(vectors[0], mean, std)]

    dist_threshold = percentile(genuine_dists, 90.0)
    genuine_scores = [score_from_dist(distance, score_k) for distance in genuine_dists]
    score_threshold = 85.0
    if genuine_scores:
        score_threshold = min(85.0, percentile(genuine_scores, 10.0))
    score_threshold = _clamp(score_threshold, 0.0, 100.0)
    auto_enroll_score = _clamp(max(score_threshold + 5.0, 92.0), 0.0, 100.0)

    template: Dict[str, Any] = {
        "dim": dim,
        "count": len(vectors),
        "mean": mean,
        "std": std,
        "distThreshold": dist_threshold,
        "scoreK": score_k,
        "autoEnrollScore": auto_enroll_score,
        "scoreThreshold": score_threshold,
    }
    recommended = {
        "distThreshold": dist_threshold,
        "scoreThreshold": score_threshold,
        "autoEnrollScore": auto_enroll_score,
    }
    return template, recommended


def update_template_incremental(
    template: Dict[str, Any], vector: List[float], std_floor_ms: float
) -> Dict[str, Any]:
    count = int(template.get("count", 0))
    mean = [float(v) for v in template.get("mean", [])]
    std = [max(float(v), std_floor_ms) for v in template.get("std", [])]

    if count <= 0:
        raise ValueError("invalid_template_count")
    if len(mean) != len(vector) or len(std) != len(vector):
        raise ValueError("template_dim_mismatch")

    new_count = count + 1
    new_mean: List[float] = []
    new_std: List[float] = []

    for i in range(len(vector)):
        old_mean = mean[i]
        old_std = std[i]
        old_m2 = (old_std * old_std) * float(max(count - 1, 0))

        delta = vector[i] - old_mean
        updated_mean = old_mean + (delta / float(new_count))
        delta2 = vector[i] - updated_mean
        updated_m2 = old_m2 + (delta * delta2)

        variance = 0.0
        if new_count > 1:
            variance = updated_m2 / float(new_count - 1)
        updated_std = max(math.sqrt(max(0.0, variance)), std_floor_ms)

        new_mean.append(updated_mean)
        new_std.append(updated_std)

    next_template = dict(template)
    next_template["count"] = new_count
    next_template["mean"] = new_mean
    next_template["std"] = new_std
    return next_template


def _ensure_template_numeric(template: Dict[str, Any]) -> bool:
    fields = ["dim", "count", "distThreshold", "scoreK", "autoEnrollScore", "scoreThreshold"]
    for field in fields:
        if not _is_finite_number(template.get(field)):
            return False

    mean = template.get("mean")
    std = template.get("std")
    if not isinstance(mean, list) or not isinstance(std, list):
        return False

    if len(mean) != len(std):
        return False

    for value in mean + std:
        if not _is_finite_number(value):
            return False

    return True


def handle_enroll(payload: Dict[str, Any]) -> Dict[str, Any]:
    samples = payload.get("samples")
    if not isinstance(samples, list) or len(samples) == 0:
        return {"ok": False, "error": "samples_required"}

    now_ms = float(payload.get("opts", {}).get("nowMs", time.time() * 1000.0))
    max_age_ms = float(payload.get("opts", {}).get("maxAgeMs", 120000.0))
    max_future_skew_ms = float(payload.get("opts", {}).get("maxFutureSkewMs", 10000.0))
    freshness_error = _validate_freshness(samples, now_ms, max_age_ms, max_future_skew_ms)
    if freshness_error is not None:
        return {"ok": False, "error": freshness_error}

    std_floor_ms = float(payload.get("opts", {}).get("stdFloorMs", 8.0))
    thresholds = payload.get("opts", {}).get("thresholds", {})
    score_k = float(thresholds.get("scoreK", 18.0))

    try:
        vectors = [flatten_sample(sample) for sample in samples]
    except ValueError as error:
        return {"ok": False, "error": "invalid_sample", "details": str(error)}

    valid, reason, _ = _validate_vectors(vectors)
    if not valid:
        return {"ok": False, "error": reason or "invalid_vectors"}

    template, recommended = build_template(vectors, std_floor_ms, score_k)
    return {"ok": True, "template": template, "recommended": recommended}


def handle_verify(payload: Dict[str, Any]) -> Dict[str, Any]:
    template = payload.get("template")
    if not isinstance(template, dict):
        return {
            "ok": True,
            "score": 0.0,
            "dist": 9999.0,
            "decision": "reject",
            "autoEnrolled": False,
            "reason": "not_enrolled",
        }

    if not _ensure_template_numeric(template):
        return {
            "ok": True,
            "score": 0.0,
            "dist": 9999.0,
            "decision": "reject",
            "autoEnrolled": False,
            "reason": "invalid_template",
        }

    samples = payload.get("samples")
    if not isinstance(samples, list) or len(samples) != 1:
        return {"ok": False, "error": "verify_requires_single_sample"}

    sample = samples[0]
    if not isinstance(sample, dict):
        return {"ok": False, "error": "invalid_sample"}

    now_ms = float(payload.get("opts", {}).get("nowMs", time.time() * 1000.0))
    max_age_ms = float(payload.get("opts", {}).get("maxAgeMs", 120000.0))
    max_future_skew_ms = float(payload.get("opts", {}).get("maxFutureSkewMs", 10000.0))
    freshness_error = _validate_freshness([sample], now_ms, max_age_ms, max_future_skew_ms)
    if freshness_error is not None:
        return {
            "ok": True,
            "score": 0.0,
            "dist": 9999.0,
            "decision": "reject",
            "autoEnrolled": False,
            "reason": freshness_error,
        }

    std_floor_ms = float(payload.get("opts", {}).get("stdFloorMs", 8.0))
    min_enroll = int(payload.get("opts", {}).get("minEnroll", 10))
    auto_enroll_enabled = bool(payload.get("opts", {}).get("autoEnroll", False))

    try:
        vector = flatten_sample(sample)
    except ValueError as error:
        return {"ok": False, "error": "invalid_sample", "details": str(error)}

    dim = int(template.get("dim", 0))
    if dim != len(vector):
        return {
            "ok": True,
            "score": 0.0,
            "dist": 9999.0,
            "decision": "reject",
            "autoEnrolled": False,
            "reason": "dim_mismatch",
        }

    mean = [float(value) for value in template.get("mean", [])]
    std = with_std_floor([float(value) for value in template.get("std", [])], std_floor_ms)
    dist_threshold = float(template.get("distThreshold", 0.0))
    score_threshold = float(template.get("scoreThreshold", 85.0))
    auto_enroll_score = float(template.get("autoEnrollScore", 92.0))
    score_k = float(template.get("scoreK", 18.0))

    dist = dist_from_template(vector, mean, std)
    score = score_from_dist(dist, score_k)

    decision = "accept" if (dist <= dist_threshold and score >= score_threshold) else "reject"
    auto_enrolled = False
    updated_template: Optional[Dict[str, Any]] = None

    template_count = int(template.get("count", 0))
    if (
        auto_enroll_enabled
        and score >= auto_enroll_score
        and template_count >= min_enroll
    ):
        try:
            updated_template = update_template_incremental(template, vector, std_floor_ms)
            auto_enrolled = True
        except ValueError:
            updated_template = None
            auto_enrolled = False

    response: Dict[str, Any] = {
        "ok": True,
        "score": score,
        "dist": dist,
        "decision": decision,
        "autoEnrolled": auto_enrolled,
    }
    if updated_template is not None:
        response["template"] = updated_template
    return response


def main() -> int:
    try:
        raw = sys.stdin.read()
        if not raw:
            payload: Dict[str, Any] = {}
        else:
            payload = json.loads(raw)

        op = payload.get("op")
        if op == "enroll":
            result = handle_enroll(payload)
        elif op == "verify":
            result = handle_verify(payload)
        else:
            result = {"ok": False, "error": "unsupported_op"}

        sys.stdout.write(json.dumps(result, separators=(",", ":")))
        sys.stdout.flush()

        return 0 if result.get("ok") is not False else 1
    except Exception as error:  # pragma: no cover
        print(f"[keystroke_ml] {error}", file=sys.stderr)
        fallback = {"ok": False, "error": "internal_error", "details": str(error)}
        sys.stdout.write(json.dumps(fallback, separators=(",", ":")))
        sys.stdout.flush()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
