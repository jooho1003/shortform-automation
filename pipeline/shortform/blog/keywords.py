from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path

import yaml

from ..paths import CONFIG, DATA, ROOT
from .naver_api import NaverApiError, NaverCredentialsMissing, keyword_suggestions, search_blog


def week_now() -> str:
    year, week, _ = date.today().isocalendar()
    return f"{year}-W{week:02d}"


def _config() -> dict:
    path = CONFIG / "blog.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}


def _used() -> set[str]:
    used: set[str] = set()
    for file in (ROOT / "블로그").glob("*/프로젝트.json"):
        try:
            data = json.loads(file.read_text(encoding="utf-8-sig"))
            keyword = data.get("keyword", {}).get("main")
            if isinstance(keyword, str):
                used.add(keyword.replace(" ", "").lower())
        except (OSError, json.JSONDecodeError):
            continue
    return used


def discover(week: str | None = None, extra_seeds: list[str] | None = None) -> dict:
    if week and not re.fullmatch(r"\d{4}-W\d{2}", week):
        raise ValueError("week는 YYYY-Www 형식이어야 합니다.")
    cfg = _config()
    seeds = [str(x).strip() for x in (extra_seeds or cfg.get("seed_keywords", [])) if str(x).strip()]
    if not seeds:
        raise ValueError("config/blog.yaml의 seed_keywords가 비었습니다.")
    source = "searchad"
    try:
        candidates = keyword_suggestions(seeds)
    except (NaverCredentialsMissing, NaverApiError):
        source = "manual-fallback"
        candidates = [{"keyword": seed, "volume_pc": 0, "volume_mobile": 0, "competition": ""} for seed in seeds]
    used = _used()
    rows = []
    for candidate in candidates:
        keyword = str(candidate["keyword"]).strip()
        if not keyword or keyword.replace(" ", "").lower() in used:
            continue
        volume_pc = int(candidate.get("volume_pc", 0) or 0)
        volume_mobile = int(candidate.get("volume_mobile", 0) or 0)
        try:
            docs = int(search_blog(keyword, display=1)["total"])
        except (NaverCredentialsMissing, NaverApiError):
            docs = 0
        volume = volume_pc + volume_mobile
        saturation = docs / max(volume, 1)
        score = volume / (docs + 1)
        # 키가 없는 수동 폴백은 0 값이어도 보드에 남긴다.
        if source != "manual-fallback" and (volume < int(cfg.get("min_volume", 0)) or saturation > float(cfg.get("max_saturation", 10000))):
            continue
        rows.append({
            "main": keyword,
            "subs": [],
            "volume_pc": volume_pc,
            "volume_mobile": volume_mobile,
            "docs": docs,
            "saturation": round(saturation, 4),
            "week": week or week_now(),
            "score": round(score, 6),
            "status": "unused",
            "competition": candidate.get("competition", ""),
        })
    rows.sort(key=lambda row: (row["score"], row["volume_pc"] + row["volume_mobile"]), reverse=True)
    payload = {"version": 1, "week": week or week_now(), "generated_at": datetime.now().astimezone().isoformat(), "source": source, "keywords": rows}
    target = DATA / "blog" / "keywords" / f"{payload['week']}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def run(args) -> int:
    payload = discover(args.week, args.seed or None)
    print(json.dumps({"week": payload["week"], "source": payload["source"], "count": len(payload["keywords"])}, ensure_ascii=False))
    return 0
