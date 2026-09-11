"""소재. 승인된 클립을 받아 9:16으로 자르고, TTS 내레이션과 자막 타이밍을 만든다.

설계 문서 5.3절.

설계와 다른 점 — 자막 타이밍을 faster-whisper 재전사로 얻지 않는다. 이유는 둘이다.

1. edge-tts 7.2.8은 WordBoundary를 주지 않는다(한국어·영어 모두 확인). SentenceBoundary만 온다.
2. whisper는 강제 정렬기가 아니라 전사기다. 자기가 들은 단어를 돌려주므로 대본 단어와
   다시 맞추는 퍼지 매칭이 필요하고, 그 매칭이 틀리면 타이밍도 같이 틀어진다.

그래서 문장 구간은 합성기가 준 SentenceBoundary(정확한 값)를 쓰고,
그 안에서 어절 위치만 글자 수 비례로 추정한다. 어절 하이라이트는 몇십 ms 어긋날 수 있다.
정확도가 더 필요해지면 강제 정렬기(MFA 등)를 이 자리에 끼우면 된다.
"""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

import edge_tts
import yaml

from .. import USER_AGENT, StepFailed
from .. import planfile
from ..paths import BGM, CONFIG, DATA, Episode

CACHE = DATA / "cache"
from ..templates import load_catalog, validate_duration

GAP = 0.18          # 문장 사이 간격(초)
TICKS = 10_000_000  # edge-tts offset 단위: 100ns


def _run(args: list[str]) -> None:
    result = subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        raise StepFailed(f"{args[0]} 실패\n{result.stderr[-800:]}")


def _duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise StepFailed(f"ffprobe 실패: {path}")
    return float(result.stdout.strip())


def speech_text(text: str, pronunciations: dict[str, str]) -> str:
    """표시용 원문을 건드리지 않고 합성용 표기만 문자 그대로 치환한다."""
    if not pronunciations:
        return text
    keys = sorted(pronunciations, key=len, reverse=True)
    pattern = re.compile("|".join(re.escape(key) for key in keys))
    return pattern.sub(lambda match: pronunciations[match.group(0)], text)


async def _speak(text: str, out: Path, voice: dict) -> tuple[float, float]:
    """한 문장을 합성하고, 실제로 말이 시작되고 끝나는 초를 돌려준다."""
    communicate = edge_tts.Communicate(
        speech_text(text, voice.get("pronunciations", {})),
        voice["voice"],
        rate=voice.get("rate", "+0%"),
        volume=voice.get("volume", "+0%"),
        pitch=voice.get("pitch", "+0Hz"),
    )
    audio = bytearray()
    start, end = None, None
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
        elif chunk["type"] == "SentenceBoundary":
            begin = chunk["offset"] / TICKS
            start = begin if start is None else min(start, begin)
            finish = (chunk["offset"] + chunk["duration"]) / TICKS
            end = finish if end is None else max(end, finish)
    out.write_bytes(bytes(audio))
    return start or 0.0, end or 0.0


def _distribute(
    text: str, start: float, end: float, pronunciations: dict[str, str] | None = None
) -> list[dict]:
    """문장 구간을 어절에 글자 수 비례로 나눈다. 문장 끝 문장부호에는 쉬는 몫을 더 준다."""
    tokens = text.split()
    if not tokens or end <= start:
        return []
    pronunciations = pronunciations or {}
    weights = [
        len(re.sub(r"\s+", "", speech_text(token.rstrip(".,!?…~"), pronunciations)))
        + (1.4 if token[-1] in ".?!…" else 0.6 if token[-1] == "," else 0)
        for token in tokens
    ]
    total = sum(weights) or 1.0
    span = end - start
    words, cursor = [], start
    for token, weight in zip(tokens, weights):
        length = span * weight / total
        words.append({"text": token, "start": round(cursor, 3), "end": round(cursor + length, 3)})
        cursor += length
    return words


