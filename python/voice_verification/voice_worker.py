import argparse
import gc
import json
import os
import re
import shutil
import sys
import tempfile
import time
import traceback
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


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


configure_standard_io()

import numpy as np
import torch


def ensure_ffmpeg_on_path() -> None:
    if shutil.which("ffmpeg"):
        return

    try:
        import imageio_ffmpeg

        ffmpeg_exe = Path(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        return

    if not ffmpeg_exe.exists():
        return

    ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    try:
        shim_dir = Path(tempfile.gettempdir()) / "securekit-ffmpeg"
        shim_dir.mkdir(parents=True, exist_ok=True)
        shim_path = shim_dir / ffmpeg_name
        if not shim_path.exists() or shim_path.stat().st_size != ffmpeg_exe.stat().st_size:
            shutil.copy2(ffmpeg_exe, shim_path)
        path_entry = shim_dir
    except Exception:
        path_entry = ffmpeg_exe.parent

    os.environ["PATH"] = f"{path_entry}{os.pathsep}{os.environ.get('PATH', '')}"


ensure_ffmpeg_on_path()
import whisper

try:
    from speechbrain.inference.classifiers import EncoderClassifier
except ImportError:  # pragma: no cover - compatibility with older SpeechBrain releases.
    from speechbrain.pretrained import EncoderClassifier  # type: ignore

try:
    from speechbrain.utils.fetching import LocalStrategy
except Exception:  # pragma: no cover - older SpeechBrain releases may not expose it.
    LocalStrategy = None  # type: ignore


MIN_AUDIO_SECONDS = 1.0
TARGET_SAMPLE_RATE = 16000


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def normalize_text(value: str) -> str:
    lowered = value.casefold().replace("\u0131", "i")
    decomposed = unicodedata.normalize("NFKD", lowered)
    stripped_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    cleaned = re.sub(r"[^a-z0-9\s]", " ", stripped_marks)
    return re.sub(r"\s+", " ", cleaned).strip()


def transcript_similarity(expected: str, transcript: str) -> float:
    normalized_expected = normalize_text(expected)
    normalized_transcript = normalize_text(transcript)
    if not normalized_expected or not normalized_transcript:
        return 0.0
    if normalized_expected == normalized_transcript:
        return 1.0
    if normalized_expected in normalized_transcript or normalized_transcript in normalized_expected:
        shorter = min(len(normalized_expected), len(normalized_transcript))
        longer = max(len(normalized_expected), len(normalized_transcript))
        if longer > 0 and shorter / longer >= 0.72:
            return 0.96
    return float(SequenceMatcher(None, normalized_expected, normalized_transcript).ratio())


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


def is_cuda_oom(error: BaseException) -> bool:
    text = str(error).lower()
    return "cuda" in text and ("out of memory" in text or "cublas" in text)


class VoiceModels:
    def __init__(self, args: argparse.Namespace):
        self.requested_device = args.device
        self.require_gpu = bool(args.require_gpu)
        self.whisper_model_name = args.whisper_model
        self.speaker_model_name = args.speaker_model
        self.device, self.cuda_available, self.fallback_reason = select_initial_device(
            self.requested_device,
            self.require_gpu,
        )
        self.cuda_device_name = (
            torch.cuda.get_device_name(0) if self.cuda_available and torch.cuda.device_count() > 0 else None
        )
        self.whisper_model = None
        self.speaker_model = None

    def runtime(self) -> dict[str, Any]:
        return {
            "device": self.device,
            "cudaAvailable": self.cuda_available,
            "cudaDeviceName": self.cuda_device_name,
            "fallbackReason": self.fallback_reason,
            "whisperModel": self.whisper_model_name,
            "speakerModel": self.speaker_model_name,
        }

    def load(self) -> None:
        if self.fallback_reason == "gpu_required":
            raise RuntimeError("gpu_required")

        try:
            self._load_on_device(self.device)
            self._warmup()
        except RuntimeError as error:
            if self.device == "cuda" and not self.require_gpu and is_cuda_oom(error):
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
                self.fallback_to_cpu("cuda_oom_fallback_cpu")
                return
            raise

    def fallback_to_cpu(self, reason: str) -> None:
        self.whisper_model = None
        self.speaker_model = None
        gc.collect()
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass
        self.device = "cpu"
        self.fallback_reason = reason
        self._load_on_device(self.device)
        self._warmup()

    def _load_on_device(self, device: str) -> None:
        model_device = "cuda:0" if device == "cuda" else device
        self.whisper_model = whisper.load_model(self.whisper_model_name, device=device)
        speaker_kwargs = {
            "source": self.speaker_model_name,
            "savedir": str(Path("pretrained_models") / self.speaker_model_name.replace("/", "_")),
            "run_opts": {"device": model_device},
        }
        if LocalStrategy is not None:
            speaker_kwargs["local_strategy"] = LocalStrategy.COPY

        try:
            self.speaker_model = EncoderClassifier.from_hparams(**speaker_kwargs)
        except TypeError:
            speaker_kwargs.pop("local_strategy", None)
            self.speaker_model = EncoderClassifier.from_hparams(**speaker_kwargs)

    def _warmup(self) -> None:
        dummy = torch.zeros(1, TARGET_SAMPLE_RATE, device=self.device)
        with torch.no_grad():
            self.speaker_model.encode_batch(dummy)

    def transcribe(self, audio_path: str) -> str:
        try:
            result = self.whisper_model.transcribe(
                audio_path,
                language="tr",
                task="transcribe",
                fp16=self.device == "cuda",
                verbose=False,
            )
        except FileNotFoundError as error:
            raise RuntimeError("ffmpeg_missing") from error

        text = result.get("text", "")
        return text.strip() if isinstance(text, str) else ""

    def embed(self, audio_path: str) -> tuple[list[float] | None, str | None]:
        audio_file = Path(audio_path).expanduser().resolve()
        if not audio_file.exists() or not audio_file.is_file():
            return None, "file_not_found"

        audio = whisper.audio.load_audio(str(audio_file), sr=TARGET_SAMPLE_RATE)
        if audio.size == 0:
            return None, "audio_too_short"

        duration_seconds = audio.shape[0] / float(TARGET_SAMPLE_RATE)
        if duration_seconds < MIN_AUDIO_SECONDS:
            return None, "audio_too_short"

        signal = torch.from_numpy(audio).float().unsqueeze(0)
        signal = signal.to(self.device)
        with torch.no_grad():
            embedding = self.speaker_model.encode_batch(signal).detach().cpu().numpy().reshape(-1)

        if not np.isfinite(embedding).all():
            return None, "python_output_invalid"

        return embedding.astype(float).tolist(), None


def build_response(
    request_id: str,
    ok: bool,
    expected_text: str,
    transcript: str | None,
    transcript_threshold: float,
    transcript_score: float,
    transcript_matched: bool,
    embedding: list[float] | None,
    runtime: dict[str, Any],
    reason: str | None = None,
) -> dict[str, Any]:
    return {
        "id": request_id,
        "ok": ok,
        "embedding": embedding,
        "transcript": {
            "expectedText": expected_text,
            "transcript": transcript,
            "similarityScore": round(transcript_score, 6),
            "matched": transcript_matched,
            "threshold": transcript_threshold,
        },
        "runtime": runtime,
        "reason": reason,
    }


def handle_request(models: VoiceModels, payload: dict[str, Any]) -> dict[str, Any]:
    request_id = str(payload.get("id") or "")
    audio_path = str(payload.get("audioPath") or "")
    expected_text = str(payload.get("expectedText") or "")
    transcript_threshold = float(payload.get("transcriptThreshold") or 0.78)

    if not request_id:
        return {}
    if not audio_path or not expected_text:
        return build_response(
            request_id,
            False,
            expected_text,
            None,
            transcript_threshold,
            0.0,
            False,
            None,
            models.runtime(),
            "invalid_request",
        )

    started = time.perf_counter()
    try:
        transcript = models.transcribe(audio_path)
        transcript_score = transcript_similarity(expected_text, transcript)
        transcript_matched = transcript_score >= transcript_threshold
        embedding, reason = models.embed(audio_path)
    except RuntimeError as error:
        if str(error) == "ffmpeg_missing":
            runtime = models.runtime()
            runtime["durationMs"] = round((time.perf_counter() - started) * 1000, 3)
            return build_response(
                request_id,
                False,
                expected_text,
                None,
                transcript_threshold,
                0.0,
                False,
                None,
                runtime,
                "ffmpeg_missing",
            )

        if models.device == "cuda" and not models.require_gpu and is_cuda_oom(error):
            models.fallback_to_cpu("cuda_oom_fallback_cpu")
            transcript = models.transcribe(audio_path)
            transcript_score = transcript_similarity(expected_text, transcript)
            transcript_matched = transcript_score >= transcript_threshold
            embedding, reason = models.embed(audio_path)
        else:
            raise
    runtime = models.runtime()
    runtime["durationMs"] = round((time.perf_counter() - started) * 1000, 3)

    if reason:
        return build_response(
            request_id,
            False,
            expected_text,
            transcript,
            transcript_threshold,
            transcript_score,
            transcript_matched,
            None,
            runtime,
            reason,
        )

    return build_response(
        request_id,
        True,
        expected_text,
        transcript,
        transcript_threshold,
        transcript_score,
        transcript_matched,
        embedding,
        runtime,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Persistent SecureKit voice verification worker.")
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("--require-gpu", action="store_true")
    parser.add_argument("--whisper-model", default="base")
    parser.add_argument("--speaker-model", default="speechbrain/spkrec-ecapa-voxceleb")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    models = VoiceModels(args)

    try:
        models.load()
    except RuntimeError as error:
        reason = "gpu_required" if str(error) == "gpu_required" else "python_process_error"
        emit(
            {
                "event": "ready",
                "ok": False,
                "runtime": models.runtime(),
                "reason": reason,
            }
        )
        return 1
    except Exception as error:
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        emit(
            {
                "event": "ready",
                "ok": False,
                "runtime": models.runtime(),
                "reason": "python_process_error",
            }
        )
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
            response = handle_request(models, payload)
            if response:
                emit(response)
        except Exception:
            request_id = ""
            try:
                request_id = str(json.loads(stripped).get("id") or "")
            except Exception:
                pass
            print(traceback.format_exc(), file=sys.stderr, flush=True)
            if request_id:
                emit(
                    build_response(
                        request_id,
                        False,
                        "",
                        None,
                        0.78,
                        0.0,
                        False,
                        None,
                        models.runtime(),
                        "python_process_error",
                    )
                )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
