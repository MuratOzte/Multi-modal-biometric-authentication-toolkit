from __future__ import annotations

import argparse
import contextlib
import json
import math
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

from card_compare import CardComparer, load_config

try:
    from cardVerificationByClipOld import verify_card as _clip_verify_card

    _CLIP_IMPORT_ERROR: str | None = None
except Exception as _clip_exc:  # noqa: BLE001 - capture import-time failures for the response payload.
    _clip_verify_card = None
    _CLIP_IMPORT_ERROR = f"{type(_clip_exc).__name__}: {_clip_exc}"


def run_clip_verification(probe_path: Path, reference_path: str) -> dict[str, Any]:
    if _clip_verify_card is None:
        return {"ok": False, "error": _CLIP_IMPORT_ERROR or "clip module unavailable"}

    try:
        with contextlib.redirect_stdout(sys.stderr):
            raw = _clip_verify_card(str(probe_path), reference_path)
    except Exception as exc:  # noqa: BLE001 - return failure detail to the caller.
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    if not isinstance(raw, dict):
        return {"ok": False, "error": "clip verify_card returned non-dict payload"}

    clip_score = raw.get("clip_score")
    is_same_card = raw.get("is_same_card")

    return {
        "ok": True,
        "clipScore": float(clip_score) if isinstance(clip_score, (int, float)) else None,
        "isSameCard": bool(is_same_card) if is_same_card is not None else None,
        "referenceImagePath": reference_path,
    }


REFERENCE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
DEFAULT_THRESHOLD = 0.7
VALID_DECISIONS = {"same", "different", "uncertain"}


def clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def to_unit_score(value: Any) -> float:
    try:
        return round(clamp01(float(value) / 100.0), 4)
    except (TypeError, ValueError):
        return 0.0


def to_number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def normalize_fields(fields: Any) -> dict[str, str]:
    source = fields if isinstance(fields, dict) else {}
    return {
        "name": str(source.get("name") or ""),
        "studentNo": str(source.get("student_no") or ""),
        "documentNo": str(source.get("document_no") or ""),
        "cardNo": str(source.get("card_no") or ""),
        "validThru": str(source.get("valid_thru") or ""),
    }


def normalize_reasons(result: dict[str, Any]) -> list[str]:
    details = result.get("details")
    raw_reasons = details.get("reasons") if isinstance(details, dict) else []
    if not isinstance(raw_reasons, list):
        return []
    return [str(reason) for reason in raw_reasons if isinstance(reason, str)]


def build_quality(result: dict[str, Any]) -> dict[str, Any]:
    quality = result.get("quality")
    source = quality if isinstance(quality, dict) else {}
    return {
        "cardDetectedProbe": bool(source.get("card_detected_a", False)),
        "cardDetectedReference": bool(source.get("card_detected_b", False)),
        "detectionConfidenceProbe": to_number(source.get("detection_confidence_a")),
        "detectionConfidenceReference": to_number(source.get("detection_confidence_b")),
        "ocrAvailable": bool(source.get("ocr_available", False)),
        "ocrWeak": bool(source.get("ocr_weak", False)),
        "ocrErrorProbe": source.get("ocr_error_a") if isinstance(source.get("ocr_error_a"), str) else None,
        "ocrErrorReference": source.get("ocr_error_b") if isinstance(source.get("ocr_error_b"), str) else None,
    }


