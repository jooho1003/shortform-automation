from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from shortform import publishing
from shortform import paths


class FakeBuffer:
    def __init__(self, service="youtube", fail=False):
        self.service, self.fail = service, fail
        self.created = []; self.verified = []; self.fetched = []
    def channels(self):
        return [{"id": "a" * 24, "name": "test", "service": self.service,
                 "isDisconnected": False, "isLocked": False, "isQueuePaused": False}]
    def verify_media(self, item): self.verified.append(item["video_url"])
    def create_post(self, item):
        self.created.append(item["id"])
        if self.fail: raise RuntimeError("secret response body")
        return {"id": "b" * 24, "status": "queued", "externalLink": "https://buffer.example/posts/1"}
    def get_post(self, post_id): self.fetched.append(post_id); return {"id": post_id, "status": "scheduled", "externalLink": "https://buffer.example/posts/2"}


@pytest.fixture
def queue(tmp_path, monkeypatch):
    monkeypatch.setattr(publishing, "ROOT", tmp_path)
    monkeypatch.setattr(publishing, "DATA", tmp_path / "data")
    monkeypatch.setattr(paths, "ROOT", tmp_path)
    video = tmp_path / "movie.mp4"; video.write_bytes(b"reviewed video")
    return tmp_path, video, hashlib.sha256(video.read_bytes()).hexdigest()


def item(video, digest, **extra):
    value = {"id": "one", "episode": "2026-01-01/B-01-x", "file": video.name,
             "sha256": digest, "title": "title", "text": "text", "platform": "youtube",
             "channel_id": "a" * 24, "video_url": "https://cdn.example.com/movie.mp4",
             "mode": "now", "due_at": None, "privacy": "unlisted"}
    value.update(extra); return value


def manifest(tmp_path, *items):
    path = tmp_path / "게시목록.json"
    path.write_text(json.dumps({"version": 1, "provider": "buffer", "items": list(items)}), encoding="utf-8")
    return path


def args(path, execute=False):
    return type("Args", (), {"manifest": str(path), "execute": execute})()


def test_hash_change_and_traversal_are_blocked(queue):
    root, video, digest = queue
    video.write_bytes(b"changed")
    assert publishing.check(args(manifest(root, item(video, digest)))) == 2
    assert publishing.check(args(manifest(root, item(video, digest, file="../outside.mp4")))) == 2


def test_schedule_requires_aware_future_time(queue):
    root, video, digest = queue
    naive = item(video, digest, mode="schedule", due_at="2030-01-01T12:00:00")
    past = item(video, digest, mode="schedule", due_at=(datetime.now(timezone.utc)-timedelta(days=1)).isoformat())
    assert publishing.check(args(manifest(root, naive))) == 2
    assert publishing.check(args(manifest(root, past))) == 2


def test_dry_run_makes_no_buffer_calls(queue, monkeypatch):
    root, video, digest = queue; fake = FakeBuffer()
    monkeypatch.setattr(publishing, "_client", lambda: fake)
    assert publishing.send(args(manifest(root, item(video, digest)), execute=False)) == 0
    assert fake.created == fake.verified == []


def test_channel_platform_is_checked_before_create(queue, monkeypatch):
    root, video, digest = queue; fake = FakeBuffer("instagram")
    monkeypatch.setattr(publishing, "_client", lambda: fake)
    assert publishing.send(args(manifest(root, item(video, digest)), execute=True)) == 2
    assert fake.created == []


def test_same_video_in_two_manifests_posts_only_once(queue, monkeypatch):
    root, video, digest = queue; fake = FakeBuffer(); monkeypatch.setattr(publishing, "_client", lambda: fake)
    first = manifest(root, item(video, digest)); second = root / "second.json"
    second.write_text(json.dumps({"version": 1, "provider": "buffer", "items": [item(video, digest, id="two")]}), encoding="utf-8")
    assert publishing.send(args(first, True)) == publishing.send(args(second, True)) == 0
    assert fake.created == ["one"]


def test_unknown_response_is_never_retried_and_has_no_secret_error(queue, monkeypatch):
    root, video, digest = queue; fake = FakeBuffer(fail=True); monkeypatch.setattr(publishing, "_client", lambda: fake)
    path = manifest(root, item(video, digest))
    assert publishing.send(args(path, True)) == 1
    fake.fail = False
    assert publishing.send(args(path, True)) == 1
    assert fake.created == ["one"]
    assert "secret" not in (root / "게시목록-결과.json").read_text(encoding="utf-8")


def test_identical_items_are_blocked_before_remote_call(queue, monkeypatch):
    root, video, digest = queue; fake = FakeBuffer(); monkeypatch.setattr(publishing, "_client", lambda: fake)
    one = item(video, digest); two = item(video, digest, id="two")
    assert publishing.send(args(manifest(root, one, two), True)) == 2
    assert fake.created == fake.verified == []


def test_sync_reads_posts_without_creating(queue, monkeypatch):
    root, video, digest = queue; fake = FakeBuffer(); monkeypatch.setattr(publishing, "_client", lambda: fake)
    path = manifest(root, item(video, digest))
    assert publishing.send(args(path, True)) == 0
    assert publishing.sync(args(path)) == 0
    assert fake.created == ["one"] and fake.fetched == ["b" * 24]
    assert json.loads((root / "게시목록-결과.json").read_text(encoding="utf-8"))["items"][0]["url"] == "https://buffer.example/posts/2"


def test_bom_and_malformed_item_types_are_blocked(queue):
    root, video, digest = queue
    path = root / "bom.json"
    path.write_text(json.dumps({"version": 1, "provider": "buffer", "items": [{"id": [], "sha256": [], "platform": [], "channel_id": []}]}), encoding="utf-8-sig")
    assert publishing.check(args(path)) == 2


def test_prepare_creates_twelve_entries_and_refuses_overwrite(queue, monkeypatch):
    root, video, digest = queue
    for num in ("02", "03", "04", "05"):
        ep = root / "2026-01-01" / f"B-{num}-x"; (ep / "04-영상").mkdir(parents=True)
        (ep / "04-영상" / "final.mp4").write_bytes(video.read_bytes())
        (ep / "01-기획안.md").write_text("# 제목 후보\n\n1. 요정재형 테스트\n\n## 훅\n\n훅\n\n## 대본\n\n| # | 문장 | 소재 | 검색어 |\n|---|---|---|---|\n| 1 | 문장 | clip | q |\n\n## AI 댓글\n\n| 시각 | 닉네임 | 내용 |\n|---|---|---|\n| 1 | n | c |\n\n## 메타데이터\n\n- 설명: 설명\n- 태그: 태그\n- 공개: unlisted\n", encoding="utf-8")
    monkeypatch.setattr(publishing, "_duration", lambda _: None)
    p = root / "2026-01-01" / "게시목록.json"
    a = type("Args", (), {"date":"2026-01-01", "episodes":"02,03,04,05", "track":"B", "manifest":str(p)})()
    assert publishing.prepare(a) == 0
    assert len(json.loads(p.read_text(encoding="utf-8"))["items"]) == 12
    with pytest.raises(Exception): publishing.prepare(a)
