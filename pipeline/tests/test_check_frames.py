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


def _cut(n, start_mode="새로", end_action="", required=True):
    return type("Cut", (), {"n": n, "required": required, "start": float(3 * (n - 1)), "end": float(3 * n),
                            "lens": "50mm", "start_mode": start_mode, "end_action": end_action,
                            "chained": start_mode == "이어서"})()


def _plan(required=(1,), cuts=None):
    cuts = cuts if cuts is not None else [_cut(n) for n in required]
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
        assert report["missing_required"] == ["키프레임-01.png", "키프레임-02.png"]
        assert report["ok"] is False

    def test_contact_sheet_is_written(self, tmp_path):
        _png(tmp_path / cf.SHEET, (1080, 1920))
        _png(tmp_path / cf.KEYFRAME.format(n=1), (1080, 1920))
        cf.run_check(_Ep(tmp_path), _plan())
        assert (tmp_path / cf.CONTACT).is_file()
        assert (tmp_path / cf.REPORT).is_file()


class TestFrameNames:
    def test_required_frames_for_legacy_plan(self):
        # 끝 프레임 열이 없는 기획안은 시작 프레임만 필수다
        assert cf.required_frames(_plan(required=(1, 2))) == ["키프레임-01.png", "키프레임-02.png"]

    def test_required_frames_for_chain_plan(self):
        plan = _plan(cuts=[_cut(1, "새로", "멈춤"), _cut(2, "이어서", "사원증"), _cut(3, "각도변경", "입 열림")])
        assert cf.required_frames(plan) == [
            "키프레임-01.png", "키프레임-01-끝.png",
            "키프레임-02-끝.png",
            "키프레임-03.png", "키프레임-03-끝.png",
        ]

    def test_chained_cut_starts_from_previous_end(self):
        plan = _plan(cuts=[_cut(1, "새로", "a"), _cut(2, "이어서", "b")])
        assert cf.start_frame_name(plan, plan.cuts[1]) == "키프레임-01-끝.png"
        assert cf.start_frame_name(plan, plan.cuts[0]) == "키프레임-01.png"
        assert cf.end_frame_name(plan.cuts[1]) == "키프레임-02-끝.png"

    def test_frame_cut_parses_start_and_end(self):
        assert cf.frame_cut("키프레임-07.png") == (7, "start")
        assert cf.frame_cut("키프레임-07-끝.png") == (7, "end")
        assert cf.frame_cut("시트-세트.png") == (None, "")


class TestChainCheck:
    def test_missing_end_frame_is_reported_by_name(self, tmp_path: Path):
        _png(tmp_path / cf.SHEET, (1080, 1920))
        _png(tmp_path / cf.KEYFRAME.format(n=1), (1080, 1920))
        plan = _plan(cuts=[_cut(1, "새로", "a"), _cut(2, "이어서", "b")])
        report = cf.run_check(_Ep(tmp_path), plan)
        assert report["missing_required"] == ["키프레임-01-끝.png", "키프레임-02-끝.png"]
        assert report["ok"] is False

    def test_files_are_ordered_sheets_then_cut_pairs(self, tmp_path: Path):
        for name in (cf.KEYFRAME.format(n=2), cf.END_KEYFRAME.format(n=1), cf.KEYFRAME.format(n=1), cf.SET_SHEET, cf.SHEET):
            _png(tmp_path / name, (1080, 1920))
        plan = _plan(cuts=[_cut(1, "새로", "a"), _cut(2, "각도변경", "b")])
        report = cf.run_check(_Ep(tmp_path), plan)
        assert [f["name"] for f in report["files"]] == [cf.SET_SHEET, cf.SHEET, "키프레임-01.png", "키프레임-01-끝.png", "키프레임-02.png"]
