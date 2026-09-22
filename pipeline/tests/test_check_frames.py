"""check_frames 해상도 판정. 짧은 변 기준과 시트 전용 하한을 본다.

배경: 원래는 세로만 봤다(MIN_HEIGHT=1280). 그래서 9:16 비율은 맞지만 너비가 모자란 941x1672
시트가 통과했고, 그 한 장이 모든 키프레임의 아이덴티티 기준으로 쓰였다.
"""

from pathlib import Path

from PIL import Image

from shortform.steps import check_frames as cf


def _png(path: Path, size: tuple[int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, "white").save(path)


class _Ep:
    """run_check 가 쓰는 부분만 가진 최소 에피소드."""

    def __init__(self, root: Path):
        self.clips_dir = root

    @property
    def contact_sheet(self):
        return self.clips_dir / cf.CONTACT


def _plan(required=(1,)):
    cuts = [type("Cut", (), {"n": n, "required": True, "start": 0.0, "end": 2.0, "lens": "50mm"})() for n in required]
    return type("P", (), {"cuts": cuts})()


class TestMinShortSide:
    def test_sheet_is_stricter_than_keyframe(self):
        assert cf.min_short_side(cf.SHEET) == cf.SHEET_MIN_SHORT_SIDE
        assert cf.min_short_side(cf.KEYFRAME.format(n=1)) == cf.MIN_SHORT_SIDE
        assert cf.SHEET_MIN_SHORT_SIDE > cf.MIN_SHORT_SIDE

    def test_keyframe_floor_matches_old_height_rule_on_exact_ratio(self):
        """정확한 9:16에서 짧은 변 720은 세로 1280과 같은 기준이어야 한다(기존 판정 보존)."""
        assert round(cf.MIN_SHORT_SIDE / cf.RATIO) == 1280


class TestRunCheck:
    def test_rejects_narrow_sheet_that_old_height_rule_allowed(self, tmp_path):
        """실제로 통과했던 941x1672 시트는 이제 떨어져야 한다."""
        _png(tmp_path / cf.SHEET, (941, 1672))
        _png(tmp_path / cf.KEYFRAME.format(n=1), (1080, 1920))
        report = cf.run_check(_Ep(tmp_path), _plan())
        sheet = next(f for f in report["files"] if f["name"] == cf.SHEET)
        assert sheet["ratio_ok"] is True, "비율은 여전히 9:16으로 맞다"
        assert sheet["size_ok"] is False
        assert sheet["min_short_side"] == cf.SHEET_MIN_SHORT_SIDE
        assert cf.SHEET in report["problems"]
        assert report["ok"] is False

    def test_same_size_passes_as_keyframe(self, tmp_path):
        """같은 941x1672라도 키프레임이면 통과한다 — 하한을 나눈 것이 핵심."""
        _png(tmp_path / cf.SHEET, (1080, 1920))
        _png(tmp_path / cf.KEYFRAME.format(n=1), (941, 1672))
        report = cf.run_check(_Ep(tmp_path), _plan())
        keyframe = next(f for f in report["files"] if f["name"] != cf.SHEET)
        assert keyframe["size_ok"] is True
        assert report["ok"] is True

    def test_accepts_spec_sheet(self, tmp_path):
        _png(tmp_path / cf.SHEET, (1080, 1920))
        _png(tmp_path / cf.KEYFRAME.format(n=1), (1080, 1920))
        report = cf.run_check(_Ep(tmp_path), _plan())
        assert report["ok"] is True
        assert report["problems"] == []

    def test_flags_keyframe_below_floor(self, tmp_path):
        _png(tmp_path / cf.SHEET, (1080, 1920))
        _png(tmp_path / cf.KEYFRAME.format(n=1), (540, 960))
        report = cf.run_check(_Ep(tmp_path), _plan())
        assert cf.KEYFRAME.format(n=1) in report["problems"]
        assert report["ok"] is False

    def test_still_flags_off_ratio(self, tmp_path):
        _png(tmp_path / cf.SHEET, (1920, 1920))
        _png(tmp_path / cf.KEYFRAME.format(n=1), (1080, 1920))
        report = cf.run_check(_Ep(tmp_path), _plan())
        sheet = next(f for f in report["files"] if f["name"] == cf.SHEET)
        assert sheet["ratio_ok"] is False
        assert report["ok"] is False

    def test_missing_required_cut(self, tmp_path):
        _png(tmp_path / cf.SHEET, (1080, 1920))
        report = cf.run_check(_Ep(tmp_path), _plan(required=(1, 2)))
        assert report["missing_required"] == [1, 2]
        assert report["ok"] is False

    def test_contact_sheet_is_written(self, tmp_path):
        _png(tmp_path / cf.SHEET, (1080, 1920))
        _png(tmp_path / cf.KEYFRAME.format(n=1), (1080, 1920))
        cf.run_check(_Ep(tmp_path), _plan())
        assert (tmp_path / cf.CONTACT).is_file()
        assert (tmp_path / cf.REPORT).is_file()
