from __future__ import annotations

import json
import re
from datetime import datetime

from ..paths import ROOT
from .naver_api import NaverApiError, NaverCredentialsMissing, search_blog


def analyze(keyword: str) -> dict:
    try:
        result = search_blog(keyword, display=10)
        source = "naver-openapi"
    except (NaverCredentialsMissing, NaverApiError) as exc:
        result = {"total": 0, "items": []}
        source = "unavailable"
        warning = str(exc)
    rows = [{"rank": index, **item} for index, item in enumerate(result["items"], 1)]
    return {"keyword": keyword, "total": result["total"], "source": source, "checked_at": datetime.now().astimezone().isoformat(), "warning": warning if source == "unavailable" else None, "items": rows}


def run(args) -> int:
    data = analyze(args.keyword)
    if args.project:
        if not re.fullmatch(r"\d{8}-[A-Za-z0-9가-힣_-]{1,80}", args.project):
            raise ValueError("블로그 프로젝트 ID가 올바르지 않습니다.")
        target = ROOT / "블로그" / args.project / "상위글.json"
        if not target.parent.is_dir():
            raise FileNotFoundError(f"블로그 프로젝트가 없습니다: {args.project}")
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(data, ensure_ascii=False))
    return 0
