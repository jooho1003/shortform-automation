from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from shortform import StepFailed
from shortform.steps import assets


PRONUNCIATIONS = {
    "MBC": "엠비씨",
    "tvN": "티비엔",
    "AI": "에이아이",
    "TOP3": "톱 쓰리",
}


class SpeechTextTests(unittest.TestCase):
    def test_literal_pronunciations_are_applied_longest_key_first(self):
        speech_text = getattr(assets, "speech_text", None)
        self.assertTrue(callable(speech_text))

        self.assertEqual(
            speech_text("MBC tvN AI TOP3 TOP", PRONUNCIATIONS),
            "엠비씨 티비엔 에이아이 톱 쓰리 TOP",
        )

    def test_distribute_uses_spoken_length_but_keeps_original_labels(self):
        words = assets._distribute("MBC 뉴스", 0.0, 5.0, PRONUNCIATIONS)

        self.assertEqual([word["text"] for word in words], ["MBC", "뉴스"])
        self.assertEqual(words[0], {"text": "MBC", "start": 0.0, "end": 3.0})
        self.assertEqual(words[1], {"text": "뉴스", "start": 3.0, "end": 5.0})

    def test_distribute_removes_spaces_from_normalized_weight(self):
        words = assets._distribute("TOP3 뉴스", 0.0, 5.0, PRONUNCIATIONS)

        self.assertEqual(words[0], {"text": "TOP3", "start": 0.0, "end": 3.0})
        self.assertEqual(words[1]["text"], "뉴스")


class MediaLayoutTests(unittest.TestCase):
    def test_display_size_respects_rotation(self):
        display_size = getattr(assets, "_display_size", None)
        self.assertTrue(callable(display_size))

        self.assertEqual(display_size(1920, 1080, 0), (1920, 1080))
        self.assertEqual(display_size(1920, 1080, 90), (1080, 1920))
        self.assertEqual(display_size(1920, 1080, 270), (1080, 1920))

    def test_probe_display_size_reads_ffprobe_json_rotation(self):
        probe = getattr(assets, "_probe_display_size", None)
        self.assertTrue(callable(probe))
        completed = type(
            "Completed",
            (),
            {
                "returncode": 0,
                "stdout": json.dumps(
                    {
                        "streams": [
                            {
                                "width": 1920,
                                "height": 1080,
                                "side_data_list": [{"rotation": -90}],
                            }
                        ]
                    }
                ),
                "stderr": "",
            },
        )()

        with patch("shortform.steps.assets.subprocess.run", return_value=completed):
            self.assertEqual(probe(Path("rotated.mp4")), (1080, 1920))

    def test_manual_media_layout_defaults_to_landscape(self):
        manual_layout = getattr(assets, "_manual_media_layout", None)
        self.assertTrue(callable(manual_layout))

        self.assertEqual(manual_layout({"chosen": None}), "landscape")

    def test_manual_media_layout_accepts_explicit_portrait(self):
        manual_layout = getattr(assets, "_manual_media_layout", None)
        self.assertTrue(callable(manual_layout))

        self.assertEqual(
            manual_layout({"chosen": None, "media_layout": "portrait"}), "portrait"
        )

    def test_manual_media_layout_rejects_invalid_value(self):
        manual_layout = getattr(assets, "_manual_media_layout", None)
        self.assertTrue(callable(manual_layout))

        with self.assertRaises(StepFailed):
            manual_layout({"chosen": None, "media_layout": "square"})


if __name__ == "__main__":
    unittest.main()
