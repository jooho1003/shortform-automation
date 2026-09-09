"""01-기획안.md 파서. 표 형식이라 사람이 읽고 고치기도, 코드가 읽기도 쉽다."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from . import StepFailed
from .templates import resolve_template


@dataclass
class Line:
    n: int
    text: str
    source: str          # stock | pd | trailer
    queries: list[str]


@dataclass
class Comment:
    at: float
    nick: str
    text: str


@dataclass
class Plan:
    title: str
    hook: str
    lines: list[Line]
    template_id: str = "briefing-focus"
    template_name: str = "브리핑 포커스"
    comments: list[Comment] = field(default_factory=list)
    meta: dict = field(default_factory=dict)


def _sections(md: str) -> dict[str, str]:
    out: dict[str, list[str]] = {}
    current = None
    for raw in md.splitlines():
        heading = re.match(r"^#{1,3}\s+(.*)$", raw)
        if heading:
            current = heading.group(1).strip()
            out[current] = []
        elif current is not None:
            out[current].append(raw)
    return {k: "\n".join(v) for k, v in out.items()}


def _find(sections: dict[str, str], *keywords: str) -> str:
    for name, body in sections.items():
        if any(k in name for k in keywords):
            return body
    raise StepFailed(f"기획안에 {keywords[0]} 절이 없습니다.")


def _table(body: str) -> list[dict[str, str]]:
    rows = [l.strip() for l in body.splitlines() if l.strip().startswith("|")]
    if len(rows) < 3:
        return []
    header = [c.strip() for c in rows[0].strip("|").split("|")]
    parsed = []
    for row in rows[2:]:  # 0=헤더, 1=구분선
        cells = [c.strip() for c in row.strip("|").split("|")]
        # 에디터가 표를 정렬하면서 빈 행을 흘려 넣는 일이 있다. 그런 행은 버린다.
        if len(cells) == len(header) and any(cells):
            parsed.append(dict(zip(header, cells)))
    return parsed


def load(path: Path) -> Plan:
    sections = _sections(path.read_text(encoding="utf-8"))

    template_body = sections.get("템플릿", "")
    selected_name = next((line.strip() for line in template_body.splitlines() if line.strip()), None)
    if selected_name:
        selected_name = re.sub(r"^[-*+]\s+", "", selected_name).strip()
    template = resolve_template(selected_name)

    titles = [
        re.sub(r"^\s*[-*\d.]+\s*", "", l).strip()
        for l in _find(sections, "제목").splitlines()
        if l.strip() and not l.strip().startswith("|")
    ]
    hook = " ".join(l.strip() for l in _find(sections, "훅").splitlines() if l.strip())

    lines = []
    for row in _table(_find(sections, "대본")):
        if not row.get("#", "").strip().isdigit():
            continue
        lines.append(
            Line(
                n=int(row["#"]),
                text=row["문장"],
                source=row.get("소재", "stock").strip() or "stock",
                queries=[q.strip() for q in row.get("검색어", "").split(",") if q.strip()],
            )
        )
    if not lines:
        raise StepFailed("기획안 대본 표를 읽지 못했습니다.")

    comments = [
        Comment(at=float(row["시각"]), nick=row["닉네임"], text=row["내용"])
        for row in _table(_find(sections, "댓글"))
    ]

    meta = {}
    for raw in _find(sections, "메타데이터").splitlines():
        m = re.match(r"^\s*[-*]\s*([^:]+):\s*(.*)$", raw)
        if m:
            meta[m.group(1).strip()] = m.group(2).strip()

    return Plan(
        title=titles[0] if titles else path.stem,
        hook=hook,
        lines=lines,
        template_id=template.id,
        template_name=template.name,
        comments=comments,
        meta=meta,
    )