def optional_unit_score(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return round(clamp01(number), 4)


def optional_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def build_visual_details(result: dict[str, Any]) -> dict[str, Any] | None:
    source = result.get("visual_details")
    if not isinstance(source, dict):
        return None

    active_method = source.get("activeMethod")
    clip_score = optional_unit_score(source.get("clipScore"))
    clip_cosine = optional_number(source.get("clipCosine"))
    clip_available = source.get("clipAvailable")
    clip_model = source.get("clipModel")
    clip_device = source.get("clipDevice")
    clip_error = source.get("clipError")

    if active_method != "clip" or not isinstance(clip_available, bool):
        return None

    return {
        "activeMethod": "clip",
        "clipScore": clip_score,
        "clipCosine": clip_cosine,
        "clipAvailable": clip_available,
        "clipModel": clip_model if isinstance(clip_model, str) else None,
        "clipDevice": clip_device if isinstance(clip_device, str) else None,
        "clipError": clip_error if isinstance(clip_error, str) else None,
    }


def build_candidate(reference_path: Path, result: dict[str, Any], threshold: float) -> dict[str, Any]:
    overall_score = to_unit_score(result.get("overall_score"))
    decision = result.get("decision")
    if decision not in VALID_DECISIONS:
        decision = "same" if result.get("same") is True else "different"

    fields = result.get("fields")
    fields_source = fields if isinstance(fields, dict) else {}
    matched = bool(result.get("same", False)) and overall_score >= threshold
    candidate = {
        "referenceImagePath": str(reference_path),
        "referenceFileName": reference_path.name,
        "decision": decision,
        "overallScore": overall_score,
        "contentScore": to_unit_score(result.get("content_score")),
        "visualScore": to_unit_score(result.get("visual_score")),
        "reasons": normalize_reasons(result),
        "fields": {
            "probe": normalize_fields(fields_source.get("a")),
            "reference": normalize_fields(fields_source.get("b")),
        },
        "quality": build_quality(result),
        "matched": matched,
    }
    visual_details = build_visual_details(result)
    if visual_details is not None:
        candidate["visualDetails"] = visual_details

    return candidate


def list_reference_images(reference_dir: Path) -> list[Path]:
    if not reference_dir.exists() or not reference_dir.is_dir():
        return []
    return sorted(
        (
            path
            for path in reference_dir.iterdir()
            if path.is_file() and path.suffix.lower() in REFERENCE_EXTENSIONS
        ),
        key=lambda path: path.name.lower(),
    )


def configure_standard_io() -> None:
    for name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if not callable(reconfigure):
            continue

        kwargs: dict[str, Any] = {"encoding": "utf-8"}
        if name != "stdin":
            kwargs["errors"] = "replace"

        try:
            reconfigure(**kwargs)
        except Exception:
            pass


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def build_payload(
    probe_path: Path,
    reference_dir: Path,
    threshold: float,
    config_path: Path,
    debug_dir: Path | None,
    comparer: CardComparer | None = None,
) -> dict[str, Any]:
    if comparer is None:
        config = load_config(config_path)
        comparer = CardComparer(config, debug_dir)

    references = list_reference_images(reference_dir)

    if not references:
        return {
            "ok": True,
            "matched": False,
            "threshold": threshold,
            "checkedCount": 0,
            "reason": "no_references",
            "bestMatch": None,
            "candidates": [],
        }

    # Analyze the probe once so an unreadable capture fails as a process error, not as
    # a misleading "no usable references" result.
    comparer.analyze(probe_path)

    candidates: list[dict[str, Any]] = []
    for reference_path in references:
        try:
            result = comparer.compare(probe_path, reference_path)
        except Exception as exc:  # noqa: BLE001 - keep one bad reference from breaking the batch.
            print(f"[card_verification] skipped {reference_path}: {exc}", file=sys.stderr)
            continue
        candidates.append(build_candidate(reference_path, result, threshold))

    candidates.sort(key=lambda candidate: candidate["overallScore"], reverse=True)
    best_match = candidates[0] if candidates else None
    matched = any(candidate["matched"] for candidate in candidates)
    reason = None
    if not matched:
        if best_match and best_match["reasons"]:
            reason = ", ".join(best_match["reasons"])
        elif best_match:
            reason = str(best_match["decision"])
        else:
            reason = "no_usable_references"

    clip_payload: dict[str, Any] | None = None
    if best_match is not None:
        clip_payload = run_clip_verification(probe_path, best_match["referenceImagePath"])

    return {
        "ok": True,
        "matched": matched,
        "threshold": threshold,
        "checkedCount": len(candidates),
        "reason": reason,
        "bestMatch": best_match,
        "candidates": candidates,
        "cardVerificationByClipOld": clip_payload,
    }


def parse_worker_threshold(value: Any) -> float:
    try:
        return clamp01(float(value))
    except (TypeError, ValueError):
        return DEFAULT_THRESHOLD


class CardWorker:
    def __init__(self, config_path: Path, debug_dir: Path | None):
        self.config_path = config_path
        self.debug_dir = debug_dir
        self.comparer = CardComparer(load_config(config_path), debug_dir)

    def handle(self, payload: dict[str, Any]) -> dict[str, Any]:
        request_id = str(payload.get("id") or "")
        probe_image_path = str(payload.get("probeImagePath") or "")
        reference_dir = str(payload.get("referenceDir") or "")
        threshold = parse_worker_threshold(payload.get("threshold", DEFAULT_THRESHOLD))

        if not request_id:
            return {}

        if not probe_image_path or not reference_dir:
            return {
                "id": request_id,
                "ok": False,
                "matched": False,
                "threshold": threshold,
                "checkedCount": 0,
                "reason": "invalid_request",
                "bestMatch": None,
                "candidates": [],
            }

        started = time.perf_counter()
        try:
            response = build_payload(
                Path(probe_image_path),
                Path(reference_dir),
                threshold,
                self.config_path,
                self.debug_dir,
                self.comparer,
            )
            response["id"] = request_id
            response["durationMs"] = round((time.perf_counter() - started) * 1000, 3)
            return response
        finally:
            # Probe paths are temporary per request. Keep model objects alive, but avoid
            # accumulating stale normalized images and CLIP embeddings forever.
            self.prune_transient_cache(Path(probe_image_path), Path(reference_dir))

    def prune_transient_cache(self, probe_path: Path, reference_dir: Path) -> None:
        paths = [probe_path]
        if self.is_under_temp_dir(reference_dir):
            paths.extend(list_reference_images(reference_dir))

        clip_cache = getattr(self.comparer.clip, "embedding_cache", None)
        for path in paths:
            resolved = str(path.resolve())
            self.comparer.cache.pop(resolved, None)

            if isinstance(clip_cache, dict):
                prefix = f"{resolved}:"
                for key in list(clip_cache.keys()):
                    if isinstance(key, str) and key.startswith(prefix):
                        clip_cache.pop(key, None)

    @staticmethod
    def is_under_temp_dir(path: Path) -> bool:
        try:
            path.resolve().relative_to(Path(tempfile.gettempdir()).resolve())
            return True
        except ValueError:
            return False


def run_worker(config_path: Path, debug_dir: Path | None) -> int:
    configure_standard_io()

    try:
        worker = CardWorker(config_path, debug_dir)
    except Exception as exc:  # noqa: BLE001 - startup boundary returns structured failure.
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        emit({"event": "ready", "ok": False, "reason": "python_process_error", "error": str(exc)})
        return 1

    emit({"event": "ready", "ok": True})

    for line in sys.stdin:
        stripped = line.strip()
        if not stripped:
            continue

        try:
            payload = json.loads(stripped)
            if not isinstance(payload, dict):
                continue
            response = worker.handle(payload)
            if response:
                emit(response)
        except Exception as exc:  # noqa: BLE001 - keep worker alive after one bad request.
            request_id = ""
            threshold = DEFAULT_THRESHOLD
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, dict):
                    request_id = str(parsed.get("id") or "")
                    threshold = parse_worker_threshold(parsed.get("threshold", DEFAULT_THRESHOLD))
            except Exception:
                pass

            print(traceback.format_exc(), file=sys.stderr, flush=True)
            if request_id:
                emit(
                    {
                        "id": request_id,
                        "ok": False,
                        "matched": False,
                        "threshold": threshold,
                        "checkedCount": 0,
                        "reason": "python_process_error",
                        "bestMatch": None,
                        "candidates": [],
                        "error": str(exc),
                    }
                )

    return 0


