from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest

from shortform import StepFailed, state
from shortform.paths import Episode
from shortform.tts import episode as voice_episode
from shortform.tts.config import DEFAULT_CONFIG, TTSError, validate_config
from shortform.tts.queue import SpeechQueue
from shortform.tts.store import VoiceStore, atomic_json, read_json


@pytest.fixture
def store(tmp_path, monkeypatch):
    config = tmp_path / "config"
    config.mkdir()
    (config / "voice.yaml").write_text("voice: ko-KR-HyunsuMultilingualNeural\nrate: '+3%'\n", encoding="utf-8")
    result = VoiceStore(tmp_path / "data", config)
    monkeypatch.setattr(voice_episode, "VoiceStore", lambda: result)
    monkeypatch.setattr(voice_episode, "CONFIG", config)
    monkeypatch.setattr(voice_episode, "ROOT", tmp_path)
    return result


@pytest.fixture
def ep(tmp_path, store):
    directory = tmp_path / "2026-01-01" / "B-01-test"
    directory.mkdir(parents=True)
    result = Episode("2026-01-01", "B", "01", directory)
    result.plan_md.write_text("""# 제목 후보

- 음성 테스트

## 훅

들어보세요.

## 대본

| # | 문장 | 소재 | 검색어 |
|---|---|---|---|
| 1 | 안녕하세요. | stock | test |

## AI 댓글

| 시각 | 닉네임 | 내용 |
|---|---|---|
| 1 | 테스트 | 좋네요 |

## 메타데이터

- 공개: unlisted
""", encoding="utf-8")
    return result


@pytest.mark.parametrize("patch", [
    {"modelId": []}, {"schemaVersion": True}, {"speaker": "../../outside"},
    {"instruct": "0.6B does not support this"}, {"mode": "voice_design"},
    {"generation": {"seed": True}}, {"generation": {"seed": 1.2}},
    {"postprocess": {"speed": float("nan")}}, {"postprocess": {"speed": 2}},
    {"referenceId": "unexpected"}, {"remoteUrl": "https://example.com/model"},
])
def test_invalid_config_is_actionable_not_internal_error(patch):
    with pytest.raises(TTSError):
        validate_config({**deepcopy(DEFAULT_CONFIG), **patch})


def test_queue_idempotency_and_immutable_snapshot(store):
    queue = SpeechQueue(store, None, autostart=False)
    body = {"text": "AI 뉴스", "config": deepcopy(DEFAULT_CONFIG), "idempotencyKey": "same"}
    first = queue.submit(body)
    assert queue.submit(body)["id"] == first["id"]
    body["config"]["speaker"] = "Ryan"
    assert queue.get(first["id"])["request"]["config"]["speaker"] == "Sohee"
    with pytest.raises(TTSError) as error:
        queue.submit(body)
    assert error.value.status == 409


def test_postprocessing_and_unused_pronunciations_reuse_raw_seed(store):
    queue = SpeechQueue(store, None, autostart=False)
    first = queue.submit({"text": "AI 뉴스", "config": DEFAULT_CONFIG, "idempotencyKey": "first"})
    config = deepcopy(DEFAULT_CONFIG)
    config["postprocess"] = {"speed": 1.1, "sentenceGapMs": 400}
    config["pronunciations"]["UNUSED"] = "안 씀"
    second = queue.submit({"text": "AI 뉴스", "config": config, "idempotencyKey": "second"})
    assert first["request"]["config"]["generation"] == second["request"]["config"]["generation"]
    config["pronunciations"]["AI"] = "인공지능"
    third = queue.submit({"text": "AI 뉴스", "config": config, "idempotencyKey": "third"})
    assert third["request"]["config"]["generation"] != first["request"]["config"]["generation"]


