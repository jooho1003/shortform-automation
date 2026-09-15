"""Run in .venv-tts; all storage is temporary and no model is downloaded."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient

from shortform.tts.config import DEFAULT_CONFIG
from shortform.tts.queue import SpeechQueue
from shortform.tts.service import create_app
from shortform.tts.store import VoiceStore, atomic_json


@pytest.fixture
def service(tmp_path):
    store = VoiceStore(tmp_path / "data", tmp_path / "config")
    engine = SimpleNamespace(model_id=None, loaded={}, device=None)
    queue = SpeechQueue(store, engine, autostart=False)
    with TestClient(create_app(store, engine, queue)) as client:
        yield client, store, queue, engine


def test_http_validation_and_idempotency(service):
    client, store, queue, engine = service
    body = {"text": "안녕하세요", "config": DEFAULT_CONFIG, "idempotencyKey": "preview1"}
    first = client.post("/previews", json=body)
    assert first.status_code == 202
    assert client.post("/previews", json=body).json()["id"] == first.json()["id"]
    assert client.post("/previews", json={**body, "text": "다른 문장"}).status_code == 409
    assert client.post("/previews", json={**body, "config": {**DEFAULT_CONFIG, "modelId": []}}).status_code == 422
    assert client.post("/previews", json={**body, "text": "가" * 501}).status_code == 422
    assert client.post("/models/prepare", json={"idempotencyKey": "bad", "modelId": {}}).status_code == 422
    assert client.post("/previews", json=body, headers={"Origin": "https://example.com"}).status_code == 403
    assert client.get("/capabilities", headers={"Host": "example.com"}).status_code == 403


def test_audio_range_head_and_path_boundary(service):
    client, store, queue, engine = service
    key = "a" * 64
    directory = store.cache / key
    directory.mkdir(parents=True)
    (directory / "audio.wav").write_bytes(b"RIFF" + bytes(range(100)))
    ranged = client.get("/audio/" + key, headers={"Range": "bytes=4-9"})
    assert ranged.status_code == 206 and ranged.content == bytes(range(6))
    assert ranged.headers["content-range"] == "bytes 4-9/104"
    assert client.head("/audio/" + key).status_code == 200
    assert client.get("/audio/not-a-hash").status_code == 400
    assert client.get("/audio/" + "b" * 64).status_code == 404


def test_sample_save_uses_heard_settings_not_mutated_draft(service):
    client, store, queue, engine = service
    job = queue.submit({"text": "안녕하세요", "config": DEFAULT_CONFIG, "idempotencyKey": "heard"})
    queue.jobs[job["id"]].update(status="done", result={"config": deepcopy(DEFAULT_CONFIG), "audioKey": "a"*64,
        "audioFile": "private-local-file"})
    response = client.post("/presets", json={"name": "실제로 들은 목소리", "sampleId": job["id"],
        "config": {**DEFAULT_CONFIG, "speaker": "Ryan"}})
    assert response.status_code == 200
    assert response.json()["config"]["speaker"] == "Sohee"
    assert "audioFile" not in client.get("/jobs/" + job["id"]).json()["result"]
    assert client.put("/default", json={"id": response.json()["id"], "revision": 1}).status_code == 200
    assert client.put("/default", json={"id": None}).json()["defaultPreset"] is None


def test_design_sample_promotes_raw_reference_not_speed_adjusted_audio(service):
    client, store, queue, engine = service
    config = {**deepcopy(DEFAULT_CONFIG), "mode": "voice_design", "modelId": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", "instruct": "차분한 목소리"}
    config.pop("speaker")
    config["postprocess"]["speed"] = 1.1
    job = queue.submit({"text": "안녕하세요", "config": config, "idempotencyKey": "design"})
    queue.jobs[job["id"]].update(status="done", result={"config": config, "rawKey": "raw", "spokenText": "안녕하세요"})
    def reference(source, name, text, ref_id):
        assert source == store.cache / "raw" / "raw.wav"
        record = {"id": ref_id, "name": name, "text": text, "hash": "c" * 64, "durationMs": 4000}
        atomic_json(store.voices / "references" / ref_id / "meta.json", record)
        return record
    engine.add_reference = reference
    result = client.post("/presets", json={"name": "해설자", "sampleId": job["id"]})
    assert result.status_code == 200
    saved = result.json()["config"]
    assert saved["mode"] == "voice_clone" and saved["modelId"].endswith("0.6B-Base")
    assert saved["postprocess"]["speed"] == 1.1 and "instruct" not in saved


def test_reference_upload_rejects_extension_and_unparseable_audio(service):
    client, store, queue, engine = service
    response = client.post("/references", files={"file": ("bad.exe", b"invalid")}, data={"text": "대본"})
    assert response.status_code == 422
    from shortform.tts.engine import QwenEngine
    engine.add_reference = QwenEngine(store).add_reference
    response = client.post("/references", files={"file": ("bad.wav", b"invalid")}, data={"text": "대본"})
    assert response.status_code == 422
    assert not list(store.voices.glob("references/*/upload.bin"))