def _download(url: str, out: Path) -> None:
    if out.exists() and out.stat().st_size > 0:
        return
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response, out.open("wb") as f:
        while block := response.read(1 << 16):
            f.write(block)


def _fetch_youtube(video_id: str) -> Path:
    """원본을 캐시에 통째로 받아 두고 경로를 돌려준다. 자르는 건 부르는 쪽이 로컬에서 한다.

    예전에는 `--download-sections`로 구간만 받았다. 그러면 yt-dlp가 원격 URL을 ffmpeg에
    넘겨 `-ss`로 seek 하는데, 짧은 영상에서는 되지만 긴 영상에서는 사실상 멈춘다 —
    76분 원본에서 83분을 돌고도 0바이트였다. `segments` 단계가 같은 이유로 이미 통째
    받기로 바꿨는데(작업기록 삽질 15) 이 단계만 남아 있었다.

    720p로 받는다. 최종 화면에서 클립이 차지하는 건 940px 띠의 약 70% 폭이라
    1080p를 받아 봐야 버린다. 같은 영상에서 여러 편을 뽑을 때 캐시가 그대로 재사용된다.
    """
    CACHE.mkdir(parents=True, exist_ok=True)
    existing = [p for p in CACHE.glob(f"{video_id}-src.*")
                if p.suffix != ".part" and p.stat().st_size > 0]
    if existing:
        return existing[0]

    result = subprocess.run(
        [sys.executable, "-m", "yt_dlp", f"https://www.youtube.com/watch?v={video_id}",
         "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]",
         "--merge-output-format", "mp4", "--no-warnings",
         "-o", str(CACHE / f"{video_id}-src.%(ext)s")],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    found = [p for p in CACHE.glob(f"{video_id}-src.*")
             if p.suffix != ".part" and p.stat().st_size > 0]
    if not found:
        raise StepFailed(f"유튜브 원본 내려받기 실패 {video_id}\n{result.stderr[-600:]}")
    return found[0]


def _display_size(width: int, height: int, rotation: int | float = 0) -> tuple[int, int]:
    return (height, width) if abs(int(rotation)) % 180 == 90 else (width, height)


def _probe_display_size(path: Path) -> tuple[int, int]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation",
         "-of", "json", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0:
        raise StepFailed(f"ffprobe 실패: {path}")
    try:
        stream = json.loads(result.stdout)["streams"][0]
        rotation = stream.get("tags", {}).get("rotate", 0)
        for side_data in stream.get("side_data_list", []):
            if "rotation" in side_data:
                rotation = side_data["rotation"]
                break
        return _display_size(int(stream["width"]), int(stream["height"]), float(rotation))
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise StepFailed(f"ffprobe 화면 크기를 읽지 못했습니다: {path}") from exc


def _manual_media_layout(entry: dict) -> str:
    layout = entry.get("media_layout", "landscape")
    if layout not in {"landscape", "portrait"}:
        raise StepFailed("수동 클립 media_layout은 landscape 또는 portrait여야 합니다.")
    return layout


BAND_H = 940   # 가로 소재를 얹을 띠의 높이
BAND_Y = 200   # 띠의 위쪽 여백. 자막과 댓글 카드가 아래에 들어갈 자리를 남긴다


def _to_9x16(
    src: Path,
    out: Path,
    seconds: float,
    start: float = 0.0,
    display_size: tuple[int, int] | None = None,
) -> None:
    """세로 1080x1920으로 맞춘다.

    세로 소재는 채워서 자른다.

    가로 소재(방송 클립은 전부 16:9)는 두 극단 사이에서 타협한다. 꽉 채워 자르면
    폭의 70%가 날아가 인물이 잘리고, 폭에만 맞추면 세로의 32%만 차지해 블러 액자
    속 작은 영상처럼 보인다. 그래서 높이 940px 띠에 맞춰 적당히 확대하고(폭은 약
    70%가 남는다) 화면 위쪽에 얹은 뒤, 나머지를 같은 화면의 흐린 확대본으로 채운다.
    """
    width, height = display_size or _probe_display_size(src)
    if width > height:
        video_filter = (
            "[0:v]split=2[bg][fg];"
            "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,boxblur=40:2[bgb];"
            f"[fg]scale=1080:{BAND_H}:force_original_aspect_ratio=increase,"
            f"crop=1080:{BAND_H}[fgs];"
            f"[bgb][fgs]overlay=0:{BAND_Y},fps=30[v]"
        )
        # 필터를 쓰면 매핑이 명시로 바뀐다. 오디오는 없을 수도 있으니 `?`로 받는다.
        args = ["-filter_complex", video_filter, "-map", "[v]", "-map", "0:a?"]
    else:
        args = ["-vf", "scale=1080:1920:force_original_aspect_ratio=increase,"
                       "crop=1080:1920,fps=30"]

    # 원음을 남긴다. 원음 중심 템플릿에서는 이게 콘텐츠 자체다. TTS 템플릿에서는
    # 렌더가 클립을 음소거하므로 남아 있어도 들리지 않는다.
    _run([
        "ffmpeg", "-y", "-ss", f"{start:.3f}", "-stream_loop", "-1", "-i", str(src),
        "-t", f"{seconds:.3f}", *args,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-c:a", "aac", "-b:a", "192k", "-ac", "2",
        "-pix_fmt", "yuv420p", str(out),
    ])


def run(ep: Episode) -> None:
    plan = planfile.load(ep.plan_md)
    entries = {e["n"]: e for e in json.loads(ep.clip_list.read_text(encoding="utf-8"))}
    voice = yaml.safe_load((CONFIG / "voice.yaml").read_text(encoding="utf-8"))

    tts_dir = ep.assets_dir / "tts"
    raw_dir = ep.assets_dir / "원본"
    clip_dir = ep.assets_dir / "클립"
    for d in (tts_dir, raw_dir, clip_dir):
        d.mkdir(parents=True, exist_ok=True)

    template = load_catalog().by_id(plan.template_id)
    use_tts = template.narration == "tts"

    # 1. 타임라인 만들기.
    #    TTS 템플릿은 합성한 내레이션 길이가 기준이고,
    #    원음 템플릿은 클립 구간 길이가 기준이다(TTS를 만들지 않는다).
    timeline: list[dict] = []
    cursor = 0.0
    if not use_tts:
        for line in plan.lines:
            seconds = entries[line.n].get("seconds")
            if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or seconds <= 0:
                raise StepFailed(
                    f"{line.n}번 클립에 길이(seconds)가 없습니다. "
                    f"{template.name}는 TTS 대신 클립 구간이 길이를 정하므로 "
                    "클립목록.json에 seconds를 적어야 합니다."
                )
            timeline.append({
                "n": line.n,
                "text": line.text,
                "start": round(cursor, 3),
                "end": round(cursor + float(seconds), 3),
                "words": [],
            })
            cursor += float(seconds)
        total = round(cursor, 3)
    else:
        print("  내레이션 합성 중...")
        for line in plan.lines:
            mp3 = tts_dir / f"{line.n:02d}.mp3"
            speech_start, speech_end = asyncio.run(_speak(line.text, mp3, voice))
            length = _duration(mp3)
            timeline.append(
                {
                    "n": line.n,
                    "text": line.text,
                    "start": round(cursor, 3),
                    "end": round(cursor + length, 3),
                    "words": _distribute(
                        line.text,
                        cursor + speech_start,
                        cursor + min(speech_end, length),
                        voice.get("pronunciations", {}),
                    ),
                }
            )
            cursor += length + GAP
        total = round(cursor - GAP, 3)

    warning = validate_duration(plan.template_id, total)
    if warning:
        print(f"  {warning}")

    # 2. 내레이션 하나로 합치기 (원음 템플릿은 만들지 않는다)
    if use_tts:
        silence = ep.assets_dir / "gap.mp3"
        _run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
              "-t", str(GAP), "-c:a", "libmp3lame", str(silence)])
        concat_list = ep.assets_dir / "concat.txt"
        parts = []
        for index, line in enumerate(plan.lines):
            parts.append(f"file '{(tts_dir / f'{line.n:02d}.mp3').as_posix()}'")
            if index < len(plan.lines) - 1:
                parts.append(f"file '{silence.as_posix()}'")
        concat_list.write_text("\n".join(parts), encoding="utf-8")
        narration = ep.assets_dir / "narration.mp3"
        _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
              "-c:a", "libmp3lame", "-b:a", "192k", str(narration)])

    # 3. 클립 내려받고 9:16으로 자르기
    print("  클립 내려받는 중...")
    credits = []
    for item in timeline:
        entry = entries[item["n"]]
        out = clip_dir / f"{item['n']:02d}.mp4"
        needed = item["end"] - item["start"]
        if entry["chosen"] is None:
            item["mediaLayout"] = _manual_media_layout(entry)
            if not out.exists():
                raise StepFailed(f"{item['n']}번 클립이 없습니다: {out}")
        else:
            chosen = entry["candidates"][entry["chosen"]]
            origin = 0.0   # 원본에서 어디를 떠왔는지. 출처 기록용
            cut_from = 0.0  # 받아 둔 파일 안에서 어디부터 자를지
            if chosen["provider"] == "youtube":
                # 발췌 지점은 클립 단계에서 정해 컨택트시트로 확인받은 값이다.
                origin = min(chosen["start"], max(0.0, chosen["duration"] - needed - 1))
                print(f"    {item['n']}번 방송 클립 {origin:.0f}s 부근 — {chosen['author']}")
                # 캐시에는 원본이 통째로 있다. seek 이 로컬이라 즉시 끝난다.
                src = _fetch_youtube(chosen["id"])
                cut_from = origin
            else:
                src = raw_dir / f"{item['n']:02d}.mp4"
                _download(chosen["download"], src)
            display_size = _probe_display_size(src)
            item["mediaLayout"] = (
                "landscape" if display_size[0] > display_size[1] else "portrait"
            )
            _to_9x16(src, out, needed, cut_from, display_size)
            credits.append(
                {"n": item["n"], "provider": chosen["provider"], "author": chosen["author"],
                 "page": chosen["page"], "title": chosen.get("title", ""),
                 "start": round(origin, 1), "seconds": round(needed, 1)}
            )
        item["clip"] = f"클립/{item['n']:02d}.mp4"

    # 4. 타임라인 저장
    bgm = sorted(BGM.glob("*.mp3"))
    payload = build_payload(
        plan, timeline, total, bgm[0].name if bgm else None, credits,
        "narration.mp3" if use_tts else "",
    )
    (ep.assets_dir / "타임라인.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  소재 완료 — 총 {total:.1f}초, 클립 {len(timeline)}개")


def build_payload(
    plan: planfile.Plan,
    timeline: list[dict],
    total: float,
    bgm: str | None,
    credits: list[dict],
    narration: str = "narration.mp3",
) -> dict:
    """네트워크나 파일 접근 없이 기획과 측정 결과를 렌더 payload로 바꾼다.

    `narration`이 빈 문자열이면 내레이션이 없다는 뜻이고, 렌더는 클립 원음을 튼다.
    """
    channel_label = str(plan.meta.get("채널", "")).strip() or "SHORTFORM"
    return {
        "fps": 30,
        "width": 1080,
        "height": 1920,
        "durationSec": total,
        "title": plan.title,
        "hook": plan.hook,
        "template": plan.template_id,
        "templateName": plan.template_name,
        "channelLabel": channel_label,
        "lines": timeline,
        "comments": [{"at": c.at, "nick": c.nick, "text": c.text} for c in plan.comments],
        "narration": narration,
        "bgm": bgm,
        "credits": credits,
    }
