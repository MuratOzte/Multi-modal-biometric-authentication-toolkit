from __future__ import annotations

import argparse
import copy
import contextlib
import dataclasses
import glob
import importlib
import itertools
import json
import math
import os
import re
import site
import sys
import unicodedata
from pathlib import Path
from typing import Any, Callable, Iterable

import cv2
import numpy as np
import yaml

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

try:
    from rapidfuzz import fuzz
except Exception:  # pragma: no cover - fallback only used when rapidfuzz is absent
    fuzz = None

DEFAULT_CONFIG: dict[str, Any] = {
    "preprocess": {
        "output_width": 856,
        "output_height": 540,
        "detection_max_side": 1200,
        "target_aspect": 1.586,
        "min_area_fraction": 0.025,
        "max_area_fraction": 0.92,
    },
    "ocr": {
        "enabled": True,
        "lang": "tr",
        "device": "gpu:0",
        "fallback_device": "cpu",
        "ocr_version": "PP-OCRv5",
        "use_textline_orientation": True,
        "suppress_logs": True,
    },
    "visual": {
        "clip": {
            "enabled": True,
            "model": "ViT-B-32",
            "pretrained": "laion2b_s34b_b79k",
            "device": "auto",
        },
    },
    "scoring": {
        "content_weight": 0.65,
        "visual_weight": 0.35,
        "same_content_min": 80,
        "same_visual_min": 50,
        "same_overall_min": 75,
        "strong_content_min": 94,
        "strong_content_visual_min": 5,
        "strong_content_overall_floor": 85,
        "different_overall_max": 60,
        "digit_conflict_max_similarity": 85,
        "name_conflict_max_similarity": 58,
    },
}


TURKISH_TRANSLATION = str.maketrans(
    {
        "ç": "c",
        "Ç": "C",
        "ğ": "g",
        "Ğ": "G",
        "ı": "i",
        "I": "I",
        "İ": "I",
        "ö": "o",
        "Ö": "O",
        "ş": "s",
        "Ş": "S",
        "ü": "u",
        "Ü": "U",
    }
)


STOP_TOKENS = {
    "KTU",
    "KARADENIZ",
    "TECHNICAL",
    "TEKNIK",
    "UNIVERSITE",
    "UNIVERSITY",
    "UNIVERSITESI",
    "LISANS",
    "OGRENCI",
    "OGRENCISI",
    "STUDENT",
    "FACULTY",
    "ENGINEERING",
    "MUHENDISLIK",
    "BILGISAYAR",
    "COMPUTER",
    "KAMPUS",
    "KAMPUSKART",
    "VAKIFBANK",
    "LIKECARD",
    "VALID",
    "THRU",
    "UNTIL",
    "EXPIRES",
    "EXPIRY",
    "KIMLIK",
    "IDENTITY",
    "DOCUMENT",
    "DOC",
    "CARD",
    "NUMBER",
    "NUMARA",
    "NO",
    "DATE",
    "BIRTH",
    "DOB",
    "REPUBLIC",
    "NATIONAL",
    "SCHOOL",
    "COLLEGE",
    "DEPARTMENT",
    "EMPLOYEE",
    "STAFF",
    "MEMBER",
    "WWW",
    "COM",
}


INSTITUTION_KEYWORDS = {
    "UNIVERSITE",
    "UNIVERSITESI",
    "UNIVERSITY",
    "UNIVERSIEES",
    "TECHNICAL",
    "TEKNIK",
    "FACULTY",
    "FAKULTESI",
    "ENGINEERING",
    "MUHENDISLIK",
    "SCHOOL",
    "COLLEGE",
    "INSTITUTE",
    "DEPARTMENT",
    "REPUBLIC",
    "MINISTRY",
    "GOVERNMENT",
    "NATIONAL",
}


INSTITUTION_PHRASES = [
    "KARADENIZ TEKNIK UNIVERSITESI",
    "KARADENIZ TECHNICAL UNIVERSITY",
    "FACULTY OF ENGINEERING",
    "MUHENDISLIK FAKULTESI",
    "BILGISAYAR MUHENDISLIGI",
    "COMPUTER ENGINEERING",
]


_DLL_DIRECTORY_HANDLES: list[Any] = []


def add_windows_nvidia_dll_dirs() -> list[str]:
    if os.name != "nt":
        return []

    site_dirs: list[str] = []
    try:
        site_dirs.extend(site.getsitepackages())
    except Exception:
        pass
    try:
        site_dirs.append(site.getusersitepackages())
    except Exception:
        pass

    dll_dirs: list[Path] = []
    for site_dir in site_dirs:
        nvidia_root = Path(site_dir) / "nvidia"
        if not nvidia_root.exists():
            continue
        for dll_path in nvidia_root.rglob("*.dll"):
            if dll_path.parent not in dll_dirs:
                dll_dirs.append(dll_path.parent)

    added: list[str] = []
    for dll_dir in dll_dirs:
        dll_dir_str = str(dll_dir)
        if dll_dir_str not in os.environ.get("PATH", ""):
            os.environ["PATH"] = dll_dir_str + os.pathsep + os.environ.get("PATH", "")
        try:
            handle = os.add_dll_directory(dll_dir_str)
            _DLL_DIRECTORY_HANDLES.append(handle)
        except (AttributeError, FileNotFoundError, OSError):
            pass
        added.append(dll_dir_str)
    return added


class suppress_native_output(contextlib.AbstractContextManager):
    def __init__(self, enabled: bool = True):
        self.enabled = enabled
        self._saved_fds: tuple[int, int] | None = None
        self._devnull: Any | None = None

    def __enter__(self) -> "suppress_native_output":
        if not self.enabled:
            return self
        sys.stdout.flush()
        sys.stderr.flush()
        self._saved_fds = (os.dup(1), os.dup(2))
        self._devnull = open(os.devnull, "w", encoding="utf-8")
        os.dup2(self._devnull.fileno(), 1)
        os.dup2(self._devnull.fileno(), 2)
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> bool:
        if self.enabled and self._saved_fds is not None:
            sys.stdout.flush()
            sys.stderr.flush()
            os.dup2(self._saved_fds[0], 1)
            os.dup2(self._saved_fds[1], 2)
            os.close(self._saved_fds[0])
            os.close(self._saved_fds[1])
            if self._devnull is not None:
                self._devnull.close()
        return False


@dataclasses.dataclass
class OCRLine:
    text: str
    confidence: float | None = None


@dataclasses.dataclass
class CardAnalysis:
    source: str
    normalized_image: np.ndarray
    card_detected: bool
    detection_confidence: float
    crop_path: str | None
    ocr_lines: list[OCRLine]
    fields: dict[str, str]
    field_confidence: dict[str, float]
    normalized_text: str
    quality: dict[str, Any]


