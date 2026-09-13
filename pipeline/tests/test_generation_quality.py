import re
from pathlib import Path

import pytest

from shortform import GateBlocked, StepFailed
from shortform.paths import Episode
from shortform.planfile_a import Cut, PlanA
from shortform.steps import images_a, video_a
from shortform.steps.check_frames import KEYFRAME, SHEET


def _plan():
    return PlanA(
        title="test", synopsis="A creature prepares to move.",
        locks={
            "CHARACTER": "A four-legged blue creature with fins, not human.",
            "COSTUME": "A red scarf only.",
            "GLOBAL STYLE": "flat cel animation.",
            "NEGATIVE": "no photorealism.",
        },
        cuts=[
            Cut(1, 0, 2, "35mm", "turns toward the door", "slow push in", True),
            Cut(2, 2, 4, "50mm", "starts running", "low tracking", True),
            Cut(3, 4, 6, "24mm", "jumps", "wide tilt", False),
        ], sound={},
    )


def _episode(tmp_path: Path) -> Episode:
    d = tmp_path / "episode"
    d.mkdir()
    return Episode("20260912", "A", "01", d)


def _fake_report(ep, plan):
    names = [SHEET] + [KEYFRAME.format(n=cut.n) for cut in plan.cuts]
    return {
        "sheet": True,
        "files": [{"name": name, "ratio_ok": True, "size_ok": True} for name in names],
        "missing_required": [], "problems": [],
    }


def _out_from_prompt(prompt: str) -> Path:
    return Path(re.search(r"저장하세요: (.+)", prompt).group(1).strip())


def test_sheet_and_keyframe_prompts_keep_a_single_canonical_design(tmp_path):
    plan = _plan()
    sheet = images_a._sheet_prompt(plan, tmp_path / "시트.png", "test")
    keyframe = images_a._keyframe_prompt(plan, plan.cuts[0], tmp_path / "시트.png", tmp_path / "키프레임-01.png", "test")
    assert "의상·소품의 변형" in sheet
    assert "고정된 정식 디자인" in sheet
    assert "단 하나의 시작 프레임" in keyframe
    assert "멀티 프레임 콜라주" in keyframe
    assert "생물의 해부학" in keyframe
    assert "귀걸이" not in keyframe


def test_video_prompt_contains_all_locks_and_single_shot_contract():
    prompt = video_a._video_prompt(_plan(), _plan().cuts[0])
    for label in ("ACTION:", "CAMERA:", "LENS:", "DURATION:", "CHARACTER:", "COSTUME:", "GLOBAL STYLE:", "NEGATIVE:"):
        assert label in prompt
    assert "one continuous" in prompt
    assert "photorealistic" in prompt


def test_free_prose_digits_or_sheet_word_do_not_mutate(tmp_path):
    ep = _episode(tmp_path)
    ep.clips_dir.mkdir()
    original = ep.clips_dir / KEYFRAME.format(n=3)
    original.write_bytes(b"original")
    ep.clips_fix.write_text("1080 9:16 시트 유지", encoding="utf-8")
    with pytest.raises(StepFailed, match="대상을 판별"):
        images_a._apply_fix(ep, _plan(), "codex")
    assert original.read_bytes() == b"original"
    assert ep.clips_fix.exists()
    assert not (ep.clips_dir / "재생성백업").exists()


def test_revision_archives_only_selected_original_and_passes_instruction(monkeypatch, tmp_path):
    ep = _episode(tmp_path)
    ep.clips_dir.mkdir()
    (ep.clips_dir / SHEET).write_bytes(b"sheet")
    (ep.clips_dir / KEYFRAME.format(n=1)).write_bytes(b"one")
    (ep.clips_dir / KEYFRAME.format(n=3)).write_bytes(b"three-old")
    ep.clips_fix.write_text('{"version":1,"cuts":[3],"instruction":"카메라를 더 낮게"}', encoding="utf-8")
    prompts = []

    def generate(prompt, cwd, images, cfg):
        prompts.append(prompt)
        _out_from_prompt(prompt).write_bytes(b"new")
        return ""

    monkeypatch.setattr(images_a.planfile_a, "load", lambda _: _plan())
    monkeypatch.setattr(images_a, "_config", lambda: {"provider": "codex"})
    monkeypatch.setattr(images_a, "_codex", generate)
    monkeypatch.setattr(images_a, "run_check", _fake_report)
    with pytest.raises(GateBlocked):
        images_a.run(ep)
    backups = list((ep.clips_dir / "재생성백업").glob("*/키프레임-03.png"))
    assert len(backups) == 1 and backups[0].read_bytes() == b"three-old"
    assert (ep.clips_dir / KEYFRAME.format(n=1)).read_bytes() == b"one"
    assert (ep.clips_dir / KEYFRAME.format(n=3)).read_bytes() == b"new"
    assert any("카메라를 더 낮게" in p for p in prompts)
    assert not ep.clips_fix.exists()


