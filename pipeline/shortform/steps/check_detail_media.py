"""상세페이지 미디어 검사 — 숏폼(check_frames)과 분리된 가로·세로 혼용 규격.

check_frames 는 A안 숏폼 전용이라 9:16만 통과시킨다. 상세페이지는 4:5 제품컷과 3:2 매크로·CGI를
섞어 쓰므로 허용 비율이 다르다. 두 규격이 서로를 망가뜨리지 않도록 검사를 따로 둔다.

기계가 볼 수 있는 것만 본다 — 비율·해상도·길이·재생 가능 여부. 연출 품질은 사람이 프리뷰로 본다.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from PIL import Image

# 상세페이지에서 실제로 쓰는 비율. 이름은 보고서에 그대로 들어간다.
RATIOS: dict[str, float] = {
    "4:5": 4 / 5,
    "3:2": 3 / 2,
    "1:1": 1.0,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
}
RATIO_TOL = 0.03
# check_frames 는 세로만 봐서 941px 너비가 그냥 통과했다. 여기서는 짧은 변을 본다.
MIN_SHORT_SIDE = 720
MAX_SECONDS = 12.0
REPORT = "미디어검사.json"


class ProbeUnavailable(RuntimeError):
    """ffprobe 가 없어 영상 규격을 읽지 못함."""


def match_ratio(width: int, height: int) -> str | None:
    """허용 비율 중 가장 가까운 이름. 허용 오차를 벗어나면 None."""
    if width <= 0 or height <= 0:
        return None
    actual = width / height
    best, gap = None, RATIO_TOL
    for name, value in RATIOS.items():
        d = abs(actual - value)
        if d <= gap:
            best, gap = name, d
    return best


def probe_video(path: Path) -> dict:
    """ffprobe 로 첫 비디오 스트림의 크기·길이를 읽는다."""
    try:
        res = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height:format=duration",
             "-of", "json", str(path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except FileNotFoundError as exc:
        raise ProbeUnavailable("ffprobe 가 없습니다. ffmpeg 를 설치하면 영상 규격까지 검사합니다.") from exc
    if res.returncode != 0:
        raise ValueError(res.stderr[-200:] or "ffprobe 실패")
    data = json.loads(res.stdout or "{}")
    streams = data.get("streams") or []
    if not streams:
        raise ValueError("비디오 스트림이 없습니다.")
    duration = data.get("format", {}).get("duration")
    return {
        "width": int(streams[0].get("width") or 0),
        "height": int(streams[0].get("height") or 0),
        "seconds": round(float(duration), 3) if duration else 0.0,
    }


def _entry(name: str, width: int, height: int, seconds: float | None, error: str = "") -> dict:
    ratio = match_ratio(width, height)
    short = min(width, height) if width and height else 0
    item = {
        "name": name,
        "width": width,
        "height": height,
        "ratio": ratio,
        "ratio_ok": ratio is not None,
        "size_ok": short >= MIN_SHORT_SIDE,
    }
    if seconds is not None:
        item["seconds"] = seconds
        item["duration_ok"] = 0 < seconds <= MAX_SECONDS
    if error:
        item["error"] = error
    return item


def check_media(media_dir: Path, expected: list[str] | None = None) -> dict:
    """media_dir 의 mp4·포스터를 검사하고 보고서를 쓴다.

    expected 는 있어야 하는 파일 이름 목록(예: ['section-1.mp4']). 누락은 missing 에 들어간다.
    """
    media_dir.mkdir(parents=True, exist_ok=True)
    files: list[dict] = []
    probe_missing = False

    for path in sorted(media_dir.iterdir()):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in (".mp4", ".webm"):
            try:
                info = probe_video(path)
                files.append(_entry(path.name, info["width"], info["height"], info["seconds"]))
            except ProbeUnavailable:
                probe_missing = True
                files.append(_entry(path.name, 0, 0, None, "ffprobe 없음 — 검사 보류"))
            except (ValueError, json.JSONDecodeError) as exc:
                files.append(_entry(path.name, 0, 0, None, f"읽을 수 없음: {exc}"))
        elif suffix in (".png", ".jpg", ".jpeg", ".webp"):
            try:
                with Image.open(path) as img:
                    w, h = img.size
                files.append(_entry(path.name, w, h, None))
            except OSError:
                files.append(_entry(path.name, 0, 0, None, "열 수 없음"))

    names = {f["name"] for f in files}
    missing = [n for n in (expected or []) if n not in names]
    problems = [
        f["name"] for f in files
        if f.get("error") or not f["ratio_ok"] or not f["size_ok"] or f.get("duration_ok") is False
    ]
    report = {
        "files": files,
        "missing": missing,
        "problems": problems,
        # ffprobe 가 없으면 영상은 판정을 보류한다. 보류를 통과로 적지 않는다.
        "probe_available": not probe_missing,
        "ok": not missing and not problems,
    }
    (media_dir / REPORT).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report
