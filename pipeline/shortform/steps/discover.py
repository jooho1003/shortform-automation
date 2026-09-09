"""발굴. 인급동 + 조회수 상위 + 재사용 허용(CC BY) 세 갈래를 돌아 레퍼런스를 쌓는다.

설계 문서 4.1절. 결과는 주제와 대본 구조를 배우는 용도이고,
영상 파일 자체를 화면에 쓸지는 클립 단계에서 사람이 판정한다.
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import yaml

from .. import MissingKey, StepFailed
from ..paths import CONFIG, DATA

API = "https://www.googleapis.com/youtube/v3"
REFERENCES = DATA / "references.jsonl"


def _api(path: str, **params) -> dict:
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        raise MissingKey(
            "YOUTUBE_API_KEY 가 없습니다.\n"
            "  https://console.cloud.google.com 에서 프로젝트를 만들고\n"
            "  'YouTube Data API v3' 를 사용 설정한 뒤 API 키를 발급받으세요.\n"
            "  발급 후:  setx YOUTUBE_API_KEY \"발급받은키\"  (새 터미널부터 적용)"
        )
    params["key"] = key
    url = f"{API}/{path}?" + urllib.parse.urlencode(params, doseq=True)
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        raise StepFailed(f"YouTube API {path} 실패 ({e.code}): {e.read().decode('utf-8')[:300]}")


def _existing_ids() -> set[str]:
    if not REFERENCES.exists():
        return set()
    ids = set()
    for line in REFERENCES.read_text(encoding="utf-8").splitlines():
        if line.strip():
            ids.add(json.loads(line)["id"])
    return ids


def _append(rows: list[dict]) -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    seen = _existing_ids()
    fresh = [r for r in rows if r["id"] not in seen]
    with REFERENCES.open("a", encoding="utf-8") as f:
        for row in fresh:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(fresh)


def _row(item: dict, source: str, stats: dict | None = None) -> dict:
    snippet = item["snippet"]
    stats = stats or item.get("statistics", {})
    return {
        "id": item["id"] if isinstance(item["id"], str) else item["id"]["videoId"],
        "title": snippet["title"],
        "channel": snippet["channelTitle"],
        "published": snippet["publishedAt"],
        "views": int(stats.get("viewCount", 0)),
        "license": item.get("status", {}).get("license", "unknown"),
        "source": source,
        "collected": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _hydrate(video_ids: list[str], source: str) -> list[dict]:
    """search.list 결과에는 조회수가 없어 videos.list로 다시 채운다."""
    rows = []
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i : i + 50]
        data = _api("videos", part="snippet,statistics,status", id=",".join(batch))
        rows += [_row(item, source) for item in data.get("items", [])]
    return rows


def run_standalone() -> None:
    config = yaml.safe_load((CONFIG / "keywords.yaml").read_text(encoding="utf-8"))
    region = config["region"]
    after = (
        datetime.now(timezone.utc) - timedelta(days=config["published_within_days"])
    ).isoformat(timespec="seconds").replace("+00:00", "Z")

    rows: list[dict] = []

    # 1. 인급동
    for category in config["trending_categories"]:
        data = _api(
            "videos",
            part="snippet,statistics,status",
            chart="mostPopular",
            regionCode=region,
            videoCategoryId=category,
            maxResults=50,
        )
        rows += [_row(item, f"trending:{category}") for item in data.get("items", [])]

    # 2. 조회수 상위
    for term in config["search_terms"]:
        data = _api(
            "search",
            part="snippet",
            q=term,
            type="video",
            order="viewCount",
            publishedAfter=after,
            regionCode=region,
            relevanceLanguage=config["language"],
            maxResults=25,
        )
        ids = [item["id"]["videoId"] for item in data.get("items", [])]
        rows += _hydrate(ids, f"topviews:{term}")

    # 3. 재사용 허용 (CC BY)
    for term in config["cc_terms"]:
        data = _api(
            "search",
            part="snippet",
            q=term,
            type="video",
            videoLicense="creativeCommon",
            order="viewCount",
            maxResults=25,
        )
        ids = [item["id"]["videoId"] for item in data.get("items", [])]
        rows += _hydrate(ids, f"cc:{term}")

    added = _append(rows)
    print(f"  발굴 {len(rows)}건 수집, 신규 {added}건 저장 → {REFERENCES}")


def run(ep) -> None:  # 편 단위 실행에서는 발굴을 건너뛴다
    run_standalone()
