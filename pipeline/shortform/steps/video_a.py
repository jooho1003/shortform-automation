"""A안 영상 단계 — 컷별 영상, 대사·조리음 믹스와 타임라인.json 을 쓴다.

- 컷마다 키프레임(+시트)을 참조로 넣고, 프롬프트에는 컷표의 ACTION·CAMERA만 쓴다.
- 체인 기획안(설계 10): 컷마다 시작 프레임(이어서 컷은 앞 컷의 끝)과 끝 프레임을 함께 보낸다. 대사는 영상보다 먼저 합성해 공백·겹침을 검사한다 — 돈 쓰기 전에 멈추기 위해서다.
- 편당 비용 상한(config/fal-chain.yaml)을 넘기면 시작하지 않는다. 사용한 금액은 상태.json 에 적는다.
- 실패한 컷은 03-소재/실패.txt 에 적는다. 같은 이름(클립/NN.mp4)으로 손으로 넣으면 이어서 진행한다.
- 기획안의 대사는 자막 데이터와 TTS로 함께 만들고, 룸톤(주방이면 조리 효과음까지)과 섞는다.
  Edge 음성 설정에 characters 항목이 있으면 화자별로 다른 목소리를 쓴다.
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
from .check_frames import SHEET, end_frame_name, start_frame_name
from .assets import _speak
from ..tts.episode import load_voice, write_manifest
from ..tts.engine import audio_duration


def _config() -> dict:
    """A안 체인 영상 설정. Take Studio가 쓰는 fal.yaml과 분리한다 — 요청 템플릿 변수가 다르다."""
    return yaml.safe_load((CONFIG / "fal-chain.yaml").read_text(encoding="utf-8"))


def _to_9x16(src: Path, dst: Path, seconds: float) -> None:
    vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-t", f"{seconds:.3f}", "-vf", vf,
         "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(dst)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if res.returncode != 0:
        raise StepFailed(f"ffmpeg 변환 실패 {src.name}: {res.stderr[-300:]}")


FAL_PROMPT_LIMIT = 2000  # 긴 프롬프트는 모델이 컷 안에서 장면을 바꾸기 쉬워 상한을 둔다.
GUARD = "Single continuous shot in the same room with the same characters. No one enters or leaves. No cut, no scene change."


def _fit(text: str, limit: int) -> str:
    """limit 안에서 마지막 문장 끝까지만 남긴다. 문장 중간에서 끊긴 지시는 모델이 오해한다."""
    if len(text) <= limit:
        return text
    cut = text[:max(0, limit)]
    end = cut.rfind(".")
    return cut[:end + 1] if end > 0 else cut


def _video_prompt(plan, cut) -> str:
    """외모·의상은 키프레임·시트에 맡긴다. 모션이 있으면 장면 이탈 방지 가드만 붙인다."""
    motion = getattr(cut, "motion", "")
    if motion:
        return (motion if "no one enters or leaves" in motion.lower() else f"{motion} {GUARD}")[:FAL_PROMPT_LIMIT]
    locks = plan.locks
    head = (
        "Generate one continuous vertical 9:16 shot. Do not make a montage, cutaway, split screen, "
        "time jump, or style change. Preserve the supplied keyframe and character-sheet reference exactly; "
        "keep identity, creature anatomy, proportions, costume, props, and all defined details consistent.\n\n"
        f"ACTION: {cut.action}\n"
        f"CAMERA: {cut.camera}\n"
        f"LENS: {cut.lens or 'use the keyframe perspective'}\n"
        f"DURATION: {cut.seconds:g} seconds\n\n"
    )
    tail = (
        "Do not add text, watermark, morphing, face changes, extra limbs, or unspecified human accessories. "
        "Do not impose a realistic or photorealistic style; use only the GLOBAL STYLE lock."
    )
    budget = FAL_PROMPT_LIMIT - len(head) - len(tail)
    style, negative = locks.get("GLOBAL STYLE", ""), locks.get("NEGATIVE", "")
    frame = len("GLOBAL STYLE:\n\n\nNEGATIVE:\n\n\n")
    if len(style) + len(negative) + frame > budget:
        negative = _fit(negative, max(0, (budget - frame) // 3))
        style = _fit(style, max(0, budget - frame - len(negative)))
    prompt = head + f"GLOBAL STYLE:\n{style}\n\nNEGATIVE:\n{negative}\n\n" + tail
    return prompt[:FAL_PROMPT_LIMIT]


def _voice_for(voice: dict, character: str) -> dict:
    """Edge 설정의 characters 항목(화자 이름 → voice/rate/pitch)으로 화자별 목소리를 덮어쓴다.
    상황극은 주인공과 상대역의 목소리가 달라야 한다. Qwen 설정은 프리셋 하나를 그대로 쓴다."""
    override = (voice.get("characters") or {}).get(character)
    if voice.get("provider") == "qwen3-local" or not override:
        return voice
    return {**voice, **override}


def _estimate(cfg: dict, cuts) -> float:
    """초당 단가가 있으면 길이 합으로, 없으면 컷당 고정가로."""
    per_sec = cfg.get("cost_per_second_usd")
    if per_sec is not None:
        return sum(c.seconds for c in cuts) * float(per_sec)
    return len(cuts) * float(cfg.get("cost_per_cut_usd", 0.6))


def _check_duration(cfg: dict, cut) -> None:
    lo, hi = cfg.get("duration_min_sec"), cfg.get("duration_max_sec")
    if (lo is not None and cut.seconds < float(lo)) or (hi is not None and cut.seconds > float(hi)):
        raise StepFailed(f"컷 {cut.n} 길이 {cut.seconds:g}초가 모델 허용 범위({lo}~{hi}초) 밖입니다. 컷표를 고치세요.")


def _needs_end_frame(cfg: dict) -> bool:
    return "{end_keyframe}" in json.dumps(cfg.get("body", {}), ensure_ascii=False)


def _check_coverage(windows: list[tuple[float, float]], total: float, max_gap: float = 0.6) -> None:
    """설계 10 §1: 모든 프레임에 대사가 있어야 한다. 겹침과 긴 공백은 돈 쓰기 전에 멈춘다."""
    prev_end = 0.0
    for i, (start, end) in enumerate(windows, 1):
        if start < prev_end - 0.05:
            raise StepFailed(f"{i}번 대사가 앞 대사와 겹칩니다 ({start:.2f} < {prev_end:.2f}). 대사 시각을 뒤로 미루세요.")
        if start - prev_end > max_gap:
            raise StepFailed(f"{i}번 대사 앞에 {start - prev_end:.2f}초 공백이 있습니다 (허용 {max_gap}초). 대사 시각을 당기세요.")
        prev_end = max(prev_end, end)
    if total - prev_end > max_gap + 0.05:
        raise StepFailed(f"마지막 대사가 끝난 뒤 {total - prev_end:.2f}초가 비어 있습니다 (허용 {max_gap}초). 끝 컷을 줄이거나 대사를 미루세요.")


WATERMARK = "워터마크.png"


def _watermark(ep: Episode) -> str:
    """03-소재/워터마크.png 가 있으면 렌더가 오른쪽 아래에 반투명으로 얹는다."""
    return WATERMARK if (ep.assets_dir / WATERMARK).is_file() else ""


def _dialogue_payload(plan, windows: list[tuple[float, float]] | None = None) -> list[dict]:
    items = [
        {"at": d.at, "character": d.character, "text": d.text, "direction": getattr(d, "direction", ""),
         "english": getattr(d, "english", "")}
        for d in plan.dialogues
    ]
    # 실제 발화 구간. 웹 스토리보드의 대사 띠가 읽는다. 렌더는 at만 쓴다.
    for item, (start, end) in zip(items, windows or []):
        item["speechStart"], item["speechEnd"] = round(start, 2), round(end, 2)
    return items


def _synthesize(ep: Episode, plan, voice: dict) -> list[tuple[Path, float, float]]:
    """대사마다 mp3 하나를 만들고 (경로, 발화 시작, 발화 끝)을 편 기준 절대초로 돌려준다."""
    tts_dir = ep.assets_dir / "tts"
    tts_dir.mkdir(parents=True, exist_ok=True)
    out: list[tuple[Path, float, float]] = []
    for index, dialogue in enumerate(plan.dialogues, 1):
        path = tts_dir / f"dialogue-{index:02d}.mp3"
        asyncio.run(_speak(dialogue.text, path, _voice_for(voice, getattr(dialogue, "character", ""))))
        # Edge의 문장 경계 이벤트는 문장 뒤 쉼까지 발화로 세어 실제 소리보다 0.5~1초 길게 나온다
        # (1화 실측: 5.2초 소리를 6.1초로 보고). 공백·겹침 판정은 소리가 있는 구간으로 해야 하므로
        # 합성 결과 오디오에서 직접 잰다.
        begin, finish = _speech_bounds(path)
        out.append((path, dialogue.at + begin, dialogue.at + finish))
    return out


SILENCE_DB = -45  # 이보다 작은 소리는 무음으로 본다. Edge mp3의 앞뒤 무음은 디지털 0에 가깝다.


def _trimmed_seconds(path: Path, filters: str) -> float:
    res = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-af", filters, "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if res.returncode != 0:
        raise StepFailed(f"발화 구간 측정 실패 {path.name}: {res.stderr[-300:]}")
    # -f null 은 길이를 안 알려 주므로 실제로 잘라 wav 로 쓰고 잰다
    tmp = path.with_suffix(".trim.wav")
    res = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(path), "-af", filters, str(tmp)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if res.returncode != 0:
        raise StepFailed(f"발화 구간 측정 실패 {path.name}: {res.stderr[-300:]}")
    try:
        return audio_duration(tmp)
    finally:
        tmp.unlink(missing_ok=True)


def _speech_bounds(path: Path) -> tuple[float, float]:
    """mp3 안에서 실제 소리가 시작·끝나는 초. 앞 무음을 떼면 시작, 앞뒤 무음을 떼면 길이가 나온다."""
    total = audio_duration(path)
    lead_trim = f"silenceremove=start_periods=1:start_threshold={SILENCE_DB}dB"
    without_lead = _trimmed_seconds(path, lead_trim)
    speech = _trimmed_seconds(path, f"{lead_trim},areverse,{lead_trim},areverse")
    begin = max(0.0, total - without_lead)
    return round(begin, 3), round(begin + speech, 3)


def _build_audio(ep: Episode, plan, synthesized: list[tuple[Path, float, float]]) -> str:
    """Place character dialogue on the plan clock and add a subtle sound bed."""
    if not plan.dialogues:
        return ""

    dialogue_paths = [p for p, _, _ in synthesized]

    total = plan.total_seconds
    args = ["ffmpeg", "-y", "-loglevel", "error"]
    for path in dialogue_paths:
        args += ["-i", str(path)]

    # Procedural sounds keep the episode self-contained. Room tone always; the
    # kitchen set (whisk, pan sizzle, egg crack, plate) only when the plan's
    # 환경음 is a kitchen — an office skit must not sizzle.
    kitchen = "주방" in getattr(plan, "sound", {}).get("환경음", "")
    args += [
        "-f", "lavfi", "-t", f"{total:g}", "-i",
        "anoisesrc=color=pink:amplitude=0.018:r=44100",
    ]
    if kitchen:
        args += [
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
    filters.append(f"[{base}:a]lowpass=f=1100,volume=0.22,aformat=channel_layouts=stereo[room]")
    mix_labels.append("[room]")
    if kitchen:
        filters += [
            f"[{base + 1}:a]highpass=f=1700,lowpass=f=7600,volume=0.50,"
            "afade=t=in:d=0.35,afade=t=out:st=10.4:d=0.6,adelay=12000:all=1[sizzle]",
            f"[{base + 2}:a]highpass=f=2400,lowpass=f=9000,volume=0.34,"
            "afade=t=in:d=0.15,afade=t=out:st=4.0:d=0.5,adelay=6800:all=1[whisk]",
            f"[{base + 3}:a]volume=0.10,adelay=2050:all=1[crack]",
            f"[{base + 4}:a]volume=0.075,adelay=24000:all=1[plate]",
        ]
        mix_labels += ["[sizzle]", "[whisk]", "[crack]", "[plate]"]
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

    # 대사를 먼저 합성·검사해야 유료 영상 요청 전에 빈 구간을 발견한다.
    synthesized: list[tuple[Path, float, float]] = []
    if plan.dialogues:
        print("  대사 합성 중...")
        synthesized = _synthesize(ep, plan, load_voice(ep, freeze=True))
        _check_coverage([(s, e) for _, s, e in synthesized], plan.total_seconds)

    todo = [c for c in plan.cuts if not (raw_dir / f"{c.n:02d}.mp4").exists() and not (clip_dir / f"{c.n:02d}.mp4").exists()]
    for cut in todo:
        _check_duration(cfg, cut)
    est = _estimate(cfg, todo)
    cap = float(cfg.get("max_cost_per_episode_usd", 10))
    spent = float(state.load(ep).get("fal_spent_usd", 0.0))
    print(f"  생성할 컷 {len(todo)}개 · 예상 ${est:.2f} (누적 ${spent:.2f}, 상한 ${cap:.0f})")
    if todo:
        if spent + est > cap:
            raise StepFailed(f"편당 비용 상한 ${cap:.0f}를 넘깁니다 (누적 ${spent:.2f} + 예상 ${est:.2f}). config/fal-chain.yaml 을 조정하거나 컷을 줄이세요.")
        key = os.environ.get("FAL_KEY")
        if not key:
            raise MissingKey("FAL_KEY 가 없습니다. https://fal.ai/dashboard/keys 에서 발급해 pipeline/.env 에 넣으세요.")

    failed = []
    for cut in todo:
        start = ep.clips_dir / start_frame_name(plan, cut)
        end = ep.clips_dir / end_frame_name(cut)
        if not start.exists():
            print(f"  ! 컷 {cut.n:02d} 시작 프레임 없음({start.name}) — 건너뜀")
            failed.append(cut.n)
            continue
        if _needs_end_frame(cfg) and not end.exists():
            print(f"  ! 컷 {cut.n:02d} 끝 프레임 없음({end.name}) — 건너뜀. 설정이 끝 프레임을 요구합니다.")
            failed.append(cut.n)
            continue
        prompt = _video_prompt(plan, cut)
        print(f"  컷 {cut.n:02d} 생성 (fal, {cut.seconds:g}초) — {prompt[:70]}")
        try:
            fal.generate(cfg, key, raw_dir / f"{cut.n:02d}.mp4", {
                "prompt": prompt,
                "keyframe": fal.data_uri(start),
                "end_keyframe": fal.data_uri(end) if end.exists() else "",
                "seconds": f"{cut.seconds:g}",
                "sheet": fal.data_uri(sheet) if sheet.exists() else "",
            })
            spent += _estimate(cfg, [cut])
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
    narration = _build_audio(ep, plan, synthesized) if synthesized else ""
    payload = {
        "fps": 30, "width": 1080, "height": 1920, "durationSec": total,
        "title": plan.title, "hook": plan.hook,
        "template": plan.template_id, "templateName": plan.template_name, "channelLabel": plan.meta.get("채널", ""),
        "lines": lines,
        "comments": [],
        "dialogues": _dialogue_payload(plan, [(s, e) for _, s, e in synthesized]),
        "narration": narration, "bgm": None, "credits": [],
        "watermark": _watermark(ep),
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
    synthesized = _synthesize(ep, plan, load_voice(ep, freeze=True)) if plan.dialogues else []
    if synthesized:
        _check_coverage([(s, e) for _, s, e in synthesized], plan.total_seconds)
    timeline["narration"] = _build_audio(ep, plan, synthesized) if synthesized else ""
    timeline.update(title=plan.title, hook=plan.hook, sound=plan.sound, watermark=_watermark(ep))
    timeline["dialogues"] = _dialogue_payload(plan, [(s, e) for _, s, e in synthesized])
    timeline_file.write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    write_manifest(ep)
