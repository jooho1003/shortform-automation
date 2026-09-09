"""클립. 문장별 화면 소재 후보를 모아 컨택트시트로 보여주고 승인 게이트에서 멈춘다.

설계 문서 5.2절. 소재 태그 두 가지를 자동으로 찾는다.

- `stock` : Pexels Video API. 저작권 걱정 없는 배경용.
- `clip`  : yt-dlp로 유튜브를 검색해 실제 방송 장면을 찾는다. 저작권이 살아 있으므로
            공식 채널 여부를 컨택트시트에 찍어 사람이 보고 고르게 한다.

`clip`은 Content ID 클레임이 붙을 수 있다는 걸 알고 쓰는 선택지다. 클레임이 붙으면
영상은 살아 있고 수익만 원저작권자에게 간다. 회피 목적의 화면 변형은 하지 않는다.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

import yaml
from PIL import Image, ImageDraw, ImageFont

from .. import USER_AGENT, GateBlocked, MissingKey, StepFailed
from .. import planfile
from ..paths import CONFIG, Episode

PEXELS = "https://api.pexels.com/videos/search"
THUMB = (270, 480)
COLUMNS = 5
FONT_PATH = "C:/Windows/Fonts/malgun.ttf"


def _pexels(query: str, per_page: int = 3) -> list[dict]:
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        raise MissingKey(
            "PEXELS_API_KEY 가 없습니다.\n"
            "  https://www.pexels.com/api/ 에서 가입하면 즉시 무료로 발급됩니다.\n"
            "  발급 후 새 터미널에서:  setx PEXELS_API_KEY 발급받은키"
        )
    url = f"{PEXELS}?" + urllib.parse.urlencode(
        {"query": query, "orientation": "portrait", "per_page": per_page}
    )
    request = urllib.request.Request(
        url, headers={"Authorization": key.strip(), "User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.load(response)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:160].replace("\n", " ")
        raise StepFailed(f"Pexels 검색 실패 ({e.code}) query={query} — {body}")

    results = []
    for video in data.get("videos", []):
        files = sorted(
            (f for f in video["video_files"] if f["file_type"] == "video/mp4" and f.get("height")),
            key=lambda f: abs(f["height"] - 1920),
        )
        if not files:
            continue
        results.append(
            {
                "provider": "pexels",
                "id": video["id"],
                "page": video["url"],
                "author": video["user"]["name"],
                "duration": video["duration"],
                "thumb": video["image"],
                "download": files[0]["link"],
                "width": files[0]["width"],
                "height": files[0]["height"],
            }
        )
    return results


def _channels_config() -> dict:
    return yaml.safe_load((CONFIG / "channels.yaml").read_text(encoding="utf-8"))


def _is_official(channel: str, hints: list[str]) -> bool:
    """채널명에 방송사 이름이 들어 있는지만 본다. 무단 재업로드도 걸리므로 힌트일 뿐이다."""
    name = (channel or "").lower()
    return any(hint.lower() in name for hint in hints)


def _youtube(query: str, config: dict) -> list[dict]:
    """yt-dlp로 유튜브를 검색한다. API 키가 필요 없고 채널명과 길이를 함께 준다."""
    count = config["candidates_per_line"]
    result = subprocess.run(
        [sys.executable, "-m", "yt_dlp", f"ytsearch{count * 2}:{query}",
         "--dump-json", "--flat-playlist", "--no-warnings"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if result.returncode != 0 and not result.stdout.strip():
        raise StepFailed(f"유튜브 검색 실패 query={query} — {result.stderr.strip()[-200:]}")

    hints = config["official_hints"]
    found = []
    for line in result.stdout.splitlines():
        if not line.strip().startswith("{"):
            continue
        item = json.loads(line)
        duration = item.get("duration") or 0
        if not item.get("id") or duration > config["max_duration"] or duration < 10:
            continue
        channel = item.get("channel") or item.get("uploader") or ""
        found.append(
            {
                "provider": "youtube",
                "id": item["id"],
                "page": f"https://www.youtube.com/watch?v={item['id']}",
                "author": channel,
                "title": (item.get("title") or "")[:120],
                "duration": duration,
                "views": item.get("view_count") or 0,
                "official": _is_official(channel, hints),
                "thumb": f"https://i.ytimg.com/vi/{item['id']}/hqdefault.jpg",
                # 발췌 시작 초. 인트로와 로고를 피해 앞쪽 25% 지점에서 뽑는다.
                # 클립목록.json에서 직접 고쳐도 된다.
                "start": round(duration * 0.25, 1),
            }
        )
    # 공식 채널을 앞으로 보내 기본 선택이 공식이 되게 한다
    found.sort(key=lambda c: (not c["official"], -c["views"]))
    return found[:count]


def _build_candidates(plan: planfile.Plan) -> list[dict]:
    config = _channels_config()
    entries = []
    for line in plan.lines:
        candidates: list[dict] = []
        for query in line.queries:
            if len(candidates) >= 3:
                break
            try:
                if line.source == "stock":
                    candidates += _pexels(query, per_page=3 - len(candidates))
                elif line.source == "clip":
                    candidates += _youtube(query + config["query_suffix"], config)
                else:
                    print(
                        f"    ! {line.n}번 소재 {line.source} 는 자동 검색이 없습니다. "
                        f"03-소재/클립/{line.n:02d}.mp4 에 직접 넣어 주세요."
                    )
                    break
            except StepFailed as e:
                print(f"    ! {e}")
        if not candidates:
            print(f"    ! {line.n}번 후보 0건 — 컨택트시트에 빈 칸으로 표시합니다.")
        elif line.source == "clip" and not candidates[0]["official"]:
            print(f"    ! {line.n}번 1순위가 공식 채널이 아닙니다: {candidates[0]['author']}")
        entries.append(
            {
                "n": line.n,
                "text": line.text,
                "source": line.source,
                "queries": line.queries,
                "chosen": 0 if candidates else None,
                "candidates": candidates,
            }
        )
    return entries


def _download_thumb(url: str) -> Image.Image | None:
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=30) as response:
            return Image.open(BytesIO(response.read())).convert("RGB")
    except Exception:
        return None


def _frame_at(video_id: str, seconds: float, cache: Path) -> Image.Image | None:
    """실제로 쓰일 지점의 프레임을 뽑는다.

    유튜브 썸네일은 문구가 박힌 홍보 이미지라 화면에 깔릴 장면과 다르다.
    영상을 통째로 받지 않고 스트림 URL에 직접 seek해서 한 장만 가져온다.
    """
    if cache.exists():
        return Image.open(cache).convert("RGB")
    urls = subprocess.run(
        [sys.executable, "-m", "yt_dlp", "-f", "bestvideo[height<=720]/best[height<=720]",
         "-g", f"https://www.youtube.com/watch?v={video_id}", "--no-warnings"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    stream = urls.stdout.strip().splitlines()
    if not stream:
        return None
    cache.parent.mkdir(parents=True, exist_ok=True)
    # -ss를 -i 앞에 두면 범위 요청으로 빠르게 건너뛴다. 다만 조각난 DASH 스트림에서는
    # 패킷을 못 받고 실패하므로, 그때는 -i 뒤로 옮겨 처음부터 디코딩한다(느리지만 확실).
    for args in (
        ["-ss", f"{seconds:.1f}", "-i", stream[0]],
        ["-i", stream[0], "-ss", f"{seconds:.1f}"],
    ):
        grab = subprocess.run(
            ["ffmpeg", "-y", *args, "-frames:v", "1", "-q:v", "3", str(cache)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if cache.exists():
            return Image.open(cache).convert("RGB")
    print(f"    ! 프레임 추출 실패 {video_id}: {grab.stderr.strip()[-150:]}")
    return None


def _fit(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> str:
    """셀 폭을 넘으면 잘라낸다. 한글은 글자 수로 못 자른다 — 실제 폭을 재야 한다."""
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "…", font=font) > max_width:
        text = text[:-1]
    return text + "…"


def _contact_sheet(entries: list[dict], out_path) -> None:
    try:
        font = ImageFont.truetype(FONT_PATH, 20)
        small = ImageFont.truetype(FONT_PATH, 17)
    except OSError:
        font = small = ImageFont.load_default()

    label_h = 70
    cell_w, cell_h = THUMB[0], THUMB[1] + label_h
    columns = min(COLUMNS, max(1, len(entries)))
    rows = (len(entries) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), "#14161a")
    draw = ImageDraw.Draw(sheet)
    frames = out_path.parent / "프레임"

    for index, entry in enumerate(entries):
        x = (index % columns) * cell_w
        y = (index // columns) * cell_h
        chosen = entry["candidates"][entry["chosen"]] if entry["chosen"] is not None else None

        if chosen:
            if chosen["provider"] == "youtube":
                cache = frames / f"{entry['n']:02d}-{chosen['id']}-{chosen['start']}.jpg"
                image = _frame_at(chosen["id"], chosen["start"], cache)
                if image is None:  # 스트림을 못 열면 썸네일이라도 보여준다
                    image = _download_thumb(chosen["thumb"])
            else:
                image = _download_thumb(chosen["thumb"])
            if image:
                # 방송 클립 썸네일은 16:9다. 세로 칸에 눌러 넣지 않고 폭에 맞춰 가운데 둔다.
                scaled_h = round(THUMB[0] * image.height / image.width)
                if scaled_h < THUMB[1]:
                    sheet.paste(image.resize((THUMB[0], scaled_h)),
                                (x, y + (THUMB[1] - scaled_h) // 2))
                else:
                    sheet.paste(image.resize(THUMB), (x, y))
        else:
            draw.rectangle([x + 2, y + 2, x + THUMB[0] - 2, y + THUMB[1] - 2],
                           outline="#c0392b", width=3)
            draw.text((x + 14, y + THUMB[1] // 2), "후보 없음", fill="#e74c3c", font=font)

        # 저작권이 걸린 소재는 테두리로 구분. 비공식 채널은 빨간색으로 눈에 띄게 한다.
        if chosen and entry["source"] == "clip":
            official = chosen.get("official")
            draw.rectangle([x + 2, y + 2, x + THUMB[0] - 2, y + THUMB[1] - 2],
                           outline="#2f9e44" if official else "#c0392b", width=5)

        draw.text((x + 8, y + THUMB[1] + 4),
                  _fit(draw, f"{entry['n']}. {entry['text']}", font, THUMB[0] - 16),
                  fill="#ecf0f1", font=font)
        total = len(entry["candidates"])
        detail = f"{entry['source']}  후보 {(entry['chosen'] or 0) + 1}/{total}"
        draw.text((x + 8, y + THUMB[1] + 26), detail, fill="#7f8c8d", font=small)
        if chosen and entry["source"] == "clip":
            mark = "공식" if chosen.get("official") else "비공식 확인요"
            draw.text((x + 8, y + THUMB[1] + 46),
                      _fit(draw, f"{mark} · {chosen['author']}", small, THUMB[0] - 16),
                      fill="#69db7c" if chosen.get("official") else "#ff8787", font=small)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)


def _apply_fix(entries: list[dict], note: str) -> None:
    """수정요청에 적힌 문장 번호는 다음 후보로 돌린다."""
    numbers = {int(n) for n in re.findall(r"\d+", note)}
    for entry in entries:
        if entry["n"] in numbers and entry["candidates"]:
            entry["chosen"] = (entry["chosen"] + 1) % len(entry["candidates"])
            print(f"    {entry['n']}번 → 후보 {entry['chosen'] + 1}번으로 교체")


def run(ep: Episode) -> None:
    plan = planfile.load(ep.plan_md)

    if ep.clip_list.exists():
        entries = json.loads(ep.clip_list.read_text(encoding="utf-8"))
    else:
        print("  문장별 소재 후보를 찾는 중...")
        entries = _build_candidates(plan)

    if ep.clips_fix.exists():
        note = ep.clips_fix.read_text(encoding="utf-8").strip()
        print(f"  수정 요청 반영: {note[:120]}")
        _apply_fix(entries, note)
        ep.clips_fix.unlink()

    ep.clips_dir.mkdir(parents=True, exist_ok=True)
    ep.clip_list.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    _contact_sheet(entries, ep.contact_sheet)
    print(f"  컨택트시트 → {ep.contact_sheet}")

    if not ep.clips_ok.exists():
        raise GateBlocked(
            "이미지 승인이 없습니다.\n"
            f"  컨택트시트를 확인하세요:  {ep.contact_sheet}\n"
            f"  괜찮으면 빈 파일을 만드세요:  {ep.clips_ok}\n"
            f"  바꿀 문장이 있으면 번호를 적으세요:  {ep.clips_fix}  (예: 3번 다른 걸로)"
        )

    missing = [e["n"] for e in entries if e["chosen"] is None]
    if missing:
        raise StepFailed(
            f"후보가 없는 문장이 있습니다: {missing}. "
            "수정요청으로 검색어를 바꾸거나 파일을 직접 넣으세요."
        )
    print(f"  이미지 승인 확인됨 — 문장 {len(entries)}개")
