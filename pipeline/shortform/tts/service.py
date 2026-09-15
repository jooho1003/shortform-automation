from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from copy import deepcopy

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from .. import StepFailed
from .config import DEFAULT_CONFIG, LANGUAGES, MODELS, SPEAKERS, TTSError, identifier, text_value
from .engine import QwenEngine
from .episode import apply_preset, find_episode, info
from .queue import SpeechQueue
from .store import VoiceStore, read_json


def create_app(store=None, engine=None, speech_queue=None):
    store = store or VoiceStore()
    engine = engine or QwenEngine(store)
    speech_queue = speech_queue or SpeechQueue(store, engine)

    @asynccontextmanager
    async def lifespan(app):
        yield
        speech_queue.closing = True

    app = FastAPI(title="Shortform Qwen3 TTS", docs_url=None, redoc_url=None, lifespan=lifespan)

    @app.exception_handler(TTSError)
    async def tts_error(req, exc):
        return JSONResponse({"error": str(exc), "code": exc.code}, status_code=exc.status)

    @app.exception_handler(StepFailed)
    async def plan_error(req, exc):
        return JSONResponse({"error": str(exc), "code": "episode_not_ready"}, status_code=422)

    @app.middleware("http")
    async def local_only(req: Request, call_next):
        host = req.headers.get("host", "").split(":")[0]
        if host not in ("127.0.0.1", "localhost", "testserver") or req.headers.get("origin"):
            return JSONResponse({"error": "로컬 콘솔을 통해 접근하세요."}, status_code=403)
        size = req.headers.get("content-length")
        if size and (not size.isdigit() or int(size) > 21 * 1024 * 1024):
            return JSONResponse({"error": "요청 파일이 너무 큽니다."}, status_code=413)
        return await call_next(req)

    def public_job(job):
        job = deepcopy(job)
        if job.get("result", {}).get("audioKey"):
            result = job["result"]
            result.pop("audioFile", None)
            result["audioUrl"] = "/api/tts/audio/" + result["audioKey"]
        return job

    @app.get("/capabilities")
    def capabilities():
        models = [{**m, "loaded": engine.model_id == m["id"], **engine.loaded.get(m["id"], {})} for m in MODELS]
        return {"available": True, "models": models, "speakers": SPEAKERS, "languages": LANGUAGES,
                "defaultConfig": DEFAULT_CONFIG, "device": engine.device,
                "activeJobs": sum(j["status"] not in ("done", "failed", "cancelled", "interrupted") for j in speech_queue.recent())}

    @app.get("/presets")
    def presets():
        return {"presets": store.presets(), "defaultPreset": store.default()}

    @app.post("/presets")
    def save_preset(body: dict):
        body = deepcopy(body)
        if body.get("sampleId"):
            job = speech_queue.get(body["sampleId"])
            if job["status"] != "done" or job["kind"] != "preview":
                raise TTSError("생성이 완료된 샘플을 선택하세요.", 422)
            body["config"] = deepcopy(job["result"]["config"])
            if body["config"]["mode"] == "voice_design":
                raw = store.cache / job["result"]["rawKey"] / "raw.wav"
                ref_id = uuid.uuid4().hex
                reference = engine.add_reference(raw, text_value(body.get("name"), "프리셋 이름", 60),
                    job["result"]["spokenText"], ref_id)
                body["config"].update(mode="voice_clone", modelId="Qwen/Qwen3-TTS-12Hz-0.6B-Base",
                                      referenceId=ref_id, referenceHash=reference["hash"])
                body["config"].pop("instruct", None)
        return store.save_preset(body)

    @app.put("/default")
    def set_default(body: dict):
        return {"defaultPreset": store.set_default(body.get("id"), body.get("revision"))}

    @app.post("/previews", status_code=202)
    def preview(body: dict):
        return public_job(speech_queue.submit(body))

    @app.post("/models/prepare", status_code=202)
    def prepare(body: dict):
        return public_job(speech_queue.submit(body, "prepare"))

    @app.get("/jobs")
    def jobs():
        return {"jobs": [public_job(j) for j in speech_queue.recent()]}

    @app.get("/jobs/{job_id}")
    def job(job_id: str):
        return public_job(speech_queue.get(job_id))

    @app.post("/jobs/{job_id}/cancel")
    def cancel(job_id: str):
        return public_job(speech_queue.cancel(job_id))

    @app.get("/references")
    def references():
        return {"references": [read_json(p) for p in (store.voices / "references").glob("*/meta.json")]}

    @app.post("/references")
    def upload(file: UploadFile = File(...), text: str = Form(...)):
        name = text_value(file.filename or "참조 음성", "파일 이름", 180)
        if not name.lower().endswith((".wav", ".mp3", ".m4a")):
            raise TTSError("WAV·MP3·M4A 파일을 선택하세요.", 422)
        ref_id = uuid.uuid4().hex
        directory = store.voices / "references" / ref_id
        directory.mkdir(parents=True, exist_ok=True)
        source = directory / "upload.bin"
        try:
            size = 0
            with source.open("wb") as target:
                while chunk := file.file.read(1024 * 1024):
                    size += len(chunk)
                    if size > 20 * 1024 * 1024:
                        raise TTSError("참조 음성은 20MB 이하여야 합니다.", 413)
                    target.write(chunk)
            return engine.add_reference(source, name, text, ref_id)
        finally:
            file.file.close()
            source.unlink(missing_ok=True)

    @app.api_route("/references/{ref_id}/audio", methods=["GET", "HEAD"])
    def reference_audio(ref_id: str):
        return FileResponse(store.reference_audio(ref_id), media_type="audio/wav")

    @app.api_route("/audio/{key}", methods=["GET", "HEAD"])
    def audio(key: str):
        import re
        if not re.fullmatch(r"[0-9a-f]{64}", key):
            raise TTSError("오디오 ID가 잘못됐습니다.", 400)
        file = store.cache / key / "audio.wav"
        if not file.is_file():
            raise TTSError("음성 파일이 없습니다.", 404)
        return FileResponse(file, media_type="audio/wav")

    @app.get("/episode")
    def episode(track: str, date: str, num: str):
        return info(find_episode(track, date, num))

    @app.put("/episode")
    def apply(body: dict):
        ep = find_episode(body.get("track"), body.get("date"), body.get("num"))
        preset = store.preset(body.get("presetId"), body.get("presetRevision"))
        return apply_preset(ep, preset, body.get("expectedRevision", 0))

    return app


def main():
    import uvicorn
    from types import SimpleNamespace
    from ..paths import DATA
    from .episode import episode_lock
    directory = DATA / "tts"
    directory.mkdir(parents=True, exist_ok=True)
    # Acquire before recovering persisted jobs: a second launch must not mark
    # another live process's work as interrupted.
    with episode_lock(SimpleNamespace(dir=directory)):
        uvicorn.run(create_app(), host="127.0.0.1", port=8765, log_level="info")


if __name__ == "__main__":
    main()
