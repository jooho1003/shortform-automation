"""A안 영상 단계 — fal.ai 로 컷별 영상을 만들고 9:16 클립과 타임라인.json 을 쓴다.

- 컷마다 키프레임(+시트)을 참조로 넣고, 프롬프트에는 컷표의 ACTION·CAMERA만 쓴다.
- 편당 비용 상한(config/fal.yaml)을 넘기면 시작하지 않는다. 사용한 금액은 상태.json 에 적는다.
- 실패한 컷은 03-소재/실패.txt 에 적는다. 같은 이름(클립/NN.mp4)으로 손으로 넣으면 이어서 진행한다.
- 대사가 없으므로 타임라인 라인의 text 는 비우고 자막을 생략한다(전략 문서 20-A안 7절).
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

import yaml

from .. import MissingKey, StepFailed
from .. import planfile_a
from ..paths import CONFIG, Episode
from .. import state
from .check_frames import KEYFRAME, SHEET

QUEUE = "https://queue.fal.run"


def _config() -> dict:
    return yaml.safe_load((CONFIG / "fal.yaml").read_text(encoding="utf-8"))


def _data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _fill(value, vars_: dict[str, str]):
    if isinstance(value, str):
        for k, v in vars_.items():
            value = value.replace("{" + k + "}", v)
        return value
    if isinstance(value, dict):
        return {k: _fill(v, vars_) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill(v, vars_) for v in value]
    return value


def _request(method: str, url: str, key: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Key {key}", "Content-Type": "application/json", "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raise StepFailed(f"fal {method} {url.split('/')[-1]} → {exc.code}: {exc.read().decode('utf-8', 'replace')[:400]}") from exc


def _dig(obj, path: str):
    cur = obj
    for part in path.split("."):
        if isinstance(cur, list) and part.isdigit():
            cur = cur[int(part)]
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def _generate(cfg: dict, key: str, prompt: str, keyframe: Path, sheet: Path, out: Path) -> None:
    vars_ = {"prompt": prompt, "keyframe": _data_uri(keyframe), "sheet": _data_uri(sheet) if sheet.exists() else ""}
    body = _fill(cfg.get("body", {"prompt": "{prompt}", "image_url": "{keyframe}"}), vars_)
    endpoint = cfg["endpoint"].strip("/")
    submitted = _request("POST", f"{QUEUE}/{endpoint}", key, body)
    request_id = submitted.get("request_id")
    status_url = submitted.get("status_url") or f"{QUEUE}/{endpoint}/requests/{request_id}/status"
    result_url = submitted.get("response_url") or f"{QUEUE}/{endpoint}/requests/{request_id}"
    if not request_id:
        raise StepFailed(f"fal 큐 응답에 request_id가 없습니다: {str(submitted)[:300]}")

    deadline = time.time() + int(cfg.get("timeout_sec", 900))
    while True:
        st = _request("GET", status_url, key)
        s = st.get("status")
        if s == "COMPLETED":
            break
        if s in ("FAILED", "ERROR"):
            raise StepFailed(f"fal 생성 실패: {str(st)[:300]}")
        if time.time() > deadline:
            raise StepFailed("fal 생성이 시간 초과됐습니다.")
        pos = st.get("queue_position")
        print(f"    … {s}{f' (대기 {pos})' if pos is not None else ''}")
        time.sleep(int(cfg.get("poll_interval_sec", 6)))

    result = _request("GET", result_url, key)
    video_url = _dig(result, cfg.get("video_url_path", "video.url"))
    if not video_url:
        raise StepFailed(f"응답에서 영상 URL을 못 찾았습니다 ({cfg.get('video_url_path')}): {str(result)[:300]}")
    out.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(video_url, out)


def _to_9x16(src: Path, dst: Path, seconds: float) -> None:
    vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-t", f"{seconds:.3f}", "-vf", vf,
         "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(dst)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if res.returncode != 0:
        raise StepFailed(f"ffmpeg 변환 실패 {src.name}: {res.stderr[-300:]}")


def run(ep: Episode) -> None:
    plan = planfile_a.load(ep.plan_md)
    cfg = _config()
    raw_dir = ep.assets_dir / "원본"
    clip_dir = ep.assets_dir / "클립"
    raw_dir.mkdir(parents=True, exist_ok=True)
    clip_dir.mkdir(parents=True, exist_ok=True)
    fail_log = ep.assets_dir / "실패.txt"
    sheet = ep.clips_dir / SHEET

    todo = [c for c in plan.cuts if not (raw_dir / f"{c.n:02d}.mp4").exists() and not (clip_dir / f"{c.n:02d}.mp4").exists()]
    est = len(todo) * float(cfg.get("cost_per_cut_usd", 0.6))
    cap = float(cfg.get("max_cost_per_episode_usd", 10))
    spent = float(state.load(ep).get("fal_spent_usd", 0.0))
    print(f"  생성할 컷 {len(todo)}개 · 예상 ${est:.2f} (누적 ${spent:.2f}, 상한 ${cap:.0f})")
    if todo:
        if spent + est > cap:
            raise StepFailed(f"편당 비용 상한 ${cap:.0f}를 넘깁니다 (누적 ${spent:.2f} + 예상 ${est:.2f}). config/fal.yaml 을 조정하거나 컷을 줄이세요.")
        key = os.environ.get("FAL_KEY")
        if not key:
            raise MissingKey("FAL_KEY 가 없습니다. https://fal.ai/dashboard/keys 에서 발급해 pipeline/.env 에 넣으세요.")

    failed = []
    for cut in todo:
        kf = ep.clips_dir / KEYFRAME.format(n=cut.n)
        if not kf.exists():
            print(f"  ! 컷 {cut.n:02d} 키프레임 없음 — 건너뜀")
            failed.append(cut.n)
            continue
        prompt = f"{cut.action}. Camera: {cut.camera}{', ' + cut.lens if cut.lens else ''}. Natural motion, no morphing, no face change, no text. 9:16 vertical."
        print(f"  컷 {cut.n:02d} 생성 (fal) — {prompt[:70]}")
        try:
            _generate(cfg, key, prompt, kf, sheet, raw_dir / f"{cut.n:02d}.mp4")
            spent += float(cfg.get("cost_per_cut_usd", 0.6))
            st = state.load(ep)
            st["fal_spent_usd"] = round(spent, 2)
            state.save(ep, st)
        except StepFailed as exc:
            print(f"  ! 컷 {cut.n:02d} 실패: {exc}")
            failed.append(cut.n)

    if failed:
        fail_log.write_text(
            "\n".join(f"{n:02d}" for n in failed) + "\n\n실패한 컷입니다. 힉스필드·NewTake 등에서 만들어 03-소재/원본/NN.mp4 로 넣고 다시 실행하세요.\n",
            encoding="utf-8",
        )
        raise StepFailed(f"실패한 컷: {failed} → {fail_log}")
    fail_log.unlink(missing_ok=True)

    # 9:16 변환 + 타임라인
    lines = []
    for cut in plan.cuts:
        dst = clip_dir / f"{cut.n:02d}.mp4"
        src = raw_dir / f"{cut.n:02d}.mp4"
        if not dst.exists():
            if not src.exists():
                raise StepFailed(f"컷 {cut.n:02d} 영상이 없습니다: {src}")
            _to_9x16(src, dst, cut.seconds)
        lines.append({"n": cut.n, "text": "", "start": cut.start, "end": cut.end, "words": [], "clip": f"클립/{cut.n:02d}.mp4", "mediaLayout": "portrait"})

    total = plan.total_seconds
    payload = {
        "fps": 30, "width": 1080, "height": 1920, "durationSec": total,
        "title": plan.title, "hook": plan.hook,
        "template": plan.template_id, "templateName": plan.template_name, "channelLabel": plan.meta.get("채널", ""),
        "lines": lines,
        "comments": [{"at": c.at, "nick": c.nick, "text": c.text} for c in plan.comments],
        "narration": "", "bgm": None, "credits": [],
        "sound": plan.sound,
    }
    (ep.assets_dir / "타임라인.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  타임라인 → {len(lines)}컷 · {total:g}초 · 누적 ${spent:.2f}")
