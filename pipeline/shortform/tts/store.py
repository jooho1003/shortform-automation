from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml

from ..paths import CONFIG, DATA
from .config import TTSError, identifier, text_value, validate_config


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def atomic_json(file: Path, value) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_name(file.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
        os.replace(temp, file)
    finally:
        temp.unlink(missing_ok=True)


def read_json(file: Path, default=None):
    if not file.exists():
        return default
    return json.loads(file.read_text(encoding="utf-8"))


class VoiceStore:
    def __init__(self, data: Path = DATA, config: Path = CONFIG):
        self.data, self.config = data, config
        self.voices = data / "voices"
        self.jobs = data / "tts" / "jobs"
        self.cache = data / "tts" / "cache"
        self.lock = threading.RLock()

    def reference(self, ref_id: str) -> dict:
        ref_id = identifier(ref_id, "참조 음성")
        record = read_json(self.voices / "references" / ref_id / "meta.json")
        if not record:
            raise TTSError("참조 음성을 찾을 수 없습니다.", 404)
        return record

    def reference_audio(self, ref_id: str) -> Path:
        self.reference(ref_id)
        file = self.voices / "references" / ref_id / "audio.wav"
        if not file.is_file():
            raise TTSError("참조 음성 파일이 없습니다.", 404)
        return file

    def resolve_config(self, value) -> dict:
        c = validate_config(value)
        if c["mode"] == "voice_clone":
            reference = self.reference(c["referenceId"])
            if c.get("referenceHash") and c["referenceHash"] != reference["hash"]:
                raise TTSError("참조 음성이 변경됐습니다.", 409)
            c["referenceHash"] = reference["hash"]
        return c

    def presets(self) -> list[dict]:
        root = self.voices / "presets"
        result = []
        for directory in sorted(root.glob("*")):
            files = [p for p in directory.glob("*.json") if p.stem.isdigit()]
            if files:
                result.append(read_json(max(files, key=lambda p: int(p.stem))))
        return sorted(result, key=lambda p: p["updatedAt"], reverse=True)

    def preset(self, preset_id, revision) -> dict:
        preset_id = identifier(preset_id, "프리셋")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise TTSError("프리셋 리비전이 필요합니다.", 422)
        record = read_json(self.voices / "presets" / preset_id / f"{revision}.json")
        if not record:
            raise TTSError("프리셋을 찾을 수 없습니다.", 404)
        self.resolve_config(record["config"])
        return record

    def save_preset(self, body: dict) -> dict:
        config = self.resolve_config(body.get("config"))
        if config["mode"] == "voice_design":
            raise TTSError("설명으로 만든 목소리는 완료된 샘플을 선택해 저장하세요.", 422)
        name = text_value(body.get("name"), "프리셋 이름", 60)
        preset_id = identifier(body["id"]) if body.get("id") else uuid.uuid4().hex
        with self.lock:
            directory = self.voices / "presets" / preset_id
            files = [p for p in directory.glob("*.json") if p.stem.isdigit()]
            current = max((int(p.stem) for p in files), default=0)
            expected = body.get("expectedRevision", 0)
            if type(expected) is not int or expected != current:
                raise TTSError("다른 창에서 변경됐습니다. 목록을 새로고침하세요.", 409)
            record = {"id": preset_id, "revision": current + 1, "name": name, "config": config,
                      "sampleId": body.get("sampleId"), "updatedAt": now()}
            atomic_json(directory / f"{current + 1}.json", record)
            return record

    def default(self):
        file = self.config / "tts.yaml"
        pointer = yaml.safe_load(file.read_text(encoding="utf-8")) if file.exists() else None
        if not pointer or not pointer.get("defaultPreset"):
            return None
        return self.preset(pointer["defaultPreset"]["id"], pointer["defaultPreset"]["revision"])

    def set_default(self, preset_id, revision):
        with self.lock:
            record = self.preset(preset_id, revision) if preset_id is not None else None
            # JSON is also valid YAML; use the same atomic writer.
            atomic_json(self.config / "tts.yaml", {"schemaVersion": 1, "defaultPreset":
                        {"id": record["id"], "revision": record["revision"]} if record else None})
            return record