def deep_merge(base: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(path: Path | None) -> dict[str, Any]:
    config = copy.deepcopy(DEFAULT_CONFIG)
    if path and path.exists():
        with path.open("r", encoding="utf-8") as fh:
            loaded = yaml.safe_load(fh) or {}
        config = deep_merge(config, loaded)
    return config


def read_image(path: Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Image could not be read: {path}")
    return image


def write_image(path: Path, image: np.ndarray) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, encoded = cv2.imencode(path.suffix or ".jpg", image)
    if not ok:
        raise ValueError(f"Image could not be written: {path}")
    path.write_bytes(encoded.tobytes())
    return str(path)


def clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return float(max(minimum, min(maximum, value)))


def resize_to_max_side(image: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    scale = min(1.0, max_side / float(max(height, width)))
    if scale == 1.0:
        return image.copy(), 1.0
    resized = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
    return resized, scale


def order_points(points: np.ndarray) -> np.ndarray:
    pts = points.astype("float32").reshape(4, 2)
    ordered = np.zeros((4, 2), dtype="float32")
    point_sum = pts.sum(axis=1)
    point_diff = np.diff(pts, axis=1).reshape(-1)
    ordered[0] = pts[np.argmin(point_sum)]
    ordered[2] = pts[np.argmax(point_sum)]
    ordered[1] = pts[np.argmin(point_diff)]
    ordered[3] = pts[np.argmax(point_diff)]
    return ordered


def distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def landscape_points(points: np.ndarray) -> np.ndarray:
    ordered = order_points(points)
    width = max(distance(ordered[1], ordered[0]), distance(ordered[2], ordered[3]))
    height = max(distance(ordered[3], ordered[0]), distance(ordered[2], ordered[1]))
    if height > width:
        # Rotate the quadrilateral mapping so the physical long edge becomes horizontal.
        ordered = np.array([ordered[3], ordered[0], ordered[1], ordered[2]], dtype="float32")
    return ordered


def four_point_transform(image: np.ndarray, points: np.ndarray, output_size: tuple[int, int]) -> np.ndarray:
    width, height = output_size
    rect = landscape_points(points)
    destination = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, destination)
    return cv2.warpPerspective(image, matrix, (width, height))


def expand_points(points: np.ndarray, factor: float) -> np.ndarray:
    ordered = landscape_points(points)
    center = ordered.mean(axis=0)
    return center + (ordered - center) * float(factor)


def yellow_stripe_score(image: np.ndarray, y0: int, y1: int) -> float:
    stripe = image[y0:y1, :]
    if stripe.size == 0:
        return 0.0
    hsv = cv2.cvtColor(stripe, cv2.COLOR_BGR2HSV)
    yellow = cv2.inRange(hsv, np.array([12, 45, 80]), np.array([45, 255, 255]))
    return float(np.count_nonzero(yellow)) / float(yellow.size)


def orient_by_yellow_stripe(image: np.ndarray) -> np.ndarray:
    height = image.shape[0]
    top = yellow_stripe_score(image, 0, int(height * 0.35))
    bottom = yellow_stripe_score(image, int(height * 0.65), height)
    if top > bottom * 1.25 and top > 0.01:
        return cv2.rotate(image, cv2.ROTATE_180)
    return image


def contour_candidates(mask: np.ndarray, method: str, cfg: dict[str, Any]) -> list[tuple[float, np.ndarray, str]]:
    height, width = mask.shape[:2]
    image_area = float(height * width)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[tuple[float, np.ndarray, str]] = []
    target_aspect = float(cfg["preprocess"]["target_aspect"])
    min_area = float(cfg["preprocess"]["min_area_fraction"]) * image_area
    max_area = float(cfg["preprocess"]["max_area_fraction"]) * image_area

    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < min_area or area > max_area:
            continue

        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(approx) == 4:
            points = approx.reshape(4, 2).astype("float32")
        else:
            rect = cv2.minAreaRect(contour)
            points = cv2.boxPoints(rect).astype("float32")

        ordered = landscape_points(points)
        edge_width = max(distance(ordered[1], ordered[0]), distance(ordered[2], ordered[3]))
        edge_height = max(distance(ordered[3], ordered[0]), distance(ordered[2], ordered[1]))
        if edge_height <= 1:
            continue
        aspect = edge_width / edge_height
        if not 1.12 <= aspect <= 2.15:
            continue

        rect_area = max(1.0, edge_width * edge_height)
        rectangularity = clamp(area / rect_area, 0.0, 1.0)
        aspect_score = clamp(100.0 - abs(aspect - target_aspect) * 85.0)
        area_score = clamp((area / image_area) * 160.0)

        x, y, w, h = cv2.boundingRect(points.astype("int32"))
        touches_border = x <= 2 or y <= 2 or (x + w) >= width - 2 or (y + h) >= height - 2
        if touches_border and (area / image_area) > 0.42:
            continue
        border_factor = 0.48 if touches_border else 1.0

        score = border_factor * (0.52 * aspect_score + 28.0 * rectangularity + 0.20 * area_score)
        candidates.append((score, points, method))
    return candidates


def yellow_stripe_inferred_candidates(mask: np.ndarray, cfg: dict[str, Any]) -> list[tuple[float, np.ndarray, str]]:
    height, width = mask.shape[:2]
    image_area = float(height * width)
    target_aspect = float(cfg["preprocess"]["target_aspect"])
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates: list[tuple[float, np.ndarray, str]] = []

    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < 0.003 * image_area:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        stripe_aspect = w / max(1, h)
        if stripe_aspect < 4.0 or w < 0.24 * width or y < 0.42 * height:
            continue

        card_width = min(width * 0.98, w * 1.12)
        card_height = card_width / target_aspect
        center_x = x + w / 2.0
        bottom_y = min(height - 1.0, y + h + 0.12 * card_height)
        top_y = bottom_y - card_height
        left_x = center_x - card_width / 2.0
        right_x = center_x + card_width / 2.0

        points = np.array(
            [[left_x, top_y], [right_x, top_y], [right_x, bottom_y], [left_x, bottom_y]],
            dtype="float32",
        )
        score = 48.0 + clamp((w / width) * 42.0, 0.0, 28.0) + clamp(stripe_aspect * 1.2, 0.0, 12.0)
        candidates.append((score, points, "yellow_stripe_inferred"))
    return candidates


def detect_card_quad(image: np.ndarray, config: dict[str, Any]) -> tuple[np.ndarray | None, float, str]:
    small, scale = resize_to_max_side(image, int(config["preprocess"]["detection_max_side"]))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB)
    lab_l, lab_a, lab_b = cv2.split(lab)

    white_mask = cv2.inRange(hsv, np.array([0, 0, 125]), np.array([179, 85, 255]))
    white_mask = cv2.morphologyEx(white_mask, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    white_mask = cv2.morphologyEx(white_mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    neutral_mask = (
        (lab_l > 115)
        & (np.abs(lab_a.astype("int16") - 128) < 8)
        & (np.abs(lab_b.astype("int16") - 128) < 12)
    ).astype("uint8") * 255
    neutral_mask = cv2.morphologyEx(neutral_mask, cv2.MORPH_CLOSE, np.ones((13, 13), np.uint8))
    neutral_mask = cv2.morphologyEx(neutral_mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    yellow_mask = cv2.inRange(hsv, np.array([12, 45, 75]), np.array([45, 255, 255]))
    card_color_mask = cv2.bitwise_or(white_mask, yellow_mask)
    card_color_mask = cv2.morphologyEx(card_color_mask, cv2.MORPH_CLOSE, np.ones((17, 17), np.uint8))
    card_color_mask = cv2.morphologyEx(card_color_mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    edges = cv2.Canny(blurred, 45, 150)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=1)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))

    adaptive = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        3,
    )
    adaptive = cv2.morphologyEx(adaptive, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))

    candidates: list[tuple[float, np.ndarray, str]] = []
    candidates.extend(contour_candidates(neutral_mask, "lab_neutral_card_body", config))
    candidates.extend(contour_candidates(card_color_mask, "white_yellow_card_body", config))
    candidates.extend(contour_candidates(white_mask, "low_saturation_card_body", config))
    candidates.extend(contour_candidates(edges, "edge_rectangle", config))
    candidates.extend(contour_candidates(adaptive, "adaptive_rectangle", config))
    candidates.extend(yellow_stripe_inferred_candidates(yellow_mask, config))

    if not candidates:
        return None, 0.0, "not_found"

    score, points, method = max(candidates, key=lambda item: item[0])
    confidence = clamp(score)
    if scale != 1.0:
        points = points / scale
    return points.astype("float32"), confidence, method


