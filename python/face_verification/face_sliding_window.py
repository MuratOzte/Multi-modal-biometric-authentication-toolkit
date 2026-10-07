"""Face verification with a per-user sliding window of recent references.

Data layout
-----------
<root>/<user_id>/
    manifest.json                     # ordered FIFO of entries
    embeddings/<entry_id>.npy         # 512-d L2-normalized vector
    images/<entry_id>.<ext>           # optional original probe image

Algorithm
---------
1. Load the user's window (0..MAX entries, ordered oldest→newest).
2. Encode the probe image once.
3. Compute cosine similarity against each reference embedding.
4. Aggregate by arithmetic mean of per-reference scores.
5. If matched and `update_on_success=True`, append the probe entry and
   evict the oldest until len(window) <= MAX.

Concurrency: a sidecar `.lock` file prevents two simultaneous writers
from interleaving manifest updates.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import torch
from facenet_pytorch import InceptionResnetV1, MTCNN
from PIL import Image

DEFAULT_MAX_WINDOW = 3
DEFAULT_THRESHOLD = 0.80
EMBEDDING_DIM = 512
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


# ---------------------------------------------------------------------------
# Model singleton — loaded lazily so importing the module stays cheap.
# ---------------------------------------------------------------------------
class _ModelBundle:
    def __init__(self, device: torch.device):
        self.device = device
        self.mtcnn = MTCNN(image_size=160, margin=20, device=device)
        self.resnet = InceptionResnetV1(pretrained="vggface2").eval().to(device)


_MODEL: _ModelBundle | None = None


def _resolve_device(prefer: str = "auto") -> torch.device:
    if prefer == "cpu":
        return torch.device("cpu")
    if prefer == "cuda" or (prefer == "auto" and torch.cuda.is_available()):
        return torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    return torch.device("cpu")


def get_model(device_preference: str = "auto") -> _ModelBundle:
    global _MODEL
    if _MODEL is None:
        _MODEL = _ModelBundle(_resolve_device(device_preference))
    return _MODEL


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------
def compute_embedding(image_path: Path, model: _ModelBundle | None = None) -> np.ndarray | None:
    """Return an L2-normalized 512-d face embedding, or None if no face is detected."""
    bundle = model or get_model()
    image = Image.open(image_path).convert("RGB")
    face = bundle.mtcnn(image)
    if face is None:
        return None

    face = face.unsqueeze(0).to(bundle.device)
    with torch.no_grad():
        embedding = bundle.resnet(face).cpu().numpy().reshape(-1)

    norm = float(np.linalg.norm(embedding))
    if norm == 0.0:
        return embedding
    return (embedding / norm).astype(np.float32)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity for embeddings (already L2-normalized is fine)."""
    a_flat = a.reshape(-1)
    b_flat = b.reshape(-1)
    denom = float(np.linalg.norm(a_flat) * np.linalg.norm(b_flat))
    if denom == 0.0:
        return 0.0
    return float(np.dot(a_flat, b_flat) / denom)