def test_failed_revision_keeps_request_and_retry_does_not_rearchive(monkeypatch, tmp_path):
    ep = _episode(tmp_path)
    ep.clips_dir.mkdir()
    (ep.clips_dir / SHEET).write_bytes(b"sheet")
    for n in (1, 2, 3):
        (ep.clips_dir / KEYFRAME.format(n=n)).write_bytes(f"old-{n}".encode())
    ep.clips_fix.write_text('{"version":1,"cuts":[1,2],"instruction":"더 역동적으로"}', encoding="utf-8")
    monkeypatch.setattr(images_a.planfile_a, "load", lambda _: _plan())
    monkeypatch.setattr(images_a, "_config", lambda: {"provider": "codex"})
    monkeypatch.setattr(images_a, "run_check", _fake_report)
    calls = []

    def fail_second(prompt, cwd, images, cfg):
        out = _out_from_prompt(prompt)
        calls.append(out.name)
        if out.name == KEYFRAME.format(n=2):
            raise StepFailed("temporary")
        out.write_bytes(b"new-1")
        return ""

    monkeypatch.setattr(images_a, "_codex", fail_second)
    with pytest.raises(StepFailed, match="temporary"):
        images_a.run(ep)
    assert ep.clips_fix.exists()
    assert (ep.clips_dir / KEYFRAME.format(n=1)).read_bytes() == b"new-1"
    archives = list((ep.clips_dir / "재생성백업").glob("*/키프레임-01.png"))
    assert len(archives) == 1

    def finish(prompt, cwd, images, cfg):
        out = _out_from_prompt(prompt)
        calls.append(out.name)
        out.write_bytes(b"new-2")
        return ""

    monkeypatch.setattr(images_a, "_codex", finish)
    with pytest.raises(GateBlocked):
        images_a.run(ep)
    assert calls.count(KEYFRAME.format(n=1)) == 1
    assert len(list((ep.clips_dir / "재생성백업").glob("*/키프레임-01.png"))) == 1
    assert not ep.clips_fix.exists()


def test_legacy_numbered_instruction_is_explicit_and_manual_is_rejected_before_move(tmp_path):
    plan = _plan()
    assert images_a._parse_fix("3번 컷: 더 낮은 카메라", {1, 2, 3}) == (False, [3], "더 낮은 카메라")
    ep = _episode(tmp_path)
    ep.clips_dir.mkdir()
    source = ep.clips_dir / KEYFRAME.format(n=3)
    source.write_bytes(b"original")
    ep.clips_fix.write_text("3번 컷: 더 낮은 카메라", encoding="utf-8")
    with pytest.raises(StepFailed, match="provider=manual"):
        images_a._apply_fix(ep, plan, "manual")
    assert source.read_bytes() == b"original"


def test_optional_selected_cut_is_generated_and_bad_versions_or_empty_notes_are_rejected(monkeypatch, tmp_path):
    ep = _episode(tmp_path)
    ep.clips_dir.mkdir()
    (ep.clips_dir / SHEET).write_bytes(b"sheet")
    for n in (1, 2, 3):
        (ep.clips_dir / KEYFRAME.format(n=n)).write_bytes(f"old-{n}".encode())
    ep.clips_fix.write_text('{"version":1,"cuts":[3],"instruction":"1080 9:16 시트 유지"}', encoding="utf-8")
    monkeypatch.setattr(images_a.planfile_a, "load", lambda _: _plan())
    monkeypatch.setattr(images_a, "_config", lambda: {"provider": "codex", "keyframes_optional": True})
    monkeypatch.setattr(images_a, "run_check", _fake_report)
    generated = []

    def generate(prompt, cwd, images, cfg):
        out = _out_from_prompt(prompt)
        generated.append(out.name)
        out.write_bytes(b"new")
        return ""

    monkeypatch.setattr(images_a, "_codex", generate)
    with pytest.raises(GateBlocked):
        images_a.run(ep)
    assert generated == [KEYFRAME.format(n=3)]
    assert (ep.clips_dir / SHEET).read_bytes() == b"sheet"
    with pytest.raises(StepFailed):
        images_a._parse_fix("", {1})
    with pytest.raises(StepFailed):
        images_a._parse_fix('{"version":true,"cuts":[1],"instruction":"x"}', {1})
    with pytest.raises(StepFailed):
        images_a._parse_fix('{"version":1.0,"cuts":[1],"instruction":"x"}', {1})
    with pytest.raises(StepFailed):
        images_a._parse_fix('{"version":1,"cuts":[1,1],"instruction":"x"}', {1})
    with pytest.raises(StepFailed):
        images_a._parse_fix('{"version":1,"cuts":[[1]],"instruction":"x"}', {1})
    with pytest.raises(StepFailed):
        images_a._parse_fix('{"version":1,"cuts":[9],"instruction":"x"}', {1})


def test_corrupt_selected_output_keeps_repair_request(monkeypatch, tmp_path):
    ep = _episode(tmp_path)
    ep.clips_dir.mkdir()
    (ep.clips_dir / SHEET).write_bytes(b"sheet")
    (ep.clips_dir / KEYFRAME.format(n=3)).write_bytes(b"old")
    ep.clips_fix.write_text('{"version":1,"cuts":[3],"instruction":"change"}', encoding="utf-8")
    monkeypatch.setattr(images_a.planfile_a, "load", lambda _: _plan())
    monkeypatch.setattr(images_a, "_config", lambda: {"provider": "codex", "keyframes_optional": True})

    def generate(prompt, cwd, images, cfg):
        _out_from_prompt(prompt).write_bytes(b"corrupt")
        return ""

    def corrupt_report(ep, plan):
        return {"sheet": True, "files": [{"name": SHEET, "ratio_ok": True, "size_ok": True},
                                             {"name": KEYFRAME.format(n=3), "ratio_ok": False, "size_ok": False,
                                              "error": "열 수 없음"}],
                "missing_required": [1, 2], "problems": [KEYFRAME.format(n=3)]}

    monkeypatch.setattr(images_a, "_codex", generate)
    monkeypatch.setattr(images_a, "run_check", corrupt_report)
    with pytest.raises(StepFailed, match="검사에 실패"):
        images_a.run(ep)
    assert ep.clips_fix.exists()
    assert images_a._manifest_path(ep).exists()
