"""읽기 전용 JSON 브릿지. 웹 콘솔이 `python -m shortform inspect ...`로 호출한다.

- shortform.steps.* 를 임포트하지 않는다 (PIL/yt-dlp 없이도 동작해야 한다).
- 모든 파일 경로는 paths.ROOT 기준 POSIX 상대 경로로 내보낸다.
"""

from __future__ import annotations

import dataclasses
import json
import re
from datetime import datetime
from pathlib import Path

import yaml

from . import StepFailed
from . import planfile
from . import state
from . import templates
from .paths import CONFIG, DATA, ROOT, Episode

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EPISODE_DIR_RE = re.compile(r"^([AB])-(\d+)-.+$")


def _rel(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _rel_or_none(path: Path, root: Path) -> str | None:
    return _rel(path, root) if path.exists() else None


def _root_posix(root: Path) -> str:
    return root.resolve().as_posix()


def _parse_plan(ep: Episode):
    """트랙별 기획안 파서 디스패처. A트랙 파서가 생기면 여기에 붙인다."""
    if ep.track == "A":
        from . import planfile_a  # B와 같은 유틸만 쓰므로 가벼움

        return planfile_a.load(ep.plan_md)
    return planfile.load(ep.plan_md)


def episode_summary(ep: Episode, root: Path = ROOT) -> dict:
    st = state.load(ep)
    from .tts.episode import is_stale
    if is_stale(ep):
        for step in ("assets", "video", "render", "upload"):
            if step in st["steps"]:
                st["steps"][step] = {**st["steps"][step], "done": False}

    plan = None
    plan_error = None
    title = ep.dir.name
    template_id = None
    template_name = None
    if ep.plan_md.exists():
        try:
            plan = _parse_plan(ep)
            title = plan.title
            template_id = plan.template_id
            template_name = plan.template_name
        except Exception as exc:  # noqa: BLE001 - 의도적으로 폭넓게 잡는다
            plan_error = str(exc)

    dir_name = ep.dir.name
    prefix = f"{ep.track}-{ep.num}-"
    slug = dir_name[len(prefix):] if dir_name.startswith(prefix) else dir_name

    timeline_path = ep.assets_dir / "타임라인.json"
    thumb_path = ep.video_dir / "thumb.jpg"

    return {
        "track": ep.track,
        "date": ep.date,
        "num": ep.num,
        "slug": slug,
        "dir": _rel(ep.dir, root),
        "steps": st["steps"],
        "errors": st["errors"],
        "gates": {
            "plan_ok": ep.plan_ok.exists(),
            "plan_fix": ep.plan_fix.exists(),
            "clips_ok": ep.clips_ok.exists(),
            "clips_fix": ep.clips_fix.exists(),
            "upload_ok": ep.upload_ok.exists(),
        },
        "files": {
            "plan_md": _rel_or_none(ep.plan_md, root),
            "contact_sheet": _rel_or_none(ep.contact_sheet, root),
            "clip_list": _rel_or_none(ep.clip_list, root),
            "timeline": _rel_or_none(timeline_path, root),
            "final_mp4": _rel_or_none(ep.final_mp4, root),
            "thumb": _rel_or_none(thumb_path, root),
            "result_json": _rel_or_none(ep.result_json, root),
        },
        "title": title,
        "template_id": template_id,
        "template_name": template_name,
    }


def run_list(root: Path | None = None) -> dict:
    root = root or ROOT
    episodes = []
    for date_dir in root.iterdir():
        if not date_dir.is_dir() or not DATE_RE.match(date_dir.name):
            continue
        for ep_dir in date_dir.iterdir():
            if not ep_dir.is_dir():
                continue
            m = EPISODE_DIR_RE.match(ep_dir.name)
            if not m:
                continue
            track, num = m.group(1), m.group(2)
            ep = Episode(date_dir.name, track, num, ep_dir)
            episodes.append(episode_summary(ep, root))

    episodes.sort(key=lambda e: (e["date"], e["track"], e["num"]), reverse=True)
    return {"root": _root_posix(root), "episodes": episodes}


def _read_text_or_none(path: Path) -> str | None:
    return path.read_text(encoding="utf-8") if path.exists() else None


def _read_json_or_none(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _find_episode(root: Path, date: str, track: str, num: str) -> Episode:
    base = root / date
    hits = sorted(base.glob(f"{track}-{num}-*"))
    if not hits:
        raise FileNotFoundError(f"{base}\\{track}-{num}-* 폴더가 없습니다.")
    return Episode(date, track, num, hits[0])


def run_episode(track: str, date: str, num: str, root: Path | None = None) -> dict:
    root = root or ROOT
    ep = _find_episode(root, date, track, num)

    summary = episode_summary(ep, root)

    plan_dict = None
    plan_error = None
    plan_md = _read_text_or_none(ep.plan_md)
    if ep.plan_md.exists():
        try:
            plan = _parse_plan(ep)
            plan_dict = dataclasses.asdict(plan)
        except Exception as exc:  # noqa: BLE001
            plan_error = str(exc)

    clips_dir = ep.assets_dir / "클립"
    tts_dir = ep.assets_dir / "tts"
    narration_path = ep.assets_dir / "narration.mp3"
    images_dir = ep.clips_dir

    clip_files = sorted(clips_dir.glob("*.mp4")) if clips_dir.exists() else []
    tts_files = sorted(tts_dir.glob("*")) if tts_dir.exists() else []
    image_files = []
    if images_dir.exists():
        for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp"):
            image_files.extend(images_dir.glob(ext))
        image_files.sort()

    return {
        "root": _root_posix(root),
        "episode": summary,
        "plan": plan_dict,
        "plan_error": plan_error,
        "brief": _read_text_or_none(ep.dir / "00-제작의도.md"),
        "plan_md": plan_md,
        "fix_requests": {
            "plan": _read_text_or_none(ep.plan_fix),
            "clips": _read_text_or_none(ep.clips_fix),
        },
        "clip_list": _read_json_or_none(ep.clip_list),
        "timeline": _read_json_or_none(ep.assets_dir / "타임라인.json"),
        "result": _read_json_or_none(ep.result_json),
        "assets": {
            "clips": [_rel(p, root) for p in clip_files],
            "tts": [_rel(p, root) for p in tts_files],
            "narration": _rel_or_none(narration_path, root),
            "images": [_rel(p, root) for p in image_files],
        },
    }


def run_research(root: Path | None = None) -> dict:
    root = root or ROOT
    research_dir = DATA / "research"
    files = sorted(research_dir.glob("*.json")) if research_dir.exists() else []

    character_references = []
    research_config_path = CONFIG / "research.yaml"
    if research_config_path.exists():
        cfg = yaml.safe_load(research_config_path.read_text(encoding="utf-8")) or {}
        character_references = cfg.get("ai_character_references", []) or []

    if not files:
        return {"root": _root_posix(root), "latest": None, "fresh": False, "character_references": character_references}

    latest_path = files[-1]
    data = json.loads(latest_path.read_text(encoding="utf-8"))

    freshness_days = 7
    if research_config_path.exists():
        cfg = yaml.safe_load(research_config_path.read_text(encoding="utf-8")) or {}
        freshness_days = cfg.get("freshness_days", freshness_days)

    fresh = False
    generated = data.get("generated")
    if generated:
        try:
            generated_dt = datetime.fromisoformat(generated)
            fresh = (datetime.now() - generated_dt).days <= freshness_days
        except ValueError:
            fresh = False

    return {
        "root": _root_posix(root),
        "latest": {"file": _rel(latest_path, root), "data": data},
        "fresh": fresh,
        "character_references": character_references,
    }


def run_config(root: Path | None = None) -> dict:
    root = root or ROOT
    catalog = templates.load_catalog()
    voice_data = yaml.safe_load((CONFIG / "voice.yaml").read_text(encoding="utf-8"))
    channels_data = yaml.safe_load((CONFIG / "channels.yaml").read_text(encoding="utf-8"))

    return {
        "root": _root_posix(root),
        "templates": [
            {
                "id": t.id,
                "name": t.name,
                "duration": list(t.duration),
                "enforce_duration": t.enforce_duration,
            }
            for t in catalog.templates
        ],
        "default_template": catalog.default_id,
        "voice": voice_data,
        "channels": channels_data,
    }


def run_blog_keywords(week: str | None = None, root: Path | None = None) -> dict:
    root = root or ROOT
    directory = DATA / "blog" / "keywords"
    if week and not re.fullmatch(r"\d{4}-W\d{2}", week):
        raise StepFailed("week는 YYYY-Www 형식이어야 합니다.")
    files = sorted(directory.glob("*.json")) if directory.exists() else []
    target = directory / f"{week}.json" if week else (files[-1] if files else None)
    if target is None or not target.exists():
        return {"root": _root_posix(root), "week": week, "file": None, "data": None}
    data = json.loads(target.read_text(encoding="utf-8-sig"))
    statuses: dict[str, str] = {}
    for project_file in (root / "블로그").glob("*/프로젝트.json"):
        try:
            project = json.loads(project_file.read_text(encoding="utf-8-sig"))
            keyword = str(project.get("keyword", {}).get("main", "")).replace(" ", "").lower()
            if keyword:
                statuses[keyword] = "published" if project.get("status") == "published" else "writing"
        except (OSError, json.JSONDecodeError):
            continue
    if isinstance(data, dict) and isinstance(data.get("keywords"), list):
        for row in data["keywords"]:
            if isinstance(row, dict):
                key = str(row.get("main", "")).replace(" ", "").lower()
                row["status"] = statuses.get(key, "unused")
    return {"root": _root_posix(root), "week": target.stem, "file": _rel(target, root), "data": data}
