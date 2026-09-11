from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import yaml

from shortform import StepFailed
from shortform import planfile
from shortform.steps import assets


BASE_PLAN = """# 제목 후보

- 카드 테스트

## 훅

첫 문장입니다.

{template_section}## 대본

| # | 문장 | 소재 | 검색어 |
|---|---|---|---|
| 1 | MBC AI 뉴스입니다. | stock | newsroom |

## AI 댓글

| 시각 | 닉네임 | 내용 |
|---|---|---|
| 2 | 테스트 | 좋아요 |

## 메타데이터

- 채널: 뉴스룸
- 공개: unlisted
"""


class TemplatePlanTests(unittest.TestCase):
    def _load(self, template_body: str | None):
        section = "" if template_body is None else f"## 템플릿\n\n{template_body}\n\n"
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "01-기획안.md"
            path.write_text(BASE_PLAN.format(template_section=section), encoding="utf-8")
            return planfile.load(path)

    def _payload(self, plan):
        build_payload = getattr(assets, "build_payload", None)
        self.assertTrue(callable(build_payload), "build_payload must be a pure callable")
        return build_payload(
            plan,
            [{"n": 1, "text": plan.lines[0].text, "start": 0.0, "end": 15.0}],
            15.0,
            "theme.mp3",
            [{"n": 1, "provider": "pexels"}],
        )

    def test_missing_template_uses_briefing_focus(self):
        plan = self._load(None)

        self.assertEqual(getattr(plan, "template_id", None), "briefing-focus")
        self.assertEqual(getattr(plan, "template_name", None), "브리핑 포커스")
        payload = self._payload(plan)
        self.assertEqual(payload["template"], "briefing-focus")
        self.assertEqual(payload["templateName"], "브리핑 포커스")
        self.assertEqual(payload["channelLabel"], "뉴스룸")
        self.assertEqual(payload["narration"], "narration.mp3")
        self.assertEqual(payload["bgm"], "theme.mp3")
        self.assertEqual(payload["credits"], [{"n": 1, "provider": "pexels"}])

    def test_light_template_round_trips_to_payload(self):
        payload = self._payload(self._load("화이트 피드 카드"))

        self.assertEqual(payload["template"], "feed-card-light")
        self.assertEqual(payload["templateName"], "화이트 피드 카드")

    def test_dark_template_round_trips_to_payload(self):
        payload = self._payload(self._load("블랙 피드 카드"))

        self.assertEqual(payload["template"], "feed-card-dark")
        self.assertEqual(payload["templateName"], "블랙 피드 카드")

    def test_markdown_bullet_is_removed_from_template_name(self):
        plan = self._load("- 화이트 피드 카드")

        self.assertEqual(getattr(plan, "template_id", None), "feed-card-light")

    def test_unknown_template_lists_every_valid_name(self):
        with self.assertRaises(StepFailed) as caught:
            self._load("없는 카드")

        for name in ("브리핑 포커스", "화이트 피드 카드", "블랙 피드 카드"):
            self.assertIn(name, str(caught.exception))

    def test_channel_label_falls_back_to_shortform(self):
        plan = self._load(None)
        plan.meta.pop("채널")

        self.assertEqual(self._payload(plan)["channelLabel"], "SHORTFORM")


class TemplateCatalogTests(unittest.TestCase):
    def _load_catalog(self, data):
        import shortform.templates as templates

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "templates.yaml"
            path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
            return templates.load_catalog(path)

    def test_catalog_rejects_duplicate_ids(self):
        data = {
            "default": "same",
            "templates": [
                {"name": "첫째", "id": "same", "duration": [15, 30], "enforce_duration": True},
                {"name": "둘째", "id": "same", "duration": [35, 60], "enforce_duration": False},
            ],
        }

        with self.assertRaises(StepFailed):
            self._load_catalog(data)

    def test_catalog_rejects_invalid_default(self):
        data = {
            "default": "없음",
            "templates": [
                {"name": "첫째", "id": "one", "duration": [15, 30], "enforce_duration": True}
            ],
        }

        with self.assertRaises(StepFailed):
            self._load_catalog(data)

    def test_catalog_rejects_malformed_bounds(self):
        malformed = ([15], [30, 15], [0, 30], [15, "30"], [15, 30, 45])
        for bounds in malformed:
            with self.subTest(bounds=bounds):
                data = {
                    "default": "one",
                    "templates": [
                        {"name": "첫째", "id": "one", "duration": bounds, "enforce_duration": True}
                    ],
                }
                with self.assertRaises(StepFailed):
                    self._load_catalog(data)

    def test_card_duration_boundaries_are_inclusive(self):
        import shortform.templates as templates

        validate_duration = getattr(templates, "validate_duration", None)
        self.assertTrue(callable(validate_duration))
        for template_id in ("feed-card-light", "feed-card-dark"):
            with self.subTest(template_id=template_id):
                self.assertIsNone(validate_duration(template_id, 15.0))
                self.assertIsNone(validate_duration(template_id, 75.0))

    def test_card_duration_outside_bounds_warns_but_proceeds(self):
        import shortform.templates as templates

        validate_duration = getattr(templates, "validate_duration", None)
        self.assertTrue(callable(validate_duration))
        for template_id, duration in (
            ("feed-card-light", 14.999),
            ("feed-card-light", 75.001),
            ("feed-card-dark", 14.999),
            ("feed-card-dark", 75.001),
        ):
            with self.subTest(template_id=template_id, duration=duration):
                warning = validate_duration(template_id, duration)
                self.assertIsNotNone(warning)
                self.assertIn("15~75", warning)

    def test_enforced_template_still_fails(self):
        import shortform.templates as templates

        catalog = self._load_catalog(
            {
                "default": "one",
                "templates": [
                    {"name": "첫째", "id": "one", "duration": [15, 30], "enforce_duration": True}
                ],
            }
        )

        self.assertIsNone(templates.validate_duration("one", 30.0, catalog))
        with self.assertRaises(StepFailed):
            templates.validate_duration("one", 30.001, catalog)

    def test_feed_cards_use_original_sound_and_briefing_uses_tts(self):
        import shortform.templates as templates

        catalog = templates.load_catalog()
        self.assertEqual(catalog.by_id("briefing-focus").narration, "tts")
        self.assertEqual(catalog.by_id("feed-card-light").narration, "original")
        self.assertEqual(catalog.by_id("feed-card-dark").narration, "original")

    def test_narration_defaults_to_tts_and_rejects_unknown_mode(self):
        base = {"name": "첫째", "id": "one", "duration": [15, 30], "enforce_duration": True}

        catalog = self._load_catalog({"default": "one", "templates": [dict(base)]})
        self.assertEqual(catalog.by_id("one").narration, "tts")

        with self.assertRaises(StepFailed):
            self._load_catalog({"default": "one", "templates": [dict(base, narration="없음")]})

    def test_briefing_duration_is_guidance_only(self):
        import shortform.templates as templates

        validate_duration = getattr(templates, "validate_duration", None)
        self.assertTrue(callable(validate_duration))
        validate_duration("briefing-focus", 10.0)
        validate_duration("briefing-focus", 90.0)


if __name__ == "__main__":
    unittest.main()
