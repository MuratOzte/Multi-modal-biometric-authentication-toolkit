import argparse
import gc
import json
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np
import torch
from facenet_pytorch import InceptionResnetV1, MTCNN
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
USER_REFERENCE_IMAGE_MAP: dict[str, list[str]] = {
    "emre": [
        "images/emre y\u00fcz 1.jpg",
        "images/emre y\u00fcz 2.jpg",
        "images/emre y\u00fcz 3.jpg",
        "images/emre karanl\u0131k %20.jpg",
        "images/emre karanl\u0131k %50.jpg",
        "images/emre karanl\u0131k %80.jpg",
        "images/emre simsiyah.jpg",
        "images/emre simsiyah 2.jpg",
    ],
    "murat": [
        "images/murat y\u00fcz.jpeg",
        "images/murat y\u00fcz 2.jpg",
    ],
    "mert": [
        "images/mert y\u00fcz.jpg",
    ],
}


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


def fail(reason: str, details: str | None = None, exit_code: int = 1) -> int:
    payload: dict[str, Any] = {
        "ok": False,
        "matched": False,
        "score": None,
        "reason": reason,
    }
    if details:
        payload["details"] = details
    emit(payload)
    return exit_code


def parse_bool_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default

    normalized = raw.strip().lower()
    if normalized in {"true", "1", "yes", "on"}:
        return True
    if normalized in {"false", "0", "no", "off"}:
        return False
    return default


def parse_device_env(name: str, default: str = "auto") -> str:
    raw = os.environ.get(name, default).strip().lower()
    return raw if raw in {"auto", "cuda", "cpu"} else default


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare two face images with FaceNet.")
    parser.add_argument("--worker", action="store_true", help="Run as a persistent JSONL worker.")
    reference_group = parser.add_mutually_exclusive_group(required=False)
    reference_group.add_argument(
        "--reference",
        help="Path to enrolled/reference face image.",
    )
    reference_group.add_argument(
        "--user-id",
        dest="user_id",
        choices=sorted(USER_REFERENCE_IMAGE_MAP.keys()),
        help="Use preconfigured sample reference images for this user id.",
    )
    parser.add_argument("--probe", help="Path to probe/selfie face image.")
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.80,
        help="Similarity threshold for match decision. Default: 0.80",
    )
    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "cpu"],
        default=parse_device_env("FACE_DEVICE"),
        help="Inference device. Default: FACE_DEVICE or auto.",
    )
    parser.add_argument(
        "--require-gpu",
        action="store_true",
        default=parse_bool_env("FACE_REQUIRE_GPU"),
        help="Fail instead of falling back to CPU when CUDA is unavailable.",
    )
    return parser.parse_args()


def select_initial_device(requested: str, require_gpu: bool) -> tuple[str, bool, str | None]:
    cuda_available = torch.cuda.is_available()
    if requested == "cpu":
        return "cpu", cuda_available, None
    if requested == "cuda":
        if cuda_available:
            return "cuda", cuda_available, None
        if require_gpu:
            return "cuda", cuda_available, "gpu_required"
        return "cpu", cuda_available, "cuda_requested_but_unavailable"
    if cuda_available:
        return "cuda", cuda_available, None
    if require_gpu:
        return "cuda", cuda_available, "gpu_required"
    return "cpu", cuda_available, "cuda_unavailable"


def build_runtime(device_name: str, cuda_available: bool, fallback_reason: str | None) -> dict[str, Any]:
    cuda_device_name = None
    if cuda_available and torch.cuda.device_count() > 0:
        cuda_device_name = torch.cuda.get_device_name(0)

    return {
        "device": device_name,
        "cudaAvailable": cuda_available,
        "cudaDeviceName": cuda_device_name,
        "fallbackReason": fallback_reason,
        "model": "facenet-pytorch/InceptionResnetV1(vggface2)",
    }


def is_cuda_oom(error: BaseException) -> bool:
    text = str(error).lower()
    return "cuda" in text and ("out of memory" in text or "cublas" in text)


def clear_cuda_cache() -> None:
    try:
        torch.cuda.empty_cache()
    except Exception:
        pass


