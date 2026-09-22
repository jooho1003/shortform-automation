"""A안 이미지 검사. 시트·키프레임을 기계가 볼 수 있는 만큼만 본다 — 비율·크기·필수 컷 누락·워터마크 의심.

좌우 일관성 같은 건 사람이 본다(전략 문서 20-A안 5절). 결과는 02-이미지/검사.json 과 컨택트시트.png.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageStat

from ..paths import Episode
from ..planfile_a import PlanA

SHEET = "시트.png"
KEYFRAME = "키프레임-{n:02d}.png"
REPORT = "검사.json"
CONTACT = "컨택트시트.png"
# 짧은 변으로 잰다. 세로만 보면 9:16 비율은 맞는데 너비가 모자란 이미지(예: 941x1672)가
# 그냥 통과한다. 정확한 9:16에서 짧은 변 720px은 세로 1280px과 같은 기준이라 기존 판정은 그대로다.
MIN_SHORT_SIDE = 720
# 시트는 한 장 안에 3면 턴어라운드·표정·클로즈업을 격자로 담고, 그 한 장이 모든 키프레임의
# 아이덴티티 기준이 된다. 칸당 해상도가 남아야 하므로 프롬프트 규격(1080x1920)을 그대로 요구한다.
SHEET_MIN_SHORT_SIDE = 1080
RATIO = 9 / 16
RATIO_TOL = 0.03
FONT_PATH = "C:/Windows/Fonts/malgun.ttf"


def min_short_side(name: str) -> int:
    """파일별 짧은 변 하한. 시트만 더 엄격하다."""
    return SHEET_MIN_SHORT_SIDE if name == SHEET else MIN_SHORT_SIDE


def keyframe_path(ep: Episode, n: int) -> Path:
    return ep.clips_dir / KEYFRAME.format(n=n)


def _watermark_suspect(img: Image.Image) -> bool:
    """오른쪽 아래 모서리가 주변보다 유난히 대비가 높으면 의심. 오탐이 있어도 사람이 확인하면 된다."""
    w, h = img.size
    box = img.crop((int(w * 0.78), int(h * 0.92), w, h)).convert("L")
    ref = img.crop((int(w * 0.40), int(h * 0.92), int(w * 0.62), h)).convert("L")
    return ImageStat.Stat(box).stddev[0] > ImageStat.Stat(ref).stddev[0] * 2.2 + 12


def run_check(ep: Episode, plan: PlanA) -> dict:
    ep.clips_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for path in sorted(ep.clips_dir.glob("*.png")) + sorted(ep.clips_dir.glob("*.jpg")):
        if path.name == CONTACT:
            continue
        try:
            with Image.open(path) as img:
                w, h = img.size
                ratio_ok = abs((w / h) - RATIO) <= RATIO_TOL
                floor = min_short_side(path.name)
                files.append({
                    "name": path.name, "width": w, "height": h,
                    "ratio_ok": ratio_ok, "size_ok": min(w, h) >= floor,
                    "min_short_side": floor,
                    "watermark_suspect": _watermark_suspect(img.convert("RGB")),
                })
        except OSError:
            files.append({"name": path.name, "width": 0, "height": 0, "ratio_ok": False, "size_ok": False, "min_short_side": min_short_side(path.name), "watermark_suspect": False, "error": "열 수 없음"})

    names = {f["name"] for f in files}
    missing_required = [c.n for c in plan.cuts if c.required and KEYFRAME.format(n=c.n) not in names]
    sheet_ok = SHEET in names
    report = {
        "sheet": sheet_ok,
        "files": files,
        "missing_required": missing_required,
        "problems": [f["name"] for f in files if not (f["ratio_ok"] and f["size_ok"]) or f.get("watermark_suspect")],
        "ok": sheet_ok and not missing_required and all(f["ratio_ok"] and f["size_ok"] for f in files),
    }
    (ep.clips_dir / REPORT).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    _contact_sheet(ep, plan, files)
    return report


def _contact_sheet(ep: Episode, plan: PlanA, files: list[dict]) -> None:
    thumb_w, thumb_h, pad = 270, 480, 14
    cols = 4
    rows = max(1, (len(files) + cols - 1) // cols)
    sheet = Image.new("RGB", (cols * (thumb_w + pad) + pad, rows * (thumb_h + 58 + pad) + pad), "#111")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype(FONT_PATH, 18)
        small = ImageFont.truetype(FONT_PATH, 14)
    except OSError:
        font = small = ImageFont.load_default()
    cut_by_n = {c.n: c for c in plan.cuts}
    for i, f in enumerate(files):
        x = pad + (i % cols) * (thumb_w + pad)
        y = pad + (i // cols) * (thumb_h + 58 + pad)
        try:
            with Image.open(ep.clips_dir / f["name"]) as img:
                img = img.convert("RGB")
                img.thumbnail((thumb_w, thumb_h))
                sheet.paste(img, (x + (thumb_w - img.width) // 2, y + (thumb_h - img.height) // 2))
        except OSError:
            pass
        bad = not (f["ratio_ok"] and f["size_ok"]) or f.get("watermark_suspect")
        draw.rectangle((x - 3, y - 3, x + thumb_w + 3, y + thumb_h + 3), outline="#ff6b6b" if bad else "#2f9e44", width=3)
        label = f["name"]
        n = None
        if label.startswith("키프레임-"):
            try:
                n = int(label[5:7])
            except ValueError:
                n = None
        cut = cut_by_n.get(n) if n else None
        draw.text((x, y + thumb_h + 6), label, fill="#fff", font=font)
        info = f"{f['width']}x{f['height']}"
        if not f["size_ok"] and f.get("min_short_side"):
            info += f" · 기준 {f['min_short_side']}"
        info += " · 워터마크?" if f.get("watermark_suspect") else ""
        if cut:
            info += f" · {cut.start:g}-{cut.end:g}s {cut.lens}"
        draw.text((x, y + thumb_h + 30), info[:38], fill="#ff8787" if bad else "#adb5bd", font=small)
    sheet.save(ep.clips_dir / CONTACT)
