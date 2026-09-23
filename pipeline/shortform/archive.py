"""아카이브 — 만든 것들을 모아 R2에 올리고 원격 뷰어가 읽을 목록을 만든다.

저장소를 훑어 편 완성 영상·상세페이지·이미지·릴스기획 자료를 찾고, 각각을 R2 키로 올린 뒤
index.json 하나에 목록을 적는다. 뷰어(Cloudflare Pages)는 그 index.json 만 읽으면 된다.

버킷은 공개하지 않는다. 본인 작업물 보관이라 URL 만 알면 보이는 구조는 맞지 않는다.
뷰어가 R2 바인딩으로 직접 읽고, 인증은 Cloudflare Access 가 앞단에서 맡는다.

키 규칙은 저장소 상대 경로를 그대로 따른다. 다시 올리면 같은 키를 덮어쓰므로
아카이브가 항상 로컬과 같은 모습이 된다.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path

from .paths import ROOT

INDEX_KEY = "archive/index.json"
# 편 폴더 이름: 2026-09-11/B-01-요정재형건강검진
EPISODE_DIR = re.compile(r"^([AB])-(\d+)-(.+)$")
DATE_DIR = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


@dataclass
class Item:
    """뷰어가 목록에 한 줄로 보여 주는 단위."""

    kind: str          # episode | detail | reels
    id: str
    title: str
    date: str = ""
    subtitle: str = ""
    video: str = ""    # R2 키
    poster: str = ""
    page: str = ""     # 상세페이지 HTML 키
    images: list[str] = field(default_factory=list)
    docs: list[str] = field(default_factory=list)


def _rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


# 트랙마다 기획안 형식이 다르다. B안은 '# 제목 후보' 아래 번호 목록, A안은 '# 시놉시스'로
# 시작하고 제목이 따로 없다(planfile_a 도 시놉시스 첫 줄을 제목으로 쓴다).
GENERIC_HEADINGS = {"시놉시스", "락 블록", "컷표"}


def _episode_title(plan_md: Path, fallback: str) -> str:
    """기획안에서 제목을 뽑는다. 못 찾으면 폴더 슬러그."""
    if not plan_md.is_file():
        return fallback
    lines = plan_md.read_text(encoding="utf-8", errors="replace").splitlines()
    for i, line in enumerate(lines):
        if line.strip() == "# 제목 후보":
            for candidate in lines[i + 1:i + 6]:
                m = re.match(r"^\s*\d+\.\s*(.+?)\s*$", candidate)
                if m:
                    return m.group(1).strip('"')
            break
        if line.strip() == "# 시놉시스":
            for body in lines[i + 1:i + 5]:
                if body.strip():
                    return body.strip()[:40]
            break
    for line in lines:
        if line.startswith("# ") and line[2:].strip() not in GENERIC_HEADINGS:
            return line[2:].strip()
    return fallback


def scan_episodes(root: Path) -> list[Item]:
    items: list[Item] = []
    for date_dir in sorted((p for p in root.iterdir() if p.is_dir() and DATE_DIR.match(p.name)), reverse=True):
        for ep_dir in sorted(p for p in date_dir.iterdir() if p.is_dir() and EPISODE_DIR.match(p.name)):
            m = EPISODE_DIR.match(ep_dir.name)
            track, num, slug = m.group(1), m.group(2), m.group(3)
            final = ep_dir / "04-영상" / "final.mp4"
            thumb = ep_dir / "04-영상" / "thumb.jpg"
            images = sorted(
                p for p in (ep_dir / "02-이미지").glob("*")
                if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
            )
            plan = ep_dir / "01-기획안.md"
            # 아직 아무 결과물도 없는 편은 목록에 넣지 않는다.
            if not final.is_file() and not images and not plan.is_file():
                continue
            items.append(Item(
                kind="episode",
                id=f"{date_dir.name}/{ep_dir.name}",
                title=_episode_title(plan, slug),
                date=date_dir.name,
                subtitle=f"{track}-{num} · {slug}",
                video=_rel(final, root) if final.is_file() else "",
                poster=_rel(thumb, root) if thumb.is_file() else "",
                images=[_rel(p, root) for p in images],
                docs=[_rel(plan, root)] if plan.is_file() else [],
            ))
    return items


def scan_detail_pages(root: Path) -> list[Item]:
    base = root / "상세페이지"
    if not base.is_dir():
        return []
    items: list[Item] = []
    for project_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        meta_file = project_dir / "프로젝트.json"
        if not meta_file.is_file():
            continue
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        pages = sorted(project_dir.glob("*.html"))
        videos = sorted(p for p in (project_dir / "영상").glob("*") if p.is_file())
        items.append(Item(
            kind="detail",
            id=project_dir.name,
            title=meta.get("title") or project_dir.name,
            date=(meta.get("updatedAt") or "")[:10],
            subtitle=" · ".join(x for x in (meta.get("client"), meta.get("product")) if x),
            page=_rel(pages[0], root) if pages else "",
            images=[_rel(p, root) for p in videos if p.suffix.lower() in IMAGE_SUFFIXES],
            video=next((_rel(p, root) for p in videos if p.suffix.lower() == ".mp4"), ""),
            docs=[_rel(meta_file, root)],
        ))
    return items


def scan_reels(root: Path) -> list[Item]:
    base = root / "릴스기획"
    if not base.is_dir():
        return []
    items: list[Item] = []
    for project_dir in sorted((p for p in base.iterdir() if p.is_dir()), reverse=True):
        meta_file = project_dir / "프로젝트.json"
        if not meta_file.is_file():
            continue
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        reference = meta.get("reference") or {}
        docs = [p for p in (project_dir / "기획안.md", project_dir / "분석.srt") if p.is_file()]
        items.append(Item(
            kind="reels",
            id=project_dir.name,
            title=meta.get("title") or project_dir.name,
            date=project_dir.name[:8],
            subtitle=" · ".join(x for x in (reference.get("author"), meta.get("brand_name")) if x),
            docs=[_rel(p, root) for p in docs] + [_rel(meta_file, root)],
        ))
    return items


def scan_studio(root: Path) -> list[Item]:
    """Only explicitly included exports; never upload project prompts or private refs."""
    items = []
    for file in (root / "pipeline/data/studio/projects").glob("*/project.json"):
        project = json.loads(file.read_text(encoding="utf-8"))
        assets = {a["id"]: a for a in project.get("assets", [])}
        for export in project.get("exports", []):
            if not export.get("archive"):
                continue
            asset = assets.get(export["assetId"])
            if not asset:
                continue
            video = (root / asset["path"]).resolve()
            if not video.is_relative_to(file.parent.resolve()) or not video.is_file():
                continue
            items.append(Item(kind="episode", id=f"studio/{project['id']}/{export['id']}", title=export["snapshot"]["title"], date=export["createdAt"][:10], subtitle="Take Studio · 출력본", video=video.relative_to(root.resolve()).as_posix()))
    return items


def build_manifest(root: Path | None = None) -> dict:
    root = root or ROOT
    items = scan_episodes(root) + scan_detail_pages(root) + scan_reels(root) + scan_studio(root)
    return {
        "version": 1,
        "items": [asdict(item) for item in items],
        "counts": {
            kind: sum(1 for i in items if i.kind == kind)
            for kind in ("episode", "detail", "reels")
        },
    }


def manifest_files(manifest: dict, root: Path | None = None) -> dict[str, Path]:
    """{R2 키: 로컬 파일}. 키는 저장소 상대 경로 그대로다."""
    root = root or ROOT
    files: dict[str, Path] = {}
    for item in manifest["items"]:
        for rel in [item["video"], item["poster"], item["page"], *item["images"], *item["docs"]]:
            if not rel:
                continue
            path = root / rel
            if path.is_file():
                files[rel] = path
    return files


def file_md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
