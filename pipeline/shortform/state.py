"""상태.json 읽기·쓰기. 재실행 시 끝난 단계를 건너뛰기 위한 것."""

from __future__ import annotations

import json
from datetime import datetime

from .paths import Episode

STEPS = ["plan", "clips", "assets", "render", "upload"]


def load(ep: Episode) -> dict:
    if ep.state_json.exists():
        return json.loads(ep.state_json.read_text(encoding="utf-8"))
    return {"steps": {}, "errors": []}


def save(ep: Episode, state: dict) -> None:
    ep.state_json.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def is_done(ep: Episode, step: str) -> bool:
    if step in ("assets", "video", "render", "upload"):
        from .tts.episode import is_stale
        if is_stale(ep):
            return False
    return bool(load(ep)["steps"].get(step, {}).get("done"))


def mark_done(ep: Episode, step: str, **info) -> None:
    state = load(ep)
    state["steps"][step] = {"done": True, "at": datetime.now().isoformat(timespec="seconds"), **info}
    save(ep, state)


def reset(ep: Episode, step: str) -> None:
    state = load(ep)
    state["steps"].pop(step, None)
    save(ep, state)


def record_error(ep: Episode, step: str, message: str) -> None:
    state = load(ep)
    state["errors"].append(
        {"step": step, "message": message, "at": datetime.now().isoformat(timespec="seconds")}
    )
    save(ep, state)
