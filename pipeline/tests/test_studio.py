import copy
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest
from PIL import Image

from shortform.studio import store as db, engine
from shortform.archive import scan_studio


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "ROOT", tmp_path)
    (tmp_path / "media").mkdir()
    Image.new("RGB", (90, 160), (110, 140, 80)).save(tmp_path / "media/one.png")
    monkeypatch.setattr(engine, "config", lambda name: {"endpoint": "test/model", "body": {"duration": "6", "prompt": "{prompt}", "image_url": "{keyframe}"}, "cost_per_cut_usd": .6, "poll_interval_sec": 0})
    return tmp_path


def change(p, op, **payload):
    return db.mutate(p["id"], {"revision": p["revision"], "op": op, **payload})


def ready():
    p = db.create({"title": "테스트"})
    p = change(p, "shot", shotId=p["shots"][0]["id"], prompt="햇빛 아래 나무", duration=.5)
    p = change(p, "asset", path="media/one.png")
    p = change(p, "attachTake", shotId=p["shots"][0]["id"], assetId=p["assets"][0]["id"])
    p = change(p, "select", shotId=p["shots"][0]["id"], takeId=p["shots"][0]["takes"][0]["id"])
    return change(p, "approvePlan")


def prepare(p, kind="export", key="test-key"):
    payload = {"kind": kind, "shotId": p["shots"][0]["id"]}
    quote = engine.quote(p, payload)
    return engine.prepare(p["id"], payload | {"revision": p["revision"], "fingerprint": quote["fingerprint"], "idempotencyKey": key, "confirmed": True})


def test_revision_conflict_does_not_overwrite(workspace):
    p = ready()
    change(p, "project", title="첫 번째")
    with pytest.raises(db.StudioError, match="다른 작업"):
        change(p, "project", title="덮어쓰기")
    assert db.read(p["id"])["title"] == "첫 번째"


def test_media_copy_is_immutable(workspace):
    p = ready()
    asset = db.safe_media(p["assets"][0]["path"])
    original = asset.read_bytes()
    Image.new("RGB", (90, 160), "red").save(workspace / "media/one.png")
    assert asset.read_bytes() == original


@pytest.mark.parametrize("path", ["../one.png", "/tmp/one.png", "D:/private.png", "media/../one.png", ".git/one.png", "pipeline/secrets/one.png"])
def test_reject_unsafe_paths(workspace, path):
    with pytest.raises(db.StudioError):
        db.safe_media(path)


def test_fake_media_rejected(workspace):
    (workspace / "media/fake.png").write_text("not an image")
    p = db.create({})
    with pytest.raises(db.StudioError, match="미디어"):
        change(p, "asset", path="media/fake.png")


def test_input_changes_require_explicit_take_review(workspace):
    p = ready()
    s = p["shots"][0]
    p = change(p, "shot", shotId=s["id"], prompt="달빛 아래 나무")
    assert not db.present(p)["planApproved"]
    assert db.present(p)["shots"][0]["takes"][0]["stale"]
    with pytest.raises(db.StudioError, match="다시 검수"):
        db.export_snapshot(p)
    p = change(p, "reviewTake", shotId=s["id"])
    assert db.export_snapshot(p)["clips"][0]["takeId"] == s["selectedTakeId"]
    p = change(p, "project", ratio="1:1")
    assert db.present(p)["shots"][0]["takes"][0]["stale"]


def test_layout_and_caption_do_not_invalidate_generation(workspace):
    p = ready()
    s = p["shots"][0]
    p = change(p, "layout", layout={"shot-"+s["id"]: {"x": 100, "y": 200}})
    p = change(p, "shot", shotId=s["id"], caption="새 자막", duration=2)
    assert db.present(p)["planApproved"]
    assert not db.present(p)["shots"][0]["takes"][0]["stale"]


def test_idempotency_and_confirmation(workspace):
    p = ready()
    result = prepare(p)
    payload = {"kind": "export", "revision": p["revision"], "fingerprint": result["run"]["fingerprint"], "idempotencyKey": "test-key", "confirmed": True}
    duplicate = engine.prepare(p["id"], payload)
    assert not duplicate["launch"]
    assert duplicate["run"]["id"] == result["run"]["id"]
    with pytest.raises(db.StudioError, match="다른 요청"):
        engine.prepare(p["id"], payload | {"fingerprint": "changed"})
    p2 = ready()
    q = engine.quote(p2, {"kind": "export"})
    with pytest.raises(db.StudioError, match="확인"):
        engine.prepare(p2["id"], payload | {"revision": p2["revision"], "fingerprint": q["fingerprint"], "confirmed": False})


