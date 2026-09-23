from __future__ import annotations

import contextlib
import copy
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from ..paths import ROOT as DEFAULT_ROOT

ROOT = Path(os.environ.get("SHORTFORM_ROOT", DEFAULT_ROOT)).resolve()
MEDIA = {".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".mp4": "video", ".mov": "video", ".webm": "video", ".wav": "audio", ".mp3": "audio", ".m4a": "audio"}


class StudioError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def uid():
    return uuid.uuid4().hex


def stamp():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def project_dir(project_id):
    if not isinstance(project_id, str) or not re.fullmatch(r"[a-f0-9]{32}", project_id):
        raise StudioError("프로젝트 ID가 올바르지 않습니다.")
    return ROOT / "pipeline/data/studio/projects" / project_id


@contextlib.contextmanager
def locked(project_id):
    with directory_lock(project_dir(project_id)):
        yield


@contextlib.contextmanager
def directory_lock(folder):
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / "project.lock").open("a+b") as handle:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            if handle.read(1) == b"":
                handle.write(b"0")
                handle.flush()
            deadline = time.monotonic() + 20
            while True:
                try:
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise StudioError("저장 중입니다. 잠시 후 다시 시도하세요.", 409)
                    time.sleep(.05)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle, fcntl.LOCK_UN)


