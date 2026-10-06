from types import SimpleNamespace
from pathlib import Path

import pytest
import yaml

from shortform import StepFailed, fal
from shortform.paths import CONFIG
from shortform.steps import video_a


def _plan(lock_len: int):
    locks = {k: ("Sentence number one is here. " * (lock_len // 30 + 1))[:lock_len] + "."
             for k in ("CHARACTER", "COSTUME", "GLOBAL STYLE", "NEGATIVE")}
    return SimpleNamespace(locks=locks)


def _cut():
    return SimpleNamespace(n=3, action="사구가 작은 숟가락으로 한 컵을 맛본 뒤 클립보드에 체크한다. " * 4,
                           camera="테이블 높이의 사선 클로즈업, 고정", lens="85mm 클로즈업", seconds=6.0)


def test_video_prompt_stays_under_fal_limit_with_long_locks():
    prompt = video_a._video_prompt(_plan(1800), _cut())
    assert len(prompt) <= video_a.FAL_PROMPT_LIMIT
    assert "ACTION: 사구가" in prompt and "GLOBAL STYLE:" in prompt and "NEGATIVE:" in prompt
    # 외모·의상 블록은 키프레임이 담당하므로 프롬프트에 넣지 않는다
    assert "CHARACTER:" not in prompt and "COSTUME:" not in prompt


def test_video_prompt_keeps_short_locks_whole():
    plan = _plan(200)
    prompt = video_a._video_prompt(plan, _cut())
    assert plan.locks["GLOBAL STYLE"] in prompt and plan.locks["NEGATIVE"] in prompt


def test_shots_group_chained_cuts_for_ambience():
    modes = ["새로", "이어서", "새로", "이어서", "새로", "새로", "새로", "새로", "각도변경", "이어서", "이어서"]
    cuts = [SimpleNamespace(n=i, chained=m == "이어서") for i, m in enumerate(modes, 1)]
    shots = video_a._shots(SimpleNamespace(cuts=cuts))
    assert [[c.n for c in s] for s in shots] == [[1, 2], [3, 4], [5], [6], [7], [8], [9, 10, 11]]


def test_fit_cuts_at_sentence_end():
    assert video_a._fit("One. Two. Three.", 9) == "One. Two."
    assert video_a._fit("short", 10) == "short"


def _chain_cut(n, seconds=3.0, motion="The fox walks up and stops.", start_mode="새로"):
    return SimpleNamespace(n=n, start=3.0 * (n - 1), end=3.0 * (n - 1) + seconds, seconds=seconds, motion=motion,
                           action="a", camera="c", lens="l", start_mode=start_mode, end_action="e",
                           chained=start_mode == "이어서")


def test_motion_prompt_gets_single_shot_guard_once():
    prompt = video_a._video_prompt(_plan(100), _chain_cut(1))
    assert prompt.startswith("The fox walks up and stops.") and prompt.count("No one enters or leaves") == 1
    again = video_a._video_prompt(_plan(100), _chain_cut(1, motion=prompt))
    assert again.count("No one enters or leaves") == 1


class TestCoverage:
    def test_accepts_tight_dialogue(self):
        video_a._check_coverage([(0.5, 5.7), (6.3, 9.0), (9.2, 11.1)], total=11.5)

    def test_rejects_gap_over_limit(self):
        with pytest.raises(StepFailed, match="공백"):
            video_a._check_coverage([(0.5, 5.7), (6.4, 9.0)], total=9.3)

    def test_rejects_overlap(self):
        with pytest.raises(StepFailed, match="겹칩니다"):
            video_a._check_coverage([(0.5, 5.7), (5.5, 9.0)], total=9.3)

    def test_rejects_silent_tail(self):
        with pytest.raises(StepFailed, match="끝"):
            video_a._check_coverage([(0.5, 5.7)], total=7.0)


class TestCost:
    def test_per_second_pricing(self):
        cfg = {"cost_per_second_usd": 0.1}
        assert video_a._estimate(cfg, [_chain_cut(1, 3.0), _chain_cut(2, 6.0)]) == pytest.approx(0.9)

    def test_legacy_per_cut_pricing(self):
        assert video_a._estimate({"cost_per_cut_usd": 0.6}, [_chain_cut(1), _chain_cut(2)]) == pytest.approx(1.2)

    def test_duration_range(self):
        cfg = {"duration_min_sec": 3, "duration_max_sec": 15}
        video_a._check_duration(cfg, _chain_cut(1, 3.0))
        with pytest.raises(StepFailed):
            video_a._check_duration(cfg, _chain_cut(1, 2.0))


def test_fal_chain_body_fills_start_end_and_duration():
    cfg = yaml.safe_load((CONFIG / "fal-chain.yaml").read_text(encoding="utf-8"))
    body = fal.fill(cfg["body"], {"prompt": "P", "keyframe": "data:a", "end_keyframe": "data:b", "seconds": "3", "seconds_int": 3, "sheet": ""})
    assert body["image_url"] == "data:a" and body["end_image_url"] == "data:b"
    assert body["duration"] == 3 and isinstance(body["duration"], int)  # H3 Max는 정수형 duration
    assert body["prompt_expansion_mode"] == "disabled"
    assert video_a._needs_end_frame(cfg) is True
    assert video_a._needs_end_frame({"body": {"image_url": "{keyframe}"}}) is False


def test_synthesize_measures_speech_from_audio_not_edge_events(monkeypatch, tmp_path: Path):
    # Edge 경계 이벤트는 문장 뒤 쉼까지 발화로 세어 길게 나온다. 구간은 오디오에서 잰 값을 써야 한다.
    async def fake_speak(text, out, voice):
        out.write_bytes(b"mp3")
        return 0.0, 9.0  # 일부러 틀린 Edge 값
    monkeypatch.setattr(video_a, "_speak", fake_speak)
    monkeypatch.setattr(video_a, "_speech_bounds", lambda p: (0.2, 2.7))
    plan = SimpleNamespace(dialogues=[SimpleNamespace(at=1.0, character="사구", text="넵!")])
    ep = SimpleNamespace(assets_dir=tmp_path)
    [(path, start, end)] = video_a._synthesize(ep, plan, {"provider": "edge-tts", "voice": "v"})
    assert path.name == "dialogue-01.mp3" and (start, end) == (1.2, 3.7)


def test_speech_bounds_strips_leading_and_trailing_silence(monkeypatch, tmp_path: Path):
    # 전체 4.0초, 앞 무음 떼면 3.8초, 앞뒤 떼면 3.0초 → 소리는 0.2~3.2초
    monkeypatch.setattr(video_a, "audio_duration", lambda p: 4.0)
    calls = iter([3.8, 3.0])
    monkeypatch.setattr(video_a, "_trimmed_seconds", lambda path, filters: next(calls))
    assert video_a._speech_bounds(tmp_path / "x.mp3") == (0.2, 3.2)


def test_dialogue_payload_carries_speech_windows():
    plan = SimpleNamespace(dialogues=[SimpleNamespace(at=0.3, character="사구", text="와", direction="속마음", english="Whoa")])
    [item] = video_a._dialogue_payload(plan, [(0.5, 5.7)])
    assert item["speechStart"] == 0.5 and item["speechEnd"] == 5.7 and item["english"] == "Whoa"


def test_fill_keeps_type_for_whole_placeholder_and_stringifies_inline():
    out = fal.fill({"duration": "{n}", "label": "cut {n}", "nested": ["{n}"]}, {"n": 3})
    assert out == {"duration": 3, "label": "cut 3", "nested": [3]}
