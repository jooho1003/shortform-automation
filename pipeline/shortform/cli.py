"""파이프라인 CLI.

    cd pipeline
    python -m shortform new    --track B --date 2026-09-08 --episode 01 --slug 제목
    python -m shortform run    --track B --date 2026-09-08 --episode 01
    python -m shortform status --track B --date 2026-09-08 --episode 01
    python -m shortform discover
"""

from __future__ import annotations

import argparse
import sys

from . import GateBlocked, MissingKey, StepFailed
from . import state
from .paths import Episode
from .steps import assets, clips, discover, plan, render, research, segments, upload

PIPELINE_STEPS = [
    ("plan", plan),
    ("clips", clips),
    ("assets", assets),
    ("render", render),
    ("upload", upload),
]


def _episode(args) -> Episode:
    return Episode.find(args.date, args.track, args.episode)


def cmd_new(args) -> int:
    ep = Episode.create(args.date, args.track, args.episode, args.slug)
    print(f"편 폴더 생성: {ep.dir}")
    return 0


def cmd_run(args) -> int:
    ep = _episode(args)
    only = set(args.only.split(",")) if args.only else None
    for name, module in PIPELINE_STEPS:
        if only and name not in only:
            continue
        if state.is_done(ep, name) and not args.force:
            print(f"  건너뜀  {name}  (상태.json에 완료로 기록됨)")
            continue
        print(f"▶ {name}")
        module.run(ep)
        state.mark_done(ep, name)
    print("\n모든 단계 완료.")
    return 0


def cmd_status(args) -> int:
    ep = _episode(args)
    st = state.load(ep)
    print(f"편: {ep.dir.name}")
    for name, _ in PIPELINE_STEPS:
        done = st["steps"].get(name, {})
        mark = "완료" if done.get("done") else "대기"
        print(f"  {name:8s} {mark} {done.get('at', '')}")
    for gate, path in [
        ("기획 승인", ep.plan_ok),
        ("이미지 승인", ep.clips_ok),
        ("업로드 승인", ep.upload_ok),
    ]:
        print(f"  [{'v' if path.exists() else ' '}] {gate}  {path.name}")
    if st["errors"]:
        print("\n오류:")
        for e in st["errors"][-5:]:
            print(f"  {e['at']} {e['step']}: {e['message']}")
    return 0


def cmd_discover(args) -> int:
    discover.run_standalone()
    return 0


def cmd_research(args) -> int:
    research.run_standalone()
    return 0


def cmd_segments(args) -> int:
    segments.run_standalone(args.source, args.date)
    return 0


def main(argv=None) -> int:
    # 한국어 Windows 콘솔은 cp949라 경로와 기호가 깨진다.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(prog="shortform", description="숏폼 자동화 파이프라인")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_episode_args(p):
        p.add_argument("--track", default="B", choices=["A", "B"])
        p.add_argument("--date", required=True)
        p.add_argument("--episode", required=True)

    p_new = sub.add_parser("new", help="편 폴더를 만든다")
    add_episode_args(p_new)
    p_new.add_argument("--slug", required=True)
    p_new.set_defaults(func=cmd_new)

    p_run = sub.add_parser("run", help="편을 단계 순서대로 실행한다")
    add_episode_args(p_run)
    p_run.add_argument("--force", action="store_true", help="완료된 단계도 다시 실행")
    p_run.add_argument("--only", help="쉼표로 구분한 단계만 실행 (plan,clips,assets,render,upload)")
    p_run.set_defaults(func=cmd_run)

    p_status = sub.add_parser("status", help="편의 진행 상태를 본다")
    add_episode_args(p_status)
    p_status.set_defaults(func=cmd_status)

    p_disc = sub.add_parser("discover", help="레퍼런스를 발굴해 references.jsonl에 쌓는다")
    p_disc.set_defaults(func=cmd_discover)

    p_res = sub.add_parser("research", help="주간 조사. 기획 전에 반드시 돌린다")
    p_res.set_defaults(func=cmd_research)

    p_seg = sub.add_parser("segments", help="롱폼 1편에서 숏폼 구간 후보를 뽑는다")
    p_seg.add_argument("--source", required=True, help="유튜브 URL 또는 영상 ID")
    p_seg.add_argument("--date", required=True, help="컨택트시트를 둘 날짜 폴더")
    p_seg.set_defaults(func=cmd_segments)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except GateBlocked as e:
        print(f"\n■ 여기서 멈춥니다.\n{e}")
        return 2
    except MissingKey as e:
        print(f"\n■ API 키가 없습니다.\n{e}")
        return 3
    except (StepFailed, FileNotFoundError) as e:
        print(f"\n■ 실패: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
