from __future__ import annotations

import gc
import hashlib
import os
import subprocess
import time
from pathlib import Path

from .config import MODEL_MAP, TTSError, digest, speech_text
from .store import VoiceStore, atomic_json, read_json


def audio_duration(file: Path) -> float:
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                             "default=noprint_wrappers=1:nokey=1", str(file)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    if result.returncode:
        raise TTSError("오디오 파일을 읽지 못했습니다.", 422)
    try:
        value = float(result.stdout.strip())
    except ValueError as exc:
        raise TTSError("오디오 길이를 측정하지 못했습니다.", 422) from exc
    if not 0 < value < 3600:
        raise TTSError("오디오 길이가 올바르지 않습니다.", 422)
    return value


def convert_audio(source: Path, target: Path, speed: float = 1) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(source), "-vn",
                             "-af", f"atempo={speed:g}", "-ar", "24000", "-ac", "1", str(target)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    if result.returncode:
        raise TTSError("음성 후처리 실패: " + result.stderr[-400:], 500, "audio_processing_failed")


class QwenEngine:
    def __init__(self, store: VoiceStore):
        self.store = store
        self.model = None
        self.model_id = None
        self.revision = None
        self.loaded = {}
        self.device = None
        os.environ.setdefault("HF_HOME", str(store.data / "tts" / "huggingface"))
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

    def load(self, model_id: str, progress) -> None:
        if model_id not in MODEL_MAP:
            raise TTSError("허용되지 않은 모델입니다.", 422)
        if self.model is not None and self.model_id == model_id:
            return
        progress("loading")
        import torch
        from huggingface_hub import snapshot_download
        from qwen_tts import Qwen3TTSModel

        if not torch.cuda.is_available():
            raise TTSError("CUDA GPU를 사용할 수 없습니다. CUDA용 PyTorch 설치를 확인하세요.", 503, "gpu_unavailable")
        self.model = None
        self.model_id = None
        gc.collect()
        torch.cuda.empty_cache()
        torch.set_num_threads(4)
        try:
            model_path = snapshot_download(model_id, local_files_only=True)
            if not (Path(model_path) / "config.json").exists():
                raise FileNotFoundError(model_path)
        except Exception:
            # HF's first symlink probe can race between download threads on Windows.
            # Serial downloads use its normal copy fallback without admin privileges.
            model_path = snapshot_download(model_id, max_workers=1 if os.name == "nt" else 8)
        # A failed/partial download must be completed before loading.
        try:
            model = Qwen3TTSModel.from_pretrained(model_path, device_map="cuda:0",
                dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16,
                attn_implementation="sdpa")
        except OSError:
            model_path = snapshot_download(model_id, max_workers=1 if os.name == "nt" else 8)
            model = Qwen3TTSModel.from_pretrained(model_path, device_map="cuda:0",
                dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16,
                attn_implementation="sdpa")
        self.model, self.model_id = model, model_id
        self.revision = Path(model_path).name
        self.device = torch.cuda.get_device_name(0)
        self.loaded[model_id] = {"revision": self.revision,
            "speakers": model.get_supported_speakers() or [],
            "languages": model.get_supported_languages() or [], "tested": False}

    def generate(self, text: str, config: dict, progress, cancelled) -> dict:
        started = time.monotonic()
        self.load(config["modelId"], progress)
        if cancelled():
            return {}
        import numpy as np
        import soundfile as sf
        import torch
        import transformers
        from importlib.metadata import version

        spoken = speech_text(text, config["pronunciations"])
        inference = {k: v for k, v in config.items() if k not in ("postprocess", "pronunciations")}
        raw_key = digest({"text": spoken, "config": inference, "revision": self.revision,
                          "qwen": version("qwen-tts"), "transformers": transformers.__version__,
                          "torch": torch.__version__})
        audio_key = digest({"rawKey": raw_key, "speed": config["postprocess"]["speed"], "output": "wav24k-mono-v1"})
        raw_dir = self.store.cache / raw_key
        output_dir = self.store.cache / audio_key
        raw_file = raw_dir / "raw.wav"
        output = output_dir / "audio.wav"
        raw_meta = read_json(raw_dir / "raw.json")
        cache_hit = output.is_file() and (output_dir / "audio.json").is_file()
        if not raw_file.is_file() or not raw_meta:
            progress("generating")
            torch.manual_seed(config["generation"]["seed"])
            torch.cuda.reset_peak_memory_stats()
            kwargs = {"text": spoken, "language": config["language"], "non_streaming_mode": True,
                      "max_new_tokens": 4096}
            if "temperature" in config["generation"]:
                kwargs["temperature"] = config["generation"]["temperature"]
            with torch.inference_mode():
                if config["mode"] == "custom_voice":
                    kwargs["speaker"] = config["speaker"]
                    if config.get("instruct"):
                        kwargs["instruct"] = config["instruct"]
                    wavs, sr = self.model.generate_custom_voice(**kwargs)
                elif config["mode"] == "voice_design":
                    wavs, sr = self.model.generate_voice_design(**kwargs, instruct=config["instruct"])
                else:
                    ref = self.store.reference(config["referenceId"])
                    wavs, sr = self.model.generate_voice_clone(**kwargs,
                        ref_audio=str(self.store.reference_audio(ref["id"])), ref_text=ref["text"])
            waveform = np.asarray(wavs[0], dtype=np.float32)
            if not waveform.size or not np.isfinite(waveform).all() or float(np.max(np.abs(waveform))) < .0001:
                raise TTSError("음성 결과가 비어 있거나 무음입니다. 대본을 바꿔 재시도하세요.", 500, "invalid_audio")
            if cancelled():
                return {}
            raw_dir.mkdir(parents=True, exist_ok=True)
            temp = raw_dir / "raw.tmp.wav"
            sf.write(temp, waveform, sr, subtype="PCM_16")
            os.replace(temp, raw_file)
            raw_meta = {"sampleRate": int(sr), "revision": self.revision,
                        "peakMemoryMiB": round(torch.cuda.max_memory_allocated() / 1024**2)}
            atomic_json(raw_dir / "raw.json", raw_meta)
        progress("postprocessing")
        if not cache_hit:
            output_dir.mkdir(parents=True, exist_ok=True)
            temp = output_dir / "audio.tmp.wav"
            convert_audio(raw_file, temp, config["postprocess"]["speed"])
            os.replace(temp, output)
            atomic_json(output_dir / "audio.json", {"duration": audio_duration(output)})
        self.loaded[config["modelId"]]["tested"] = True
        return {"audioKey": audio_key, "rawKey": raw_key, "audioFile": str(output),
                "durationMs": round(audio_duration(output) * 1000), "sampleRate": 24000,
                "spokenText": spoken, "config": config, "configHash": digest(config),
                "cacheHit": cache_hit, "modelRevision": self.revision,
                "timingSource": "estimated", "elapsedSeconds": round(time.monotonic() - started, 2),
                "peakMemoryMiB": raw_meta.get("peakMemoryMiB")}

    def add_reference(self, source: Path, name: str, text: str, ref_id: str) -> dict:
        from .config import text_value
        import numpy as np
        import soundfile as sf
        text = text_value(text, "참조 음성 대본", 2000)
        duration = audio_duration(source)
        if not 3 <= duration <= 30:
            raise TTSError("참조 음성은 3–30초여야 합니다.", 422)
        directory = self.store.voices / "references" / ref_id
        directory.mkdir(parents=True, exist_ok=True)
        audio = directory / "audio.wav"
        convert_audio(source, audio)
        pcm, _ = sf.read(audio)
        if not np.isfinite(pcm).all() or np.max(np.abs(pcm)) < .0001:
            audio.unlink(missing_ok=True)
            raise TTSError("참조 파일에 들리는 음성이 없습니다.", 422)
        record = {"id": ref_id, "name": name, "text": text, "durationMs": round(duration * 1000),
                  "hash": hashlib.sha256(audio.read_bytes() + text.encode("utf-8")).hexdigest()}
        atomic_json(directory / "meta.json", record)
        return record
