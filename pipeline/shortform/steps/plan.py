"""기획. 01-기획안.md를 만들고 기획 승인 게이트에서 멈춘다. 설계 문서 4.3절.

조사 없이 기획하지 않는다. 그 주의 조사 리포트가 없거나 묵었으면 여기서 막는다.
문서로만 적어 두면 지켜지지 않아서 게이트로 박았다.
"""

from __future__ import annotations

from .. import GateBlocked
from ..paths import Episode
from . import research


def run(ep: Episode) -> None:
    data = research.require_fresh()
    print(f"  조사 확인됨 — {data['week']} · 축 {data['axis']}")

    if not ep.plan_md.exists():
        raise GateBlocked(
            f"기획안이 없습니다: {ep.plan_md}\n"
            "  Claude Code 세션에서 기획안을 쓰게 하거나 직접 작성한 뒤 다시 실행하세요."
        )

    if ep.plan_fix.exists():
        note = ep.plan_fix.read_text(encoding="utf-8").strip()
        raise GateBlocked(
            f"수정 요청이 남아 있습니다: {ep.plan_fix.name}\n"
            f"  내용: {note[:200]}\n"
            "  기획안을 고치고 수정요청 파일을 지운 뒤 다시 실행하세요."
        )

    if not ep.plan_ok.exists():
        raise GateBlocked(
            f"기획 승인이 없습니다.\n"
            f"  기획안을 읽어보세요:  {ep.plan_md}\n"
            f"  괜찮으면 빈 파일을 만드세요:  {ep.plan_ok}\n"
            f"  고칠 게 있으면 여기에 적으세요:  {ep.plan_fix}"
        )

    print(f"  기획 승인 확인됨 → {ep.plan_md.name}")
