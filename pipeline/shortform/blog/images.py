from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import yaml

from .. import StepFailed
from ..paths import CONFIG, PIPELINE, ROOT


def _load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return default


def _codex(prompt: str, output: Path) -> None:
    cfg_path = CONFIG / "images.yaml"
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
    if cfg.get("provider", "manual") != "codex":
        raise StepFailed(f"본문 이미지가 없습니다: {output.name}. provider=manual이면 직접 넣어 주세요.")
    output.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "codex", "exec", "-m", cfg.get("codex_model", "gpt-5.6-terra"),
        "-c", f"model_reasoning_effort={cfg.get('reasoning_effort', 'medium')}",
        "--sandbox", "workspace-write", "--skip-git-repo-check", "--ephemeral", "--color", "never",
        "-C", str(output.parent), "--add-dir", str(output.parent), "-",
    ]
    full = (
        f"이미지 생성 도구로 네이버 블로그 본문용 가로 4:3 이미지 한 장을 만들어 정확히 이 경로에 저장하세요: {output}\n"
        "다른 파일은 만들지 말고 이미지 안에는 글자·로고·워터마크를 넣지 마세요. 과장된 광고 이미지가 아니라 자연스럽고 구체적인 설명용 비주얼이어야 합니다.\n\n"
        + prompt
    )
    try:
        result = subprocess.run(args, input=full, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=int(cfg.get("timeout", 600)), shell=(os.name == "nt"), env={**os.environ, "PYTHONUTF8": "1"})
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise StepFailed("codex 이미지 생성기를 실행할 수 없습니다.") from exc
    if result.returncode != 0 or not output.exists():
        raise StepFailed(f"본문 이미지 생성 실패: {output.name}\n{(result.stderr or result.stdout)[-500:]}")


def generate(project_id: str) -> list[dict]:
    project_dir = ROOT / "블로그" / project_id
    if not project_dir.is_dir() or project_dir.name != project_id or project_dir.parent != ROOT / "블로그":
        raise FileNotFoundError(f"블로그 프로젝트가 없습니다: {project_id}")
    project = _load(project_dir / "프로젝트.json", {})
    outline = _load(project_dir / "개요.json", {})
    image_dir = project_dir / "이미지"
    image_dir.mkdir(parents=True, exist_ok=True)
    thumb = image_dir / "00-대표.jpg"
    if not thumb.exists():
        result = subprocess.run(["node", "scripts/render-blog-thumb.mjs", project_id], cwd=PIPELINE / "remotion", capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
        if result.returncode != 0 or not thumb.exists():
            raise StepFailed(f"대표 이미지 렌더 실패\n{result.stdout[-500:]}\n{result.stderr[-500:]}")
    metadata = [{"n": 0, "file": "이미지/00-대표.jpg", "alt": f"{project.get('keyword', {}).get('main', '')} 대표 이미지", "prompt": "Remotion BlogThumb", "kind": "thumb"}]
    body_specs = [spec for spec in outline.get("images", []) if isinstance(spec, dict) and spec.get("kind") == "body"]
    for index, spec in enumerate(body_specs, 1):
        out = image_dir / f"{index:02d}.png"
        if not out.exists():
            _codex(str(spec.get("brief", "블로그 주제를 설명하는 자연스러운 장면")), out)
        metadata.append({"n": index, "file": f"이미지/{out.name}", "alt": str(spec.get("alt", "")).strip(), "prompt": str(spec.get("brief", "")).strip(), "kind": "body"})
    (image_dir / "이미지.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata


def run(args) -> int:
    images = generate(args.id)
    print(json.dumps({"id": args.id, "images": len(images)}, ensure_ascii=False))
    return 0
