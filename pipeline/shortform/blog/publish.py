from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import yaml

from .. import StepFailed
from ..paths import CONFIG, DATA, ROOT
from .naver_editor import EditorError, EditorPreflightError, login as editor_login, save_draft


def _json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return default


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _project(project_id: str) -> tuple[Path, dict, dict]:
    directory = ROOT / "블로그" / project_id
    if directory.name != project_id or directory.parent != ROOT / "블로그" or not directory.is_dir():
        raise StepFailed("블로그 프로젝트가 없습니다.")
    project = _json(directory / "프로젝트.json")
    if not isinstance(project, dict):
        raise StepFailed("프로젝트.json을 읽을 수 없습니다.")
    cfg = yaml.safe_load((CONFIG / "blog.yaml").read_text(encoding="utf-8")) if (CONFIG / "blog.yaml").exists() else {}
    return directory, project, cfg


def _snapshot(directory: Path) -> dict:
    body = directory / "본문.md"
    if not body.is_file():
        raise StepFailed("본문.md가 없습니다.")
    images = _json(directory / "이미지" / "이미지.json", [])
    rows = []
    for item in images if isinstance(images, list) else []:
        if not isinstance(item, dict):
            continue
        rel = str(item.get("file", ""))
        target = directory / rel
        if not target.is_file() or target.resolve().parent not in {directory.resolve(), (directory / "이미지").resolve()}:
            rows.append({"file": rel, "sha256": "missing"})
        else:
            rows.append({"file": rel, "sha256": _sha(target)})
    return {"body_sha256": _sha(body), "images": rows}


def validate_ready(directory: Path) -> dict:
    lint = _json(directory / "점검.json", {})
    if not isinstance(lint, dict) or lint.get("errors"):
        raise StepFailed("점검 오류가 남아 있어 게시 준비를 진행할 수 없습니다.")
    approved = _json(directory / "02-원고-승인.txt")
    if not isinstance(approved, dict) or approved != _snapshot(directory):
        raise StepFailed("원고 승인 이후 본문 또는 이미지가 바뀌었습니다. 다시 승인하세요.")
    if "[확인필요]" in (directory / "본문.md").read_text(encoding="utf-8"):
        raise StepFailed("[확인필요]가 남은 글은 게시할 수 없습니다.")
    return approved


def _db() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATA / "publishing.sqlite3")
    connection.execute(
        "CREATE TABLE IF NOT EXISTS blog_publishing (body_sha256 TEXT NOT NULL, blog_id TEXT NOT NULL, project_id TEXT NOT NULL, state TEXT NOT NULL, post_url TEXT, updated_at TEXT NOT NULL, error TEXT, UNIQUE(body_sha256, blog_id))"
    )
    connection.commit()
    return connection


def _limits(connection: sqlite3.Connection, cfg: dict, blog_id: str) -> None:
    maximum = min(3, max(1, int(cfg.get("max_posts_per_day", 1))))
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    states = "('sending','unknown','drafted','published')"
    count = connection.execute(f"SELECT COUNT(*) FROM blog_publishing WHERE blog_id=? AND state IN {states} AND updated_at>=?", (blog_id, since)).fetchone()[0]
    if count >= maximum:
        raise StepFailed(f"최근 24시간 임시저장 상한({maximum}건)에 도달했습니다.")
    hours = max(0, int(cfg.get("min_hours_between_posts", 12)))
    row = connection.execute(f"SELECT updated_at FROM blog_publishing WHERE blog_id=? AND state IN {states} ORDER BY updated_at DESC LIMIT 1", (blog_id,)).fetchone()
    if row:
        previous = datetime.fromisoformat(row[0])
        if datetime.now(timezone.utc) - previous < timedelta(hours=hours):
            raise StepFailed(f"임시저장 사이에 최소 {hours}시간을 두어야 합니다.")


