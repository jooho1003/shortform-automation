"""렌더. 타임라인을 Remotion에 넘겨 1080x1920 mp4를 만든다. 설계 문서 4.6절."""

from __future__ import annotations

import json
import shutil
import subprocess

from .. import StepFailed
from ..paths import BGM, PIPELINE, Episode

REMOTION = PIPELINE / "remotion"
STAGE = REMOTION / "public" / "ep"


def _stage(ep: Episode, timeline: dict) -> dict:
    """Remotion은 public/ 안의 파일만 읽는다. 한글 파일명은 URL에서 말썽이라 ASCII로 옮긴다."""
    if STAGE.exists():
        shutil.rmtree(STAGE)
    (STAGE / "clips").mkdir(parents=True)

    # A안(대사 없음)이나 원음 중심 피드 카드는 내레이션이 없을 수 있다
    if timeline.get("narration") and (ep.assets_dir / timeline["narration"]).exists():
        shutil.copy(ep.assets_dir / timeline["narration"], STAGE / "narration.mp3")
        timeline["narration"] = "narration.mp3"
    else:
        timeline["narration"] = ""

    for item in timeline["lines"]:
        source = ep.assets_dir / item["clip"]
        if not source.exists():
            raise StepFailed(f"클립이 없습니다: {source}")
        name = f"clips/{item['n']:02d}.mp4"
        shutil.copy(source, STAGE / name)
        item["clip"] = name

    if timeline.get("bgm"):
        shutil.copy(BGM / timeline["bgm"], STAGE / "bgm.mp3")
        timeline["bgm"] = "bgm.mp3"
    return timeline


def run(ep: Episode) -> None:
    timeline_path = ep.assets_dir / "타임라인.json"
    if not timeline_path.exists():
        raise StepFailed(f"타임라인이 없습니다: {timeline_path}")
    if not (REMOTION / "node_modules").exists():
        raise StepFailed(f"Remotion 의존성이 없습니다. 먼저 실행하세요:  cd {REMOTION} && npm install")

    timeline = _stage(ep, json.loads(timeline_path.read_text(encoding="utf-8")))
    props = REMOTION / "props.json"
    props.write_text(json.dumps(timeline, ensure_ascii=False), encoding="utf-8")

    ep.video_dir.mkdir(parents=True, exist_ok=True)
    print("  Remotion 렌더 중... (첫 실행은 헤드리스 Chrome 내려받느라 몇 분 걸립니다)")
    result = subprocess.run(
        f'npx remotion render Short "{ep.final_mp4}" --props="{props}"',
        cwd=REMOTION, capture_output=True, text=True, encoding="utf-8", errors="replace", shell=True,
    )
    if result.returncode != 0:
        raise StepFailed(f"Remotion 렌더 실패\n{result.stdout[-1500:]}\n{result.stderr[-1500:]}")

    subprocess.run(
        ["ffmpeg", "-y", "-i", str(ep.final_mp4), "-ss", "1", "-vframes", "1",
         str(ep.video_dir / "thumb.jpg")],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    shutil.rmtree(STAGE, ignore_errors=True)
    print(f"  렌더 완료 → {ep.final_mp4}")
