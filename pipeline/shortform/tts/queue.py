from __future__ import annotations

import queue
import secrets
import threading
import uuid
from copy import deepcopy

from .config import MODEL_MAP, TTSError, digest, identifier, speech_text, text_value
from .store import VoiceStore, atomic_json, now, read_json

TERMINAL = {"done", "failed", "cancelled", "interrupted"}


class SpeechQueue:
    def __init__(self, store: VoiceStore, engine, *, autostart=True):
        self.store, self.engine = store, engine
        self.lock = threading.RLock()
        self.jobs = {}
        self.pending = queue.Queue()
        self.closing = False
        for file in sorted(store.jobs.glob("*.json")):
            job = read_json(file)
            if job["status"] not in TERMINAL:
                # Fail closed after a restart; never silently generate forgotten requests.
                job.update(status="interrupted", error={"code": "service_restarted", "message": "서비스가 재시작됐습니다. 다시 시도하세요."})
                atomic_json(file, job)
            self.jobs[job["id"]] = job
        if autostart:
            threading.Thread(target=self._loop, daemon=True, name="qwen-gpu-queue").start()

    def _save(self, job):
        atomic_json(self.store.jobs / f"{job['id']}.json", job)

    def submit(self, body: dict, kind="preview") -> dict:
        key = identifier(body.get("idempotencyKey"), "요청 ID")
        if kind == "prepare":
            if not isinstance(body.get("modelId"), str) or body["modelId"] not in MODEL_MAP:
                raise TTSError("지원하지 않는 모델입니다.", 422)
            request = {"modelId": body["modelId"]}
        else:
            c = self.store.resolve_config(body.get("config"))
            request = {"text": text_value(body.get("text"), "미리듣기 대본", 500), "config": c,
                       "take": body.get("take", "reuse")}
            if request["take"] not in ("reuse", "new"):
                raise TTSError("테이크 설정이 잘못됐습니다.")
        fingerprint = digest({"kind": kind, "request": request})
        with self.lock:
            for job in self.jobs.values():
                if job["idempotencyKey"] == key:
                    if job["fingerprint"] != fingerprint:
                        raise TTSError("같은 요청 ID에 다른 내용이 전달됐습니다.", 409)
                    return deepcopy(job)
            if sum(j["status"] not in TERMINAL for j in self.jobs.values()) >= 20:
                raise TTSError("작업 대기열이 가득 찼습니다.", 429)
            job = {"id": uuid.uuid4().hex, "kind": kind, "status": "queued", "createdAt": now(),
                   "idempotencyKey": key, "fingerprint": fingerprint, "request": deepcopy(request),
                   "cancelRequested": False}
            if kind == "preview":
                generation = job["request"]["config"]["generation"]
                if request["take"] == "new":
                    generation["seed"] = secrets.randbelow(2**31)
                elif generation["seed"] is None:
                    inference = {k: v for k, v in c.items() if k not in ("postprocess", "pronunciations")}
                    generation["seed"] = int(digest({"text": speech_text(request["text"], c["pronunciations"]),
                                                     "config": inference})[:8], 16) % 2**31
            self.jobs[job["id"]] = job
            self._save(job)
            self.pending.put(job["id"])
            return deepcopy(job)

    def get(self, job_id):
        with self.lock:
            job = self.jobs.get(identifier(job_id))
            if not job:
                raise TTSError("작업을 찾을 수 없습니다.", 404)
            return deepcopy(job)

    def recent(self):
        with self.lock:
            return [deepcopy(j) for j in sorted(self.jobs.values(), key=lambda j: j["createdAt"], reverse=True)[:30]]

    def cancel(self, job_id):
        with self.lock:
            self.get(job_id)
            job = self.jobs[job_id]
            if job["status"] not in TERMINAL:
                job["cancelRequested"] = True
                if job["status"] == "queued":
                    job["status"] = "cancelled"
                self._save(job)
            return deepcopy(job)

    def _process(self, job_id):
        with self.lock:
            job = self.jobs[job_id]
            if job["status"] in TERMINAL:
                return

        def progress(status):
            with self.lock:
                job["status"] = status
                self._save(job)

        def cancelled():
            return self.closing or job["cancelRequested"]

        try:
            progress("loading")
            if job["kind"] == "prepare":
                self.engine.load(job["request"]["modelId"], progress)
                result = {"modelId": job["request"]["modelId"]}
            else:
                req = job["request"]
                result = self.engine.generate(req["text"], req["config"], progress, cancelled)
            with self.lock:
                job.update(status="cancelled" if cancelled() else "done", endedAt=now())
                if not cancelled():
                    job["result"] = result
                self._save(job)
        except Exception as exc:
            message = str(exc)
            code = getattr(exc, "code", "generation_failed")
            if "out of memory" in message.lower():
                code, message = "gpu_out_of_memory", "GPU 메모리가 부족합니다. 다른 GPU 작업을 종료하거나 0.6B 모델을 선택하세요."
            with self.lock:
                job.update(status="cancelled" if cancelled() else "failed", endedAt=now(),
                           error={"code": code, "message": message[-1200:]})
                self._save(job)

    def _loop(self):
        while not self.closing:
            try:
                job_id = self.pending.get(timeout=1)
            except queue.Empty:
                continue
            try:
                self._process(job_id)
            finally:
                self.pending.task_done()