def _result(directory: Path, mode: str, state: str, error: str | None = None, post_url: str | None = None) -> None:
    payload = {"mode": mode, "state": state, "post_url": post_url, "at": datetime.now(timezone.utc).isoformat(), "error": error}
    (directory / "게시결과.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_publish(args) -> int:
    directory, project, cfg = _project(args.id)
    snapshot = validate_ready(directory)
    mode = args.mode or project.get("publish", {}).get("mode", "copy")
    if mode == "copy":
        package = directory / "게시패키지"
        if not (package / "본문.html").is_file():
            raise StepFailed("복사 패키지가 없습니다. 웹 콘솔에서 ‘복사 패키지 만들기’를 먼저 실행하세요.")
        _result(directory, "copy", "ready")
        print(f"복사 패키지 준비됨: {package}")
        return 0
    if mode != "draft":
        raise StepFailed("publish 모드는 구현하지 않습니다. copy 또는 draft만 가능합니다.")
    if not cfg.get("draft_enabled", False):
        raise StepFailed("draft 모드가 비활성입니다. 위험을 검토한 뒤 config/blog.yaml의 draft_enabled를 true로 바꾸세요.")
    if not args.execute:
        print("검증 완료. --execute 없이 네이버에 접속하지 않았습니다.")
        return 0
    if not args.confirmed:
        raise StepFailed("draft 실행에는 --confirmed가 필요합니다.")
    blog_id = str(cfg.get("blog_id", "")).strip()
    if not blog_id:
        raise StepFailed("config/blog.yaml의 blog_id가 비었습니다.")
    connection = _db()
    try:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute("SELECT state,error FROM blog_publishing WHERE body_sha256=? AND blog_id=?", (snapshot["body_sha256"], blog_id)).fetchone()
        if existing:
            raise StepFailed(f"같은 승인본의 기존 기록이 있습니다: {existing[0]}. 자동 재시도하지 않습니다.")
        _limits(connection, cfg, blog_id)
        timestamp = datetime.now(timezone.utc).isoformat()
        connection.execute("INSERT INTO blog_publishing VALUES (?,?,?,?,?,?,?)", (snapshot["body_sha256"], blog_id, args.id, "sending", None, timestamp, None))
        connection.commit()
        images_meta = _json(directory / "이미지" / "이미지.json", [])
        images = [directory / item["file"] for item in images_meta if isinstance(item, dict) and item.get("kind") == "body"]
        try:
            result = save_draft(
                blog_id=blog_id,
                title=str(project.get("title", "")),
                body=(directory / "본문.md").read_text(encoding="utf-8"),
                tags=[str(x) for x in project.get("tags", [])],
                images=images,
                log_dir=directory / "로그",
            )
        except EditorPreflightError as exc:
            connection.execute("DELETE FROM blog_publishing WHERE body_sha256=? AND blog_id=?", (snapshot["body_sha256"], blog_id))
            connection.commit()
            _result(directory, "draft", "failed", "에디터 사전 점검 실패")
            raise StepFailed(str(exc)) from exc
        except EditorError as exc:
            connection.execute("UPDATE blog_publishing SET state='unknown',updated_at=?,error=? WHERE body_sha256=? AND blog_id=?", (datetime.now(timezone.utc).isoformat(), "임시저장 결과 수동 확인 필요", snapshot["body_sha256"], blog_id))
            connection.commit()
            _result(directory, "draft", "unknown", "임시저장 결과 수동 확인 필요")
            raise StepFailed(str(exc)) from exc
        connection.execute("UPDATE blog_publishing SET state='drafted',updated_at=?,error=NULL WHERE body_sha256=? AND blog_id=?", (datetime.now(timezone.utc).isoformat(), snapshot["body_sha256"], blog_id))
        connection.commit()
        project["status"] = "drafted"
        project["revision"] = int(project.get("revision", 0)) + 1
        project["updatedAt"] = datetime.now(timezone.utc).isoformat()
        (directory / "프로젝트.json").write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
        _result(directory, "draft", "drafted")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    finally:
        connection.close()


def run_login(_args) -> int:
    editor_login()
    return 0


def run_sync(args) -> int:
    directory, project, cfg = _project(args.id)
    snapshot = _snapshot(directory)
    blog_id = str(cfg.get("blog_id", "")).strip()
    if args.state == "published":
        parsed = urlparse(str(args.post_url or ""))
        if parsed.scheme != "https" or parsed.hostname not in {"blog.naver.com", "m.blog.naver.com"}:
            raise StepFailed("published 동기화에는 네이버 블로그 HTTPS 게시 URL이 필요합니다.")
    connection = _db()
    try:
        row = connection.execute("SELECT state FROM blog_publishing WHERE body_sha256=? AND blog_id=?", (snapshot["body_sha256"], blog_id)).fetchone()
        if not row:
            raise StepFailed("동기화할 게시 기록이 없습니다.")
        connection.execute("UPDATE blog_publishing SET state=?,post_url=?,updated_at=?,error=NULL WHERE body_sha256=? AND blog_id=?", (args.state, args.post_url, datetime.now(timezone.utc).isoformat(), snapshot["body_sha256"], blog_id))
        connection.commit()
        if args.state in {"drafted", "published"}:
            project["status"] = args.state
            project["publish"]["post_url"] = args.post_url
            if args.state == "published":
                project["publish"]["published_at"] = datetime.now(timezone.utc).isoformat()
            project["revision"] = int(project.get("revision", 0)) + 1
            project["updatedAt"] = datetime.now(timezone.utc).isoformat()
            (directory / "프로젝트.json").write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
        _result(directory, "draft", args.state, post_url=args.post_url)
    finally:
        connection.close()
    return 0


def add_parsers(sub) -> None:
    p = sub.add_parser("login", help="전용 Chrome 프로필로 사람이 직접 로그인")
    p.set_defaults(func=run_login)
    p = sub.add_parser("publish", help="copy 패키지 점검 또는 네이버 임시저장")
    p.add_argument("--id", required=True)
    p.add_argument("--mode", choices=["copy", "draft"], default="copy")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--confirmed", action="store_true")
    p.set_defaults(func=run_publish)
    p = sub.add_parser("sync", help="네이버에서 수동 확인한 상태를 반영")
    p.add_argument("--id", required=True)
    p.add_argument("--state", choices=["drafted", "published"], required=True)
    p.add_argument("--post-url")
    p.set_defaults(func=run_sync)
