from __future__ import annotations

import hashlib
import json
import math
import re
from copy import deepcopy

from .. import StepFailed

LANGUAGES = ["Korean", "English", "Chinese", "Japanese", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"]
SPEAKERS = ["Sohee", "Ryan", "Aiden", "Serena", "Uncle_Fu", "Ono_Anna", "Vivian", "Dylan", "Eric"]
MODELS = [
    {"id": f"Qwen/Qwen3-TTS-12Hz-{size}-{kind}", "mode": mode, "size": size,
     "instruct": kind == "VoiceDesign" or (kind == "CustomVoice" and size == "1.7B")}
    for kind, mode, sizes in [("CustomVoice", "custom_voice", ["0.6B", "1.7B"]),
                              ("VoiceDesign", "voice_design", ["1.7B"]),
                              ("Base", "voice_clone", ["0.6B", "1.7B"])]
    for size in sizes
]
MODEL_MAP = {m["id"]: m for m in MODELS}
DEFAULT_CONFIG = {
    "schemaVersion": 1, "provider": "qwen3-local", "mode": "custom_voice",
    "modelId": MODELS[0]["id"], "language": "Korean", "speaker": "Sohee",
    "postprocess": {"speed": 1.0, "sentenceGapMs": 180},
    "pronunciations": {"AI": "에이아이", "MBC": "엠비씨", "tvN": "티비엔", "TOP3": "톱 쓰리"},
    "generation": {"seed": None},
}


class TTSError(StepFailed):
    def __init__(self, message: str, status: int = 400, code: str = "invalid_request"):
        super().__init__(message)
        self.status, self.code = status, code


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def identifier(value, label="ID") -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}", value):
        raise TTSError(f"{label} 형식이 올바르지 않습니다.")
    return value


def text_value(value, label, maximum, *, empty=False) -> str:
    if not isinstance(value, str) or (not empty and not value.strip()) or len(value) > maximum or "\0" in value:
        raise TTSError(f"{label}: {'0' if empty else '1'}–{maximum}자로 입력하세요.", 422)
    return value.strip()


def number(value, label, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise TTSError(f"{label}: {minimum}–{maximum} 범위여야 합니다.", 422)
    return value


def validate_config(value) -> dict:
    if not isinstance(value, dict):
        raise TTSError("음성 설정이 필요합니다.", 422)
    allowed = set(DEFAULT_CONFIG) | {"instruct", "referenceId", "referenceHash"}
    if set(value) - allowed:
        raise TTSError("지원하지 않는 음성 설정 항목입니다.", 422)
    c = deepcopy(value)
    if type(c.get("schemaVersion")) is not int or c["schemaVersion"] != 1 or c.get("provider") != "qwen3-local":
        raise TTSError("지원하지 않는 음성 설정 버전 또는 공급자입니다.", 422)
    model = MODEL_MAP.get(c.get("modelId")) if isinstance(c.get("modelId"), str) else None
    if not model or c.get("mode") != model["mode"]:
        raise TTSError("모델과 목소리 모드가 맞지 않습니다.", 422)
    if c.get("language") not in LANGUAGES:
        raise TTSError("지원하지 않는 언어입니다.", 422)
    if c["mode"] == "custom_voice":
        if c.get("speaker") not in SPEAKERS:
            raise TTSError("기본 목소리를 선택하세요.", 422)
    elif "speaker" in c:
        raise TTSError("이 모드에서는 기본 화자를 지정할 수 없습니다.", 422)
    if "instruct" in c:
        if not model["instruct"]:
            raise TTSError("이 모델은 읽는 방식 지시를 지원하지 않습니다.", 422)
        c["instruct"] = text_value(c["instruct"], "목소리 설명", 1500, empty=c["mode"] != "voice_design")
    elif c["mode"] == "voice_design":
        raise TTSError("만들고 싶은 목소리를 설명하세요.", 422)
    if c["mode"] == "voice_clone":
        c["referenceId"] = identifier(c.get("referenceId"), "참조 음성")
        if "referenceHash" in c and not re.fullmatch(r"[0-9a-f]{64}", str(c["referenceHash"])):
            raise TTSError("참조 음성 해시가 잘못됐습니다.", 422)
    elif "referenceId" in c or "referenceHash" in c:
        raise TTSError("이 모드에서는 참조 음성을 지정할 수 없습니다.", 422)
    post = c.get("postprocess", {})
    if not isinstance(post, dict) or set(post) - {"speed", "sentenceGapMs"}:
        raise TTSError("후처리 설정이 올바르지 않습니다.", 422)
    c["postprocess"] = {"speed": number(post.get("speed", 1), "속도", .8, 1.2),
                        "sentenceGapMs": number(post.get("sentenceGapMs", 180), "문장 간격", 0, 800)}
    pronunciation = c.get("pronunciations", {})
    if not isinstance(pronunciation, dict) or len(pronunciation) > 100:
        raise TTSError("발음 사전은 최대 100개입니다.", 422)
    for key, val in pronunciation.items():
        text_value(key, "발음 원문", 80)
        text_value(val, "발음 표기", 160)
    c["pronunciations"] = pronunciation
    generation = c.get("generation", {})
    if not isinstance(generation, dict) or set(generation) - {"seed", "temperature"}:
        raise TTSError("생성 설정이 올바르지 않습니다.", 422)
    seed = generation.get("seed")
    if seed is not None:
        number(seed, "seed", 0, 2**31 - 1)
        if not isinstance(seed, int):
            raise TTSError("seed는 정수여야 합니다.", 422)
    c["generation"] = {"seed": seed}
    if "temperature" in generation:
        c["generation"]["temperature"] = number(generation["temperature"], "temperature", .1, 1.5)
    return c


def speech_text(text: str, pronunciations: dict[str, str]) -> str:
    if not pronunciations:
        return text
    pattern = re.compile("|".join(re.escape(key) for key in sorted(pronunciations, key=len, reverse=True)))
    return pattern.sub(lambda match: pronunciations[match.group(0)], text)
