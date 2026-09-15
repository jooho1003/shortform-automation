from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from contextlib import contextmanager
from pathlib import Path

import yaml

from .. import StepFailed
from ..paths import CONFIG, ROOT, Episode
from .config import TTSError, digest
from .store import VoiceStore, atomic_json, now, read_json


def find_episode(track, date, num) -> Episode:
    if track not in ("A", "B") or not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise TTSError("회차 트랙·날짜가 올바르지 않습니다.")
    if not isinstance(num, str) or not re.fullmatch(r"\d{1,3}", num):
        raise TTSError("회차 번호가 올바르지 않습니다.")
    try:
        ep = Episode.find(date, track, num.zfill(2))
    except FileNotFoundError as exc:
        raise TTSError("회차를 찾을 수 없습니다.", 404) from exc
    if not ep.dir.resolve().is_relative_to(ROOT.resolve()):
        raise TTSError("회차 경로가 잘못됐습니다.", 403)
    return ep


def uses_tts(ep) -> bool:
    if ep.track == "A":
        return True
    from .. import planfile
    from ..templates import load_catalog
    return load_catalog().by_id(planfile.load(ep.plan_md).template_id).narration == "tts"


def load_voice(ep, *, freeze=False, inherit_default=False) -> dict:
    file = ep.assets_dir / "voice-settings.json"
    snapshot = read_json(file)
    if snapshot:
        if snapshot.get("config", {}).get("provider") == "edge-tts":
            return snapshot["config"]
        return VoiceStore().resolve_config(snapshot["config"])
    # Only newly created episodes inherit the current default. Legacy episodes
    # without a snapshot keep their original Edge voice until explicitly changed.
    preset = VoiceStore().default() if inherit_default else None
    if preset:
        config = preset["config"]
    else:
        config = {"provider": "edge-tts", **yaml.safe_load((CONFIG / "voice.yaml").read_text(encoding="utf-8"))}
    if freeze:
        atomic_json(file, {"schemaVersion": 1, "revision": 1, "preset":
            {"id": preset["id"], "revision": preset["revision"], "name": preset["name"]} if preset else None,
            "config": config, "updatedAt": now()})
    return config


def input_hash(ep) -> str:
    return digest({"plan": ep.plan_md.read_text(encoding="utf-8") if ep.plan_md.exists() else "",
                   "config": load_voice(ep)})


def is_stale(ep) -> bool:
    if not (ep.assets_dir / "voice-settings.json").exists():
        return False
    try:
        if not uses_tts(ep):
            return False
        manifest = read_json(ep.assets_dir / "tts-manifest.json")
        return not manifest or manifest.get("inputHash") != input_hash(ep)
    except (OSError, ValueError, StepFailed):
        return True


def write_manifest(ep):
    if not uses_tts(ep):
        return
    files = []
    for file in sorted((ep.assets_dir / "tts").glob("*.tts.json")):
        files.append({"file": file.name, **read_json(file)})
    atomic_json(ep.assets_dir / "tts-manifest.json", {"schemaVersion": 1, "inputHash": input_hash(ep),
                "config": load_voice(ep), "timingSource": "estimated", "files": files, "createdAt": now()})


@contextmanager
def episode_lock(ep):
    # Kernel lock is released even if a process is terminated; no stale lock directory.
    lock = ep.dir / ".tts.lock"
    with lock.open("a+b") as file:
        file.seek(0)
        file.write(b"0")
        file.flush()
        file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise TTSError("이 회차의 음성 작업이 진행 중입니다.", 409) from exc
        try:
            yield
        finally:
            file.seek(0)
            if os.name == "nt":
                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(file.fileno(), fcntl.LOCK_UN)


def info(ep):
    from ..inspect import _parse_plan
    plan = _parse_plan(ep)
    lines = [d.text for d in plan.dialogues] if ep.track == "A" else [line.text for line in plan.lines]
    return {"track": ep.track, "date": ep.date, "num": ep.num, "dir": ep.dir.relative_to(ROOT).as_posix(),
            "title": plan.title, "usesTts": uses_tts(ep), "text": "\n".join(lines),
            "snapshot": read_json(ep.assets_dir / "voice-settings.json"), "stale": is_stale(ep),
            "hasTimeline": (ep.assets_dir / "타임라인.json").exists()}


