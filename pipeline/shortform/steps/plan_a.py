"""A안 기획 게이트. B안 plan.py와 같은 승인 흐름이되 조사 게이트는 없다 — AI 생성물은 주간 화제성을 따르지 않는다."""

from __future__ import annotations

from .. import GateBlocked
from ..paths import Episode
from .. import planfile_a


def run(ep: Episode) -> None:
    if not ep.plan_md.exists():
        raise GateBlocked(
            f"기획안이 없습니다: {ep.plan_md}\n"
            "  시놉시스 / 락 블록 4개 / 컷표 / 음향 설계 / 메타데이터 형식으로 쓰고 다시 실행하세요."
        )
    plan = planfile_a.load(ep.plan_md)  # 형식이 틀리면 여기서 StepFailed
    print(f"  컷 {len(plan.cuts)}개 · {plan.total_seconds:g}초 · 필수 컷 {sum(c.required for c in plan.cuts)}개")

    if ep.plan_fix.exists():
        note = ep.plan_fix.read_text(encoding="utf-8").strip()
        raise GateBlocked(f"수정 요청이 남아 있습니다: {ep.plan_fix.name}\n  내용: {note[:200]}")
    if not ep.plan_ok.exists():
        raise GateBlocked(
            f"기획 승인이 없습니다.\n  기획안: {ep.plan_md}\n  괜찮으면 빈 파일을 만드세요:  {ep.plan_ok}"
        )
    print(f"  기획 승인 확인됨 → {ep.plan_md.name}")
