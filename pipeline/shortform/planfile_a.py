"""A안(AI 생성 영상) 기획안 파서. 전략 문서 20-A안 4절의 형식.

    # 시놉시스
    ## 락 블록
    ### CHARACTER / ### COSTUME / ### GLOBAL STYLE / ### NEGATIVE
    ## 컷표        | 컷 | TC | 렌즈 | 액션 | 카메라 | 필수 |
    ## 음향 설계   - 환경음: / - 효과음: / - 무음 구간:
    ## 캐릭터 시트  (캐릭터별 ### 소제목과 - 항목: 값)
    ## 대사         | 시각 | 캐릭터 | 대사 | 연출 |
    ## 조사 참고    (선택)
    ## 메타데이터  - 제목: / - 설명: / - 태그: / - 공개:

B안 planfile과 같은 섹션 유틸을 쓴다. 웹 콘솔 inspect가 title/template_id/template_name을 읽으므로 같은 속성을 둔다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from . import StepFailed
from .planfile import Comment, _sections, _table

LOCK_KEYS = ("CHARACTER", "COSTUME", "GLOBAL STYLE", "NEGATIVE")


@dataclass
class Cut:
    n: int
    start: float
    end: float
    lens: str
    action: str
    camera: str
    required: bool

    @property
    def seconds(self) -> float:
        return max(0.5, self.end - self.start)


@dataclass
class Character:
    name: str
    details: dict[str, str] = field(default_factory=dict)


@dataclass
class Dialogue:
    at: float
    character: str
    text: str
    direction: str = ""


@dataclass
class PlanA:
    title: str
    synopsis: str
    locks: dict[str, str]
    cuts: list[Cut]
    sound: dict[str, str]
    characters: list[Character] = field(default_factory=list)
    dialogues: list[Dialogue] = field(default_factory=list)
    research_notes: list[str] = field(default_factory=list)
    comments: list[Comment] = field(default_factory=list)
    meta: dict = field(default_factory=dict)
    template_id: str = "briefing-focus"
    template_name: str = "브리핑 포커스"

    @property
    def hook(self) -> str:
        return self.synopsis.splitlines()[0] if self.synopsis else ""

    @property
    def total_seconds(self) -> float:
        return max((c.end for c in self.cuts), default=0.0)


def _tc(raw: str) -> tuple[float, float]:
    """'0-5', '5~10', '0:05-0:10' 을 초 구간으로."""
    parts = re.split(r"\s*[-~–]\s*", raw.strip())
    if len(parts) != 2:
        raise StepFailed(f"컷표 TC 형식이 이상합니다: {raw!r} (예: 0-5)")

    def sec(s: str) -> float:
        if ":" in s:
            m, ss = s.split(":", 1)
            return float(m) * 60 + float(ss)
        return float(s)

    a, b = sec(parts[0]), sec(parts[1])
    if b <= a:
        raise StepFailed(f"컷표 TC 구간이 비었습니다: {raw!r}")
    return a, b


def _seconds(raw: str) -> float:
    value = raw.strip()
    if ":" in value:
        minute, second = value.split(":", 1)
        return float(minute) * 60 + float(second)
    return float(value)


def _character_sheets(markdown: str) -> list[Character]:
    """Read the character-sheet section while preserving its ### character groups."""
    in_section = False
    current: Character | None = None
    characters: list[Character] = []
    for raw in markdown.splitlines():
        h2 = re.match(r"^##\s+(.*)$", raw)
        if h2:
            in_section = "캐릭터" in h2.group(1)
            current = None
            continue
        if not in_section:
            continue
        h3 = re.match(r"^###\s+(.+?)\s*$", raw)
        if h3:
            current = Character(name=h3.group(1).strip())
            characters.append(current)
            continue
        item = re.match(r"^\s*[-*]\s*([^:：]+)\s*[:：]\s*(.*?)\s*$", raw)
        if item and current:
            current.details[item.group(1).strip()] = item.group(2).strip()
    return [character for character in characters if character.name]


