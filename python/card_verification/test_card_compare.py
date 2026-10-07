import copy
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from card_compare import (
    CardAnalysis,
    CardComparer,
    ClipVisualBackend,
    OCRLine,
    content_similarity,
    decide,
    extract_fields,
    load_config,
)


def analysis(fields, confidence=None, text=""):
    image = np.zeros((8, 8, 3), dtype=np.uint8)
    return CardAnalysis(
        source="test",
        normalized_image=image,
        card_detected=True,
        detection_confidence=90.0,
        crop_path=None,
        ocr_lines=[],
        fields=fields,
        field_confidence=confidence or {key: 1.0 for key, value in fields.items() if value},
        normalized_text=text,
        quality={"ocr_weak": False},
    )


def synthetic_card_with_background(background_color):
    image = np.full((540, 856, 3), background_color, dtype=np.uint8)
    x_margin = round(856 * 0.06)
    y_margin = round(540 * 0.07)
    x1 = 856 - x_margin - 1
    y1 = 540 - y_margin - 1

    cv2.rectangle(image, (x_margin, y_margin), (x1, y1), (242, 242, 238), -1)
    cv2.rectangle(image, (x_margin + 20, y1 - 72), (x1 - 20, y1 - 28), (20, 170, 210), -1)
    cv2.circle(image, (x_margin + 86, y_margin + 78), 42, (120, 42, 12), -1)
    cv2.rectangle(image, (x_margin + 56, y_margin + 150), (x_margin + 178, y_margin + 222), (160, 145, 115), -1)
    cv2.rectangle(image, (x1 - 170, y_margin + 54), (x1 - 52, y_margin + 162), (210, 210, 205), -1)

    cv2.putText(image, "KTU", (x_margin + 148, y_margin + 94), cv2.FONT_HERSHEY_SIMPLEX, 1.7, (25, 45, 95), 4)
    cv2.putText(image, "MERT KARAHASANOGLU", (x_margin + 230, y_margin + 190), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (22, 22, 22), 3)
    cv2.putText(image, "5400 4601 5144 3604", (x_margin + 230, y_margin + 238), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (22, 22, 22), 2)
    cv2.putText(image, "Ogrenci No 00000416781", (x_margin + 230, y_margin + 282), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (22, 22, 22), 2)
    cv2.putText(image, "COMPUTER ENGINEERING", (x_margin + 230, y_margin + 330), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (22, 22, 22), 2)
    return image


class FakeClipBackend:
    def __init__(self, score):
        self.score = score

    def compare(self, _analysis_a, _analysis_b):
        return {
            "score": self.score,
            "cosine": self.score,
            "available": True,
            "model": "fake/model",
            "device": "cpu",
            "error": None,
        }


def write_temp_card(directory, name, image):
    path = Path(directory) / name
    ok = cv2.imwrite(str(path), image)
    if not ok:
        raise AssertionError(f"failed to write {path}")
    return path


class CardCompareExtractionTests(unittest.TestCase):
    def test_ktu_header_noise_is_not_used_as_name(self):
        fields, _text, confidence = extract_fields(
            [
                OCRLine("KTU"),
                OCRLine("WARADENIZ TEKNN UNIVERSIEES"),
                OCRLine("Lisans Ogrencisi"),
                OCRLine("MERT KARAHASANOGLU"),
                OCRLine("5400 4801 6194 3604 29/10/24"),
                OCRLine("Ogrenci No / Student No 000000416781"),
            ]
        )

        self.assertEqual(fields["name"], "MERT KARAHASANOGLU")
        self.assertEqual(fields["student_no"], "000000416781")
        self.assertEqual(fields["valid_thru"], "10/24")
        self.assertGreaterEqual(confidence["name"], 0.7)

    def test_general_id_labels_extract_document_number_and_expiry(self):
        fields, _text, confidence = extract_fields(
            [
                OCRLine("Blue Valley City ID"),
                OCRLine("Name: Jane Ada Doe"),
                OCRLine("ID No: A1234567"),
                OCRLine("Valid until 2027-05-01"),
            ]
        )

        self.assertEqual(fields["name"], "JANE ADA DOE")
        self.assertEqual(fields["document_no"], "A1234567")
        self.assertEqual(fields["valid_thru"], "05/27")
        self.assertGreaterEqual(confidence["document_no"], 0.9)