def read(project_id):
    try:
        return json.loads((project_dir(project_id) / "project.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise StudioError("프로젝트를 찾을 수 없습니다.", 404)


def write(project):
    project["revision"] += 1
    project["updatedAt"] = stamp()
    folder = project_dir(project["id"])
    tmp = folder / f".{uid()}.tmp"
    try:
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(project, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, folder / "project.json")
    finally:
        tmp.unlink(missing_ok=True)


def text(value, limit=6000):
    if not isinstance(value, str) or len(value) > limit:
        raise StudioError(f"문자열은 {limit}자 이하여야 합니다.")
    return value.strip()


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise StudioError(f"숫자는 {low}~{high} 범위여야 합니다.")
    return value


def shot(title="새 컷", prompt="", duration=5):
    return {"id": uid(), "title": title, "prompt": prompt, "duration": duration, "caption": "", "camera": "", "style": "", "trimStart": 0, "refs": [], "selectedTakeId": None, "takes": []}


def get_shot(project, shot_id):
    return next((s for s in project["shots"] if s["id"] == shot_id), None) or _missing("컷")


def _missing(name):
    raise StudioError(f"{name}을 찾을 수 없습니다.", 404)


def get_asset(project, asset_id):
    return next((a for a in project["assets"] if a["id"] == asset_id), None) or _missing("소재")


def input_hash(project, target):
    return digest({k: target[k] for k in ("prompt", "camera", "style")} | {"ratio": project["ratio"], "refs": [get_asset(project, i)["sha256"] for i in target["refs"]]})


def plan_hash(project):
    return digest({"brief": project["brief"], "ratio": project["ratio"], "shots": [{k: s[k] for k in ("id", "title", "prompt", "camera", "style", "refs")} for s in project["shots"]]})


def export_snapshot(project):
    if not project["shots"]:
        raise StudioError("출력할 컷을 추가하세요.")
    if audio_needs_review(project):
        raise StudioError("나레이션 대본이 변경되었습니다. 음성을 다시 생성하거나 현재 음성을 검수하세요.")
    clips = []
    for s in project["shots"]:
        take = next((t for t in s["takes"] if t["id"] == s["selectedTakeId"]), None)
        if not take:
            raise StudioError(f"{s['title']}: 테이크를 선택하세요.")
        if take["inputHash"] != input_hash(project, s) and s.get("acceptedHash") != digest([take["id"], input_hash(project, s)]):
            raise StudioError(f"{s['title']}: 입력이 변경되었습니다. 선택한 테이크를 다시 검수하세요.")
        a = get_asset(project, take["assetId"])
        if a["kind"] == "video" and s["trimStart"] + s["duration"] > a["duration"] + .05:
            raise StudioError(f"{s['title']}: 길이가 원본 영상 범위를 넘습니다.")
        clips.append({"path": a["path"], "kind": a["kind"], "duration": s["duration"], "trimStart": s["trimStart"], "caption": s["caption"], "takeId": take["id"], "sha256": a["sha256"]})
    return {"title": project["title"], "ratio": project["ratio"], "clips": clips, "audio": copy.deepcopy(get_asset(project, project["audioId"])) if project.get("audioId") else None}


def audio_needs_review(project):
    if not project.get("audioId"):
        return False
    asset = get_asset(project, project["audioId"])
    current = digest(project.get("narrationText", ""))
    return bool(asset.get("narrationHash") and asset["narrationHash"] != current and project.get("audioApproval") != digest([asset["id"], current]))


def safe_media(relative):
    if not isinstance(relative, str) or "\\" in relative or ":" in relative or Path(relative).is_absolute() or any(x.startswith(".") or x.lower() == "secrets" for x in relative.split("/")):
        raise StudioError("허용되지 않은 소재 경로입니다.")
    path = (ROOT / relative).resolve()
    if not path.is_relative_to(ROOT) or path.suffix.lower() not in MEDIA or not path.is_file():
        raise StudioError("소재 파일을 찾을 수 없거나 지원하지 않는 형식입니다.")
    # Resolve symlinks before checking sensitive directories too.
    if any(x.startswith(".") or x.lower() == "secrets" for x in path.relative_to(ROOT).parts):
        raise StudioError("허용되지 않은 소재 경로입니다.")
    return path


def add_asset(project, relative, name=None):
    source = safe_media(relative)
    if source.stat().st_size > 200 * 1024 * 1024:
        raise StudioError("소재 파일은 200MB 이하여야 합니다.")
    result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(source)], capture_output=True, timeout=30, encoding="utf-8", creationflags=0x08000000 if os.name == "nt" else 0)
    if result.returncode:
        raise StudioError("읽을 수 없는 미디어 파일입니다.")
    meta = json.loads(result.stdout)
    kind = MEDIA[source.suffix.lower()]
    if kind == "image":
        from PIL import Image
        try:
            with Image.open(source) as image:
                if image.width * image.height > 40000000:
                    raise ValueError("too large")
                image.verify()
        except Exception as exc:
            raise StudioError("읽을 수 없는 이미지 미디어 파일입니다.") from exc
    if not any(s.get("codec_type") == ("audio" if kind == "audio" else "video") for s in meta.get("streams", [])):
        raise StudioError("파일 내용과 미디어 형식이 일치하지 않습니다.")
    duration = float(meta.get("format", {}).get("duration", 0))
    if kind != "image" and (not math.isfinite(duration) or duration <= 0):
        raise StudioError("미디어 길이를 확인할 수 없습니다.")
    asset_id = uid()
    dest = project_dir(project["id"]) / "assets" / (asset_id + source.suffix.lower())
    dest.parent.mkdir(exist_ok=True)
    shutil.copyfile(source, dest)
    asset = {"id": asset_id, "name": text(name or source.name, 200), "path": dest.relative_to(ROOT).as_posix(), "kind": kind, "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(), "duration": duration}
    project["assets"].append(asset)
    return asset


def verified_asset(asset):
    source = safe_media(asset["path"])
    if hashlib.sha256(source.read_bytes()).hexdigest() != asset["sha256"]:
        raise StudioError("저장된 소재가 외부에서 변경되었습니다. 파일을 다시 추가하세요.")
    return source


def add_take(project, target, asset, fingerprint=None, run_id=None):
    if asset["kind"] not in ("image", "video"):
        raise StudioError("테이크에는 이미지 또는 영상을 선택하세요.")
    take = {"id": uid(), "assetId": asset["id"], "inputHash": fingerprint or input_hash(project, target), "createdAt": stamp(), "runId": run_id}
    target["takes"].append(take)
    return take


def create(payload):
    p = {"id": uid(), "version": 1, "revision": 0, "title": text(payload.get("title", "새 프로젝트"), 120) or "새 프로젝트", "brief": "", "ratio": "9:16", "stage": 0, "createdAt": stamp(), "updatedAt": stamp(), "source": None, "shots": [], "assets": [], "layout": {}, "runs": [], "exports": [], "audioId": None, "planApproval": None}
    with locked(p["id"]):
        if payload.get("episode"):
            from ..inspect import run_episode
            e = payload["episode"]
            if not isinstance(e, dict) or e.get("track") not in ("A", "B") or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(e.get("date"))) or not re.fullmatch(r"\d{2}", str(e.get("num"))):
                raise StudioError("회차 정보가 올바르지 않습니다.")
            old = run_episode(e["track"], e["date"], e["num"], root=ROOT)
            p["source"] = e
            p["stage"] = 1
            p["brief"] = (old.get("brief") or "")[:6000]
            timeline = old.get("timeline") or {}
            lines = timeline.get("lines") or []
            cuts = (old.get("plan") or {}).get("cuts") or []
            for idx, line in enumerate(lines):
                s = shot(f"컷 {idx+1:02}", str(line.get("text", "")), max(.2, min(60, float(line.get("end", 5)) - float(line.get("start", 0)))))
                s["caption"] = str(line.get("text", ""))[:1000]
                path = line.get("video") or line.get("clip")
                if path:
                    base = old["episode"]["dir"] + "/03-소재/"
                    a = add_asset(p, base + path)
                    t = add_take(p, s, a)
                    s["selectedTakeId"] = t["id"]
                    if a["kind"] == "video":
                        s["duration"] = min(s["duration"], a["duration"])
                p["shots"].append(s)
            if not p["shots"]:
                for idx, c in enumerate(cuts):
                    p["shots"].append(shot(f"컷 {idx+1:02}", str(c.get("action", "")), max(.2, min(60, float(c.get("end", 5)) - float(c.get("start", 0))))))
            for relative in (old.get("assets") or {}).get("images", []):
                add_asset(p, relative)
            narration = (old.get("assets") or {}).get("narration")
            if narration:
                p["audioId"] = add_asset(p, narration)["id"]
        if not p["shots"]:
            p["shots"].append(shot())
        write(p)
    return p