def test_generated_take_does_not_replace_selection(workspace, monkeypatch):
    from shortform import codex
    p = ready()
    chosen = p["shots"][0]["selectedTakeId"]
    monkeypatch.setattr(engine.shutil, "which", lambda _: "codex")
    def mock_image(prompt, folder, refs, cfg):
        Image.new("RGB", (90, 160), "blue").save(folder / "output.png")
    monkeypatch.setattr(codex, "run", mock_image)
    r = prepare(p, "image")["run"]
    engine.execute(p["id"], r["id"])
    current = db.read(p["id"])
    assert current["runs"][0]["status"] == "done"
    assert current["shots"][0]["selectedTakeId"] == chosen
    assert len(current["shots"][0]["takes"]) == 2
    engine.execute(p["id"], r["id"])
    assert len(db.read(p["id"])["shots"][0]["takes"]) == 2


def test_paid_network_ambiguity_is_not_retried(workspace, monkeypatch):
    from shortform import fal
    monkeypatch.setenv("FAL_KEY", "test-only")
    p = ready()
    p = change(p, "shot", shotId=p["shots"][0]["id"], refs=[p["assets"][0]["id"]])
    p = change(p, "approvePlan")
    calls = []
    def network(*args):
        calls.append(args[0])
        raise TimeoutError("simulated lost response")
    monkeypatch.setattr(fal, "request", network)
    r = prepare(p, "video")["run"]
    with pytest.raises(TimeoutError):
        engine.execute(p["id"], r["id"])
    assert db.read(p["id"])["runs"][0]["status"] == "unknown"
    with pytest.raises(db.StudioError, match="접수 여부"):
        engine.resume(p["id"], {"runId": r["id"]})
    with pytest.raises(db.StudioError, match="재실행"):
        engine.execute(p["id"], r["id"])
    assert calls == ["POST"]


def test_remote_id_survives_poll_failure(workspace, monkeypatch):
    from shortform import fal
    monkeypatch.setenv("FAL_KEY", "test-only")
    p = ready()
    p = change(p, "shot", shotId=p["shots"][0]["id"], refs=[p["assets"][0]["id"]])
    p = change(p, "approvePlan")
    def network(method, *args):
        if method == "POST":
            return {"request_id": "remote-123", "status_url": "https://queue.fal.run/status", "response_url": "https://queue.fal.run/result"}
        raise TimeoutError("poll failed")
    monkeypatch.setattr(fal, "request", network)
    r = prepare(p, "video")["run"]
    with pytest.raises(TimeoutError):
        engine.execute(p["id"], r["id"])
    current = db.read(p["id"])["runs"][0]
    assert current["remote"]["request_id"] == "remote-123"
    assert engine.resume(p["id"], {"runId": r["id"]})["launch"]


def test_terminated_worker_reconciles_to_unknown(workspace, monkeypatch):
    p = ready()
    r = prepare(p)["run"]
    engine.update(p["id"], r["id"], status="running", pid=987654)
    monkeypatch.setattr(engine, "alive", lambda _: False)
    assert engine.state(p["id"])["runs"][0]["status"] == "unknown"


def test_api_revisions_across_processes(workspace):
    p = db.create({})
    request = json.dumps({"action": "mutate", "projectId": p["id"], "payload": {"op": "project", "revision": p["revision"], "title": "동시 수정"}})
    def worker():
        return subprocess.run([sys.executable, "-m", "shortform", "studio"], input=request, capture_output=True, text=True, encoding="utf-8", env={**os.environ, "SHORTFORM_ROOT": str(workspace), "PYTHONUTF8": "1"})
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: worker(), range(2)))
    assert sorted(r.returncode for r in results) == [0, 1]
    assert db.read(p["id"])["revision"] == 2


