from __future__ import annotations

import json
from datetime import date, datetime

import yaml

from ..paths import CONFIG, ROOT
from .naver_api import NaverApiError, NaverCredentialsMissing, search_blog


def _find_rank(keyword: str, blog_id: str, post_url: str | None) -> int | None:
    result = search_blog(keyword, display=100)
    for index, item in enumerate(result["items"], 1):
        link = str(item.get("link", ""))
        blogger = str(item.get("bloggerlink", ""))
        if post_url and link.rstrip("/") == post_url.rstrip("/"):
            return index
        if blog_id and (f"blog.naver.com/{blog_id}" in link or f"blog.naver.com/{blog_id}" in blogger):
            return index
    return None


def track_all() -> dict:
    cfg_path = CONFIG / "blog.yaml"
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
    blog_id = str(cfg.get("blog_id", ""))
    tracked = 0
    skipped = 0
    for project_file in (ROOT / "블로그").glob("*/프로젝트.json"):
        try:
            project = json.loads(project_file.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            continue
        if project.get("status") not in {"drafted", "published"}:
            continue
        keyword = str(project.get("keyword", {}).get("main", "")).strip()
        if not keyword:
            continue
        try:
            rank = _find_rank(keyword, blog_id, project.get("publish", {}).get("post_url"))
        except (NaverCredentialsMissing, NaverApiError):
            skipped += 1
            continue
        target = project_file.parent / "순위.json"
        try:
            rows = json.loads(target.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            rows = []
        rows = [row for row in rows if not (row.get("date") == date.today().isoformat() and row.get("keyword") == keyword)]
        rows.append({"date": date.today().isoformat(), "keyword": keyword, "rank": rank, "checked_at": datetime.now().astimezone().isoformat()})
        target.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        tracked += 1
    return {"tracked": tracked, "skipped": skipped}


def run(_args) -> int:
    print(json.dumps(track_all(), ensure_ascii=False))
    return 0