class FaceModels:
    def __init__(self, requested_device: str, require_gpu: bool):
        self.requested_device = requested_device
        self.require_gpu = bool(require_gpu)
        self.device_name, self.cuda_available, self.fallback_reason = select_initial_device(
            requested_device,
            self.require_gpu,
        )
        self.device: torch.device | None = None
        self.mtcnn: MTCNN | None = None
        self.model: InceptionResnetV1 | None = None
        self.reference_cache: dict[tuple[str, int, int, str], np.ndarray | None] = {}

    def runtime(self) -> dict[str, Any]:
        return build_runtime(self.device_name, self.cuda_available, self.fallback_reason)

    def load(self) -> None:
        if self.fallback_reason == "gpu_required":
            raise RuntimeError("gpu_required")

        try:
            self._load_on_device(self.device_name)
        except RuntimeError as error:
            if self.device_name == "cuda" and not self.require_gpu and is_cuda_oom(error):
                self.fallback_to_cpu("cuda_oom_fallback_cpu")
                return
            raise

    def fallback_to_cpu(self, reason: str) -> None:
        self.mtcnn = None
        self.model = None
        self.device = None
        self.reference_cache.clear()
        gc.collect()
        clear_cuda_cache()
        self.device_name = "cpu"
        self.fallback_reason = reason
        self._load_on_device("cpu")

    def _load_on_device(self, device_name: str) -> None:
        self.device = torch.device("cuda:0" if device_name == "cuda" else "cpu")
        self.mtcnn = MTCNN(image_size=160, margin=20, device=self.device)
        self.model = InceptionResnetV1(pretrained="vggface2").eval().to(self.device)

    def get_embedding(self, path: Path) -> np.ndarray | None:
        if self.mtcnn is None or self.model is None or self.device is None:
            self.load()

        if self.mtcnn is None or self.model is None or self.device is None:
            raise RuntimeError("face models are not loaded")

        face = self.mtcnn(load_image(path))
        if face is None:
            return None

        face = face.unsqueeze(0).to(self.device)
        with torch.no_grad():
            embedding = self.model(face).cpu().numpy()
        return embedding

    def get_reference_embedding(self, path: Path) -> np.ndarray | None:
        if self._is_under_temp_dir(path):
            return self.get_embedding(path)

        stat = path.stat()
        key = (str(path.resolve()), int(stat.st_mtime_ns), int(stat.st_size), self.device_name)
        if key in self.reference_cache:
            return self.reference_cache[key]

        embedding = self.get_embedding(path)
        if len(self.reference_cache) >= 128:
            oldest_key = next(iter(self.reference_cache))
            self.reference_cache.pop(oldest_key, None)
        self.reference_cache[key] = embedding
        return embedding

    def verify(
        self,
        reference_paths: list[Path],
        probe_path: Path,
        threshold: float,
    ) -> dict[str, Any]:
        try:
            return self._verify_loaded(reference_paths, probe_path, threshold)
        except RuntimeError as error:
            if self.device_name == "cuda" and not self.require_gpu and is_cuda_oom(error):
                self.fallback_to_cpu("cuda_oom_fallback_cpu")
                return self._verify_loaded(reference_paths, probe_path, threshold)
            raise

    def _verify_loaded(
        self,
        reference_paths: list[Path],
        probe_path: Path,
        threshold: float,
    ) -> dict[str, Any]:
        runtime = self.runtime()
        reference_embeddings = []
        for reference_path in reference_paths:
            reference_embedding = self.get_reference_embedding(reference_path)
            if reference_embedding is not None:
                reference_embeddings.append(reference_embedding)

        if len(reference_embeddings) == 0:
            return {
                "ok": False,
                "matched": False,
                "score": None,
                "reason": "reference_face_not_detected",
                "runtime": runtime,
            }
        reference_embedding = np.mean(np.vstack(reference_embeddings), axis=0, keepdims=True)

        probe_embedding = self.get_embedding(probe_path)
        if probe_embedding is None:
            return {
                "ok": False,
                "matched": False,
                "score": None,
                "reason": "probe_face_not_detected",
                "runtime": runtime,
            }

        score = cosine_similarity_score(reference_embedding, probe_embedding)
        matched = score >= threshold

        return {
            "ok": True,
            "matched": matched,
            "score": round(score, 6),
            "reason": None,
            "runtime": runtime,
        }

    @staticmethod
    def _is_under_temp_dir(path: Path) -> bool:
        try:
            path.resolve().relative_to(Path(tempfile.gettempdir()).resolve())
            return True
        except ValueError:
            return False