def test_import_episode_preserves_source_and_selected_take(workspace, monkeypatch):
    from shortform import inspect
    folder = workspace / "2026-09-23/A-01-test/03-소재"
    folder.mkdir(parents=True)
    Image.new("RGB", (90, 160), "red").save(folder / "clip.png")
    source = (folder / "clip.png").read_bytes()
    monkeypatch.setattr(inspect, "run_episode", lambda *args, **kw: {"episode": {"dir": "2026-09-23/A-01-test"}, "timeline": {"lines": [{"clip": "clip.png", "text": "한글", "start": 0, "end": 5}]}, "assets": {"images": []}})
    p = db.create({"title": "가져오기", "episode": {"date": "2026-09-23", "track": "A", "num": "01"}})
    assert p["shots"][0]["selectedTakeId"]
    assert p["shots"][0]["caption"] == "한글"
    assert (folder / "clip.png").read_bytes() == source


def test_archive_is_opt_in_and_excludes_refs(workspace):
    p = ready()
    snapshot = db.export_snapshot(p)
    p["exports"].append({"id": "export-1", "assetId": p["assets"][0]["id"], "createdAt": "2026-09-23T00:00:00Z", "snapshot": snapshot})
    db.write(p)
    assert scan_studio(workspace) == []
    p = change(p, "archive", exportId="export-1", enabled=True)
    items = scan_studio(workspace)
    assert len(items) == 1
    assert not items[0].docs and not items[0].images


@pytest.mark.parametrize("url", ["http://queue.fal.run/status", "https://attacker.example/", "https://queue.fal.run.attacker.example/", "https://user@queue.fal.run/"])
def test_provider_auth_never_sent_to_foreign_origin(url):
    with pytest.raises(db.StudioError):
        engine.queue_url(url)


def test_voice_workflow_and_changed_narration_review(workspace, monkeypatch):
    import wave
    from shortform.tts import client
    monkeypatch.setattr(db, "DEFAULT_ROOT", workspace)
    audio_key = "a" * 64
    cache = workspace / "pipeline/data/tts/cache" / audio_key
    cache.mkdir(parents=True)
    with wave.open(str(cache / "audio.wav"), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * 8000)
    calls = []
    def request(endpoint, body=None, **kwargs):
        calls.append(endpoint)
        if endpoint == "/capabilities":
            return {"available": True}
        if endpoint == "/previews":
            assert body["idempotencyKey"]
            return {"id": "tts-job-1", "status": "queued"}
        assert endpoint == "/jobs/tts-job-1"
        return {"status": "done", "result": {"audioKey": audio_key}}
    monkeypatch.setattr(client, "request", request)
    p = ready()
    p = change(p, "project", narrationText="다음 테이크로")
    r = prepare(p, "voice")["run"]
    assert r["estimatedUsd"] == 0
    engine.execute(p["id"], r["id"])
    p = db.read(p["id"])
    assert p["runs"][0]["status"] == "done"
    assert p["runs"][0]["ttsJobId"] == "tts-job-1"
    assert p["audioId"] is None  # New output does not silently replace selected audio.
    p = change(p, "audio", assetId=p["assets"][-1]["id"])
    assert not db.audio_needs_review(p)
    p = change(p, "project", narrationText="다른 대본")
    assert db.audio_needs_review(p)
    with pytest.raises(db.StudioError, match="대본이 변경"):
        db.export_snapshot(p)
    p = change(p, "audio", assetId=p["audioId"])
    assert not db.audio_needs_review(p)
    assert calls.count("/previews") == 1


def test_modified_asset_is_rejected_before_render(workspace):
    p = ready()
    asset = p["assets"][0]
    db.safe_media(asset["path"]).write_bytes(b"tampered")
    with pytest.raises(db.StudioError, match="외부에서 변경"):
        db.verified_asset(asset)


def test_nonfinite_duration_and_invalid_reference_are_rejected(workspace):
    p = ready()
    with pytest.raises(db.StudioError):
        change(p, "shot", shotId=p["shots"][0]["id"], duration=float("nan"))
    with pytest.raises(db.StudioError):
        change(p, "shot", shotId=p["shots"][0]["id"], refs=["missing"])


def test_provider_admission_is_bounded_across_projects(workspace):
    first = ready()
    second = ready()
    run = prepare(first)["run"]
    with pytest.raises(db.StudioError, match="같은 엔진"):
        prepare(second)
    engine.update(first["id"], run["id"], status="failed")
    assert prepare(second)["launch"]