def test_cancel_running_job_discards_result_and_recovers_pending(store):
    queue = SpeechQueue(store, None, autostart=False)
    job = queue.submit({"text": "안녕", "config": DEFAULT_CONFIG, "idempotencyKey": "cancel"})
    def generate(text, config, progress, cancelled):
        progress("generating")
        queue.cancel(job["id"])
        return {"audioKey": "must-not-publish"}
    queue.engine = SimpleNamespace(generate=generate)
    queue._process(job["id"])
    assert queue.get(job["id"])["status"] == "cancelled"
    assert "result" not in queue.get(job["id"])
    pending = queue.submit({"text": "다음", "config": DEFAULT_CONFIG, "idempotencyKey": "restart"})
    recovered = SpeechQueue(store, None, autostart=False)
    assert recovered.get(pending["id"])["status"] == "interrupted"


def test_preset_revisions_and_new_episode_default_are_frozen(store, ep):
    first = store.save_preset({"name": "목소리", "config": DEFAULT_CONFIG})
    store.set_default(first["id"], 1)
    # Legacy episodes retain Edge unless explicitly changed.
    assert voice_episode.load_voice(ep)["provider"] == "edge-tts"
    voice_episode.load_voice(ep, freeze=True, inherit_default=True)
    changed = {**deepcopy(DEFAULT_CONFIG), "speaker": "Ryan"}
    second = store.save_preset({"id": first["id"], "expectedRevision": 1, "name": "변경", "config": changed})
    store.set_default(second["id"], 2)
    assert voice_episode.load_voice(ep)["speaker"] == "Sohee"
    assert store.preset(first["id"], 1)["config"]["speaker"] == "Sohee"
    with pytest.raises(TTSError):
        store.save_preset({"id": first["id"], "expectedRevision": 1, "name": "충돌", "config": changed})


def test_apply_invalidates_render_without_changing_other_episode(store, ep):
    voice_episode.load_voice(ep, freeze=True)
    voice_episode.write_manifest(ep)
    state.mark_done(ep, "assets")
    state.mark_done(ep, "render")
    assert state.is_done(ep, "render")
    preset = store.save_preset({"name": "새 목소리", "config": DEFAULT_CONFIG})
    info = voice_episode.apply_preset(ep, preset, 1)
    assert info["stale"] and not state.is_done(ep, "render")
    with pytest.raises(TTSError):
        voice_episode.apply_preset(ep, preset, 1)
    voice_episode.write_manifest(ep)
    assert not voice_episode.is_stale(ep)
    ep.plan_md.write_text(ep.plan_md.read_text(encoding="utf-8").replace("안녕하세요.", "대본 수정."), encoding="utf-8")
    assert voice_episode.is_stale(ep)


def test_original_audio_template_rejects_tts(store, ep):
    text = ep.plan_md.read_text(encoding="utf-8").replace("## 대본", "## 템플릿\n\n화이트 피드 카드\n\n## 대본")
    ep.plan_md.write_text(text, encoding="utf-8")
    preset = store.save_preset({"name": "목소리", "config": DEFAULT_CONFIG})
    with pytest.raises(TTSError):
        voice_episode.apply_preset(ep, preset, 0)
    with pytest.raises(TTSError):
        voice_episode.regenerate(ep)
    assert not (ep.assets_dir / "voice-settings.json").exists()


def test_regeneration_failure_preserves_original_assets(store, ep, monkeypatch):
    from shortform.steps import assets
    voice_episode.load_voice(ep, freeze=True)
    original = ep.assets_dir / "narration.mp3"
    original.write_bytes(b"old-audio")
    atomic_json(ep.assets_dir / "타임라인.json", {"old": True})
    def fail(staged):
        (staged.assets_dir / "narration.mp3").write_bytes(b"partial-audio")
        raise StepFailed("synthesis failed")
    monkeypatch.setattr(assets, "run", fail)
    with pytest.raises(StepFailed):
        voice_episode.regenerate(ep)
    assert original.read_bytes() == b"old-audio"
    assert read_json(ep.assets_dir / "타임라인.json") == {"old": True}
    assert not list(ep.dir.glob(".tts-stage-*"))


