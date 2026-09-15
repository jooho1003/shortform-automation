"""Opt-in integration check using a completed local preview and temporary B assets.

Run with the main pipeline Python: python tts-service/smoke_episode.py JOB_ID
No paid services or user episode directories are touched.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shortform.paths import DATA, Episode
from shortform.tts.client import request
from shortform.tts.engine import audio_duration
from shortform.tts.episode import regenerate
from shortform.tts.store import atomic_json, read_json


def main(job_id):
    job = request("/jobs/" + job_id)
    if job["status"] != "done" or job["kind"] != "preview":
        raise ValueError("A completed preview job is required")
    text = job["request"]["text"]
    if "|" in text or "\n" in text:
        raise ValueError("Use a single-line preview without table separators")
    with tempfile.TemporaryDirectory(prefix="episode-smoke-", dir=DATA / "tts") as directory:
        ep = Episode("2026-01-01", "B", "01", Path(directory))
        ep.plan_md.write_text(f"""# 제목 후보

- Qwen 연결 검증

## 훅

실제 오디오와 타임라인.

## 대본

| # | 문장 | 소재 | 검색어 |
|---|---|---|---|
| 1 | {text} | stock | test |
| 2 | {text} | stock | test |

## AI 댓글

| 시각 | 닉네임 | 내용 |
|---|---|---|
| 2 | 검증 | 테스트 |

## 메타데이터

- 공개: unlisted
""", encoding="utf-8")
        atomic_json(ep.clip_list, [{"n": n, "chosen": None, "media_layout": "portrait"} for n in (1, 2)])
        atomic_json(ep.assets_dir / "voice-settings.json", {"schemaVersion": 1, "revision": 1,
            "preset": None, "config": job["result"]["config"]})
        for n in (1, 2):
            target = ep.assets_dir / "클립" / f"{n:02d}.mp4"
            target.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=180x320:r=30",
                "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(target)], check=True)
        regenerate(ep)
        timeline = read_json(ep.assets_dir / "타임라인.json")
        duration = audio_duration(ep.assets_dir / "narration.mp3")
        assert abs(timeline["durationSec"] - duration) < .15
        assert timeline["lines"][1]["start"] > timeline["lines"][0]["end"]
        assert len(read_json(ep.assets_dir / "tts-manifest.json")["files"]) == 2
        cached = DATA / "tts" / "cache" / job["result"]["audioKey"] / "audio.wav"
        assert (ep.assets_dir / "tts" / "01.wav").read_bytes() == cached.read_bytes()
        result = {"passed": True, "previewId": job_id, "modelId": job["result"]["config"]["modelId"],
                  "timelineSeconds": timeline["durationSec"], "narrationSeconds": duration,
                  "lineCount": len(timeline["lines"]), "temporaryAssetsCleaned": True}
    atomic_json(DATA / "tts" / "episode-smoke-result.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    main(sys.argv[1])