def load(path: Path) -> PlanA:
    markdown = path.read_text(encoding="utf-8")
    sections = _sections(markdown)

    synopsis_body = next((body for name, body in sections.items() if "시놉시스" in name), None)
    if synopsis_body is None:
        raise StepFailed("A안 기획안에 '# 시놉시스' 절이 없습니다.")
    synopsis = "\n".join(l.strip() for l in synopsis_body.splitlines() if l.strip())

    locks = {}
    for key in LOCK_KEYS:
        body = next((b for n, b in sections.items() if n.strip().upper() == key), "")
        locks[key] = "\n".join(l.strip() for l in body.splitlines() if l.strip())
    if not locks["CHARACTER"]:
        raise StepFailed("락 블록 CHARACTER가 비어 있습니다. 캐릭터 시트 생성의 기준이라 필수입니다.")

    cut_body = next((b for n, b in sections.items() if "컷표" in n), None)
    if cut_body is None:
        raise StepFailed("A안 기획안에 '## 컷표' 절이 없습니다.")
    cuts: list[Cut] = []
    for row in _table(cut_body):
        n_raw = (row.get("컷") or row.get("#") or "").strip()
        if not n_raw.isdigit():
            continue
        start, end = _tc(row.get("TC", ""))
        cuts.append(Cut(
            n=int(n_raw), start=start, end=end,
            lens=row.get("렌즈", "").strip(),
            action=row.get("액션", "").strip(),
            camera=row.get("카메라", "").strip(),
            required=(row.get("필수", "").strip() in ("필수", "O", "o", "✓", "Y", "y", "yes")),
        ))
    if not cuts:
        raise StepFailed("컷표를 읽지 못했습니다. 컷·TC·렌즈·액션·카메라·필수 열이 있어야 합니다.")
    cuts.sort(key=lambda c: c.n)

    characters = _character_sheets(markdown)

    dialogues: list[Dialogue] = []
    dialogue_body = next((b for n, b in sections.items() if "대사" in n or "다이얼로그" in n), "")
    for row in _table(dialogue_body):
        raw_at = (row.get("시각") or row.get("TC") or "").strip()
        raw_text = (row.get("대사") or row.get("내용") or "").strip()
        if not raw_text:
            continue
        try:
            at = _seconds(raw_at.split("-", 1)[0].strip()) if raw_at else 0.0
        except ValueError:
            continue
        dialogues.append(Dialogue(
            at=at,
            character=(row.get("캐릭터") or row.get("인물") or "").strip(),
            text=raw_text,
            direction=(row.get("연출") or row.get("표정") or "").strip(),
        ))

    research_notes = [
        re.sub(r"^\s*[-*]\s*", "", line).strip()
        for line in next((b for n, b in sections.items() if "조사" in n), "").splitlines()
        if re.sub(r"^\s*[-*]\s*", "", line).strip()
    ]

    sound = {}
    for raw in next((b for n, b in sections.items() if "음향" in n), "").splitlines():
        m = re.match(r"^\s*[-*]\s*([^:]+):\s*(.*)$", raw)
        if m:
            sound[m.group(1).strip()] = m.group(2).strip()

    meta = {}
    for raw in next((b for n, b in sections.items() if "메타" in n), "").splitlines():
        m = re.match(r"^\s*[-*]\s*([^:]+):\s*(.*)$", raw)
        if m:
            meta[m.group(1).strip()] = m.group(2).strip()

    title = meta.get("제목") or (synopsis.splitlines()[0][:40] if synopsis else path.parent.name)
    return PlanA(
        title=title,
        synopsis=synopsis,
        locks=locks,
        cuts=cuts,
        sound=sound,
        characters=characters,
        dialogues=dialogues,
        research_notes=research_notes,
        # A안은 댓글 카드가 아니라 캐릭터 대사를 사용한다.
        comments=[],
        meta=meta,
    )


def lock_block_text(plan: PlanA) -> str:
    """이미지·영상 프롬프트 머리에 붙일 락 블록. 외모·의상·스타일은 여기서만 말한다."""
    return "\n".join(f"[{k}]\n{v}" for k, v in plan.locks.items() if v)