def mutate(project_id, payload):
    with locked(project_id):
        p = read(project_id)
        if payload.get("revision") != p["revision"]:
            raise StudioError("다른 작업이 프로젝트를 변경했습니다. 새로고침 후 다시 저장하세요.", 409)
        op = payload.get("op")
        if op == "project":
            for k in ("title", "brief", "narrationText"):
                if k in payload:
                    p[k] = text(payload[k], 120 if k == "title" else 6000)
            if "ratio" in payload:
                if payload["ratio"] not in ("9:16", "16:9", "1:1"):
                    raise StudioError("지원하지 않는 화면 비율입니다.")
                p["ratio"] = payload["ratio"]
            if "stage" in payload:
                p["stage"] = int(number(payload["stage"], 0, 5))
        elif op == "addShot":
            if len(p["shots"]) >= 60:
                raise StudioError("한 프로젝트에 최대 60컷까지 지원합니다.")
            p["shots"].append(shot())
        elif op in ("shot", "select", "attachTake", "reviewTake", "move", "removeShot"):
            s = get_shot(p, payload.get("shotId"))
            if op == "shot":
                for k in ("title", "prompt", "caption", "camera", "style"):
                    if k in payload:
                        s[k] = text(payload[k], 6000 if k == "prompt" else 1000)
                for k, low, high in (("duration", .2, 60), ("trimStart", 0, 3600)):
                    if k in payload:
                        s[k] = number(payload[k], low, high)
                if "refs" in payload:
                    refs = payload["refs"]
                    if not isinstance(refs, list) or len(refs) > 8 or any(not isinstance(i, str) for i in refs) or len(set(refs)) != len(refs):
                        raise StudioError("참조 이미지는 중복 없이 최대 8개입니다.")
                    for ref in refs:
                        if get_asset(p, ref)["kind"] != "image":
                            raise StudioError("참조에는 이미지만 연결할 수 있습니다.")
                    s["refs"] = refs
            elif op == "select":
                if not any(t["id"] == payload.get("takeId") for t in s["takes"]):
                    _missing("테이크")
                s["selectedTakeId"] = payload["takeId"]
                s.pop("acceptedHash", None)
            elif op == "reviewTake":
                if not s["selectedTakeId"]:
                    raise StudioError("테이크를 먼저 선택하세요.")
                s["acceptedHash"] = digest([s["selectedTakeId"], input_hash(p, s)])
            elif op == "attachTake":
                add_take(p, s, get_asset(p, payload.get("assetId")))
            elif op == "removeShot":
                p["shots"].remove(s)
            else:
                index = p["shots"].index(s)
                dest = index + int(number(payload.get("delta"), -1, 1))
                p["shots"].pop(index)
                p["shots"].insert(max(0, min(len(p["shots"]), dest)), s)
        elif op == "asset":
            add_asset(p, payload.get("path"), payload.get("name"))
        elif op == "audio":
            asset_id = payload.get("assetId")
            if asset_id and get_asset(p, asset_id)["kind"] != "audio":
                raise StudioError("오디오 파일을 선택하세요.")
            p["audioId"] = asset_id or None
            p["audioApproval"] = digest([asset_id, digest(p.get("narrationText", ""))])
        elif op == "layout":
            layout = payload.get("layout")
            valid = {"shot-" + s["id"] for s in p["shots"]} | {"asset-" + a["id"] for a in p["assets"]}
            if not isinstance(layout, dict) or len(layout) > len(valid):
                raise StudioError("캔버스 배치가 올바르지 않습니다.")
            for key, pos in layout.items():
                if key not in valid or not isinstance(pos, dict):
                    raise StudioError("알 수 없는 노드입니다.")
                number(pos.get("x"), -100000, 100000)
                number(pos.get("y"), -100000, 100000)
            p["layout"] = layout
        elif op == "approvePlan":
            if not p["shots"] or any(not s["prompt"] for s in p["shots"]):
                raise StudioError("각 컷의 프롬프트를 입력한 뒤 기획을 승인하세요.")
            p["planApproval"] = plan_hash(p)
        elif op == "archive":
            export = next((e for e in p["exports"] if e["id"] == payload.get("exportId")), None)
            if not export or not isinstance(payload.get("enabled"), bool):
                raise StudioError("출력본을 선택하세요.")
            export["archive"] = payload["enabled"]
        else:
            raise StudioError("지원하지 않는 변경입니다.")
        write(p)
        return p


def present(p):
    p = copy.deepcopy(p)
    p["planApproved"] = p["planApproval"] == plan_hash(p)
    p["audioNeedsReview"] = audio_needs_review(p)
    for s in p["shots"]:
        current = input_hash(p, s)
        for t in s["takes"]:
            t["stale"] = t["inputHash"] != current and s.get("acceptedHash") != digest([t["id"], current])
    return p


def listing():
    base = ROOT / "pipeline/data/studio/projects"
    return sorted([{"id": p["id"], "title": p["title"], "updatedAt": p["updatedAt"], "shots": len(p["shots"]), "exports": len(p["exports"])} for f in base.glob("*/project.json") if (p := json.loads(f.read_text(encoding="utf-8")))], key=lambda p: p["updatedAt"], reverse=True)
