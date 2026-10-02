"""A안 이미지 단계 — 캐릭터 시트 1장 → 컷별 키프레임 → 검사 → 승인 게이트.

생성기는 codex CLI(사용자 결정). codex exec 를 02-이미지/ 를 작업 폴더로 열고
"이 경로에 PNG를 만들어라"고 시킨다. 파일이 안 생기면 실패로 보고 수동 투입 경로를 안내한다.

원칙(전략 문서 20-A안 5절)
- 시트는 한 장. 마음에 들 때까지 이 한 장만 반복한다(시트가 있으면 다시 만들지 않는다 — 지우고 재실행).
- 키프레임은 컷마다 시트를 참조로 첨부한다. 앞 컷 결과를 참조하지 않는다(오차 누적).
- 체인 기획안(설계 10): 세트 시트 1장 + 컷마다 시작·끝 프레임. 끝 프레임은 그 컷의 시작 프레임을 참조한다(한 컷 안의 한 번 참조라 오차가 누적되지 않는다).
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path

import yaml

from .. import GateBlocked, StepFailed
from .. import codex
from ..paths import CONFIG, Episode
from .. import planfile_a
from .check_frames import END_KEYFRAME, KEYFRAME, SET_SHEET, SHEET, end_frame_name, run_check, start_frame_name


def _config() -> dict:
    path = CONFIG / "images.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {"provider": "manual"}


def _sheet_prompt(plan, out: Path, hint: str, instruction: str = "") -> str:
    return (
        f"이미지 생성 도구({hint})로 캐릭터 시트 PNG 한 장을 만들어 정확히 이 경로에 저장하세요: {out}\n"
        "다른 파일은 만들지 마세요. 코드 작성이나 설명 대신 이미지 생성 결과 파일만 남기면 됩니다.\n\n"
        "규격: 세로 9:16, 최소 1080x1920. 한 장 안에 3면 턴어라운드(정면·3/4·측면), 표정 4~6개, 디테일 클로즈업을 격자로 배치. 모든 뷰와 디테일은 하나의 고정된 정식 디자인을 같은 모습으로 보여야 합니다. 의상·소품의 변형, 대체안, 다른 버전을 만들지 마세요. "
        "흰 배경, 라벨 텍스트 최소. 워터마크 없음.\n\n"
        f"캐릭터 락 블록(외모·의상·스타일은 이대로만):\n{planfile_a.lock_block_text(plan)}\n\n"
        f"시놉시스(분위기 참고):\n{plan.synopsis[:600]}\n"
        + (f"\n재생성 지시(락 블록을 바꾸지 말고 이것만 반영):\n{instruction}\n" if instruction else "")
    )


def _extra_sheets(ep: Episode) -> list[Path]:
    """주인공 시트 외의 보조 시트(예: 시트-인물.png — 사무실 사람들). 키프레임 참조로 함께 붙인다."""
    return sorted(p for p in ep.clips_dir.glob("시트-*.png") if p.name != SHEET)


def frame_name(plan, n: int, which: str) -> str:
    """(컷, 시작|끝) → 파일 이름. '이어서' 컷의 시작은 앞 컷의 끝 파일이다."""
    cut = next(c for c in plan.cuts if c.n == n)
    return start_frame_name(plan, cut) if which == "start" else end_frame_name(cut)


def expand_frames(plan, frames: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """시작 변경은 해당 끝과 체인 뒤쪽 끝까지 전파하고, 공유 시작은 앞 컷 끝으로 옮긴다."""
    by_n = {c.n: c for c in plan.cuts}
    todo = list(frames)
    out: set[tuple[int, str]] = set()
    while todo:
        n, which = todo.pop()
        cut = by_n[n]
        if which == "start" and cut.chained:
            todo.append((n - 1, "end"))
            continue
        if (n, which) in out:
            continue
        out.add((n, which))
        if which == "start":
            todo.append((n, "end"))
        else:
            nxt = by_n.get(n + 1)
            if nxt is not None and nxt.chained:
                todo.append((n + 1, "end"))
    return sorted(out, key=lambda f: (f[0], 0 if f[1] == "start" else 1))


def _keyframe_prompt(plan, cut, sheet: Path, out: Path, hint: str, instruction: str = "", extra: list[Path] = (), pose_ref: Path | None = None) -> str:
    return (
        f"첨부한 캐릭터 시트({sheet.name})의 인물을 그대로 써서, 이미지 생성 도구({hint})로 컷 {cut.n} 키프레임 PNG를 만들어 정확히 이 경로에 저장하세요: {out}\n"
        + (f"함께 첨부한 보조 시트({', '.join(p.name for p in extra)})의 사람들이 이 컷에 나오면 얼굴·머리·옷을 그 시트와 같게 유지하세요.\n" if extra else "")
        + "다른 파일은 만들지 마세요.\n\n"
        + (f"배경·가구 배치·조명·카메라 위치는 첨부한 세트 시트({SET_SHEET})의 {cut.view} 칸과 같게 하세요.\n" if getattr(cut, "view", "") and any(p.name == SET_SHEET for p in extra) else "")
        + f"이 컷에 보이는 사람: {getattr(cut, 'visible', '') or '없음'}. 그 외 사람·동물은 넣지 마세요.\n"
        + (f"첨부한 {pose_ref.name}은 같은 순간을 다른 카메라에서 본 프레임입니다. 인물의 자세·소품 위치·귀 상태를 그대로 두고 카메라만 {cut.view}로 바꾸세요.\n" if pose_ref else "")
        + "이 이미지는 액션을 시작하기 직전의 단 하나의 시작 프레임입니다. 한 장의 연속된 장면만 만들고, 멀티 프레임 콜라주·분할 패널·컨택트시트·대체 포즈를 만들지 마세요.\n"
        "규격: 세로 9:16, 최소 1080x1920, 워터마크 없음. 시트와 락 블록에 정의된 생물의 해부학·얼굴·신체 특징·의상·소품을 정확히 보존하세요. 인간형이라고 가정하거나, 정의되지 않은 신체·복장·장신구를 추가하지 마세요.\n"
        f"이 컷의 지시 — 액션: {cut.action} / 카메라: {cut.camera} / 렌즈: {cut.lens} / 구간: {cut.start:g}~{cut.end:g}초\n"
        "외모·의상·스타일은 시트와 락 블록에 이미 있으니 다시 쓰지 말고, 액션과 카메라만 반영하세요.\n\n"
        f"락 블록:\n{planfile_a.lock_block_text(plan)}\n"
        + (f"\n재생성 지시(락 블록을 바꾸지 말고 이것만 반영):\n{instruction}\n" if instruction else "")
    )


def _end_frame_prompt(plan, cut, start_ref: Path, out: Path, hint: str, instruction: str = "", extra: list[Path] = ()) -> str:
    return (
        f"첨부한 시작 프레임({start_ref.name})과 같은 카메라·같은 배경·같은 인물 위치를 유지한 채, 자세만 아래 '끝 상태'로 바꾼 컷 {cut.n}의 끝 프레임 PNG를 이미지 생성 도구({hint})로 만들어 정확히 이 경로에 저장하세요: {out}\n"
        "다른 파일은 만들지 마세요.\n\n"
        f"끝 상태: {cut.end_action}\n"
        "시작 프레임과 자세가 분명히 달라야 합니다(같으면 영상이 움직이지 않습니다). 카메라를 옮기거나 배경·조명·소품을 바꾸지 마세요.\n"
        + (f"배경은 세트 시트({SET_SHEET})의 {cut.view} 칸 그대로입니다.\n" if any(p.name == SET_SHEET for p in extra) else "")
        + f"이 컷에 보이는 사람: {getattr(cut, 'visible', '') or '없음'}. 그 외 사람·동물은 넣지 마세요.\n"
        + "규격: 세로 9:16, 최소 1080x1920, 워터마크·글자 없음. 시트와 락 블록의 해부학·얼굴·의상·소품을 정확히 보존하세요.\n\n"
        f"락 블록:\n{planfile_a.lock_block_text(plan)}\n"
        + (f"\n재생성 지시(락 블록을 바꾸지 말고 이것만 반영):\n{instruction}\n" if instruction else "")
    )


def _set_sheet_prompt(plan, out: Path, hint: str) -> str:
    places = "\n".join(f"- {k}: {v}" for k, v in plan.sets.items() if k.startswith("S"))
    views = [(k, v) for k, v in plan.sets.items() if k.startswith("V")]
    view_lines = "\n".join(f"- {k}: {v}" for k, v in views)
    return (
        f"이미지 생성 도구({hint})로 세트 시트 PNG 한 장을 만들어 정확히 이 경로에 저장하세요: {out}\n"
        "다른 파일은 만들지 마세요.\n\n"
        f"규격: 세로 9:16, 최소 1080x1920. 한 장 안에 아래 카메라 뷰 {len(views)}개를 세로로 쌓은 격자로 담고, 칸마다 작은 뷰 ID 라벨만 적습니다. "
        "사람·동물 없이 빈 공간만. 실사 사진풍. 워터마크·로고·그 밖의 글자 없음.\n"
        "모든 칸은 같은 회사 공간이어야 하고, 가구·창·바닥·소품 위치가 서로 모순되지 않아야 합니다. 이 시트는 모든 키프레임의 배경 기준이 됩니다.\n\n"
        f"장소:\n{places}\n\n카메라 뷰(칸 순서):\n{view_lines}\n\n"
        "조명·화풍은 락 블록 GLOBAL STYLE을 따르되, 상상 장면 장소는 황금빛 조명입니다.\n\n"
        f"락 블록:\n{planfile_a.lock_block_text(plan)}\n"
    )


@dataclass
class FrameJob:
    cut: object
    kind: str
    out: Path
    refs: list[Path]
    prompt: str


def _frame_jobs(ep: Episode, plan, targets, sheet: Path, extra: list[Path], hint: str, instruction_for) -> list[FrameJob]:
    """같은 컷의 끝 프레임이 시작을 참조하므로 시작 작업을 먼저 놓는다."""
    by_n = {c.n: c for c in plan.cuts}
    jobs: list[FrameJob] = []
    for cut in sorted(targets, key=lambda c: c.n):
        instr = instruction_for(cut.n)
        start = ep.clips_dir / KEYFRAME.format(n=cut.n)
        if not cut.chained and not start.exists():
            refs = [sheet, *extra]
            pose_ref = None
            prev = by_n.get(cut.n - 1)
            if cut.start_mode == "각도변경" and prev is not None:
                pose_ref = ep.clips_dir / end_frame_name(prev)
                refs.append(pose_ref)
            jobs.append(FrameJob(cut, "start", start, refs, _keyframe_prompt(plan, cut, sheet, start, hint, instr, extra, pose_ref)))
        if getattr(cut, "end_action", ""):
            end = ep.clips_dir / end_frame_name(cut)
            if not end.exists():
                start_ref = ep.clips_dir / start_frame_name(plan, cut)
                jobs.append(FrameJob(cut, "end", end, [sheet, *extra, start_ref], _end_frame_prompt(plan, cut, start_ref, end, hint, instr, extra)))
    return jobs


def _fix_error(message: str) -> StepFailed:
    return StepFailed(
        f"이미지 수정 요청 형식이 올바르지 않습니다: {message}\n"
        'JSON 예: {"version":2,"frames":[{"cut":3,"which":"end"}],"instruction":"카메라를 더 낮게"} 또는 {"version":1,"cuts":[3],"instruction":"…"}. '
        "기존 형식은 정확한 번호 목록(예: 1, 3) 또는 파일 전체가 정확히 '시트'일 때만 됩니다."
    )


def _parse_fix(note: str, known_cuts: set[int]) -> tuple[bool, list[tuple[int, str]], str]:
    """v2는 프레임 단위, v1·번호 목록은 컷의 시작·끝 모두를 대상으로 읽는다."""
    stripped = note.strip()
    if not stripped:
        raise _fix_error("요청이 비어 있습니다.")

    def both(cuts: list[int]) -> list[tuple[int, str]]:
        return sorted((n, w) for n in cuts for w in ("start", "end"))

    if stripped == "시트":
        return True, both(sorted(known_cuts)), "시트"
    if stripped.startswith("{"):
        try:
            value = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise _fix_error("JSON을 읽을 수 없습니다.") from exc
        if not isinstance(value, dict):
            raise _fix_error("JSON 객체여야 합니다.")
        instruction = value.get("instruction")
        if not isinstance(instruction, str) or not instruction.strip():
            raise _fix_error("instruction은 비어 있지 않은 문자열이어야 합니다.")
        if value.get("version") == 2 and set(value) == {"version", "frames", "instruction"}:
            frames = value.get("frames")
            if not isinstance(frames, list) or not frames:
                raise _fix_error("frames는 비어 있지 않은 배열이어야 합니다.")
            parsed: set[tuple[int, str]] = set()
            for item in frames:
                if not isinstance(item, dict) or type(item.get("cut")) is not int or item.get("which") not in ("start", "end"):
                    raise _fix_error('frames 항목은 {"cut": 번호, "which": "start"|"end"} 여야 합니다.')
                if item["cut"] not in known_cuts:
                    raise _fix_error("frames에는 현재 컷표에 있는 번호만 넣으세요.")
                parsed.add((item["cut"], item["which"]))
            return False, sorted(parsed), instruction.strip()
        if set(value) != {"version", "cuts", "instruction"}:
            raise _fix_error("version, cuts(또는 v2의 frames), instruction 세 필드만 필요합니다.")
        cuts = value.get("cuts")
        if type(value.get("version")) is not int or value.get("version") != 1 or not isinstance(cuts, list):
            raise _fix_error("version은 1, cuts는 배열이어야 합니다.")
        if any(type(n) is not int or n <= 0 for n in cuts) or len(set(cuts)) != len(cuts):
            raise _fix_error("cuts에는 중복 없는 양의 정수만 넣으세요.")
        if not cuts or any(n not in known_cuts for n in cuts):
            raise _fix_error("cuts에는 현재 컷표에 있는 번호만 넣으세요.")
        return False, both(sorted(cuts)), instruction.strip()
    if re.fullmatch(r"\d+(?:\s*,\s*\d+)*", stripped):
        cuts = [int(n.strip()) for n in stripped.split(",")]
        if len(set(cuts)) != len(cuts) or any(n not in known_cuts for n in cuts):
            raise _fix_error("번호 목록에 중복 또는 알 수 없는 컷이 있습니다.")
        return False, both(cuts), ""
    # 1080/9:16 같은 숫자를 컷 번호로 오인하지 않도록 지시는 번호가 있는 첫 줄에서만 받는다.
    first, *rest = stripped.splitlines()
    m = re.fullmatch(r"\s*(\d+)\s*번\s*컷\s*[:：\-–—]?\s*(.+?)\s*", first)
    if m and not rest:
        n = int(m.group(1))
        if n in known_cuts:
            return False, both([n]), m.group(2)
    raise _fix_error("대상을 판별할 수 없습니다.")


def _manifest_path(ep: Episode) -> Path:
    return ep.clips_dir / "재생성백업" / "진행중.json"


def _revision_hash(note: str) -> str:
    return hashlib.sha256(note.strip().encode("utf-8")).hexdigest()


def _save_manifest(path: Path, manifest: dict) -> None:
    """Replace a small state file atomically so an interrupted archive remains resumable."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _finish_archive(ep: Episode, manifest_path: Path, manifest: dict) -> None:
    backup = Path(manifest["backup"])
    backup.mkdir(parents=True, exist_ok=True)
    statuses = manifest.setdefault("archive_status", {})
    for name in manifest["names"]:
        if statuses.get(name) in ("archived", "missing"):
            continue
        src, dst = ep.clips_dir / name, backup / name
        if dst.exists():
            statuses[name] = "archived"
        elif src.exists():
            src.replace(dst)
            statuses[name] = "archived"
        else:
            statuses[name] = "missing"
        _save_manifest(manifest_path, manifest)
    manifest["phase"] = "archived"
    _save_manifest(manifest_path, manifest)


