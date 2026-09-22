"""codex CLI 스폰 — 이미지 생성 도구를 시켜 지정한 경로에 PNG를 남기게 한다.

A안 캐릭터 시트(steps/images_a.py)와 상세페이지 제품 시트(steps/detail_video.py)가 같이 쓴다.
파일 생성은 codex가 하고, 여기서는 호출과 실패 보고만 맡는다.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from . import StepFailed


def run(prompt: str, cwd: Path, images: list[Path], cfg: dict) -> str:
    """codex exec 를 돌리고 stdout 을 돌려준다. 파일이 생겼는지는 호출부가 확인한다."""
    args = [
        "codex", "exec",
        "-m", cfg.get("codex_model", "gpt-5.6-terra"),
        "-c", f"model_reasoning_effort={cfg.get('reasoning_effort', 'medium')}",
        "--sandbox", "workspace-write", "--skip-git-repo-check", "--ephemeral", "--color", "never",
        "-C", str(cwd), "--add-dir", str(cwd),
    ]
    for img in images:
        args += ["-i", str(img)]
    args.append("-")
    try:
        res = subprocess.run(
            args, input=prompt, capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=int(cfg.get("timeout", 600)), shell=(os.name == "nt"), env={**os.environ, "PYTHONUTF8": "1"},
        )
    except FileNotFoundError as exc:
        raise StepFailed("codex CLI가 없습니다. npm install -g @openai/codex") from exc
    except subprocess.TimeoutExpired as exc:
        raise StepFailed("codex 호출이 시간 초과됐습니다.") from exc
    for line in (res.stdout or "").splitlines()[-12:]:
        print("    codex│ " + line[:160])
    if res.returncode != 0:
        raise StepFailed(f"codex 종료 코드 {res.returncode}\n{(res.stderr or res.stdout)[-600:]}")
    return res.stdout
