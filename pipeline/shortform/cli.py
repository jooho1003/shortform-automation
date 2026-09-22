"""파이프라인 CLI.

    cd pipeline
    python -m shortform new    --track B --date 2026-09-08 --episode 01 --slug 제목
    python -m shortform run    --track B --date 2026-09-08 --episode 01
    python -m shortform status --track B --date 2026-09-08 --episode 01
    python -m shortform discover
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import GateBlocked, MissingKey, StepFailed
from . import inspect as inspector
from . import state
from .paths import Episode, load_dotenv

# `shortform.steps.*`는 PIL/yt-dlp/edge-tts 같은 무거운 의존성을 끌고 온다.
# `inspect` 서브커맨드는 이런 패키지가 없어도 동작해야 하므로, 실제로
# 파이프라인 단계를 실행하는 커맨드에서만 지연 임포트한다.
STEP_NAMES = ["plan", "clips", "assets", "render", "upload"]
STEP_NAMES_A = ["plan", "images", "video", "render", "upload"]


def step_names(track: str) -> list[str]:
    return STEP_NAMES_A if track == "A" else STEP_NAMES


def _pipeline_steps(track: str = "B"):
    if track == "A":
        from .steps import images_a, plan_a, render, upload, video_a

        return [
            ("plan", plan_a),
            ("images", images_a),
            ("video", video_a),
            ("render", render),
            ("upload", upload),
        ]
    from .steps import assets, clips, plan, render, upload

    return [
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
    for name, module in _pipeline_steps(ep.track):
        if only and name not in only:
            continue
        if state.is_done(ep, name) and not args.force:
            print(f"  건너뜀  {name}  (상태.json에 완료로 기록됨)")
            continue
        print(f"▶ {name}")
        from .tts.episode import is_stale, regenerate
        if name in ("assets", "video") and (ep.assets_dir / "타임라인.json").exists() and is_stale(ep):
            regenerate(ep)
        else:
            module.run(ep)
        state.mark_done(ep, name)
    print("\n모든 단계 완료.")
    return 0


def cmd_status(args) -> int:
    ep = _episode(args)
    st = state.load(ep)
    print(f"편: {ep.dir.name}")
    for name in step_names(ep.track):
        done = st["steps"].get(name, {})
        mark = "완료" if state.is_done(ep, name) else "대기"
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
    from .steps import discover

    discover.run_standalone()
    return 0


def cmd_research(args) -> int:
    from .steps import research

    research.run_standalone()
    return 0


def cmd_segments(args) -> int:
    from .steps import segments

    segments.run_standalone(args.source, args.date)
    return 0


def _print_json(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def cmd_reels(args) -> int:
    from . import reels  # yt-dlp가 필요해 지연 import

    return reels.main(args)


def cmd_inspect_list(args) -> int:
    _print_json(inspector.run_list())
    return 0


def cmd_inspect_episode(args) -> int:
    _print_json(inspector.run_episode(args.track, args.date, args.episode))
    return 0


def cmd_inspect_research(args) -> int:
    _print_json(inspector.run_research())
    return 0


def cmd_inspect_config(args) -> int:
    _print_json(inspector.run_config())
    return 0


def cmd_inspect_blog_keywords(args) -> int:
    _print_json(inspector.run_blog_keywords(args.week))
    return 0


def cmd_detail_video(args) -> int:
    from .steps import detail_video

    report = detail_video.run(args.project)
    if args.json:
        _print_json(report)
    return 0 if report["ok"] else 1


def cmd_detail_check(args) -> int:
    from .steps import detail_video
    from .steps.check_detail_media import check_media

    base = detail_video.project_dir(args.project)
    project = detail_video.load_project(args.project)
    expected = [Path(s["video"]["file"]).name for s in project.get("sections", []) if isinstance(s.get("video"), dict)]
    report = check_media(base / detail_video.MEDIA_DIR, expected)
    _print_json(report)
    return 0 if report["ok"] else 1


def main(argv=None) -> int:
    # 한국어 Windows 콘솔은 cp949라 경로와 기호가 깨진다.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    # 셸 환경변수가 우선. 웹에서 돌릴 때는 자식 환경에 이미 들어와 있다.
    load_dotenv()

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

    p_reels = sub.add_parser("reels", help="릴스 기획 — 레퍼런스 메타·다운로드·대본 (웹 콘솔용)")
    reels_sub = p_reels.add_subparsers(dest="reels_cmd", required=True)
    p_rm = reels_sub.add_parser("meta", help="URL 메타를 JSON으로")
    p_rm.add_argument("--url", required=True)
    p_rf = reels_sub.add_parser("fetch", help="원본 영상·자막 내려받기")
    p_rf.add_argument("--url", required=True)
    p_rf.add_argument("--dir", required=True, help="저장소 상대 프로젝트 폴더 (릴스기획/<id>)")
    p_rt = reels_sub.add_parser("transcribe", help="자막 또는 whisper로 타임스탬프 대본")
    p_rt.add_argument("--dir", required=True)
    for p in (p_rm, p_rf, p_rt):
        p.set_defaults(func=cmd_reels)

    p_detail = sub.add_parser("detail-video", help="상세페이지 섹션 영상 — 시드/제품시트 → fal i2v")
    detail_sub = p_detail.add_subparsers(dest="detail_command", required=True)

    p_detail_gen = detail_sub.add_parser("generate", help="영상이 없는 섹션을 생성한다")
    p_detail_gen.add_argument("--project", required=True, help="상세페이지 프로젝트 ID")
    p_detail_gen.add_argument("--json", action="store_true", help="검사 결과를 JSON으로 출력")
    p_detail_gen.set_defaults(func=cmd_detail_video)

    p_detail_check = detail_sub.add_parser("check", help="생성 없이 미디어 규격만 검사한다")
    p_detail_check.add_argument("--project", required=True, help="상세페이지 프로젝트 ID")
    p_detail_check.set_defaults(func=cmd_detail_check)

    p_inspect = sub.add_parser("inspect", help="웹 콘솔용 읽기 전용 JSON 브릿지")
    inspect_sub = p_inspect.add_subparsers(dest="inspect_command", required=True)

    p_inspect_list = inspect_sub.add_parser("list", help="모든 편의 요약 목록")
    p_inspect_list.set_defaults(func=cmd_inspect_list)

    p_inspect_episode = inspect_sub.add_parser("episode", help="편 하나의 상세 정보")
    add_episode_args(p_inspect_episode)
    p_inspect_episode.set_defaults(func=cmd_inspect_episode)

    p_inspect_research = inspect_sub.add_parser("research", help="최신 주간 조사 결과")
    p_inspect_research.set_defaults(func=cmd_inspect_research)

    p_inspect_config = inspect_sub.add_parser("config", help="템플릿·음성·채널 설정")
    p_inspect_config.set_defaults(func=cmd_inspect_config)

    p_inspect_blog = inspect_sub.add_parser("blog-keywords", help="블로그 키워드 보드")
    p_inspect_blog.add_argument("--week")
    p_inspect_blog.set_defaults(func=cmd_inspect_blog_keywords)

    from .blog.cli import add_parser as add_blog_parser
    add_blog_parser(sub)

    from . import publishing
    publishing.add_parser(sub)
    from .tts.episode import add_parser as add_tts_parser
    add_tts_parser(sub)

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