def _apply_fix(ep: Episode, plan, provider: str) -> tuple[bool, list[tuple[int, str]], str]:
    """Archive original targets exactly once and leave the request pending until regenerated."""
    note = ep.clips_fix.read_text(encoding="utf-8").strip()
    replace_sheet, frames, instruction = _parse_fix(note, {c.n for c in plan.cuts})
    frames = expand_frames(plan, frames)
    if provider != "codex":
        raise StepFailed("provider=manual에서는 수정 대상을 안전하게 재생성할 수 없습니다. provider를 codex로 바꾸거나 새 파일을 직접 넣은 뒤 수정 요청 파일을 지우세요.")
    request_hash = _revision_hash(note)
    manifest_path = _manifest_path(ep)
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("request_hash") != request_hash:
            raise StepFailed("이전 이미지 수정 요청이 아직 완료되지 않았습니다. 같은 요청을 재시도하거나 현재 요청 파일을 되돌리세요.")
        _finish_archive(ep, manifest_path, manifest)
        ep.clips_ok.unlink(missing_ok=True)
        return bool(manifest["replace_sheet"]), [tuple(f) for f in manifest.get("frames", [])], str(manifest.get("instruction", ""))

    backup = ep.clips_dir / "재생성백업" / f"{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:8]}"
    names = ([SHEET] if replace_sheet else []) + [frame_name(plan, n, w) for n, w in frames]
    manifest = {
        "version": 1, "request_hash": request_hash, "replace_sheet": replace_sheet,
        "frames": [list(f) for f in frames], "instruction": instruction, "backup": str(backup), "names": names,
        "archive_status": {}, "phase": "archiving",
    }
    # 이동 전에 목록을 저장해 중단 후 재실행해도 이미 재생성한 파일을 다시 보관하지 않는다.
    _save_manifest(manifest_path, manifest)
    _finish_archive(ep, manifest_path, manifest)
    ep.clips_ok.unlink(missing_ok=True)
    print("  이미지 수정으로 승인 해제됨. 기존 영상·최종본은 지우지 않았습니다; 새 이미지를 쓰려면 이후 단계를 다시 빌드하세요.")
    return replace_sheet, frames, instruction


