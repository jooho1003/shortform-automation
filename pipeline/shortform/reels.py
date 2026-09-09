"""릴스 기획 — 레퍼런스 릴스 메타·다운로드·대본 추출.

웹 콘솔이 부른다. 판단은 하지 않고 파일만 만든다.

    python -m shortform reels meta       --url <url>
    python -m shortform reels fetch      --url <url> --dir 릴스기획/<id>
    python -m shortform reels transcribe --dir 릴스기획/<id>

대본은 유튜브면 자동 자막(vtt), 아니면 faster-whisper(선택 의존성). 둘 다 없으면 실패 코드 1과 안내를 낸다.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from . import StepFailed
from .paths import ROOT

VIDEO_NAME = "원본.mp4"
SUBS_STEM = "자막"
ANALYSIS_JSON = "분석.json"
ANALYSIS_SRT = "분석.srt"


def _ytdlp(args: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "yt_dlp", *args, "--no-warnings"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
    )


def _provider(url: str) -> str:
    if re.search(r"youtube\.com|youtu\.be", url):
        return "youtube"
    if "instagram.com" in url:
        return "instagram"
    if "tiktok.com" in url:
        return "tiktok"
    return "other"


def _project_dir(rel: str) -> Path:
    p = (ROOT / rel).resolve()
    if ROOT.resolve() not in p.parents:
        raise StepFailed("프로젝트 폴더가 저장소 밖입니다.")
    p.mkdir(parents=True, exist_ok=True)
    return p


def meta(url: str) -> dict:
    res = _ytdlp(["-j", "--no-download", "--no-playlist", url], timeout=120)
    if res.returncode != 0:
        raise StepFailed(f"메타를 읽지 못했습니다: {res.stderr.strip()[-400:]}")
    line = next((l for l in res.stdout.splitlines() if l.startswith("{")), "")
    if not line:
        raise StepFailed("yt-dlp가 JSON을 주지 않았습니다.")
    info = json.loads(line)
    upload_date = info.get("upload_date")
    return {
        "url": info.get("webpage_url") or url,
        "provider": _provider(url),
        "video_id": str(info.get("id") or ""),
        "title": info.get("title") or "",
        "author": info.get("uploader") or info.get("channel") or info.get("uploader_id") or "",
        "views": info.get("view_count"),
        "likes": info.get("like_count"),
        "duration": info.get("duration"),
        "thumb": info.get("thumbnail"),
        "upload_date": f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}" if upload_date and len(upload_date) == 8 else None,
    }


def fetch(url: str, rel_dir: str) -> dict:
    d = _project_dir(rel_dir)
    video = d / VIDEO_NAME
    info = meta(url)
    print(f"  {info['provider']} · {info['title'][:60]}")
    if not video.exists():
        print("  영상 내려받는 중...")
        res = _ytdlp([
            url, "--no-playlist",
            "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best",
            "--merge-output-format", "mp4",
            "-o", str(d / "원본.%(ext)s"),
        ])
        if res.returncode != 0 or not video.exists():
            # ext가 mp4가 아니게 떨어진 경우를 잡는다
            alt = next((p for p in d.glob("원본.*") if p.suffix.lower() in {".mp4", ".webm", ".mkv", ".mov"}), None)
            if alt and alt != video:
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(alt), "-c:v", "libx264", "-c:a", "aac", str(video)],
                               capture_output=True)
                if video.exists():
                    alt.unlink(missing_ok=True)
            if not video.exists():
                raise StepFailed(f"영상을 받지 못했습니다: {res.stderr.strip()[-400:]}")
    else:
        print("  영상 있음 — 건너뜀")

    subs = None
    if info["provider"] == "youtube":
        print("  자막 확인 중...")
        _ytdlp([url, "--skip-download", "--write-auto-subs", "--write-subs", "--sub-langs", "ko,ko-orig,en",
                "--sub-format", "vtt", "-o", str(d / SUBS_STEM)], timeout=300)
        found = sorted(d.glob(f"{SUBS_STEM}*.vtt"))
        if found:
            subs = found[0].name
            print(f"  자막 → {subs}")
        else:
            print("  자막 없음 — transcribe에서 whisper를 씁니다")

    return {"video": f"{rel_dir}/{VIDEO_NAME}", "subs": f"{rel_dir}/{subs}" if subs else None, "meta": info}


def _srt(cues: list[dict]) -> str:
    def stamp(s: float) -> str:
        ms = int(round(s * 1000))
        h, ms = divmod(ms, 3_600_000)
        m, ms = divmod(ms, 60_000)
        sec, ms = divmod(ms, 1000)
        return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"
    out = []
    for i, c in enumerate(cues, 1):
        out.append(f"{i}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}\n")
    return "\n".join(out)


def _whisper(video: Path) -> tuple[list[dict], str]:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:
        raise StepFailed(
            "자막이 없어 음성 인식이 필요합니다. venv에 설치하세요:\n"
            "  .venv\\Scripts\\python -m pip install faster-whisper\n"
            "(첫 실행 때 모델 ~500MB를 내려받습니다)"
        ) from exc
    print("  faster-whisper(small) 인식 중... 첫 실행은 모델을 내려받습니다")
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(video), language=None, vad_filter=True)
    cues = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments if s.text.strip()]
    return cues, info.language or "ko"


def transcribe(rel_dir: str) -> dict:
    d = _project_dir(rel_dir)
    video = d / VIDEO_NAME
    vtts = sorted(d.glob(f"{SUBS_STEM}*.vtt"))
    if vtts:
        from .steps.segments import _parse_vtt  # PIL이 필요해 지연 import
        cues = _parse_vtt(vtts[0].read_text(encoding="utf-8", errors="replace"))
        source, language = "youtube-auto-subs", ("ko" if ".ko" in vtts[0].name else "en")
        print(f"  자막 큐 {len(cues)}개 ({vtts[0].name})")
    elif video.exists():
        cues, language = _whisper(video)
        source = "whisper"
        print(f"  인식 큐 {len(cues)}개 ({language})")
    else:
        raise StepFailed("원본 영상도 자막도 없습니다. fetch를 먼저 실행하세요.")

    cues = [{"start": float(c["start"]), "end": float(c["end"]), "text": str(c["text"]).strip()} for c in cues if str(c.get("text", "")).strip()]
    analysis_path = d / ANALYSIS_JSON
    existing = json.loads(analysis_path.read_text(encoding="utf-8")) if analysis_path.exists() else {}
    analysis = {
        **existing,
        "source": source,
        "language": language,
        "transcript": cues,
        "structure": existing.get("structure"),
        "analyzed_at": datetime.now().isoformat(timespec="seconds"),
    }
    analysis_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")
    (d / ANALYSIS_SRT).write_text(_srt(cues), encoding="utf-8")
    print(f"  → {ANALYSIS_JSON}, {ANALYSIS_SRT}")
    return {"cues": len(cues), "source": source, "language": language}


def main(args) -> int:
    if args.reels_cmd == "meta":
        print(json.dumps(meta(args.url), ensure_ascii=False, indent=2))
    elif args.reels_cmd == "fetch":
        result = fetch(args.url, args.dir)
        print("RESULT " + json.dumps(result, ensure_ascii=False))
    elif args.reels_cmd == "transcribe":
        result = transcribe(args.dir)
        print("RESULT " + json.dumps(result, ensure_ascii=False))
    return 0