def print_summary(payload: dict[str, Any]) -> None:
    best_match = payload.get("bestMatch")
    print(f"Matched: {str(payload.get('matched')).lower()}")
    print(f"Checked references: {payload.get('checkedCount')}")
    if isinstance(best_match, dict):
        print(
            "Best match: "
            f"{best_match.get('referenceFileName')} "
            f"decision={best_match.get('decision')} "
            f"overall={best_match.get('overallScore')}"
        )
    if payload.get("reason"):
        print(f"Reason: {payload.get('reason')}")


def build_parser() -> argparse.ArgumentParser:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(
        description="Compare a probe card image against registered reference card images."
    )
    parser.add_argument("--worker", action="store_true", help="Run as a persistent JSONL worker")
    parser.add_argument("--probe", type=Path, help="Captured probe card image")
    parser.add_argument(
        "--references-dir",
        type=Path,
        help="Directory with registered reference card images",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help="Minimum 0-1 overall score required after the card comparer returns same",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=script_dir / "config.yaml",
        help="YAML config path for card_compare.py",
    )
    parser.add_argument("--debug-dir", type=Path, help="Optional debug crop output directory")
    parser.add_argument("--json", action="store_true", help="Print JSON payload")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.worker:
        return run_worker(args.config, args.debug_dir)

    if not args.probe or not args.references_dir:
        parser.error("--probe and --references-dir are required unless --worker is used")

    threshold = clamp01(args.threshold)

    try:
        payload = build_payload(
            args.probe,
            args.references_dir,
            threshold,
            args.config,
            args.debug_dir,
        )
    except Exception as exc:  # noqa: BLE001 - CLI boundary maps all fatal failures to stderr.
        print(f"[card_verification] failed: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(payload, ensure_ascii=False))
    else:
        print_summary(payload)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
