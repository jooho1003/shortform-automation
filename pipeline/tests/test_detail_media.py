"""상세페이지 미디어 검사 테스트. 숏폼 9:16 규격과 섞이지 않는지까지 본다."""

from pathlib import Path

import pytest
from PIL import Image

from shortform.steps import check_detail_media as cdm


def _png(path: Path, size: tuple[int, int]) -> None:
    Image.new("RGB", size, "white").save(path)


class TestMatchRatio:
    @pytest.mark.parametrize("size,expected", [
        ((1080, 1350), "4:5"),
        ((1800, 1200), "3:2"),
        ((1200, 1200), "1:1"),
        ((1920, 1080), "16:9"),
        ((1080, 1920), "9:16"),
    ])
    def test_allowed(self, size, expected):
        assert cdm.match_ratio(*size) == expected

    def test_rejects_off_ratio(self):
        assert cdm.match_ratio(1000, 1400) is None

    def test_rejects_zero(self):
        assert cdm.match_ratio(0, 1080) is None

    def test_detail_ratio_would_fail_shortform_check(self):
        """4:5는 상세페이지에서 통과하고 A안 검사에서는 떨어져야 한다 — 규격 분리의 핵심."""
        from shortform.steps.check_frames import RATIO, RATIO_TOL
        assert cdm.match_ratio(1080, 1350) == "4:5"
        assert abs((1080 / 1350) - RATIO) > RATIO_TOL


class TestCheckMedia:
    def test_accepts_valid_poster(self, tmp_path):
        _png(tmp_path / "section-1.png", (1080, 1350))
        report = cdm.check_media(tmp_path)
        assert report["ok"]
        assert report["files"][0]["ratio"] == "4:5"

    def test_flags_short_side(self, tmp_path):
        _png(tmp_path / "small.png", (512, 640))  # 4:5지만 짧은 변 512
        report = cdm.check_media(tmp_path)
        assert not report["ok"]
        assert "small.png" in report["problems"]

    def test_flags_off_ratio(self, tmp_path):
        _png(tmp_path / "odd.png", (1000, 1400))
        report = cdm.check_media(tmp_path)
        assert "odd.png" in report["problems"]

    def test_reports_missing(self, tmp_path):
        report = cdm.check_media(tmp_path, expected=["section-1.mp4"])
        assert report["missing"] == ["section-1.mp4"]
        assert not report["ok"]

    def test_writes_report_file(self, tmp_path):
        _png(tmp_path / "section-1.png", (1800, 1200))
        cdm.check_media(tmp_path)
        assert (tmp_path / cdm.REPORT).is_file()

    def test_ignores_report_and_other_files(self, tmp_path):
        _png(tmp_path / "section-1.png", (1800, 1200))
        (tmp_path / "메모.txt").write_text("x", encoding="utf-8")
        report = cdm.check_media(tmp_path)
        assert [f["name"] for f in report["files"]] == ["section-1.png"]

    def test_probe_missing_is_not_a_pass(self, tmp_path, monkeypatch):
        """ffprobe 가 없으면 보류다. ok 를 true 로 적으면 안 된다."""
        (tmp_path / "section-1.mp4").write_bytes(b"\x00")
        monkeypatch.setattr(cdm, "probe_video", lambda p: (_ for _ in ()).throw(cdm.ProbeUnavailable("없음")))
        report = cdm.check_media(tmp_path)
        assert report["probe_available"] is False
        assert not report["ok"]
