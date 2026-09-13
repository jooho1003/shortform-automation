"""Local, reviewable Buffer publishing queue.

``channels`` and ``sync`` make read-only provider calls.  A provider mutation is
only possible through the explicit ``send --execute`` command.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from . import StepFailed
from .paths import DATA, ROOT, Episode

PLATFORMS = {"youtube", "instagram", "tiktok"}
PRIVACY = {"private", "unlisted", "public"}
CHANNEL_ID = re.compile(r"^[0-9a-fA-F]{24}$")


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _under_root(value: str) -> Path | None:
    try:
        p = (ROOT / value).resolve()
        p.relative_to(ROOT.resolve())
        return p
    except (OSError, ValueError, TypeError):
        return None


def _load_manifest(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as e:
        raise StepFailed(f"게시목록을 읽을 수 없습니다: {e}") from e
    if not isinstance(data, dict) or data.get("version") != 1 or data.get("provider") != "buffer":
        raise StepFailed("게시목록 형식(version=1, provider=buffer)이 아닙니다.")
    if not isinstance(data.get("items"), list) or not data["items"]:
        raise StepFailed("게시목록 items가 비어 있거나 올바르지 않습니다.")
    return data


def _valid_public_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        u = urlparse(value)
        if u.scheme != "https" or not u.hostname or u.username or u.password:
            return False
        host = u.hostname.lower()
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")) or "." not in host:
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return True
    except ValueError:
        return False


def _item_errors(item: object) -> list[str]:
    if not isinstance(item, dict): return ["항목이 객체가 아닙니다"]
    errors: list[str] = []
    platform = item.get("platform")
    if not isinstance(platform, str): errors.append("platform은 문자열이어야 합니다"); platform = ""
    if platform not in PLATFORMS: errors.append("지원하지 않는 플랫폼")
    file = _under_root(item.get("file", "") if isinstance(item.get("file", ""), str) else "")
    if not file or not file.is_file(): errors.append("영상 파일이 없거나 저장소 밖입니다")
    elif item.get("sha256") != _sha(file): errors.append("영상 SHA-256이 변경되었습니다")
    if not CHANNEL_ID.fullmatch(str(item.get("channel_id", ""))): errors.append("채널 ID가 24자리 hex가 아닙니다")
    if not _valid_public_url(item.get("video_url")): errors.append("공개 HTTPS 동영상 URL이 필요합니다")
    mode = item.get("mode")
    if not isinstance(mode, str): errors.append("mode는 문자열이어야 합니다"); mode = ""
    if mode not in {"draft", "now", "schedule"}: errors.append("mode는 draft/now/schedule 중 하나여야 합니다")
    if mode == "schedule":
        try:
            due = datetime.fromisoformat(str(item.get("due_at", "")).replace("Z", "+00:00"))
            if due.tzinfo is None or due <= datetime.now(timezone.utc): raise ValueError
        except ValueError: errors.append("예약 시간은 미래의 시간대 포함 ISO-8601이어야 합니다")
    if platform == "youtube":
        if not isinstance(item.get("privacy"), str) or item.get("privacy") not in PRIVACY: errors.append("YouTube 공개설정이 필요합니다")
        if not isinstance(item.get("title"), str) or not item["title"].strip(): errors.append("YouTube 제목이 필요합니다")
        elif len(item["title"]) > 100: errors.append("YouTube 제목은 100자 이하여야 합니다")
        if not isinstance(item.get("text"), str): errors.append("설명은 문자열이어야 합니다")
        elif len(item["text"]) > 5000: errors.append("YouTube 설명은 5000자 이하여야 합니다")
    elif not isinstance(item.get("text"), str):
        errors.append("설명은 문자열이어야 합니다")
    elif len(item["text"]) > 2200:
        errors.append("Instagram/TikTok 설명은 2200자 이하여야 합니다")
    return errors


def validate(manifest: dict) -> list[tuple[dict, list[str]]]:
    seen_ids, seen_keys = set(), set()
    results = []
    for item in manifest["items"]:
        errors = _item_errors(item)
        if isinstance(item, dict):
            ident = item.get("id")
            if not isinstance(ident, str) or not ident: errors.append("항목 id가 필요합니다")
            elif ident in seen_ids: errors.append("중복된 항목 id")
            elif ident: seen_ids.add(ident)
            key_fields = (item.get("sha256"), item.get("platform"), item.get("channel_id"))
            if not all(isinstance(x, str) and x for x in key_fields):
                errors.append("sha256/platform/channel_id는 비어 있지 않은 문자열이어야 합니다")
            else:
                if key_fields in seen_keys: errors.append("같은 영상/플랫폼/채널 항목이 중복됩니다")
                seen_keys.add(key_fields)
        results.append((item if isinstance(item, dict) else {}, errors))
    return results


def _atomic_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def _db() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DATA / "publishing.sqlite3")
    con.execute("CREATE TABLE IF NOT EXISTS publishing (sha256 TEXT NOT NULL, platform TEXT NOT NULL, channel_id TEXT NOT NULL, item_id TEXT NOT NULL, state TEXT NOT NULL, post_id TEXT, updated_at TEXT NOT NULL, error TEXT, url TEXT, UNIQUE(sha256, platform, channel_id))")
    columns = {r[1] for r in con.execute("PRAGMA table_info(publishing)")}
    if "url" not in columns:
        con.execute("ALTER TABLE publishing ADD COLUMN url TEXT")
        con.commit()
    return con


def _records(con: sqlite3.Connection, items: list[dict]) -> list[dict]:
    out = []
    for item in items:
        row = con.execute("SELECT item_id,state,post_id,updated_at,error,url FROM publishing WHERE sha256=? AND platform=? AND channel_id=?", (item.get("sha256"), item.get("platform"), item.get("channel_id"))).fetchone()
        out.append({"id": item.get("id"), "state": row[1] if row else "pending", "post_id": row[2] if row else None, "updated_at": row[3] if row else None, "error": row[4] if row else None, "url": row[5] if row else None})
    return out


def _export(path: Path, con: sqlite3.Connection, items: list[dict]) -> Path:
    out = path.with_name(path.stem + "-결과.json")
    _atomic_json(out, {"version": 1, "provider": "buffer", "items": _records(con, items)})
    return out


def _source_url(ep: Episode) -> str:
    # Timeline credits describe the material actually used, so prefer them over
    # planning references.  Older episodes may not have a timeline yet.
    timeline_urls: list[str] = []
    for path in ep.dir.rglob("*.json"):
        if "timeline" not in path.name.lower():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            continue
        def walk(value):
            if isinstance(value, dict):
                credits = value.get("credits")
                if isinstance(credits, dict) and isinstance(credits.get("page"), str):
                    timeline_urls.append(credits["page"])
                for child in value.values(): walk(child)
            elif isinstance(value, list):
                for child in value: walk(child)
        walk(data)
    if timeline_urls:
        return next(iter(dict.fromkeys(timeline_urls)))
    candidates = [ep.plan_md, ep.clip_list]
    urls: list[str] = []
    for path in candidates:
        if path.exists(): urls += re.findall(r"https?://[^\s)\]\"']+", path.read_text(encoding="utf-8", errors="replace"))
    return next(iter(dict.fromkeys(urls)), "")


def _duration(path: Path) -> None:
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)], capture_output=True, text=True, check=True, timeout=30)
        if float(r.stdout.strip()) <= 0: raise ValueError
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        raise StepFailed(f"ffprobe로 영상 길이를 확인할 수 없습니다: {path.name}") from e


def prepare(args) -> int:
    target = Path(args.manifest) if args.manifest else ROOT / args.date / "게시목록.json"
    if target.exists(): raise StepFailed(f"기존 게시목록을 덮어쓰지 않습니다: {target}")
    loader = __import__("shortform.planfile_a" if args.track == "A" else "shortform.planfile", fromlist=["load"]).load
    items = []
    for num in [x.strip() for x in args.episodes.split(",") if x.strip()]:
        ep = Episode.find(args.date, args.track, num); _duration(ep.final_mp4)
        plan = loader(ep.plan_md); source = _source_url(ep)
        tags = " ".join("#" + t.strip().replace(" ", "") for t in str(plan.meta.get("태그", "")).split(",") if t.strip())
        if not tags and ("요정재형" in ep.dir.name or plan.meta.get("채널") == "요정재형"):
            tags = "#요정재형 #요정식탁"
        text = str(plan.meta.get("설명", "")).strip()
        if source and source not in text: text = (text + "\n출처: " + source).strip()
        if tags: text = (text + "\n" + tags).strip()
        file = ep.final_mp4.resolve()
        digest = _sha(file)
        common = {"episode": str(ep.dir.resolve().relative_to(ROOT.resolve())).replace("\\", "/"), "file": str(file.relative_to(ROOT.resolve())).replace("\\", "/"), "sha256": digest, "media_name": f"{digest}.mp4", "title": plan.title, "text": text, "channel_id": "", "video_url": "", "mode": "pending", "due_at": None, "privacy": plan.meta.get("공개", "unlisted")}
        for platform in ("youtube", "instagram", "tiktok"):
            items.append({"id": f"{args.date}-{args.track}-{num}-{platform}", "platform": platform, **common})
    _atomic_json(target, {"version": 1, "provider": "buffer", "items": items})
    print(f"게시목록 생성: {target} ({len(items)}건)")
    return 0


def check(args) -> int:
    manifest = _load_manifest(Path(args.manifest)); results = validate(manifest)
    blocked = 0
    for item, errors in results:
        if errors: blocked += 1; print(f"BLOCKED {item.get('id', '?')}: {'; '.join(errors)}")
        else: print(f"READY {item['id']}")
    print(f"ready={len(results)-blocked} blocked={blocked}")
    return 2 if blocked else 0


def _client():
    from .buffer_api import BufferClient
    return BufferClient()


def channels(args) -> int:
    for row in _client().channels():
        print(json.dumps({k: row.get(k) for k in ("id", "name", "service", "isDisconnected", "isLocked", "isQueuePaused")}, ensure_ascii=False))
    return 0


def _validate_channels(client, items: list[dict]) -> list[str]:
    by_id = {str(x.get("id")): x for x in client.channels()}; errors = []
    for i in items:
        c = by_id.get(i["channel_id"])
        if not c or str(c.get("service", "")).lower() != i["platform"]: errors.append(f"{i['id']}: 채널 플랫폼 불일치")
        elif c.get("isDisconnected") or c.get("isLocked") or (i["mode"] == "schedule" and c.get("isQueuePaused")): errors.append(f"{i['id']}: 채널이 게시 가능한 상태가 아닙니다")
    return errors


def send(args) -> int:
    path = Path(args.manifest); manifest = _load_manifest(path); results = validate(manifest)
    errors = [f"{i.get('id', '?')}: {'; '.join(e)}" for i, e in results if e]
    if errors:
        print("\n".join(errors)); return 2
    items = manifest["items"]
    if not args.execute:
        print("검증 완료. --execute 없이 외부 게시 요청은 하지 않았습니다."); return 0
    # Constructing the client validates local credentials before creating a DB.
    client = _client()
    con = _db()
    existing = _records(con, items)
    uncertain = [r for r in existing if r["state"] in {"sending", "unknown"} and not r["post_id"]]
    if uncertain:
        for row in uncertain:
            print(f"{row['id']}: 이전 게시 응답이 불확실합니다. Buffer 대시보드에서 수동 확인 필요")
        _export(path, con, items)
        con.close()
        return 1
    errors = _validate_channels(client, items)
    if errors:
        con.close(); print("\n".join(errors)); return 2
    # The URL is user-supplied, so verify every unique remote media object before
    # reserving a delivery row.  This is deliberately before any create_post call.
    try:
        seen_media = set()
        for item in items:
            key = (item["video_url"], item["sha256"])
            if key not in seen_media:
                client.verify_media(item)
                seen_media.add(key)
    except Exception:
        con.close()
        print("원격 영상 확인에 실패했습니다. 게시 요청은 하지 않았습니다.")
        return 2
    unknown = False
    try:
        for item in items:
            now = datetime.now(timezone.utc).isoformat()
            try:
                con.execute("BEGIN IMMEDIATE")
                con.execute("INSERT INTO publishing (sha256,platform,channel_id,item_id,state,post_id,updated_at,error,url) VALUES (?,?,?,?,?,?,?,?,?)", (item["sha256"], item["platform"], item["channel_id"], item["id"], "sending", None, now, None, None))
                con.commit()
            except sqlite3.IntegrityError:
                con.rollback(); print(f"SKIP {item['id']} (기존 전송 기록)"); continue
            try:
                result = client.create_post(item)
                con.execute("UPDATE publishing SET state=?,post_id=?,updated_at=?,error=NULL,url=? WHERE sha256=? AND platform=? AND channel_id=?", (str(result.get("status", "accepted")), result.get("id"), datetime.now(timezone.utc).isoformat(), result.get("externalLink"), item["sha256"], item["platform"], item["channel_id"]))
                con.commit(); print(f"ACCEPTED {item['id']} ({result.get('status', 'accepted')})")
            except Exception:
                con.execute("UPDATE publishing SET state='unknown',updated_at=?,error='게시 응답 확인 필요' WHERE sha256=? AND platform=? AND channel_id=?", (datetime.now(timezone.utc).isoformat(), item["sha256"], item["platform"], item["channel_id"]))
                con.commit(); unknown = True; break
        _export(path, con, items)
    finally: con.close()
    if unknown: print("게시 응답 확인 필요: Buffer 대시보드에서 수동 확인 후 sync 하세요."); return 1
    return 0


def status(args) -> int:
    manifest = _load_manifest(Path(args.manifest)); db_path = DATA / "publishing.sqlite3"
    if not db_path.exists():
        for item in manifest["items"]:
            print(json.dumps({"id": item.get("id"), "state": "pending", "post_id": None, "updated_at": None, "error": None, "url": None}, ensure_ascii=False))
        return 0
    con = sqlite3.connect(db_path)
    try:
        for row in _records(con, manifest["items"]): print(json.dumps(row, ensure_ascii=False))
    finally: con.close()
    return 0


def sync(args) -> int:
    path = Path(args.manifest); manifest = _load_manifest(path); client = _client(); con = _db()
    try:
        for item, row in zip(manifest["items"], _records(con, manifest["items"])):
            if row["post_id"]:
                result = client.get_post(row["post_id"])
                con.execute("UPDATE publishing SET state=?,updated_at=?,url=? WHERE sha256=? AND platform=? AND channel_id=?", (str(result.get("status", row["state"])), datetime.now(timezone.utc).isoformat(), result.get("externalLink"), item["sha256"], item["platform"], item["channel_id"]))
            elif row["state"] in {"sending", "unknown"}:
                print(f"{item['id']}: Buffer 대시보드에서 수동 확인 필요")
        con.commit(); _export(path, con, manifest["items"])
    finally: con.close()
    return 0


def add_parser(subparsers) -> None:
    p = subparsers.add_parser("publish", help="로컬 게시 목록을 준비·검증·전송한다")
    s = p.add_subparsers(dest="publish_command", required=True)
    q = s.add_parser("prepare"); q.add_argument("--date", required=True); q.add_argument("--episodes", required=True); q.add_argument("--track", default="B", choices=["A", "B"]); q.add_argument("--manifest"); q.set_defaults(func=prepare)
    for name, fn in (("check", check), ("send", send), ("status", status), ("sync", sync)):
        q = s.add_parser(name); q.add_argument("--manifest", required=True)
        if name == "send": q.add_argument("--execute", action="store_true")
        q.set_defaults(func=fn)
    q = s.add_parser("channels"); q.set_defaults(func=channels)
