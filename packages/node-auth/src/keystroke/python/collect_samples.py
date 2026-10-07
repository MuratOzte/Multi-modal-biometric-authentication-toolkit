#!/usr/bin/env python3
import json
import math
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

try:
    from pynput import keyboard
except ImportError:  # pragma: no cover - runtime dependency check
    keyboard = None  # type: ignore[assignment]


TEXT_ID = "tr-medium-fixed-v1"
EXPECTED_TEXT = "securekit keeps login safer with typingg"
DEFAULT_SAMPLE_COUNT = 10
DATA_DIR = Path(__file__).resolve().parent / "data"


def _round_ms(value: float) -> float:
    return math.floor((float(value) * 1000.0) + 0.5) / 1000.0


def _normalize_key(key: object) -> Optional[str]:
    if keyboard is None:
        return None
    if key == keyboard.Key.space:
        return " "
    if isinstance(key, keyboard.KeyCode):
        value = key.char
        if isinstance(value, str) and len(value) == 1:
            return value
    return None


class AttemptRecorder:
    def __init__(self, expected_text: str) -> None:
        self.expected_chars = list(expected_text)
        self.perf_base_at_reset = time.perf_counter()
        self.epoch_base_at_reset = time.time() * 1000.0
        self.next_index = 0
        self.wrong_key_pressed = False

        self.down_times: List[Optional[float]] = [None] * len(self.expected_chars)
        self.up_times: List[Optional[float]] = [None] * len(self.expected_chars)
        self.down_indices_by_key: Dict[str, List[int]] = {}

    def on_press(self, key: object) -> Optional[bool]:
        char = _normalize_key(key)
        if char is None:
            return None

        if self.next_index >= len(self.expected_chars):
            self.wrong_key_pressed = True
            return False

        expected_char = self.expected_chars[self.next_index]
        if char != expected_char:
            self.wrong_key_pressed = True
            return False

        now = time.perf_counter()
        self.down_times[self.next_index] = now
        queue = self.down_indices_by_key.setdefault(char, [])
        queue.append(self.next_index)
        self.next_index += 1
        return None

    def on_release(self, key: object) -> Optional[bool]:
        char = _normalize_key(key)
        if char is None:
            return None

        queue = self.down_indices_by_key.get(char)
        if not queue:
            return None

        index = queue.pop(0)
        if self.up_times[index] is not None:
            return None

        self.up_times[index] = time.perf_counter()
        if self.is_complete():
            return False
        return None

    def is_complete(self) -> bool:
        if self.next_index != len(self.expected_chars):
            return False
        for index in range(len(self.expected_chars)):
            if self.down_times[index] is None or self.up_times[index] is None:
                return False
        return True

    def build_sample(self) -> Optional[dict]:
        if not self.is_complete():
            return None

        hold_ms: List[float] = []
        dd_ms: List[float] = []
        ud_ms: List[float] = []

        for index in range(len(self.expected_chars)):
            down = self.down_times[index]
            up = self.up_times[index]
            if down is None or up is None:
                return None

            hold_ms.append(_round_ms((up - down) * 1000.0))
            if index > 0:
                prev_down = self.down_times[index - 1]
                prev_up = self.up_times[index - 1]
                if prev_down is None or prev_up is None:
                    return None
                dd_ms.append(_round_ms((down - prev_down) * 1000.0))
                ud_ms.append(_round_ms((down - prev_up) * 1000.0))

        first_down = self.down_times[0]
        last_up = self.up_times[-1]
        if first_down is None or last_up is None:
            return None

        timestamp = int(round(self.epoch_base_at_reset + ((first_down - self.perf_base_at_reset) * 1000.0)))
        duration_ms = _round_ms((last_up - first_down) * 1000.0)

        return {
            "textId": TEXT_ID,
            "text": EXPECTED_TEXT,
            "holdMs": hold_ms,
            "ddMs": dd_ms,
            "udMs": ud_ms,
            "meta": {
                "timestamp": timestamp,
                "durationMs": duration_ms,
            },
        }


def _load_existing_samples(file_path: Path) -> List[dict]:
    if not file_path.exists():
        return []

    with file_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if not isinstance(payload, list):
        raise ValueError(f"Expected JSON array in {file_path}")

    samples: List[dict] = []
    for item in payload:
        if isinstance(item, dict):
            samples.append(item)
    return samples


def _save_samples(file_path: Path, samples: List[dict]) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = file_path.with_suffix(".json.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(samples, handle, indent=2)
    temp_path.replace(file_path)


def _prompt_participant_id() -> str:
    while True:
        participant_id = input("Participant ID: ").strip()
        if not participant_id:
            print("Participant ID cannot be empty.")
            continue
        if "/" in participant_id or "\\" in participant_id:
            print("Participant ID cannot contain path separators.")
            continue
        return participant_id


def _prompt_sample_count() -> int:
    while True:
        raw = input(f"How many samples to collect? [{DEFAULT_SAMPLE_COUNT}]: ").strip()
        if raw == "":
            return DEFAULT_SAMPLE_COUNT
        try:
            value = int(raw)
        except ValueError:
            print("Please enter a valid integer.")
            continue
        if value <= 0:
            print("Sample count must be positive.")
            continue
        return value


def _capture_single_attempt() -> Optional[dict]:
    if keyboard is None:
        raise RuntimeError("pynput is not installed. Run: pip install pynput")

    recorder = AttemptRecorder(EXPECTED_TEXT)
    with keyboard.Listener(on_press=recorder.on_press, on_release=recorder.on_release) as listener:
        listener.join()

    if recorder.wrong_key_pressed:
        return None
    return recorder.build_sample()


def main() -> int:
    if keyboard is None:
        print("Missing dependency: pynput. Install with: pip install pynput", file=sys.stderr)
        return 1

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    participant_id = _prompt_participant_id()
    requested_samples = _prompt_sample_count()

    file_path = DATA_DIR / f"{participant_id}.json"
    try:
        existing_samples = _load_existing_samples(file_path)
    except Exception as error:
        print(f"Failed to read existing samples: {error}", file=sys.stderr)
        return 1

    new_samples: List[dict] = []
    interrupted = False

    print("\nType this text exactly for each sample:")
    print(f'"{EXPECTED_TEXT}"\n')

    while len(new_samples) < requested_samples:
        sample_index = len(new_samples) + 1
        print(f"Sample {sample_index}/{requested_samples}: start typing...")
        try:
            sample = _capture_single_attempt()
        except KeyboardInterrupt:
            interrupted = True
            print("\nInterrupted. Saving collected samples...")
            break
        except Exception as error:
            interrupted = True
            print(f"\nCapture failed: {error}", file=sys.stderr)
            break

        if sample is None:
            print("Wrong key! Resetting...")
            continue

        new_samples.append(sample)
        remaining = requested_samples - len(new_samples)
        print(f"Sample {len(new_samples)} collected. ({remaining} remaining)")

    all_samples = existing_samples + new_samples
    try:
        _save_samples(file_path, all_samples)
    except Exception as error:
        print(f"Failed to save samples: {error}", file=sys.stderr)
        return 1

    print("\nSummary")
    print(f"Participant ID: {participant_id}")
    print(f"Total samples in file: {len(all_samples)}")
    if interrupted:
        print("Collection stopped early due to interrupt.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
