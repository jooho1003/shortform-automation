from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import os
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ..paths import PIPELINE, load_dotenv


class NaverApiError(RuntimeError):
    pass


class NaverCredentialsMissing(NaverApiError):
    pass


def _json_request(url: str, headers: dict[str, str], timeout: int = 20) -> dict:
    request = Request(url, headers={**headers, "Accept": "application/json", "User-Agent": "shortform-automation/1.0"})
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - 고정된 네이버 HTTPS 호스트만 호출
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        # 응답 본문에는 키가 없지만 공급자 내부 메시지는 장기 로그에 남기지 않는다.
        raise NaverApiError(f"네이버 API가 HTTP {exc.code}을 반환했습니다.") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise NaverApiError("네이버 API 응답을 읽을 수 없습니다.") from exc


def _strip_html(value: object) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", str(value or ""))).strip()


def search_blog(query: str, *, display: int = 10, start: int = 1, sort: str = "sim") -> dict:
    load_dotenv()
    client_id = os.environ.get("NAVER_CLIENT_ID", "")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        raise NaverCredentialsMissing("NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET이 없습니다.")
    params = urlencode({"query": query, "display": max(1, min(100, display)), "start": max(1, min(1000, start)), "sort": sort if sort in {"sim", "date"} else "sim"})
    data = _json_request(
        f"https://openapi.naver.com/v1/search/blog.json?{params}",
        {"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret},
    )
    items = []
    for item in data.get("items", []):
        if not isinstance(item, dict):
            continue
        items.append({
            "title": _strip_html(item.get("title")),
            "description": _strip_html(item.get("description")),
            "link": str(item.get("link", "")),
            "bloggername": _strip_html(item.get("bloggername")),
            "bloggerlink": str(item.get("bloggerlink", "")),
            "postdate": str(item.get("postdate", "")),
        })
    return {"total": int(data.get("total", 0) or 0), "items": items}


def _signature(timestamp: str, method: str, uri: str, secret: str) -> str:
    message = f"{timestamp}.{method}.{uri}".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def _count(value: object) -> int:
    text = str(value or "0").replace(",", "").strip()
    if text.startswith("<"):
        return max(0, int(text[1:] or 0) - 1)
    try:
        return max(0, int(float(text)))
    except ValueError:
        return 0


def keyword_suggestions(keywords: list[str]) -> list[dict]:
    """GET /keywordstool using the official HMAC header contract."""
    load_dotenv()
    customer = os.environ.get("NAVER_AD_CUSTOMER_ID", "")
    license_key = os.environ.get("NAVER_AD_ACCESS_LICENSE", "")
    secret = os.environ.get("NAVER_AD_SECRET_KEY", "")
    if not customer or not license_key or not secret:
        raise NaverCredentialsMissing("네이버 검색광고 API 키 3종이 없습니다.")
    uri = "/keywordstool"
    timestamp = str(int(time.time() * 1000))
    params = urlencode({"hintKeywords": ",".join(k.replace(" ", "") for k in keywords[:5]), "showDetail": "1"})
    data = _json_request(
        f"https://api.searchad.naver.com{uri}?{params}",
        {
            "X-Timestamp": timestamp,
            "X-API-KEY": license_key,
            "X-Customer": customer,
            "X-Signature": _signature(timestamp, "GET", uri, secret),
        },
    )
    out = []
    for row in data.get("keywordList", []):
        if not isinstance(row, dict) or not row.get("relKeyword"):
            continue
        out.append({
            "keyword": str(row["relKeyword"]),
            "volume_pc": _count(row.get("monthlyPcQcCnt")),
            "volume_mobile": _count(row.get("monthlyMobileQcCnt")),
            "competition": str(row.get("compIdx", "")),
        })
    return out