def fallback_normalized_crop(image: np.ndarray, config: dict[str, Any]) -> np.ndarray:
    output_size = (int(config["preprocess"]["output_width"]), int(config["preprocess"]["output_height"]))
    height, width = image.shape[:2]
    target_ratio = output_size[0] / output_size[1]
    current_ratio = width / max(1, height)
    if current_ratio > target_ratio:
        new_width = int(height * target_ratio)
        x0 = max(0, (width - new_width) // 2)
        crop = image[:, x0 : x0 + new_width]
    else:
        new_height = int(width / target_ratio)
        y0 = max(0, (height - new_height) // 2)
        crop = image[y0 : y0 + new_height, :]
    return cv2.resize(crop, output_size, interpolation=cv2.INTER_AREA)


def normalize_card_image(image: np.ndarray, config: dict[str, Any]) -> tuple[np.ndarray, dict[str, Any]]:
    output_size = (int(config["preprocess"]["output_width"]), int(config["preprocess"]["output_height"]))
    quad, confidence, method = detect_card_quad(image, config)
    if quad is None:
        normalized = fallback_normalized_crop(image, config)
        return orient_by_yellow_stripe(normalized), {
            "card_detected": False,
            "detection_confidence": 0.0,
            "detection_method": method,
            "quad": None,
        }

    expand_factor = 1.12 if method == "lab_neutral_card_body" else 1.035
    normalized = four_point_transform(image, expand_points(quad, expand_factor), output_size)
    normalized = orient_by_yellow_stripe(normalized)
    return normalized, {
        "card_detected": confidence >= 35,
        "detection_confidence": round(confidence, 2),
        "detection_method": method,
        "quad": [[round(float(x), 2), round(float(y), 2)] for x, y in quad],
    }


def draw_quad(image: np.ndarray, quad: list[list[float]] | None) -> np.ndarray:
    debug = image.copy()
    if not quad:
        return debug
    points = np.array(quad, dtype=np.int32).reshape(-1, 1, 2)
    cv2.polylines(debug, [points], True, (0, 255, 0), 4)
    return debug


def simplify_text(text: str) -> str:
    text = text.translate(TURKISH_TRANSLATION)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.upper()
    text = re.sub(r"[^A-Z0-9/ ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def digitish(text: str) -> str:
    table = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "S": "5", "s": "5"})
    return text.translate(table)


def digits_only(text: str) -> str:
    return re.sub(r"\D+", "", digitish(text))


def alnum_only(text: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", simplify_text(text))


def fuzzy_ratio(a: str, b: str) -> float:
    a = simplify_text(a)
    b = simplify_text(b)
    if not a or not b:
        return 0.0
    if fuzz is not None:
        return float(fuzz.ratio(a, b))
    return 100.0 * sequence_ratio(a, b)


def token_ratio(a: str, b: str) -> float:
    a = simplify_text(a)
    b = simplify_text(b)
    if not a or not b:
        return 0.0
    if fuzz is not None:
        return float(fuzz.token_set_ratio(a, b))
    return 100.0 * sequence_ratio(" ".join(sorted(a.split())), " ".join(sorted(b.split())))


def sequence_ratio(a: str, b: str) -> float:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, a, b).ratio()


def has_fuzzy_keyword(tokens: list[str], keywords: Iterable[str], threshold: float = 78.0) -> bool:
    for token in tokens:
        for keyword in keywords:
            if token == keyword or fuzzy_ratio(token, keyword) >= threshold:
                return True
    return False


def strip_labeled_prefix(line: str, labels: Iterable[str]) -> tuple[str, bool]:
    simplified = simplify_text(line)
    for label in labels:
        label_text = simplify_text(label)
        pattern = rf"^(?:{re.escape(label_text)})(?:\s+NO|\s+NUMBER)?\s*"
        stripped = re.sub(pattern, "", simplified, count=1).strip()
        if stripped != simplified:
            return stripped, True
    return simplified, False


def extract_card_number(text: str) -> str:
    candidates: list[tuple[float, str]] = []
    lines = [line for line in re.split(r"[\r\n]+", text) if line.strip()]
    search_units = lines + [text]

    for unit_index, unit in enumerate(search_units):
        normalized = digitish(unit)
        groups = re.findall(r"\d[\d\s.-]{10,}\d", normalized)
        for group in groups:
            compact = re.sub(r"\D+", "", group)
            if len(compact) < 16:
                continue
            windows = [compact[i : i + 16] for i in range(0, len(compact) - 15)]
            for window in windows:
                if len(window) != 16:
                    continue
                score = 10.0
                if unit_index < len(lines):
                    score += 25.0
                if window.startswith("5400"):
                    score += 30.0
                if "/" in unit or "VALID" in simplify_text(unit):
                    score += 8.0
                if window.startswith("1955"):
                    score -= 40.0
                candidates.append((score, window))

    if not candidates:
        return ""
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def extract_student_number(text: str, card_number: str) -> tuple[str, float]:
    normalized = simplify_text(text)
    label_patterns = [
        r"(?:STUDENT\s*(?:NO|NUMBER|ID)|OGRENCI\s*(?:NO|NUMARA)|OGRENCI\s*NO\s*STUDENT\s*NO)\D{0,30}([0-9OIlS\s]{7,18})",
        r"(?:NO\s*/\s*STUDENT\s*NO)\D{0,30}([0-9OIlS\s]{7,18})",
    ]
    for pattern in label_patterns:
        match = re.search(pattern, normalized)
        if match:
            digits = digits_only(match.group(1))
            if 7 <= len(digits) <= 12 and digits not in card_number:
                return digits, 0.95

    candidates = []
    compact = digitish(normalized.replace(" ", ""))
    for match in re.finditer(r"(?<!\d)[0OIlS][0OIlS\d]{6,11}(?!\d)", compact):
        digits = digits_only(match.group(0))
        if 7 <= len(digits) <= 12 and digits not in card_number:
            candidates.append(digits)
    return (candidates[0], 0.62) if candidates else ("", 0.0)


def normalize_year(value: str) -> str:
    return value[-2:]


def parse_valid_date(fragment: str, allow_day_first: bool = True) -> str:
    normalized = digitish(simplify_text(fragment))
    separator = r"(?:\s*/\s*|\s+)"
    if allow_day_first:
        for match in re.finditer(
            rf"(?<!\d)([0-3]?\d){separator}(0?[1-9]|1[0-2]){separator}(\d{{2,4}})(?!\d)",
            normalized,
        ):
            day = int(match.group(1))
            if 1 <= day <= 31:
                return f"{int(match.group(2)):02d}/{normalize_year(match.group(3))}"
        for match in re.finditer(
            rf"(?<!\d)(19\d{{2}}|20\d{{2}}){separator}(0?[1-9]|1[0-2]){separator}([0-3]?\d)(?!\d)",
            normalized,
        ):
            day = int(match.group(3))
            if 1 <= day <= 31:
                return f"{int(match.group(2)):02d}/{normalize_year(match.group(1))}"
    for match in re.finditer(r"(?<!\d)(0[1-9]|1[0-2])\s*/\s*(\d{2,4})(?!\d)", normalized):
        return f"{match.group(1)}/{normalize_year(match.group(2))}"
    return ""


def extract_valid_thru(text: str) -> tuple[str, float]:
    normalized = simplify_text(text)
    label_pattern = (
        r"(?:VALID\s*(?:THRU|THROUGH|UNTIL|TO)|EXPIRES|EXPIRY|EXP\s*DATE|"
        r"SON\s*GECERLILIK|GECERLILIK)"
    )
    for match in re.finditer(label_pattern, normalized):
        value = parse_valid_date(normalized[match.end() : match.end() + 50])
        if value:
            return value, 0.95

    value = parse_valid_date(normalized, allow_day_first=False)
    if value:
        return value, 0.76

    value = parse_valid_date(normalized, allow_day_first=True)
    if value:
        return value, 0.58

    return "", 0.0


def extract_document_number(text: str, card_number: str, student_number: str) -> tuple[str, float]:
    normalized = simplify_text(text)
    units = [simplify_text(line) for line in re.split(r"[\r\n]+", text) if line.strip()] + [normalized]
    label_patterns = [
        r"(?:DOCUMENT\s*(?:NO|NUMBER)|DOC\s*(?:NO|NUMBER)|ID\s*(?:NO|NUMBER)|IDENTITY\s*(?:NO|NUMBER)|"
        r"KIMLIK\s*(?:NO|NUMARA)|TCKN|TC\s*KIMLIK\s*NO|NATIONAL\s*ID|PERSONAL\s*NO)[^A-Z0-9]{0,30}([A-Z0-9\s-]{5,22})",
    ]
    excluded = {card_number, student_number}
    for unit in units:
        for pattern in label_patterns:
            match = re.search(pattern, unit)
            if not match:
                continue
            value = alnum_only(match.group(1))
            digits = digits_only(value)
            candidate = digits if value == digits and len(digits) >= 6 else value
            if 6 <= len(candidate) <= 16 and candidate not in excluded:
                return candidate, 0.94

    candidates: list[str] = []
    for match in re.finditer(r"(?<![A-Z0-9])[A-Z]{1,3}\d[A-Z0-9]{5,14}(?![A-Z0-9])", normalized.replace(" ", "")):
        candidate = alnum_only(match.group(0))
        if 6 <= len(candidate) <= 16 and candidate not in excluded:
            candidates.append(candidate)
    return (candidates[0], 0.55) if candidates else ("", 0.0)


NAME_LABELS = [
    "FULL NAME",
    "NAME SURNAME",
    "NAME",
    "SURNAME NAME",
    "AD SOYAD",
    "ADI SOYADI",
    "ISIM SOYISIM",
    "CARDHOLDER NAME",
    "HOLDER NAME",
    "STUDENT NAME",
    "EMPLOYEE NAME",
    "MEMBER NAME",
]


def clean_name_line(line: str) -> str:
    normalized = simplify_text(line)
    normalized = re.sub(r"\d+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def is_institution_or_header_line(line: str) -> bool:
    normalized = simplify_text(line)
    if not normalized:
        return True
    tokens = normalized.split()
    if any(token in STOP_TOKENS for token in tokens):
        return True
    if has_fuzzy_keyword(tokens, INSTITUTION_KEYWORDS):
        return True
    if any(token_ratio(normalized, phrase) >= 56 for phrase in INSTITUTION_PHRASES):
        return True
    stopish = sum(1 for token in tokens if has_fuzzy_keyword([token], STOP_TOKENS, 84.0))
    return len(tokens) >= 2 and stopish / len(tokens) >= 0.5


def score_name_candidate(line: str, ocr_line: OCRLine, index: int, lines: list[OCRLine], previous_line: str) -> tuple[str, float, float] | None:
    stripped, has_label = strip_labeled_prefix(line, NAME_LABELS)
    stripped = clean_name_line(stripped)
    if not stripped or is_institution_or_header_line(stripped):
        return None

    tokens = [token for token in stripped.split() if len(token) >= 2]
    if len(tokens) < 2 or len(tokens) > 5:
        return None
    if any(len(token) > 18 for token in tokens):
        return None
    if any(token in STOP_TOKENS for token in tokens):
        return None

    score = 10.0 * len(tokens) + sum(len(token) for token in tokens)
    context = " ".join(
        simplify_text(lines[i].text)
        for i in range(max(0, index - 2), min(len(lines), index + 1))
    )
    if has_label:
        score += 42.0
    if "LISANS" in context or "OGRENCI" in context or "STUDENT" in context:
        score += 35.0
    if previous_line and (
        "LISANS" in previous_line
        or "OGRENCI" in previous_line
        or "STUDENT" in previous_line
        or any(label in previous_line for label in ("NAME", "SOYAD", "ADI SOYADI"))
    ):
        score += 20.0
    if ocr_line.confidence is not None:
        score += clamp(float(ocr_line.confidence) * 10.0, 0.0, 10.0)

    confidence = clamp(score / 105.0, 0.0, 1.0)
    return " ".join(tokens), score, confidence


def extract_name_with_confidence(lines: list[OCRLine]) -> tuple[str, float]:
    best_name = ""
    best_score = -1.0
    best_confidence = 0.0
    previous_line = ""

    for index, ocr_line in enumerate(lines):
        line = clean_name_line(ocr_line.text)
        candidate = score_name_candidate(line, ocr_line, index, lines, previous_line)
        if candidate and candidate[1] > best_score:
            name, score, confidence = candidate
            best_score = score
            best_name = name
            best_confidence = confidence

        previous_line = simplify_text(ocr_line.text)

    return best_name, best_confidence


def extract_name(lines: list[OCRLine]) -> str:
    return extract_name_with_confidence(lines)[0]


def extract_fields(lines: list[OCRLine]) -> tuple[dict[str, str], str, dict[str, float]]:
    raw_text = "\n".join(line.text for line in lines)
    normalized_text = simplify_text(raw_text)
    card_number = extract_card_number(raw_text)
    student_number, student_confidence = extract_student_number(raw_text, card_number)
    document_number, document_confidence = extract_document_number(raw_text, card_number, student_number)
    valid_thru, valid_confidence = extract_valid_thru(raw_text)
    name, name_confidence = extract_name_with_confidence(lines)
    fields = {
        "name": name,
        "student_no": student_number,
        "document_no": document_number,
        "card_no": card_number,
        "valid_thru": valid_thru,
    }
    confidence = {
        "name": round(name_confidence, 4),
        "student_no": round(student_confidence, 4),
        "document_no": round(document_confidence, 4),
        "card_no": 0.86 if card_number else 0.0,
        "valid_thru": round(valid_confidence, 4),
    }
    return fields, normalized_text, confidence


def parse_ocr_output(raw: Any) -> list[OCRLine]:
    lines: list[OCRLine] = []
    seen: set[tuple[str, str]] = set()

    def add(text: Any, confidence: Any = None) -> None:
        if not isinstance(text, str):
            return
        cleaned = re.sub(r"\s+", " ", text).strip()
        if not cleaned:
            return
        score: float | None = None
        try:
            if confidence is not None:
                score = float(confidence)
        except Exception:
            score = None
        key = (cleaned, "" if score is None else f"{score:.3f}")
        if key not in seen:
            seen.add(key)
            lines.append(OCRLine(cleaned, score))

    def walk(obj: Any) -> None:
        if obj is None:
            return
        if hasattr(obj, "to_dict"):
            try:
                walk(obj.to_dict())
                return
            except Exception:
                pass
        if hasattr(obj, "json"):
            try:
                walk(obj.json)
                return
            except Exception:
                pass
        if isinstance(obj, dict):
            texts = obj.get("rec_texts") or obj.get("texts")
            if isinstance(texts, list):
                scores = obj.get("rec_scores") or obj.get("scores") or []
                for i, text in enumerate(texts):
                    add(text, scores[i] if i < len(scores) else None)
                return
            if "text" in obj:
                add(obj.get("text"), obj.get("score") or obj.get("confidence"))
            for value in obj.values():
                walk(value)
            return
        if isinstance(obj, (list, tuple)):
            if len(obj) >= 2 and isinstance(obj[0], str):
                add(obj[0], obj[1])
                return
            if len(obj) >= 2 and isinstance(obj[1], (list, tuple)) and obj[1] and isinstance(obj[1][0], str):
                confidence = obj[1][1] if len(obj[1]) > 1 else None
                add(obj[1][0], confidence)
                return
            for item in obj:
                walk(item)

    walk(raw)
    return lines


class OCRBackend:
    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.error: str | None = None
        self.reader: Any | None = None
        self.available = False

        if not config["ocr"].get("enabled", True):
            self.error = "OCR disabled in config"
            return

        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        os.environ.setdefault("FLAGS_minloglevel", "2")
        os.environ.setdefault("GLOG_minloglevel", "2")
        os.environ.setdefault("PADDLE_CPP_LOG_LEVEL", "3")
        add_windows_nvidia_dll_dirs()
        suppress_logs = bool(config["ocr"].get("suppress_logs", True))

        try:
            with suppress_native_output(suppress_logs):
                from paddleocr import PaddleOCR
        except Exception as exc:
            self.error = f"PaddleOCR import failed: {exc}"
            return

        kwargs = {
            "lang": config["ocr"].get("lang", "tr"),
            "ocr_version": config["ocr"].get("ocr_version", "PP-OCRv5"),
            "device": config["ocr"].get("device", "gpu:0"),
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": bool(config["ocr"].get("use_textline_orientation", True)),
        }
        try:
            with suppress_native_output(suppress_logs):
                self.reader = PaddleOCR(**kwargs)
        except TypeError:
            legacy_kwargs = {
                "lang": config["ocr"].get("lang", "tr"),
                "use_angle_cls": bool(config["ocr"].get("use_textline_orientation", True)),
                "use_gpu": str(config["ocr"].get("device", "")).startswith("gpu"),
            }
            try:
                with suppress_native_output(suppress_logs):
                    self.reader = PaddleOCR(**legacy_kwargs)
            except Exception as exc:
                self.error = f"PaddleOCR init failed: {exc}"
                return
        except Exception as exc:
            fallback_device = config["ocr"].get("fallback_device")
            if fallback_device and fallback_device != config["ocr"].get("device"):
                kwargs["device"] = fallback_device
                try:
                    with suppress_native_output(suppress_logs):
                        self.reader = PaddleOCR(**kwargs)
                except Exception as fallback_exc:
                    self.error = f"PaddleOCR init failed: {exc}; fallback failed: {fallback_exc}"
                    return
            else:
                self.error = f"PaddleOCR init failed: {exc}"
                return

        self.available = True

    def run(self, image: np.ndarray, image_path: Path | None = None) -> tuple[list[OCRLine], str | None]:
        if self.reader is None:
            return [], self.error

        attempts: list[Any] = [image]
        if image_path is not None:
            attempts.append(str(image_path))

        last_error: str | None = None
        suppress_logs = bool(self.config["ocr"].get("suppress_logs", True))
        for payload in attempts:
            try:
                with suppress_native_output(suppress_logs):
                    if hasattr(self.reader, "predict"):
                        raw = self.reader.predict(payload)
                    else:
                        raw = self.reader.ocr(payload, cls=True)
                return parse_ocr_output(raw), None
            except Exception as exc:
                last_error = str(exc)

        return [], f"OCR failed: {last_error}"


class ClipVisualBackend:
    def __init__(
        self,
        config: dict[str, Any],
        module_loader: Callable[[str], Any] = importlib.import_module,
    ):
        clip_config = config.get("visual", {}).get("clip", {})
        self.enabled = bool(clip_config.get("enabled", True))
        self.model_name = str(clip_config.get("model", "ViT-B-32"))
        self.pretrained = str(clip_config.get("pretrained", "laion2b_s34b_b79k"))
        self.requested_device = str(clip_config.get("device", "auto"))
        self.module_loader = module_loader
        self.available = False
        self.error: str | None = None
        self.device: str | None = None
        self.model: Any | None = None
        self.preprocess: Any | None = None
        self.torch: Any | None = None
        self.pil_image: Any | None = None
        self.attempted_load = False
        self.embedding_cache: dict[str, Any] = {}

    def _model_label(self) -> str | None:
        if not self.enabled:
            return None
        return f"{self.model_name}/{self.pretrained}"

    def _detail(
        self,
        score: float | None = None,
        cosine: float | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        return {
            "score": None if score is None else round(clamp(float(score), 0.0, 1.0), 4),
            "cosine": None if cosine is None else round(float(cosine), 4),
            "available": bool(self.available),
            "model": self._model_label(),
            "device": self.device,
            "error": error or self.error,
        }

    def _resolve_device(self, torch_module: Any) -> str:
        requested = self.requested_device.strip().lower()
        if requested == "auto":
            return "cuda" if torch_module.cuda.is_available() else "cpu"
        if requested.startswith("gpu"):
            suffix = requested.removeprefix("gpu").lstrip(":")
            return f"cuda:{suffix}" if suffix else "cuda"
        return self.requested_device

    def _load(self) -> bool:
        if not self.enabled:
            self.error = "CLIP disabled in config"
            return False
        if self.available:
            return True
        if self.attempted_load:
            return False

        self.attempted_load = True
        try:
            add_windows_nvidia_dll_dirs()
            self.torch = self.module_loader("torch")
            open_clip = self.module_loader("open_clip")
            self.pil_image = self.module_loader("PIL.Image")
            self.device = self._resolve_device(self.torch)
            self.model, _, self.preprocess = open_clip.create_model_and_transforms(
                self.model_name,
                pretrained=self.pretrained,
            )
            self.model = self.model.to(self.device)
            self.model.eval()
            self.available = True
            self.error = None
            return True
        except Exception as exc:  # pragma: no cover - exact dependency failure depends on runtime.
            self.available = False
            self.error = f"OpenCLIP unavailable: {exc}"
            return False

    def _embedding(self, cache_key: str, image: np.ndarray) -> Any | None:
        cache_key = f"{cache_key}:{id(image)}"
        cached = self.embedding_cache.get(cache_key)
        if cached is not None:
            return cached
        if not self._load() or self.model is None or self.preprocess is None or self.torch is None:
            return None

        rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil_image = self.pil_image.fromarray(rgb_image)
        tensor = self.preprocess(pil_image).unsqueeze(0).to(self.device)
        with self.torch.no_grad():
            feature = self.model.encode_image(tensor)
            feature = feature / feature.norm(dim=-1, keepdim=True)
        self.embedding_cache[cache_key] = feature
        return feature

    def compare(self, analysis_a: CardAnalysis, analysis_b: CardAnalysis) -> dict[str, Any]:
        if not self._load():
            return self._detail()
        try:
            feature_a = self._embedding(analysis_a.source, analysis_a.normalized_image)
            feature_b = self._embedding(analysis_b.source, analysis_b.normalized_image)
        except Exception as exc:
            return self._detail(error=f"OpenCLIP embedding failed: {exc}")
        if feature_a is None or feature_b is None:
            return self._detail()

        try:
            cosine = float((feature_a @ feature_b.T).item())
        except Exception as exc:
            return self._detail(error=f"OpenCLIP comparison failed: {exc}")
        return self._detail(score=cosine, cosine=cosine)


def visual_ab_details(clip_detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "activeMethod": "clip",
        "clipScore": clip_detail.get("score") if isinstance(clip_detail.get("score"), (int, float)) else None,
        "clipCosine": clip_detail.get("cosine") if isinstance(clip_detail.get("cosine"), (int, float)) else None,
        "clipAvailable": bool(clip_detail.get("available", False)),
        "clipModel": clip_detail.get("model") if isinstance(clip_detail.get("model"), str) else None,
        "clipDevice": clip_detail.get("device") if isinstance(clip_detail.get("device"), str) else None,
        "clipError": clip_detail.get("error") if isinstance(clip_detail.get("error"), str) else None,
    }


def compare_digit_field(field: str, a: str, b: str, conflict_threshold: float) -> tuple[float | None, str | None]:
    if not a or not b:
        return None, None
    similarity = fuzzy_ratio(a, b)
    if a == b:
        return 100.0, None
    conflict = f"{field}_mismatch:{a}!={b}" if similarity < conflict_threshold else None
    return similarity, conflict


def field_confidence(analysis: CardAnalysis, field: str) -> float:
    if not analysis.fields.get(field):
        return 0.0
    value = analysis.field_confidence.get(field)
    if value is None:
        return 1.0
    try:
        return clamp(float(value), 0.0, 1.0)
    except (TypeError, ValueError):
        return 1.0


def content_similarity(a: CardAnalysis, b: CardAnalysis, config: dict[str, Any]) -> tuple[float, dict[str, Any]]:
    scoring_cfg = config["scoring"]
    components: list[tuple[str, float, float]] = []
    conflicts: list[str] = []
    reliable_fields = 0
    exact_card_match = bool(a.fields.get("card_no") and a.fields.get("card_no") == b.fields.get("card_no"))
    exact_student_no_match = bool(
        a.fields.get("student_no") and a.fields.get("student_no") == b.fields.get("student_no")
    )
    exact_document_no_match = bool(
        a.fields.get("document_no") and a.fields.get("document_no") == b.fields.get("document_no")
    )
    name_a = a.fields.get("name", "")
    name_b = b.fields.get("name", "")
    valid_a = a.fields.get("valid_thru", "")
    valid_b = b.fields.get("valid_thru", "")
    name_confidence = min(field_confidence(a, "name"), field_confidence(b, "name"))
    exact_name_match = bool(
        name_confidence >= 0.45 and name_a and name_b and simplify_text(name_a) == simplify_text(name_b)
    )
    exact_valid_thru_match = bool(valid_a and valid_b and valid_a == valid_b)

    for field, weight in (("student_no", 0.26), ("document_no", 0.30), ("card_no", 0.34)):
        conflict_threshold = float(scoring_cfg["digit_conflict_max_similarity"])
        if field == "student_no":
            conflict_threshold = min(conflict_threshold, 72.0)
        score, conflict = compare_digit_field(
            field,
            a.fields.get(field, ""),
            b.fields.get(field, ""),
            conflict_threshold,
        )
        confidence = min(field_confidence(a, field), field_confidence(b, field))
        if score is not None:
            components.append((field, score, weight * max(0.45, confidence)))
            if confidence >= 0.45:
                reliable_fields += 1
        if (
            conflict
            and confidence >= 0.55
            and not (exact_card_match and field in {"student_no", "document_no"})
        ):
            conflicts.append(conflict)

    if name_a and name_b:
        name_score = token_ratio(name_a, name_b)
        components.append(("name", name_score, 0.22 * max(0.35, name_confidence)))
        if name_confidence >= 0.45:
            reliable_fields += 1
        strong_exact_number = exact_card_match or exact_student_no_match or exact_document_no_match
        if (
            name_confidence >= 0.65
            and not strong_exact_number
            and name_score < float(scoring_cfg["name_conflict_max_similarity"])
        ):
            conflicts.append(f"name_mismatch:{name_a}!={name_b}")

    if valid_a and valid_b:
        valid_confidence = min(field_confidence(a, "valid_thru"), field_confidence(b, "valid_thru"))
        components.append(("valid_thru", 100.0 if valid_a == valid_b else 0.0, 0.06 * max(0.45, valid_confidence)))

    text_score = token_ratio(a.normalized_text, b.normalized_text)
    if a.normalized_text and b.normalized_text:
        components.append(("ocr_text", text_score, 0.08))

    strong_identity_match = bool(
        (exact_card_match and (exact_student_no_match or exact_document_no_match or exact_name_match or exact_valid_thru_match))
        or (exact_name_match and (exact_student_no_match or exact_document_no_match))
        or (exact_student_no_match and exact_document_no_match)
    )
    strong_signal_count = sum(
        1
        for value in (
            exact_card_match,
            exact_student_no_match,
            exact_document_no_match,
            exact_name_match,
            exact_valid_thru_match,
        )
        if value
    )

    if not components:
        return 0.0, {
            "components": [],
            "conflicts": [],
            "reliable_fields": 0,
            "ocr_text_score": 0.0,
            "exact_card_match": exact_card_match,
            "exact_student_no_match": exact_student_no_match,
            "exact_document_no_match": exact_document_no_match,
            "exact_name_match": exact_name_match,
            "exact_valid_thru_match": exact_valid_thru_match,
            "strong_identity_match": False,
            "strong_signal_count": 0,
        }

    weighted_total = sum(score * weight for _, score, weight in components)
    weight_sum = sum(weight for _, _, weight in components)
    score = weighted_total / max(0.001, weight_sum)
    if reliable_fields == 0:
        score = min(score, 55.0)

    return round(clamp(score), 2), {
        "components": [
            {"name": name, "score": round(score, 2), "weight": weight}
            for name, score, weight in components
        ],
        "conflicts": conflicts,
        "reliable_fields": reliable_fields,
        "ocr_text_score": round(text_score, 2),
        "exact_card_match": exact_card_match,
        "exact_student_no_match": exact_student_no_match,
        "exact_document_no_match": exact_document_no_match,
        "exact_name_match": exact_name_match,
        "exact_valid_thru_match": exact_valid_thru_match,
        "strong_identity_match": strong_identity_match,
        "strong_signal_count": strong_signal_count,
    }


def decide(
    content_score: float,
    visual_score: float,
    content_detail: dict[str, Any],
    quality: dict[str, Any],
    config: dict[str, Any],
) -> tuple[str, bool, float, list[str]]:
    cfg = config["scoring"]
    overall = round(
        float(cfg["content_weight"]) * content_score + float(cfg["visual_weight"]) * visual_score,
        2,
    )
    reasons: list[str] = []

    if content_detail.get("conflicts"):
        reasons.extend(content_detail["conflicts"])
        return "different", False, overall, reasons

    strong_identity_match = bool(content_detail.get("strong_identity_match"))
    if (
        strong_identity_match
        and int(content_detail.get("strong_signal_count", 0)) >= 2
        and content_score >= float(cfg.get("strong_content_min", 94))
        and visual_score >= float(cfg.get("strong_content_visual_min", 5))
    ):
        overall = max(overall, float(cfg.get("strong_content_overall_floor", 85)))
        if overall >= float(cfg["same_overall_min"]):
            return "same", True, round(clamp(overall), 2), reasons

    if not quality.get("ocr_available", True) or quality.get("ocr_weak", False):
        reasons.append("ocr_weak")
        if visual_score >= float(cfg["same_visual_min"]):
            return "uncertain", False, overall, reasons

    if (
        content_score >= float(cfg["same_content_min"])
        and visual_score >= float(cfg["same_visual_min"])
        and overall >= float(cfg["same_overall_min"])
    ):
        return "same", True, overall, reasons

    if overall < float(cfg["different_overall_max"]):
        reasons.append("overall_below_different_threshold")
        return "different", False, overall, reasons

    reasons.append("score_between_thresholds")
    return "uncertain", False, overall, reasons


def public_analysis(analysis: CardAnalysis) -> dict[str, Any]:
    return {
        "source": analysis.source,
        "fields": analysis.fields,
        "field_confidence": analysis.field_confidence,
        "ocr_lines": [dataclasses.asdict(line) for line in analysis.ocr_lines],
        "quality": analysis.quality,
        "crop_path": analysis.crop_path,
    }


class CardComparer:
    def __init__(
        self,
        config: dict[str, Any],
        debug_dir: Path | None = None,
        clip_backend: Any | None = None,
    ):
        self.config = config
        self.debug_dir = debug_dir
        self.ocr = OCRBackend(config)
        self.clip = clip_backend if clip_backend is not None else ClipVisualBackend(config)
        self.cache: dict[str, CardAnalysis] = {}

    def analyze(self, image_path: Path) -> CardAnalysis:
        key = str(image_path.resolve())
        if key in self.cache:
            return self.cache[key]

        image = read_image(image_path)
        normalized, detection = normalize_card_image(image, self.config)
        crop_path: str | None = None
        ocr_path: Path | None = None

        if self.debug_dir:
            stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", image_path.stem)
            crop = self.debug_dir / f"{stem}_crop.jpg"
            crop_path = write_image(crop, normalized)
            ocr_path = crop
            if detection.get("quad") is not None:
                write_image(self.debug_dir / f"{stem}_quad.jpg", draw_quad(image, detection.get("quad")))

        lines, ocr_error = self.ocr.run(normalized, ocr_path)
        fields, normalized_text, field_confidence = extract_fields(lines)
        ocr_weak = len(lines) < 2 or (
            not fields.get("student_no")
            and not fields.get("document_no")
            and not fields.get("card_no")
            and not fields.get("name")
        )
        quality = {
            **detection,
            "ocr_available": self.ocr.available,
            "ocr_error": ocr_error or self.ocr.error,
            "ocr_line_count": len(lines),
            "ocr_weak": ocr_weak,
            "image_shape": list(image.shape[:2]),
        }
        analysis = CardAnalysis(
            source=str(image_path),
            normalized_image=normalized,
            card_detected=bool(detection["card_detected"]),
            detection_confidence=float(detection["detection_confidence"]),
            crop_path=crop_path,
            ocr_lines=lines,
            fields=fields,
            field_confidence=field_confidence,
            normalized_text=normalized_text,
            quality=quality,
        )
        self.cache[key] = analysis
        return analysis

    def compare(self, image_a: Path, image_b: Path) -> dict[str, Any]:
        analysis_a = self.analyze(image_a)
        analysis_b = self.analyze(image_b)
        content_score, content_detail = content_similarity(analysis_a, analysis_b, self.config)
        clip_detail = self.clip.compare(analysis_a, analysis_b)
        visual_score = (
            round(float(clip_detail["score"]) * 100.0, 2)
            if isinstance(clip_detail.get("score"), (int, float))
            else 0.0
        )
        visual_details = visual_ab_details(clip_detail)
        quality = {
            "card_detected_a": analysis_a.card_detected,
            "card_detected_b": analysis_b.card_detected,
            "detection_confidence_a": analysis_a.detection_confidence,
            "detection_confidence_b": analysis_b.detection_confidence,
            "ocr_available": self.ocr.available,
            "ocr_weak": bool(analysis_a.quality.get("ocr_weak") or analysis_b.quality.get("ocr_weak")),
            "ocr_error_a": analysis_a.quality.get("ocr_error"),
            "ocr_error_b": analysis_b.quality.get("ocr_error"),
        }
        decision, same, overall, reasons = decide(content_score, visual_score, content_detail, quality, self.config)
        return {
            "decision": decision,
            "same": same,
            "overall_score": overall,
            "content_score": content_score,
            "visual_score": visual_score,
            "visual_details": visual_details,
            "fields": {"a": analysis_a.fields, "b": analysis_b.fields},
            "quality": quality,
            "debug": {"crop_a": analysis_a.crop_path, "crop_b": analysis_b.crop_path},
            "details": {
                "content": content_detail,
                "visual": {
                    "ab": visual_details,
                    "clip": clip_detail,
                },
                "reasons": reasons,
                "analysis_a": public_analysis(analysis_a),
                "analysis_b": public_analysis(analysis_b),
            },
        }


def summarize_pair(result: dict[str, Any], image_a: Path, image_b: Path) -> str:
    fields = result["fields"]
    reasons = ", ".join(result["details"].get("reasons", [])) or "-"
    return "\n".join(
        [
            f"Pair: {image_a.name} <-> {image_b.name}",
            f"Decision: {result['decision']} (same={str(result['same']).lower()})",
            f"Scores: overall={result['overall_score']:.2f}, content={result['content_score']:.2f}, visual={result['visual_score']:.2f}",
            f"A fields: name={fields['a'].get('name') or '-'}, student_no={fields['a'].get('student_no') or '-'}, document_no={fields['a'].get('document_no') or '-'}, card_no={fields['a'].get('card_no') or '-'}, valid={fields['a'].get('valid_thru') or '-'}",
            f"B fields: name={fields['b'].get('name') or '-'}, student_no={fields['b'].get('student_no') or '-'}, document_no={fields['b'].get('document_no') or '-'}, card_no={fields['b'].get('card_no') or '-'}, valid={fields['b'].get('valid_thru') or '-'}",
            f"Reasons: {reasons}",
        ]
    )


def matrix_summary(results: list[dict[str, Any]]) -> str:
    lines = ["Pair matrix:"]
    for item in sorted(results, key=lambda row: row["overall_score"], reverse=True):
        lines.append(
            f"{Path(item['a']).name:<12} <-> {Path(item['b']).name:<12} "
            f"{item['decision']:<9} overall={item['overall_score']:>6.2f} "
            f"content={item['content_score']:>6.2f} visual={item['visual_score']:>6.2f}"
        )
    return "\n".join(lines)


def expand_matrix_pattern(pattern: str) -> list[Path]:
    paths = [Path(p) for p in glob.glob(pattern)]
    paths = [path for path in paths if path.is_file()]
    return sorted(paths, key=lambda path: path.name.lower())


def to_jsonable(obj: Any) -> Any:
    if dataclasses.is_dataclass(obj):
        return to_jsonable(dataclasses.asdict(obj))
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, np.ndarray):
        return "<ndarray>"
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, dict):
        return {str(key): to_jsonable(value) for key, value in obj.items()}
    if isinstance(obj, list):
        return [to_jsonable(value) for value in obj]
    return obj


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Compare two student card images by OCR content and CLIP similarity.")
    parser.add_argument("image_a", nargs="?", type=Path, help="First card image")
    parser.add_argument("image_b", nargs="?", type=Path, help="Second card image")
    parser.add_argument("--matrix", help="Glob pattern for all-vs-all pair comparison, e.g. \"*.jpeg\"")
    parser.add_argument("--out", type=Path, help="Write JSON result to this path")
    parser.add_argument("--config", type=Path, default=Path("config.yaml"), help="YAML config path")
    parser.add_argument("--debug-dir", type=Path, help="Directory for normalized crops and quad debug images")
    parser.add_argument("--json", action="store_true", help="Print JSON result after the readable summary")
    parser.add_argument("--quiet", action="store_true", help="Only print JSON when used with --json")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config = load_config(args.config)
    comparer = CardComparer(config, args.debug_dir)

    try:
        if args.matrix:
            paths = expand_matrix_pattern(args.matrix)
            if len(paths) < 2:
                parser.error("--matrix needs at least two image files")
            pair_results = []
            for image_a, image_b in itertools.combinations(paths, 2):
                result = comparer.compare(image_a, image_b)
                pair_results.append({"a": str(image_a), "b": str(image_b), **result})
            payload = {"matrix": str(args.matrix), "count": len(pair_results), "results": pair_results}
            if not args.quiet:
                print(matrix_summary(pair_results))
            if args.out:
                args.out.parent.mkdir(parents=True, exist_ok=True)
                args.out.write_text(json.dumps(to_jsonable(payload), ensure_ascii=False, indent=2), encoding="utf-8")
            if args.json:
                print(json.dumps(to_jsonable(payload), ensure_ascii=False, indent=2))
            return 0

        if not args.image_a or not args.image_b:
            parser.error("provide two images or use --matrix")
        result = comparer.compare(args.image_a, args.image_b)
        if not args.quiet:
            print(summarize_pair(result, args.image_a, args.image_b))
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(json.dumps(to_jsonable(result), ensure_ascii=False, indent=2), encoding="utf-8")
        if args.json:
            print(json.dumps(to_jsonable(result), ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
