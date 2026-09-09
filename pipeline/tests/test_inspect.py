from __future__ import annotations

import tempfile
from pathlib import Path

from shortform import inspect as inspector

VALID_PLAN_MD = """# 제목 후보

1. 테스트 제목

## 훅

테스트 훅입니다.

## 대본

| # | 문장 | 소재 | 검색어 |
|---|---|---|---|
| 1 | 테스트 문장입니다. | stock | 테스트 검색어 |

## AI 댓글

| 시각 | 닉네임 | 내용 |
|---|---|---|
| 2 | 테스터 | 좋아요 |

## 메타데이터

- 설명: 테스트용 기획안입니다.
- 태그: 테스트
- 공개: unlisted
"""


def _make_episode(root: Path, track: str, date: str, num: str, slug: str, plan_md: str, approve: bool = True) -> Path:
    ep_dir = root / date / f"{track}-{num}-{slug}"
    ep_dir.mkdir(parents=True)
    (ep_dir / "01-기획안.md").write_text(plan_md, encoding="utf-8")
    if approve:
        (ep_dir / "01-기획-승인.txt").write_text("", encoding="utf-8")
    return ep_dir


def test_run_list_finds_b_track_episode_and_gates():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _make_episode(root, "B", "2026-01-01", "01", "테스트", VALID_PLAN_MD)

        result = inspector.run_list(root=root)

        assert result["root"] == root.resolve().as_posix()
        assert len(result["episodes"]) == 1
        ep = result["episodes"][0]
        assert ep["track"] == "B"
        assert ep["date"] == "2026-01-01"
        assert ep["num"] == "01"
        assert ep["slug"] == "테스트"
        assert ep["gates"]["plan_ok"] is True
        assert ep["title"] == "테스트 제목"
        assert ep["files"]["final_mp4"] is None


def test_run_episode_detail_matches_summary():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _make_episode(root, "B", "2026-01-01", "01", "테스트", VALID_PLAN_MD)

        detail = inspector.run_episode("B", "2026-01-01", "01", root=root)

        assert detail["plan"] is not None
        assert detail["plan_error"] is None
        assert detail["plan"]["title"] == "테스트 제목"
        assert detail["plan_md"] is not None
        assert detail["episode"]["gates"]["plan_ok"] is True


def test_a_track_plan_parse_failure_returns_error_not_exception():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        # A트랙 포맷 파서가 없어서 B트랙 파서로는 실패해야 정상 (플랜 없이도 죽지 않아야 한다)
        _make_episode(root, "A", "2026-01-01", "01", "A트랙테스트", "# 다른 형식\n\n그냥 텍스트.\n")

        result = inspector.run_list(root=root)
        ep = result["episodes"][0]
        assert ep["title"] == "A-01-A트랙테스트"  # 파싱 실패 시 디렉터리명 폴백
        assert ep["template_id"] is None

        detail = inspector.run_episode("A", "2026-01-01", "01", root=root)
        assert detail["plan"] is None
        assert isinstance(detail["plan_error"], str)
        assert detail["plan_md"] is not None