def apply_preset(ep, preset: dict, expected_revision: int):
    info(ep)  # Validate the plan before changing anything on disk.
    if not uses_tts(ep):
        raise TTSError("이 회차는 클립 원음을 사용하므로 TTS를 적용하지 않습니다.", 422)
    with episode_lock(ep):
        file = ep.assets_dir / "voice-settings.json"
        previous = read_json(file, {})
        if type(expected_revision) is not int or expected_revision != previous.get("revision", 0):
            raise TTSError("회차 설정이 변경됐습니다. 새로고침하세요.", 409)
        atomic_json(file, {"schemaVersion": 1, "revision": expected_revision + 1,
            "preset": {"id": preset["id"], "revision": preset["revision"], "name": preset["name"]},
            "config": preset["config"], "updatedAt": now()})
    return info(ep)


class StagedEpisode:
    def __init__(self, ep, assets):
        self.original = ep
        self.assets_dir = assets

    def __getattr__(self, key):
        return getattr(self.original, key)


def regenerate(ep):
    """Regenerate in an isolated copy; never invoke paid video generation for A."""
    from .. import state
    if not uses_tts(ep):
        raise TTSError("원음 템플릿에서는 음성을 생성하지 않습니다.", 422)
    from ..inspect import _parse_plan
    plan = _parse_plan(ep)
    texts = [d.text for d in plan.dialogues] if ep.track == "A" else [line.text for line in plan.lines]
    if len(texts) > 200 or sum(map(len, texts)) > 10000 or any(len(t) > 500 for t in texts):
        raise TTSError("회차 대본은 총 10,000자·200문장, 한 문장 500자 이내여야 합니다.", 422)
    with episode_lock(ep):
        load_voice(ep, freeze=True)
        original_hash = input_hash(ep)
        token = uuid.uuid4().hex
        stage = ep.dir / (".tts-stage-" + token)
        backup = ep.dir / (".tts-previous-" + token)
        for candidate in (stage, backup, ep.assets_dir):
            if candidate.resolve().parent != ep.dir.resolve():
                raise TTSError("음성 작업 경로가 잘못됐습니다.", 403)
        try:
            shutil.copytree(ep.assets_dir, stage)
            staged = StagedEpisode(ep, stage)
            if ep.track == "A":
                from ..steps.video_a import regenerate_audio
                regenerate_audio(staged)
            else:
                from ..steps.assets import run
                run(staged)
            if original_hash != input_hash(ep):
                raise TTSError("생성 중 기획안이 변경됐습니다. 기존 결과를 보존했습니다.", 409)
            write_manifest(staged)
            os.replace(ep.assets_dir, backup)
            try:
                os.replace(stage, ep.assets_dir)
            except BaseException:
                os.replace(backup, ep.assets_dir)
                raise
            state.mark_done(ep, "video" if ep.track == "A" else "assets")
            state.reset(ep, "render")
            state.reset(ep, "upload")
            print(f"음성·타임라인 갱신 완료. 이전 소재 보관: {backup.name}\n다음 작업: 렌더")
        finally:
            if stage.exists() and stage.resolve().parent == ep.dir.resolve() and stage.name.startswith(".tts-stage-"):
                shutil.rmtree(stage)


def add_parser(sub):
    initializer = sub.add_parser("tts-initialize", help="새 회차에 현재 기본 음성 설정을 고정")
    initializer.add_argument("--track", choices=["A", "B"], required=True)
    initializer.add_argument("--date", required=True)
    initializer.add_argument("--episode", required=True)
    initializer.add_argument("--directory", help="웹에서 방금 만든 정확한 회차 상대 경로")
    def initialize(args):
        ep = find_episode(args.track, args.date, args.episode)
        if args.directory:
            directory = (ROOT / args.directory).resolve()
            if (not directory.is_dir() or directory.parent != (ROOT / args.date).resolve()
                    or not directory.name.startswith(f"{args.track}-{args.episode.zfill(2)}-")):
                raise TTSError("새 회차 경로가 잘못됐습니다.", 403)
            ep = Episode(args.date, args.track, args.episode.zfill(2), directory)
        load_voice(ep, freeze=True, inherit_default=True)
        return 0
    initializer.set_defaults(func=initialize)
    parser = sub.add_parser("tts-regenerate", help="영상 재생성 비용 없이 회차 음성·타임라인 갱신")
    parser.add_argument("--track", choices=["A", "B"], required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--episode", required=True)
    parser.set_defaults(func=lambda args: regenerate(find_episode(args.track, args.date, args.episode)) or 0)
