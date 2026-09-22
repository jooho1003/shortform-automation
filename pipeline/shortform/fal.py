"""fal.ai 큐 API 클라이언트.

A안 숏폼(steps/video_a.py)과 상세페이지 영상(steps/detail_video.py)이 같이 쓴다.
큐 제출 → 상태 폴링 → 결과 URL 내려받기까지만 담당하고, 프롬프트·비용·파일 배치는 호출부가 정한다.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import time
import urllib.error
import urllib.request
from pathlib import Path

from . import StepFailed

QUEUE = "https://queue.fal.run"


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def fill(value, vars_: dict[str, str]):
    """설정 템플릿의 {키}를 값으로 바꾼다. 문자열·딕셔너리·리스트를 재귀로 훑는다."""
    if isinstance(value, str):
        for k, v in vars_.items():
            value = value.replace("{" + k + "}", v)
        return value
    if isinstance(value, dict):
        return {k: fill(v, vars_) for k, v in value.items()}
    if isinstance(value, list):
        return [fill(v, vars_) for v in value]
    return value


def request(method: str, url: str, key: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Key {key}", "Content-Type": "application/json", "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raise StepFailed(f"fal {method} {url.split('/')[-1]} → {exc.code}: {exc.read().decode('utf-8', 'replace')[:400]}") from exc


def dig(obj, path: str):
    cur = obj
    for part in path.split("."):
        if isinstance(cur, list) and part.isdigit():
            cur = cur[int(part)]
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def generate(cfg: dict, key: str, out: Path, vars_: dict[str, str]) -> None:
    """cfg['body'] 템플릿에 vars_를 채워 큐에 넣고, 완료되면 영상을 out에 내려받는다."""
    body = fill(cfg.get("body", {"prompt": "{prompt}", "image_url": "{keyframe}"}), vars_)
    endpoint = cfg["endpoint"].strip("/")
    submitted = request("POST", f"{QUEUE}/{endpoint}", key, body)
    request_id = submitted.get("request_id")
    status_url = submitted.get("status_url") or f"{QUEUE}/{endpoint}/requests/{request_id}/status"
    result_url = submitted.get("response_url") or f"{QUEUE}/{endpoint}/requests/{request_id}"
    if not request_id:
        raise StepFailed(f"fal 큐 응답에 request_id가 없습니다: {str(submitted)[:300]}")

    deadline = time.time() + int(cfg.get("timeout_sec", 900))
    while True:
        st = request("GET", status_url, key)
        s = st.get("status")
        if s == "COMPLETED":
            break
        if s in ("FAILED", "ERROR"):
            raise StepFailed(f"fal 생성 실패: {str(st)[:300]}")
        if time.time() > deadline:
            raise StepFailed("fal 생성이 시간 초과됐습니다.")
        pos = st.get("queue_position")
        print(f"    … {s}{f' (대기 {pos})' if pos is not None else ''}")
        time.sleep(int(cfg.get("poll_interval_sec", 6)))

    result = request("GET", result_url, key)
    video_url = dig(result, cfg.get("video_url_path", "video.url"))
    if not video_url:
        raise StepFailed(f"응답에서 영상 URL을 못 찾았습니다 ({cfg.get('video_url_path')}): {str(result)[:300]}")
    out.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(video_url, out)
