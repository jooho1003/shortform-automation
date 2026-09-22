"""A안 영상 단계 — 컷별 영상, 대사·조리음 믹스와 타임라인.json 을 쓴다.

- 컷마다 키프레임(+시트)을 참조로 넣고, 프롬프트에는 컷표의 ACTION·CAMERA만 쓴다.
- 편당 비용 상한(config/fal.yaml)을 넘기면 시작하지 않는다. 사용한 금액은 상태.json 에 적는다.
- 실패한 컷은 03-소재/실패.txt 에 적는다. 같은 이름(클립/NN.mp4)으로 손으로 넣으면 이어서 진행한다.
- 기획안의 대사는 자막 데이터와 TTS로 함께 만들고, 간단한 주방 룸톤·조리 효과음과 섞는다.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
from pathlib import Path

import yaml

from .. import MissingKey, StepFailed
from .. import fal
from .. import planfile_a
from ..paths import CONFIG, Episode
from .. import state
from .check_frames import KEYFRAME, SHEET
from .assets import _speak
from ..tts.episode import load_voice, write_manifest
from ..tts.engine import audio_duration


def _config() -> dict:
    return yaml.safe_load((CONFIG / "fal.yaml").read_text(encoding="utf-8"))


def _to_9x16(src: Path, dst: Path, seconds: float) -> None:
    vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-t", f"{seconds:.3f}", "-vf", vf,
         "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(dst)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if res.returncode != 0:
        raise StepFailed(f"ffmpeg 변환 실패 {src.name}: {res.stderr[-300:]}")


def _video_prompt(plan, cut) -> str:
    """A single-shot video prompt with the plan locks repeated for every request."""
    locks = plan.locks
    return (
        "Generate one continuous vertical 9:16 shot. Do not make a montage, cutaway, split screen, "
        "time jump, or style change. Preserve the supplied keyframe and character-sheet reference exactly; "
        "keep identity, creature anatomy, proportions, costume, props, and all defined details consistent.\n\n"
        f"ACTION: {cut.action}\n"
        f"CAMERA: {cut.camera}\n"
        f"LENS: {cut.lens or 'use the keyframe perspective'}\n"
        f"DURATION: {cut.seconds:g} seconds\n\n"
        f"CHARACTER:\n{locks.get('CHARACTER', '')}\n\n"
        f"COSTUME:\n{locks.get('COSTUME', '')}\n\n"
        f"GLOBAL STYLE:\n{locks.get('GLOBAL STYLE', '')}\n\n"
        f"NEGATIVE:\n{locks.get('NEGATIVE', '')}\n\n"
        "Do not add text, watermark, morphing, face changes, extra limbs, or unspecified human accessories. "
        "Do not impose a realistic or photorealistic style; use only the GLOBAL STYLE lock."
    )


def _build_audio(ep: Episode, plan) -> str:
    """Place character dialogue on the plan clock and add a subtle kitchen sound bed."""
    if not plan.dialogues:
        return ""

    voice = load_voice(ep, freeze=True)
    tts_dir = ep.assets_dir / "tts"
    tts_dir.mkdir(parents=True, exist_ok=True)
    dialogue_paths: list[Path] = []
    print("  리버 대사 합성 중...")
    for index, dialogue in enumerate(plan.dialogues, 1):
        out = tts_dir / f"dialogue-{index:02d}.mp3"
        asyncio.run(_speak(dialogue.text, out, voice))
        if voice.get("provider") == "qwen3-local":
            limit = min([plan.total_seconds] + [d.at for d in plan.dialogues if d.at > dialogue.at]
                        + [cut.end for cut in plan.cuts if cut.start <= dialogue.at < cut.end])
            duration = audio_duration(out)
            if dialogue.at + duration > limit + 0.05:
                raise StepFailed(f"{index}번 대사 {duration:.2f}초가 배정 구간 {limit - dialogue.at:.2f}초를 넘습니다. 대본·속도·대사 시각을 수정하세요.")
        dialogue_paths.append(out)

    total = plan.total_seconds
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    for path in dialogue_paths:
        args += ["-i", str(path)]

    # Procedural sounds keep the episode self-contained: room tone, whisk, pan
    # sizzle, a light egg crack and the ceramic plate landing.
    args += [
        "-f", "lavfi", "-t", f"{total:g}", "-i",
        "anoisesrc=color=pink:amplitude=0.018:r=44100",
        "-f", "lavfi", "-t", "11", "-i",
        "anoisesrc=color=white:amplitude=0.045:r=44100",
        "-f", "lavfi", "-t", "4.5", "-i",
        "anoisesrc=color=white:amplitude=0.025:r=44100",
        "-f", "lavfi", "-t", "0.12", "-i", "sine=frequency=720:r=44100",
        "-f", "lavfi", "-t", "0.16", "-i", "sine=frequency=1320:r=44100",
    ]

    filters: list[str] = []
    mix_labels: list[str] = []
    for index, dialogue in enumerate(plan.dialogues):
        delay = max(0, round(dialogue.at * 1000))
        label = f"d{index}"
        filters.append(
            f"[{index}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
            f"volume=1.18,adelay={delay}:all=1[{label}]"
        )
        mix_labels.append(f"[{label}]")

    base = len(dialogue_paths)
    filters += [
        f"[{base}:a]lowpass=f=1100,volume=0.22,aformat=channel_layouts=stereo[room]",
        f"[{base + 1}:a]highpass=f=1700,lowpass=f=7600,volume=0.50,"
        "afade=t=in:d=0.35,afade=t=out:st=10.4:d=0.6,adelay=12000:all=1[sizzle]",
        f"[{base + 2}:a]highpass=f=2400,lowpass=f=9000,volume=0.34,"
        "afade=t=in:d=0.15,afade=t=out:st=4.0:d=0.5,adelay=6800:all=1[whisk]",
        f"[{base + 3}:a]volume=0.10,adelay=2050:all=1[crack]",
        f"[{base + 4}:a]volume=0.075,adelay=24000:all=1[plate]",
    ]
    mix_labels += ["[room]", "[sizzle]", "[whisk]", "[crack]", "[plate]"]
    filters.append(
        "".join(mix_labels)
        + f"amix=inputs={len(mix_labels)}:duration=longest:normalize=0,"
        f"alimiter=limit=0.94,atrim=0:{total:g},afade=t=out:st={max(0, total - 0.35):g}:d=0.35[out]"
    )

    narration = ep.assets_dir / "narration.mp3"
    args += ["-filter_complex", ";".join(filters), "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", str(narration)]
    result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise StepFailed(f"A안 대사·효과음 믹스 실패: {result.stderr[-600:]}")
    return narration.name


def run(ep: Episode) -> None:
    plan = planfile_a.load(ep.plan_md)
    cfg = _config()
    raw_dir = ep.assets_dir / "원본"
    clip_dir = ep.assets_dir / "클립"
    raw_dir.mkdir(parents=True, exist_ok=True)
    clip_dir.mkdir(parents=True, exist_ok=True)
    fail_log = ep.assets_dir / "실패.txt"
    sheet = ep.clips_dir / SHEET

    todo = [c for c in plan.cuts if not (raw_dir / f"{c.n:02d}.mp4").exists() and not (clip_dir / f"{c.n:02d}.mp4").exists()]
    est = len(todo) * float(cfg.get("cost_per_cut_usd", 0.6))
    cap = float(cfg.get("max_cost_per_episode_usd", 10))
    spent = float(state.load(ep).get("fal_spent_usd", 0.0))
    print(f"  생성할 컷 {len(todo)}개 · 예상 ${est:.2f} (누적 ${spent:.2f}, 상한 ${cap:.0f})")
    if todo:
        if spent + est > cap:
            raise StepFailed(f"편당 비용 상한 ${cap:.0f}를 넘깁니다 (누적 ${spent:.2f} + 예상 ${est:.2f}). config/fal.yaml 을 조정하거나 컷을 줄이세요.")
        key = os.environ.get("FAL_KEY")
        if not key:
            raise MissingKey("FAL_KEY 가 없습니다. https://fal.ai/dashboard/keys 에서 발급해 pipeline/.env 에 넣으세요.")

    failed = []
    for cut in todo:
        kf = ep.clips_dir / KEYFRAME.format(n=cut.n)
        if not kf.exists():
            print(f"  ! 컷 {cut.n:02d} 키프레임 없음 — 건너뜀")
            failed.append(cut.n)
            continue
        prompt = _video_prompt(plan, cut)
        print(f"  컷 {cut.n:02d} 생성 (fal) — {prompt[:70]}")
        try:
            fal.generate(cfg, key, raw_dir / f"{cut.n:02d}.mp4", {
                "prompt": prompt,
                "keyframe": fal.data_uri(kf),
                "sheet": fal.data_uri(sheet) if sheet.exists() else "",
            })
            spent += float(cfg.get("cost_per_cut_usd", 0.6))
            st = state.load(ep)
            st["fal_spent_usd"] = round(spent, 2)
            state.save(ep, st)
        except StepFailed as exc:
            print(f"  ! 컷 {cut.n:02d} 실패: {exc}")
            failed.append(cut.n)

    if failed:
        fail_log.write_text(
            "\n".join(f"{n:02d}" for n in failed) + "\n\n실패한 컷입니다. 힉스필드·NewTake 등에서 만들어 03-소재/원본/NN.mp4 로 넣고 다시 실행하세요.\n",
            encoding="utf-8",
        )
        raise StepFailed(f"실패한 컷: {failed} → {fail_log}")
    fail_log.unlink(missing_ok=True)

    # 9:16 변환 + 타임라인
    lines = []
    for cut in plan.cuts:
        dst = clip_dir / f"{cut.n:02d}.mp4"
        src = raw_dir / f"{cut.n:02d}.mp4"
        if not dst.exists():
            if not src.exists():
                raise StepFailed(f"컷 {cut.n:02d} 영상이 없습니다: {src}")
            _to_9x16(src, dst, cut.seconds)
        lines.append({"n": cut.n, "text": "", "start": cut.start, "end": cut.end, "words": [], "clip": f"클립/{cut.n:02d}.mp4", "mediaLayout": "portrait"})

    total = plan.total_seconds
    narration = _build_audio(ep, plan)
    payload = {
        "fps": 30, "width": 1080, "height": 1920, "durationSec": total,
        "title": plan.title, "hook": plan.hook,
        "template": plan.template_id, "templateName": plan.template_name, "channelLabel": plan.meta.get("채널", ""),
        "lines": lines,
        "comments": [],
        "dialogues": [
            {"at": d.at, "character": d.character, "text": d.text, "direction": d.direction}
            for d in plan.dialogues
        ],
        "narration": narration, "bgm": None, "credits": [],
        "sound": plan.sound,
    }
    (ep.assets_dir / "타임라인.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_manifest(ep)
    print(f"  타임라인 → {len(lines)}컷 · {total:g}초 · 누적 ${spent:.2f}")


def regenerate_audio(ep: Episode) -> None:
    """Reuse existing cut videos; no fal configuration, requests, or billable generation."""
    plan = planfile_a.load(ep.plan_md)
    timeline_file = ep.assets_dir / "타임라인.json"
    if not timeline_file.exists():
        raise StepFailed("먼저 A안 컷 영상을 완성하세요. 음성만 갱신할 기존 타임라인이 없습니다.")
    timeline = json.loads(timeline_file.read_text(encoding="utf-8"))
    planned = [(c.n, c.start, c.end) for c in plan.cuts]
    existing = [(c.get("n"), c.get("start"), c.get("end")) for c in timeline.get("lines", [])]
    if planned != existing or timeline.get("durationSec") != plan.total_seconds:
        raise StepFailed("컷 구성·길이가 변경됐습니다. 음성만 갱신하려면 기존 컷 시각을 유지하세요.")
    for cut in plan.cuts:
        if not (ep.assets_dir / "클립" / f"{cut.n:02d}.mp4").is_file():
            raise StepFailed(f"기존 컷 {cut.n:02d} 영상이 없습니다. 컷 영상을 먼저 준비하세요.")
    timeline["narration"] = _build_audio(ep, plan)
    timeline.update(title=plan.title, hook=plan.hook, sound=plan.sound)
    timeline["dialogues"] = [{"at": d.at, "character": d.character, "text": d.text, "direction": d.direction} for d in plan.dialogues]
    timeline_file.write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    write_manifest(ep)