class CardCompareScoringTests(unittest.TestCase):
    def test_low_confidence_name_mismatch_is_not_terminal_conflict(self):
        config = load_config(None)
        probe = analysis(
            {"name": "WARADENIZ TEKNN UNIVERSIEES", "student_no": "", "document_no": "", "card_no": "", "valid_thru": ""},
            {"name": 0.25},
            "WARADENIZ TEKNN UNIVERSIEES",
        )
        reference = analysis(
            {"name": "MERT KARAHASANOGLU", "student_no": "", "document_no": "", "card_no": "", "valid_thru": ""},
            {"name": 0.95},
            "MERT KARAHASANOGLU",
        )

        content_score, detail = content_similarity(probe, reference, config)
        decision, matched, _overall, reasons = decide(
            content_score,
            40.0,
            detail,
            {"ocr_available": True, "ocr_weak": False},
            config,
        )

        self.assertFalse(matched)
        self.assertEqual(decision, "different")
        self.assertNotIn("name_mismatch:WARADENIZ TEKNN UNIVERSIEES!=MERT KARAHASANOGLU", reasons)

    def test_high_visual_score_does_not_override_content_conflict(self):
        config = load_config(None)
        probe = analysis(
            {
                "name": "MERT KARAHASANOGLU",
                "student_no": "00000416781",
                "document_no": "",
                "card_no": "",
                "valid_thru": "10/24",
            },
            {"name": 0.95, "student_no": 0.95, "valid_thru": 0.95},
            "MERT KARAHASANOGLU 00000416781 10/24",
        )
        reference = analysis(
            {
                "name": "MERT KARAHASANOGLU",
                "student_no": "99999999999",
                "document_no": "",
                "card_no": "",
                "valid_thru": "10/24",
            },
            {"name": 0.95, "student_no": 0.95, "valid_thru": 0.95},
            "MERT KARAHASANOGLU 99999999999 10/24",
        )

        content_score, detail = content_similarity(probe, reference, config)
        decision, matched, _overall, reasons = decide(
            content_score,
            100.0,
            detail,
            {"ocr_available": True, "ocr_weak": False},
            config,
        )

        self.assertEqual(decision, "different")
        self.assertFalse(matched)
        self.assertIn("student_no_mismatch:00000416781!=99999999999", reasons)

    def test_strong_identity_signals_can_match_with_low_visual_score(self):
        config = load_config(None)
        probe = analysis(
            {
                "name": "MERT KARAHASANOGLU",
                "student_no": "000000416781",
                "document_no": "",
                "card_no": "",
                "valid_thru": "10/24",
            },
            {"name": 0.9, "student_no": 0.95, "valid_thru": 0.76},
            "MERT KARAHASANOGLU 000000416781 10/24",
        )
        reference = analysis(
            {
                "name": "MERT KARAHASANOGLU",
                "student_no": "000000416781",
                "document_no": "",
                "card_no": "",
                "valid_thru": "10/24",
            },
            {"name": 0.95, "student_no": 0.95, "valid_thru": 0.95},
            "MERT KARAHASANOGLU 000000416781 10/24",
        )

        content_score, detail = content_similarity(probe, reference, config)
        decision, matched, overall, reasons = decide(
            content_score,
            8.0,
            detail,
            {"ocr_available": True, "ocr_weak": False},
            config,
        )

        self.assertEqual(decision, "same")
        self.assertTrue(matched)
        self.assertGreaterEqual(overall, 75.0)
        self.assertEqual(reasons, [])

    def test_clip_dependency_missing_is_non_fatal(self):
        config = load_config(None)

        def missing_loader(_module_name):
            raise ModuleNotFoundError("No module named 'open_clip'")

        backend = ClipVisualBackend(config, module_loader=missing_loader)
        detail = backend.compare(analysis({}), analysis({}))

        self.assertIsNone(detail["score"])
        self.assertFalse(detail["available"])
        self.assertIn("OpenCLIP unavailable", detail["error"])

    def test_clip_score_drives_card_comparer_visual_score(self):
        config = copy.deepcopy(load_config(None))
        config["ocr"]["enabled"] = False

        with tempfile.TemporaryDirectory() as directory:
            probe_path = write_temp_card(
                directory,
                "probe.jpg",
                synthetic_card_with_background((40, 160, 60)),
            )
            reference_path = write_temp_card(
                directory,
                "reference.jpg",
                synthetic_card_with_background((180, 40, 150)),
            )

            low_clip = CardComparer(config, clip_backend=FakeClipBackend(0.12)).compare(
                probe_path,
                reference_path,
            )
            high_clip = CardComparer(config, clip_backend=FakeClipBackend(0.98)).compare(
                probe_path,
                reference_path,
            )

        self.assertEqual(low_clip["visual_details"]["activeMethod"], "clip")
        self.assertEqual(low_clip["visual_details"]["clipScore"], 0.12)
        self.assertEqual(high_clip["visual_details"]["clipScore"], 0.98)
        self.assertEqual(low_clip["visual_score"], 12.0)
        self.assertEqual(high_clip["visual_score"], 98.0)
        self.assertLess(low_clip["overall_score"], high_clip["overall_score"])


if __name__ == "__main__":
    unittest.main()
