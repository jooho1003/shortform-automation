from __future__ import annotations

from . import images, keywords, publish, rank, serp


def add_parser(subparsers) -> None:
    root = subparsers.add_parser("blog", help="네이버 블로그 기획·검색·게시 준비")
    sub = root.add_subparsers(dest="blog_command", required=True)

    p = sub.add_parser("keywords", help="주간 키워드 보드 생성")
    p.add_argument("--week")
    p.add_argument("--seed", action="append", help="설정 대신 사용할 시드 키워드(여러 번 가능)")
    p.set_defaults(func=keywords.run)

    p = sub.add_parser("serp", help="상위 블로그 검색 결과 저장")
    p.add_argument("--keyword", required=True)
    p.add_argument("--project")
    p.set_defaults(func=serp.run)

    p = sub.add_parser("rank", help="게시된 글의 키워드 순위 추적")
    p.set_defaults(func=rank.run)

    p = sub.add_parser("images", help="대표·본문 이미지 생성")
    p.add_argument("--id", required=True)
    p.set_defaults(func=images.run)

    publish.add_parsers(sub)