# ---------------------------------------------------------------------------
# Per-user storage
# ---------------------------------------------------------------------------
class FaceWindowStore:
    """Filesystem-backed FIFO window of face references for a single user.

    A manifest.json holds the ordered list of entries; embeddings are stored
    as `.npy` files for O(1) load. Original probe images can be kept too
    (useful for audits) but are not required by the verification path.
    """

    def __init__(self, root_dir: Path, user_id: str, max_window: int = DEFAULT_MAX_WINDOW):
        if max_window < 1:
            raise ValueError("max_window must be >= 1")
        self.user_id = user_id
        self.max_window = max_window
        self.user_dir = Path(root_dir) / user_id
        self.embeddings_dir = self.user_dir / "embeddings"
        self.images_dir = self.user_dir / "images"
        self.manifest_path = self.user_dir / "manifest.json"
        self._lock_path = self.user_dir / ".lock"

    # ---- manifest I/O ------------------------------------------------------
    def _ensure_dirs(self) -> None:
        self.user_dir.mkdir(parents=True, exist_ok=True)
        self.embeddings_dir.mkdir(exist_ok=True)
        self.images_dir.mkdir(exist_ok=True)

    def _read_manifest(self) -> list[dict[str, Any]]:
        if not self.manifest_path.exists():
            return []
        try:
            data = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []
        entries = data.get("entries", []) if isinstance(data, dict) else []
        return [e for e in entries if isinstance(e, dict) and "id" in e]

    def _write_manifest(self, entries: list[dict[str, Any]]) -> None:
        payload = {"userId": self.user_id, "maxWindow": self.max_window, "entries": entries}
        tmp = self.manifest_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, self.manifest_path)

    @contextmanager
    def _locked(self, timeout_seconds: float = 5.0):
        """Best-effort cross-process lock for manifest writes."""
        self._ensure_dirs()
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                fd = os.open(self._lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
                break
            except FileExistsError:
                if time.monotonic() >= deadline:
                    raise RuntimeError(f"Could not acquire lock for {self.user_id}")
                time.sleep(0.05)
        try:
            yield
        finally:
            try:
                self._lock_path.unlink(missing_ok=True)  # type: ignore[arg-type]
            except TypeError:
                # Python < 3.8 compatibility (unused in 3.11 but defensive)
                if self._lock_path.exists():
                    self._lock_path.unlink()

    # ---- read API ----------------------------------------------------------
    def load_window(self) -> list[dict[str, Any]]:
        """Return entries ordered oldest→newest with `embedding` ndarray loaded."""
        entries = self._read_manifest()
        loaded: list[dict[str, Any]] = []
        for entry in sorted(entries, key=lambda e: e.get("ts", 0)):
            embedding_path = self.embeddings_dir / f"{entry['id']}.npy"
            if not embedding_path.exists():
                continue
            try:
                vec = np.load(embedding_path)
            except (OSError, ValueError):
                continue
            loaded.append({**entry, "embedding": vec})
        return loaded

    # ---- write API ---------------------------------------------------------
    def add_entry(
        self,
        embedding: np.ndarray,
        source_image_path: Path | None = None,
    ) -> dict[str, Any]:
        """Append a new entry and FIFO-evict the oldest until size <= max_window."""
        if embedding.size != EMBEDDING_DIM:
            raise ValueError(f"embedding must have {EMBEDDING_DIM} elements, got {embedding.size}")

        with self._locked():
            entries = self._read_manifest()

            entry_id = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
            entry: dict[str, Any] = {
                "id": entry_id,
                "ts": int(time.time() * 1000),
            }

            np.save(self.embeddings_dir / f"{entry_id}.npy", embedding.astype(np.float32))

            if source_image_path is not None and source_image_path.exists():
                ext = source_image_path.suffix.lower()
                if ext in SUPPORTED_IMAGE_EXTENSIONS:
                    image_target = self.images_dir / f"{entry_id}{ext}"
                    shutil.copy2(source_image_path, image_target)
                    entry["image"] = image_target.name

            entries.append(entry)
            entries.sort(key=lambda e: e.get("ts", 0))

            evicted: list[dict[str, Any]] = []
            while len(entries) > self.max_window:
                evicted.append(entries.pop(0))

            self._write_manifest(entries)

            for old in evicted:
                self._delete_artifacts(old)

            return {"added": entry, "evicted": evicted, "size": len(entries)}

    def _delete_artifacts(self, entry: dict[str, Any]) -> None:
        entry_id = entry.get("id")
        if not entry_id:
            return
        (self.embeddings_dir / f"{entry_id}.npy").unlink(missing_ok=True)
        image_name = entry.get("image")
        if image_name:
            (self.images_dir / image_name).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Verification (the modular function the user asked for)
# ---------------------------------------------------------------------------
def verify_with_window(
    probe_image_path: Path,
    user_id: str,
    references_root: Path,
    threshold: float = DEFAULT_THRESHOLD,
    max_window: int = DEFAULT_MAX_WINDOW,
    update_on_success: bool = True,
    device_preference: str = "auto",
) -> dict[str, Any]:
    """Verify `probe_image_path` against the user's sliding window.

    Returns a dict ready to JSON-encode:
        {
            "ok": bool,
            "matched": bool,
            "score": float | None,          # mean similarity, None if window empty
            "perReferenceScores": [...],     # one score per reference
            "windowSizeBefore": int,
            "windowSizeAfter": int,
            "threshold": float,
            "reason": str | None,
            "added": entry | None,
            "evicted": [entry...],
        }
    """
    store = FaceWindowStore(references_root, user_id, max_window=max_window)
    window = store.load_window()
    window_size_before = len(window)

    model = get_model(device_preference)
    probe_embedding = compute_embedding(probe_image_path, model)
    if probe_embedding is None:
        return {
            "ok": False,
            "matched": False,
            "score": None,
            "perReferenceScores": [],
            "windowSizeBefore": window_size_before,
            "windowSizeAfter": window_size_before,
            "threshold": threshold,
            "reason": "probe_face_not_detected",
            "added": None,
            "evicted": [],
        }

    if window_size_before == 0:
        # First enrollment path — no references to compare against.
        result_added = None
        result_evicted: list[dict[str, Any]] = []
        if update_on_success:
            outcome = store.add_entry(probe_embedding, probe_image_path)
            result_added = outcome["added"]
            result_evicted = outcome["evicted"]
        return {
            "ok": True,
            "matched": False,
            "score": None,
            "perReferenceScores": [],
            "windowSizeBefore": 0,
            "windowSizeAfter": 1 if result_added else 0,
            "threshold": threshold,
            "reason": "window_empty_bootstrapped" if result_added else "window_empty",
            "added": result_added,
            "evicted": result_evicted,
        }

    per_ref: list[dict[str, Any]] = []
    for entry in window:
        score = cosine_similarity(entry["embedding"], probe_embedding)
        per_ref.append({"id": entry["id"], "ts": entry["ts"], "score": round(score, 6)})

    mean_score = float(np.mean([item["score"] for item in per_ref]))
    matched = mean_score >= threshold

    added_entry: dict[str, Any] | None = None
    evicted_entries: list[dict[str, Any]] = []
    if matched and update_on_success:
        outcome = store.add_entry(probe_embedding, probe_image_path)
        added_entry = outcome["added"]
        evicted_entries = outcome["evicted"]
        window_size_after = outcome["size"]
    else:
        window_size_after = window_size_before

    return {
        "ok": True,
        "matched": matched,
        "score": round(mean_score, 6),
        "perReferenceScores": per_ref,
        "windowSizeBefore": window_size_before,
        "windowSizeAfter": window_size_after,
        "threshold": threshold,
        "reason": None if matched else "score_below_threshold",
        "added": added_entry,
        "evicted": evicted_entries,
    }


# ---------------------------------------------------------------------------
# CLI for ad-hoc testing
# ---------------------------------------------------------------------------
def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sliding-window face verification.")
    parser.add_argument("--probe", required=True, type=Path)
    parser.add_argument("--user-id", required=True)
    parser.add_argument(
        "--references-root",
        required=True,
        type=Path,
        help="Directory containing per-user reference subfolders.",
    )
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--max-window", type=int, default=DEFAULT_MAX_WINDOW)
    parser.add_argument(
        "--no-update",
        action="store_true",
        help="Do not write the probe into the window on success.",
    )
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("--json", action="store_true", help="Print JSON payload to stdout.")
    return parser.parse_args(list(argv) if argv is not None else None)


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        payload = verify_with_window(
            probe_image_path=args.probe,
            user_id=args.user_id,
            references_root=args.references_root,
            threshold=args.threshold,
            max_window=args.max_window,
            update_on_success=not args.no_update,
            device_preference=args.device,
        )
    except FileNotFoundError as exc:
        payload = {"ok": False, "matched": False, "reason": "file_not_found", "details": str(exc)}
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        payload = {"ok": False, "matched": False, "reason": "internal_error", "details": str(exc)}

    if args.json:
        print(json.dumps(payload, ensure_ascii=False))
    else:
        print(f"Matched: {payload.get('matched')} | Score: {payload.get('score')}")
        print(f"Window: {payload.get('windowSizeBefore')} → {payload.get('windowSizeAfter')}")
        if payload.get("perReferenceScores"):
            for ref in payload["perReferenceScores"]:
                print(f"  - {ref['id']}: {ref['score']}")
        if payload.get("reason"):
            print(f"Reason: {payload['reason']}")

    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