def run(ep: Episode) -> None:
    plan = planfile_a.load(ep.plan_md)
    cfg = _config()
    provider = cfg.get("provider", "manual")
    hint = cfg.get("image_model_hint", "gpt-image")
    ep.clips_dir.mkdir(parents=True, exist_ok=True)
    sheet = ep.clips_dir / SHEET
    revision_sheet = False
    revision_frames: list[tuple[int, str]] = []
    revision_instruction = ""

    if ep.clips_fix.exists():
        note = ep.clips_fix.read_text(encoding="utf-8").strip()
        print(f"  수정 요청: {note[:200]}")
        revision_sheet, revision_frames, revision_instruction = _apply_fix(ep, plan, provider)

    if not sheet.exists():
        if provider == "codex":
            print("  캐릭터 시트 생성 중 (codex)...")
            codex.run(_sheet_prompt(plan, sheet, hint, revision_instruction if revision_sheet else ""), ep.clips_dir, [], cfg)
        if not sheet.exists():
            raise StepFailed(
                f"캐릭터 시트가 없습니다: {sheet}\n"
                "  codex가 이미지를 만들지 못했거나 provider가 manual입니다. Codex/힉스필드 등에서 만들어 이 이름으로 넣고 다시 실행하세요."
            )
    else:
        print(f"  시트 있음 → {sheet.name} (다시 만들려면 파일을 지우세요)")

    set_sheet = ep.clips_dir / SET_SHEET
    if getattr(plan, "sets", None) and not set_sheet.exists():
        if provider == "codex":
            print("  세트 시트 생성 중 (codex)...")
            codex.run(_set_sheet_prompt(plan, set_sheet, hint), ep.clips_dir, [], cfg)
        if not set_sheet.exists():
            raise StepFailed(f"세트 시트가 없습니다: {set_sheet}\n  '## 세트' 절이 있는 기획안은 배경 기준이 필요합니다. 만들어 이 이름으로 넣고 다시 실행하세요.")

    target_numbers = {n for n, _ in revision_frames}
    # 수정 요청 중에는 선택한 프레임의 컷만 재생성해 다른 누락 컷에 비용을 쓰지 않는다.
    targets = (
        [c for c in plan.cuts if c.n in target_numbers]
        if ep.clips_fix.exists()
        else [c for c in plan.cuts if c.required or not cfg.get("keyframes_optional", False)]
    )
    instruction_for = (lambda n: revision_instruction if n in target_numbers else "")
    if provider == "codex":
        extra = _extra_sheets(ep)
        for job in _frame_jobs(ep, plan, targets, sheet, extra, hint, instruction_for):
            missing = [r.name for r in job.refs if not r.exists()]
            if missing:
                print(f"  ! 컷 {job.cut.n:02d} {job.kind} 참조 없음 — 건너뜀: {missing}")
                continue
            # codex가 이미지는 만들고도 샌드박스 저장에 간헐적으로 실패한다(실측 4회 중 2회). 한 번 더 시도한다.
            for attempt in (1, 2):
                print(f"  {job.out.name} 생성 중 (codex, {attempt}/2)... {(job.cut.end_action if job.kind == 'end' else job.cut.action)[:40]}")
                codex.run(job.prompt, ep.clips_dir, job.refs, cfg)
                if job.out.exists():
                    break
            if not job.out.exists():
                print(f"  ! {job.out.name} 없음 — 수동으로 넣을 수 있습니다")

    report = run_check(ep, plan)
    print(f"  검사: 시트 {'OK' if report['sheet'] else '없음'} · 파일 {len(report['files'])}개 · 필수 누락 {report['missing_required']} · 문제 {report['problems']}")
    # 선택한 이미지가 검사에 통과해야 요청을 지워 실패한 재시도에서도 보관 목록을 유지한다.
    if ep.clips_fix.exists():
        expected = ([sheet] if revision_sheet else []) + [ep.clips_dir / frame_name(plan, n, w) for n, w in revision_frames]
        missing_selected = [path.name for path in expected if not path.exists()]
        if missing_selected:
            raise StepFailed(f"선택한 재생성 이미지가 없습니다: {missing_selected}. 수정 요청은 유지했습니다.")
        by_name = {item.get("name"): item for item in report["files"]}
        invalid = [path.name for path in expected if not (
            by_name.get(path.name, {}).get("ratio_ok")
            and by_name.get(path.name, {}).get("size_ok")
            and not by_name.get(path.name, {}).get("error")
        )]
        if invalid:
            raise StepFailed(
                f"재생성한 이미지가 검사에 실패했습니다: {invalid}. 수정 요청은 유지했습니다. "
                "해당 파일을 고친 뒤 다시 실행하거나, 파일을 지운 뒤 같은 요청으로 재생성하세요."
            )
        ep.clips_fix.unlink()
        _manifest_path(ep).unlink(missing_ok=True)
        print("  수정 요청의 선택된 이미지 생성 및 검사 완료")

    if report["missing_required"]:
        raise StepFailed(f"필수 컷 키프레임이 없습니다: {report['missing_required']}. 만들어 넣고 다시 실행하세요.")

    if not ep.clips_ok.exists():
        raise GateBlocked(
            f"이미지 승인이 없습니다.\n  컨택트시트를 보세요: {ep.contact_sheet}\n"
            f"  괜찮으면 빈 파일을 만드세요:  {ep.clips_ok}\n  다시 만들 컷 번호(또는 '시트')를 적으세요:  {ep.clips_fix}"
        )
    print("  이미지 승인 확인됨")
