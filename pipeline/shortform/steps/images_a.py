"""A안 이미지 단계 — 캐릭터 시트 1장 → 컷별 키프레임 → 검사 → 승인 게이트.

생성기는 codex CLI(사용자 결정). codex exec 를 02-이미지/ 를 작업 폴더로 열고
"이 경로에 PNG를 만들어라"고 시킨다. 파일이 안 생기면 실패로 보고 수동 투입 경로를 안내한다.

원칙(전략 문서 20-A안 5절)
- 시트는 한 장. 마음에 들 때까지 이 한 장만 반복한다(시트가 있으면 다시 만들지 않는다 — 지우고 재실행).
- 키프레임은 컷마다 시트를 참조로 첨부한다. 앞 컷 결과를 참조하지 않는다(오차 누적).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import yaml

from .. import GateBlocked, StepFailed
from ..paths import CONFIG, Episode
from .. import planfile_a
from .check_frames import KEYFRAME, SHEET, run_check


def _config() -> dict:
    path = CONFIG / "images.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {"provider": "manual"}


def _codex(prompt: str, cwd: Path, images: list[Path], cfg: dict) -> str:
    """codex exec 를 돌리고 마지막 메시지를 돌려준다. 파일 생성은 codex가 한다."""
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


def _sheet_prompt(plan, out: Path, hint: str) -> str:
    return (
        f"이미지 생성 도구({hint})로 캐릭터 시트 PNG 한 장을 만들어 정확히 이 경로에 저장하세요: {out}\n"
        "다른 파일은 만들지 마세요. 코드 작성이나 설명 대신 이미지 생성 결과 파일만 남기면 됩니다.\n\n"
        "규격: 세로 9:16, 최소 1080x1920. 한 장 안에 3면 턴어라운드(정면·3/4·측면), 표정 4~6개, 의상·소품 변형, 디테일 클로즈업을 격자로 배치. "
        "흰 배경, 라벨 텍스트 최소. 워터마크 없음.\n\n"
        f"캐릭터 락 블록(외모·의상·스타일은 이대로만):\n{planfile_a.lock_block_text(plan)}\n\n"
        f"시놉시스(분위기 참고):\n{plan.synopsis[:600]}\n"
    )


def _keyframe_prompt(plan, cut, sheet: Path, out: Path, hint: str) -> str:
    return (
        f"첨부한 캐릭터 시트({sheet.name})의 인물을 그대로 써서, 이미지 생성 도구({hint})로 컷 {cut.n} 키프레임 PNG를 만들어 정확히 이 경로에 저장하세요: {out}\n"
        "다른 파일은 만들지 마세요.\n\n"
        "규격: 세로 9:16, 최소 1080x1920, 워터마크 없음. 시트와 같은 얼굴·머리·의상·소품(귀걸이·단추 같은 디테일 포함).\n"
        f"이 컷의 지시 — 액션: {cut.action} / 카메라: {cut.camera} / 렌즈: {cut.lens} / 구간: {cut.start:g}~{cut.end:g}초\n"
        "외모·의상·스타일은 시트와 락 블록에 이미 있으니 다시 쓰지 말고, 액션과 카메라만 반영하세요.\n\n"
        f"락 블록:\n{planfile_a.lock_block_text(plan)}\n"
    )


def run(ep: Episode) -> None:
    plan = planfile_a.load(ep.plan_md)
    cfg = _config()
    provider = cfg.get("provider", "manual")
    hint = cfg.get("image_model_hint", "gpt-image")
    ep.clips_dir.mkdir(parents=True, exist_ok=True)
    sheet = ep.clips_dir / SHEET

    if ep.clips_fix.exists():
        note = ep.clips_fix.read_text(encoding="utf-8").strip()
        print(f"  수정 요청: {note[:200]}")
        # 요청에 적힌 번호의 키프레임을 지워 다시 만든다. '시트'가 적혀 있으면 시트부터.
        if "시트" in note:
            sheet.unlink(missing_ok=True)
            for c in plan.cuts:
                (ep.clips_dir / KEYFRAME.format(n=c.n)).unlink(missing_ok=True)
        else:
            for tok in note.replace(",", " ").split():
                digits = "".join(ch for ch in tok if ch.isdigit())
                if digits:
                    (ep.clips_dir / KEYFRAME.format(n=int(digits))).unlink(missing_ok=True)
        ep.clips_fix.unlink()
        ep.clips_ok.unlink(missing_ok=True)

    if not sheet.exists():
        if provider == "codex":
            print("  캐릭터 시트 생성 중 (codex)...")
            _codex(_sheet_prompt(plan, sheet, hint), ep.clips_dir, [], cfg)
        if not sheet.exists():
            raise StepFailed(
                f"캐릭터 시트가 없습니다: {sheet}\n"
                "  codex가 이미지를 만들지 못했거나 provider가 manual입니다. Codex/힉스필드 등에서 만들어 이 이름으로 넣고 다시 실행하세요."
            )
    else:
        print(f"  시트 있음 → {sheet.name} (다시 만들려면 파일을 지우세요)")

    targets = [c for c in plan.cuts if c.required or not cfg.get("keyframes_optional", False)]
    for cut in targets:
        out = ep.clips_dir / KEYFRAME.format(n=cut.n)
        if out.exists():
            continue
        if provider == "codex":
            # codex가 이미지는 만들고도 샌드박스 저장에 간헐적으로 실패한다(실측 4회 중 2회). 한 번 더 시도한다.
            for attempt in (1, 2):
                print(f"  키프레임 {cut.n:02d} 생성 중 (codex, {attempt}/2)... {cut.action[:40]}")
                _codex(_keyframe_prompt(plan, cut, sheet, out, hint), ep.clips_dir, [sheet], cfg)
                if out.exists():
                    break
        if not out.exists():
            print(f"  ! 키프레임 {cut.n:02d} 없음 — 수동으로 넣을 수 있습니다: {out.name}")

    report = run_check(ep, plan)
    print(f"  검사: 시트 {'OK' if report['sheet'] else '없음'} · 파일 {len(report['files'])}개 · 필수 누락 {report['missing_required']} · 문제 {report['problems']}")
    if report["missing_required"]:
        raise StepFailed(f"필수 컷 키프레임이 없습니다: {report['missing_required']}. 만들어 넣고 다시 실행하세요.")

    if not ep.clips_ok.exists():
        raise GateBlocked(
            f"이미지 승인이 없습니다.\n  컨택트시트를 보세요: {ep.contact_sheet}\n"
            f"  괜찮으면 빈 파일을 만드세요:  {ep.clips_ok}\n  다시 만들 컷 번호(또는 '시트')를 적으세요:  {ep.clips_fix}"
        )
    print("  이미지 승인 확인됨")