def test_regeneration_success_commits_and_preserves_backup(store, ep, monkeypatch):
    from shortform.steps import assets
    voice_episode.load_voice(ep, freeze=True)
    (ep.assets_dir / "narration.mp3").write_bytes(b"old-audio")
    state.mark_done(ep, "render")
    state.mark_done(ep, "upload")
    def generate(staged):
        (staged.assets_dir / "narration.mp3").write_bytes(b"new-audio")
        atomic_json(staged.assets_dir / "타임라인.json", {"new": True})
    monkeypatch.setattr(assets, "run", generate)
    voice_episode.regenerate(ep)
    assert (ep.assets_dir / "narration.mp3").read_bytes() == b"new-audio"
    backups = list(ep.dir.glob(".tts-previous-*"))
    assert len(backups) == 1 and (backups[0] / "narration.mp3").read_bytes() == b"old-audio"
    assert state.is_done(ep, "assets") and not state.is_done(ep, "render") and not state.is_done(ep, "upload")


def test_episode_lock_blocks_second_writer_and_releases(ep):
    with voice_episode.episode_lock(ep):
        with pytest.raises(TTSError):
            with voice_episode.episode_lock(ep):
                pytest.fail("second writer acquired lock")
    with voice_episode.episode_lock(ep):
        pass


def test_web_initialization_targets_exact_new_directory(ep, store, monkeypatch):
    import argparse
    other = ep.dir.with_name("B-01-z-new")
    other.mkdir()
    monkeypatch.setattr(voice_episode, "find_episode", lambda *args: ep)
    parser = argparse.ArgumentParser()
    voice_episode.add_parser(parser.add_subparsers())
    args = parser.parse_args(["tts-initialize", "--track", "B", "--date", ep.date, "--episode", "01",
                              "--directory", f"{ep.date}/{other.name}"])
    assert args.func(args) == 0
    assert (other / "03-소재" / "voice-settings.json").exists()
    assert not (ep.assets_dir / "voice-settings.json").exists()


def test_a_audio_only_reuses_cuts_without_paid_generation(ep, monkeypatch):
    from shortform.steps import video_a
    cut = SimpleNamespace(n=1, start=0, end=5)
    plan = SimpleNamespace(cuts=[cut], total_seconds=5, dialogues=[], title="title", hook="hook", sound={})
    monkeypatch.setattr(video_a.planfile_a, "load", lambda path: plan)
    monkeypatch.setattr(video_a, "_config", lambda: pytest.fail("paid provider configuration accessed"))
    monkeypatch.setattr(video_a, "_build_audio", lambda ep, plan: "narration.mp3")
    monkeypatch.setattr(video_a, "write_manifest", lambda ep: None)
    (ep.assets_dir / "클립").mkdir(parents=True)
    (ep.assets_dir / "클립" / "01.mp4").write_bytes(b"existing-video")
    atomic_json(ep.assets_dir / "타임라인.json", {"durationSec": 5, "lines": [{"n": 1, "start": 0, "end": 5}]})
    video_a.regenerate_audio(ep)
    assert read_json(ep.assets_dir / "타임라인.json")["narration"] == "narration.mp3"
    cut.end = 6
    with pytest.raises(StepFailed, match="컷 구성"):
        video_a.regenerate_audio(ep)


def test_a_dialogue_overflow_fails_before_mixing(ep, monkeypatch):
    from shortform.steps import video_a
    async def speak(*args):
        return 0, 4.2
    monkeypatch.setattr(video_a, "_speak", speak)
    monkeypatch.setattr(video_a, "load_voice", lambda *args, **kwargs: DEFAULT_CONFIG)
    monkeypatch.setattr(video_a, "audio_duration", lambda path: 4.2)
    plan = SimpleNamespace(dialogues=[SimpleNamespace(at=0, text="긴 대사")],
                           cuts=[SimpleNamespace(start=0, end=3)], total_seconds=3)
    with pytest.raises(StepFailed, match="배정 구간"):
        video_a._build_audio(ep, plan)