def load_image(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def get_embedding(path: Path, mtcnn: MTCNN, model: InceptionResnetV1, device: torch.device):
    face = mtcnn(load_image(path))
    if face is None:
        return None

    face = face.unsqueeze(0).to(device)
    with torch.no_grad():
        embedding = model(face).cpu().numpy()
    return embedding


def validate_file(path_value: str, arg_name: str) -> Path:
    path = Path(path_value).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(f"{arg_name} file does not exist: {path}")
    if not path.is_file():
        raise ValueError(f"{arg_name} must point to a file: {path}")
    return path


def resolve_reference_paths(args: argparse.Namespace) -> list[Path]:
    if isinstance(args.reference, str) and args.reference.strip():
        return [validate_file(args.reference, "--reference")]

    if isinstance(args.user_id, str) and args.user_id.strip():
        relative_paths = USER_REFERENCE_IMAGE_MAP.get(args.user_id.lower())
        if not relative_paths:
            raise ValueError(f"--user-id is not supported: {args.user_id}")

        return [
            validate_file(str((SCRIPT_DIR / relative_path).resolve()), f"--user-id ({args.user_id})")
            for relative_path in relative_paths
        ]

    raise ValueError("Either --reference or --user-id must be provided.")


def cosine_similarity_score(reference_embedding: np.ndarray, probe_embedding: np.ndarray) -> float:
    reference_vector = reference_embedding.reshape(-1)
    probe_vector = probe_embedding.reshape(-1)
    denominator = float(np.linalg.norm(reference_vector) * np.linalg.norm(probe_vector))
    if denominator == 0:
        return 0.0
    return float(np.dot(reference_vector, probe_vector) / denominator)


def verify_on_device(
    reference_paths: list[Path],
    probe_path: Path,
    threshold: float,
    device_name: str,
    cuda_available: bool,
    fallback_reason: str | None,
) -> dict[str, Any]:
    runtime = build_runtime(device_name, cuda_available, fallback_reason)
    device = torch.device("cuda:0" if device_name == "cuda" else "cpu")
    mtcnn = MTCNN(image_size=160, margin=20, device=device)
    model = InceptionResnetV1(pretrained="vggface2").eval().to(device)

    reference_embeddings = []
    for reference_path in reference_paths:
        reference_embedding = get_embedding(reference_path, mtcnn, model, device)
        if reference_embedding is not None:
            reference_embeddings.append(reference_embedding)

    if len(reference_embeddings) == 0:
        return {
            "ok": False,
            "matched": False,
            "score": None,
            "reason": "reference_face_not_detected",
            "runtime": runtime,
        }
    reference_embedding = np.mean(np.vstack(reference_embeddings), axis=0, keepdims=True)

    probe_embedding = get_embedding(probe_path, mtcnn, model, device)
    if probe_embedding is None:
        return {
            "ok": False,
            "matched": False,
            "score": None,
            "reason": "probe_face_not_detected",
            "runtime": runtime,
        }

    score = cosine_similarity_score(reference_embedding, probe_embedding)
    matched = score >= threshold

    return {
        "ok": True,
        "matched": matched,
        "score": round(score, 6),
        "reason": None,
        "runtime": runtime,
    }


def parse_worker_threshold(value: Any) -> float:
    try:
        threshold = float(value)
    except (TypeError, ValueError):
        return 0.80
    return threshold


def handle_worker_request(models: FaceModels, payload: dict[str, Any]) -> dict[str, Any]:
    request_id = str(payload.get("id") or "")
    reference_image_path = str(payload.get("referenceImagePath") or "")
    probe_image_path = str(payload.get("probeImagePath") or "")
    threshold = parse_worker_threshold(payload.get("threshold", 0.80))

    if not request_id:
        return {}

    started = time.perf_counter()

    def with_runtime(response: dict[str, Any]) -> dict[str, Any]:
        response["id"] = request_id
        response["durationMs"] = round((time.perf_counter() - started) * 1000, 3)
        if "runtime" not in response:
            response["runtime"] = models.runtime()
        return response

    if not reference_image_path or not probe_image_path:
        return with_runtime(
            {
                "ok": False,
                "matched": False,
                "score": None,
                "reason": "invalid_request",
            }
        )

    if threshold < -1 or threshold > 1:
        return with_runtime(
            {
                "ok": False,
                "matched": False,
                "score": None,
                "reason": "invalid_threshold",
            }
        )

    try:
        reference_path = validate_file(reference_image_path, "referenceImagePath")
        probe_path = validate_file(probe_image_path, "probeImagePath")
    except FileNotFoundError as error:
        return with_runtime(
            {
                "ok": False,
                "matched": False,
                "score": None,
                "reason": "file_not_found",
                "details": str(error),
            }
        )
    except ValueError as error:
        return with_runtime(
            {
                "ok": False,
                "matched": False,
                "score": None,
                "reason": "invalid_request",
                "details": str(error),
            }
        )

    return with_runtime(models.verify([reference_path], probe_path, threshold))


def run_worker(args: argparse.Namespace) -> int:
    configure_standard_io()
    models = FaceModels(args.device, bool(args.require_gpu))

    try:
        models.load()
    except RuntimeError as error:
        reason = "gpu_required" if str(error) == "gpu_required" else "python_process_error"
        emit({"event": "ready", "ok": False, "runtime": models.runtime(), "reason": reason})
        return 1
    except Exception:
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        emit({"event": "ready", "ok": False, "runtime": models.runtime(), "reason": "python_process_error"})
        return 1

    emit({"event": "ready", "ok": True, "runtime": models.runtime()})

    for line in sys.stdin:
        stripped = line.strip()
        if not stripped:
            continue

        try:
            payload = json.loads(stripped)
            if not isinstance(payload, dict):
                continue
            response = handle_worker_request(models, payload)
            if response:
                emit(response)
        except Exception as error:
            request_id = ""
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, dict):
                    request_id = str(parsed.get("id") or "")
            except Exception:
                pass

            print(traceback.format_exc(), file=sys.stderr, flush=True)
            if request_id:
                emit(
                    {
                        "id": request_id,
                        "ok": False,
                        "matched": False,
                        "score": None,
                        "reason": "internal_error",
                        "details": str(error),
                        "runtime": models.runtime(),
                    }
                )

    return 0


def main() -> int:
    configure_standard_io()
    try:
        args = parse_args()
        if args.worker:
            return run_worker(args)

        if not args.probe or not (args.reference or args.user_id):
            return fail("invalid_request", "--probe and either --reference or --user-id are required.")

        reference_paths = resolve_reference_paths(args)
        probe_path = validate_file(args.probe, "--probe")
        threshold = float(args.threshold)
        if threshold < -1 or threshold > 1:
            return fail("invalid_threshold", "threshold must be between -1 and 1.")

        try:
            models = FaceModels(args.device, bool(args.require_gpu))
            models.load()
            result = models.verify(reference_paths, probe_path, threshold)
            emit(result)
            return 0 if result["ok"] else 1
        except RuntimeError as error:
            if str(error) == "gpu_required":
                runtime = build_runtime("cuda", torch.cuda.is_available(), "gpu_required")
                emit(
                    {
                        "ok": False,
                        "matched": False,
                        "score": None,
                        "reason": "gpu_required",
                        "runtime": runtime,
                    }
                )
                return 1
            raise
    except FileNotFoundError as error:
        return fail("file_not_found", str(error))
    except Exception as error:
        return fail("internal_error", str(error))


if __name__ == "__main__":
    raise SystemExit(main())
