from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .config import TTSError
from .engine import audio_duration, convert_audio
from .store import atomic_json

SERVICE_URL = "http://127.0.0.1:8765"


def request(endpoint: str, body=None, *, method=None, timeout=20):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(SERVICE_URL + endpoint, data=data,
        headers={"Content-Type": "application/json"}, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            error = json.loads(exc.read()).get("error", "TTS 요청 실패")
        except Exception:
            error = "TTS 요청 실패"
        raise TTSError(str(error), exc.code) from exc
    except (OSError, urllib.error.URLError) as exc:
        raise TTSError("Qwen 음성 서비스에 연결할 수 없습니다. 웹 음성 스튜디오에서 엔진을 시작하세요.", 503) from exc


def _synthesize(text: str, out: Path, config: dict) -> tuple[float, float]:
    job = request("/previews", {"text": text, "config": config, "take": "reuse", "idempotencyKey": uuid.uuid4().hex})
    deadline = time.monotonic() + 1800
    try:
        while job["status"] not in ("done", "failed", "cancelled", "interrupted"):
            if time.monotonic() > deadline:
                raise TTSError("음성 생성 제한 시간(30분)을 넘었습니다.", 504)
            time.sleep(.5)
            job = request("/jobs/" + job["id"])
        if job["status"] != "done":
            raise TTSError(job.get("error", {}).get("message", "음성 생성이 취소됐습니다."), 500)
    except BaseException:
        try:
            request("/jobs/" + job["id"] + "/cancel", {})
        except Exception:
            pass
        raise
    result = job["result"]
    # Only trust a locally issued cache key, never a returned arbitrary filesystem path.
    from ..paths import DATA
    import re
    if not re.fullmatch(r"[0-9a-f]{64}", result["audioKey"]):
        raise TTSError("TTS 결과 키가 잘못됐습니다.")
    source = DATA / "tts" / "cache" / result["audioKey"] / "audio.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    temp = out.with_name(out.stem + ".tmp" + out.suffix)
    if out.suffix.lower() == ".wav":
        shutil.copyfile(source, temp)  # Preserve exactly the WAV heard in the studio.
    else:
        convert_audio(source, temp)
    os.replace(temp, out)
    atomic_json(out.with_suffix(".tts.json"), {k: v for k, v in result.items() if k != "audioFile"})
    return 0.0, audio_duration(out)


async def synthesize(text: str, out: Path, config: dict) -> tuple[float, float]:
    return await asyncio.to_thread(_synthesize, text, out, config)
