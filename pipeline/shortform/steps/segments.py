"""구간 추출. 롱폼 1편에서 숏폼으로 쓸 만한 구간 후보를 뽑는다.

기계가 20개쯤 뽑고 사람이 3개를 고른다. 완전 자동을 노리지 않는다 —
"웃긴 지점"은 신호로 근사할 수 있어도 판정은 사람이 해야 한다.

신호 두 갈래를 쓴다. 둘 다 추가 의존성 없이 얻는다.

1. 오디오 에너지  ffmpeg ebur128 필터가 100ms 간격 순간 음량을 뱉는다.
                 웃음·박수·비명은 여기서 봉우리로 잡힌다.
2. 자막 텍스트    yt-dlp 자동 자막. 감탄사·물음표·숫자·말 밀도를 센다.

앞선 정적은 따로 가산한다. 정적 뒤에 터지는 반응이 숏폼에서 잘 먹힌다.
"""

from __future__ import annotations

import html
import json
import re
import statistics
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .. import StepFailed
from ..paths import DATA, ROOT

SEGMENT_DIR = DATA / "segments"
CACHE_DIR = DATA / "cache"

PRE, POST = 32.0, 18.0      # 봉우리 앞뒤로 잡는 초. 합쳐서 50초
MIN_GAP = 40.0              # 후보끼리 이만큼은 떨어뜨린다
TOP_N = 20
PEAK_PERCENTILE = 0.90      # 음량 상위 10%를 봉우리 후보로 본다
SKIP_HEAD = 60.0            # 도입부. 인트로 타이틀과 인사말이라 소재가 안 된다
SKIP_TAIL = 30.0            # 마무리 인사와 엔딩
FONT_PATH = "C:/Windows/Fonts/malgun.ttf"

EXCLAIM = ["헐", "대박", "진짜", "미쳤", "레전드", "소름", "실화", "어머", "우와",
           "아니 ", "뭐야", "아이고", "어이없", "장난", "말도 안"]

# 유튜브 ASR이 붙이는 비언어 표시. 웃음 지점을 직접 알려준다.
LAUGH_MARK = re.compile(r"\[(웃음|박수|비명|환호|콧방귀|웃음소리)\]")


def _run(args, timeout=900):
    try:
        return subprocess.run(args, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        return None


def _ytdlp(args, timeout=900):
    return _run([sys.executable, "-m", "yt_dlp", *args, "--no-warnings"], timeout)


# --- 소스 받기 -------------------------------------------------------------

def _fetch_audio(video_id: str) -> Path:
    out = CACHE_DIR / f"{video_id}.m4a"
    if out.exists() and out.stat().st_size > 0:
        return out
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _ytdlp([f"https://www.youtube.com/watch?v={video_id}", "-f", "bestaudio[ext=m4a]/bestaudio",
            "-o", str(CACHE_DIR / f"{video_id}.%(ext)s")])
    hits = list(CACHE_DIR.glob(f"{video_id}.*"))
    audio = next((h for h in hits if h.suffix in {".m4a", ".webm", ".opus", ".mp3"}), None)
    if not audio:
        raise StepFailed(f"오디오를 받지 못했습니다: {video_id}")
    return audio


def _fetch_subs(video_id: str) -> list[dict]:
    """자동 자막을 받아 (start, end, text)로 만든다. 없으면 빈 목록."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    stem = CACHE_DIR / video_id
    if not list(CACHE_DIR.glob(f"{video_id}*.vtt")):
        _ytdlp([f"https://www.youtube.com/watch?v={video_id}", "--skip-download",
                "--write-auto-subs", "--write-subs", "--sub-langs", "ko,ko-orig",
                "--sub-format", "vtt", "-o", str(stem)], timeout=300)
    files = sorted(CACHE_DIR.glob(f"{video_id}*.vtt"))
    if not files:
        return []
    return _parse_vtt(files[0].read_text(encoding="utf-8", errors="replace"))


def _parse_vtt(raw: str) -> list[dict]:
    def seconds(stamp: str) -> float:
        parts = stamp.replace(",", ".").split(":")
        parts = [float(p) for p in parts]
        while len(parts) < 3:
            parts.insert(0, 0.0)
        return parts[0] * 3600 + parts[1] * 60 + parts[2]

    cues, previous = [], None
    lines = raw.splitlines()
    for index, line in enumerate(lines):
        if "-->" not in line:
            continue
        left, _, right = line.partition("-->")
        try:
            start = seconds(left.strip().split()[0])
            end = seconds(right.strip().split()[0])
        except (ValueError, IndexError):
            continue
        body = []
        for follow in lines[index + 1:]:
            if "-->" in follow:
                break
            body.append(follow)

        # 유튜브 자동 자막은 2줄 롤링이다. 각 큐가 "이전 줄 + 새 줄"을 담는다.
        # 전부 이어붙이면 같은 말이 2~3번 들어가 말밀도가 초당 40자로 뻥튀기된다.
        # 마지막 비어 있지 않은 줄만 새 내용이다.
        cleaned = []
        for raw_line in body:
            line = re.sub(r"<[^>]*>", "", raw_line)      # <00:00:01.5><c> 태그
            line = html.unescape(line)                    # &gt;&gt; -> >>
            line = re.sub(r"\s+", " ", line).strip()
            if line:
                cleaned.append(line)
        if not cleaned:
            continue
        text = cleaned[-1]
        if text == previous:
            continue
        previous = text
        cues.append({"start": start, "end": end, "text": text})
    return cues


def _laugh_moments(cues: list[dict]) -> list[float]:
    """자막의 [웃음] [비명] 같은 마커 시각. ASR이 직접 붙인 표시라 음량 추정보다 정확하다."""
    return [c["start"] for c in cues if LAUGH_MARK.search(c["text"])]


# --- 신호 ------------------------------------------------------------------

def _loudness(audio: Path) -> list[tuple[float, float]]:
    """ffmpeg ebur128이 stderr로 뱉는 순간 음량(M)을 시계열로 만든다."""
    result = _run(["ffmpeg", "-nostats", "-i", str(audio),
                   "-filter_complex", "ebur128=peak=none", "-f", "null", "-"])
    if result is None:
        raise StepFailed("음량 분석이 시간 초과됐습니다")
    series = []
    for line in result.stderr.splitlines():
        match = re.search(r"t:\s*([\d.]+).*?M:\s*(-?[\d.]+)", line)
        if match:
            value = float(match.group(2))
            if value > -70:  # -120 은 무음 표기다
                series.append((float(match.group(1)), value))
    if not series:
        raise StepFailed("음량 시계열을 얻지 못했습니다")
    return series


def _percentile(sorted_values: list[float], ratio: float) -> float:
    index = min(len(sorted_values) - 1, max(0, int(len(sorted_values) * ratio)))
    return sorted_values[index]


def _peaks(series: list[tuple[float, float]]) -> list[float]:
    """음량 봉우리를 고른다.

    평균+표준편차로 자르면 안 된다. 방송 오디오는 압축돼 있어 위쪽 여유가 7dB 남짓인데
    무음 구간(-69dB)이 표준편차를 부풀려서 임계값이 최대값 위로 올라가 버린다.
    실측에서 median+1.1*sd 는 99백분위보다 높아 21,612개 중 2개만 통과했다.
    그래서 백분위로 자른다.
    """
    values = sorted(v for _, v in series)
    threshold = _percentile(values, PEAK_PERCENTILE)

    span = 40  # ±4초 안에서 가장 큰 값만 남긴다
    local_max = []
    for index, (time, value) in enumerate(series):
        if value < threshold:
            continue
        window = series[max(0, index - span): index + span]
        if value >= max(v for _, v in window):
            local_max.append((time, value))

    # 강한 것부터 집는다. 시간순으로 집으면 약한 봉우리가 먼저 자리를 차지해
    # 40초 안에 있는 더 강한 봉우리가 밀려난다.
    picked: list[float] = []
    for time, _ in sorted(local_max, key=lambda item: -item[1]):
        if all(abs(time - other) >= MIN_GAP for other in picked):
            picked.append(time)
    return sorted(picked)


def _silence_before(series: list[tuple[float, float]], moment: float) -> float:
    """봉우리 직전에 얼마나 조용했는지. 정적 뒤 반응에 가산점을 준다."""
    values = sorted(v for _, v in series)
    quiet = _percentile(values, 0.20)
    length = 0.0
    for time, value in reversed(series):
        if time >= moment:
            continue
        if value > quiet:
            break
        length = moment - time
        if length > 8:
            break
    return length


def _text_in(cues: list[dict], start: float, end: float) -> str:
    return " ".join(c["text"] for c in cues if c["start"] >= start and c["end"] <= end)


def _score(text: str, loud_gain: float, silence: float, laughs: int) -> tuple[float, dict]:
    """가중치는 근거 있는 값이 아니라 시작값이다. 결과를 보고 조정한다.

    웃음 마커를 가장 무겁게 둔다. ASR이 직접 붙인 표시라 다른 신호보다 정확하다.
    """
    marks = text.count("?") + text.count("!")
    exclaims = sum(text.count(word) for word in EXCLAIM)
    numbers = len(re.findall(r"\d+", text))
    density = len(text) / max(PRE + POST, 1)

    signals = {"웃음": laughs, "음량": round(loud_gain, 1), "정적": round(silence, 1),
               "물음표느낌표": marks, "감탄사": exclaims,
               "숫자": numbers, "말밀도": round(density, 2)}
    score = (laughs * 4.0 + loud_gain * 1.0 + silence * 0.8 + marks * 1.0
             + exclaims * 1.5 + numbers * 0.5 + density * 1.0)
    return round(score, 1), signals


# --- 프레임과 컨택트시트 ---------------------------------------------------

def _fetch_lowres(video_id: str) -> Path | None:
    """프레임 뽑기용 저화질 영상을 한 번 받는다.

    원격 스트림 URL에 seek 하는 방식은 못 쓴다. 36분 영상의 중반 지점 하나를 뽑는 데만
    120초가 넘게 걸렸고 20개 중 1개만 성공했다. 360p를 통째로 받으면 수십 MB지만
    이후 seek이 로컬 디스크라 즉시 끝나고, 캐시되니 재실행도 빠르다.
    """
    existing = [p for p in CACHE_DIR.glob(f"{video_id}-low.*") if p.stat().st_size > 0]
    if existing:
        return existing[0]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _ytdlp([f"https://www.youtube.com/watch?v={video_id}",
            "-f", "bestvideo[height<=360]/worstvideo/worst",
            "-o", str(CACHE_DIR / f"{video_id}-low.%(ext)s")])
    found = [p for p in CACHE_DIR.glob(f"{video_id}-low.*") if p.stat().st_size > 0]
    return found[0] if found else None


def _frames(video_id: str, moments: list[float], out_dir: Path) -> list[Path | None]:
    video = _fetch_lowres(video_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for moment in moments:
        # 순번으로 캐시하면 후보 목록이 바뀔 때 엉뚱한 프레임을 재사용한다. 시각으로 캐시한다.
        target = out_dir / f"{moment:.0f}s.jpg"
        if target.exists():
            paths.append(target)
            continue
        if video:
            _run(["ffmpeg", "-y", "-ss", f"{moment:.1f}", "-i", str(video),
                  "-frames:v", "1", "-q:v", "3", str(target)], timeout=120)
        paths.append(target if target.exists() else None)
    return paths


def _contact_sheet(candidates: list[dict], frames: list[Path | None], out: Path) -> None:
    try:
        font = ImageFont.truetype(FONT_PATH, 17)
        small = ImageFont.truetype(FONT_PATH, 15)
    except OSError:
        font = small = ImageFont.load_default()

    cell_w, cell_h, columns = 320, 244, 5
    rows = (len(candidates) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), "#14161a")
    draw = ImageDraw.Draw(sheet)

    for index, (item, frame) in enumerate(zip(candidates, frames)):
        x = (index % columns) * cell_w
        y = (index // columns) * cell_h
        if frame and frame.exists():
            sheet.paste(Image.open(frame).convert("RGB").resize((cell_w, 180)), (x, y))
        else:
            draw.rectangle([x + 2, y + 2, x + cell_w - 4, y + 178], outline="#c0392b", width=2)
        minutes, seconds = divmod(int(item["start"]), 60)
        draw.text((x + 6, y + 184), f"{index + 1}. {minutes}:{seconds:02d}  점수 {item['score']}",
                  fill="#ffd43b", font=font)
        draw.text((x + 6, y + 206), item["text"][:26] or "(자막 없음)", fill="#ecf0f1", font=small)
        draw.text((x + 6, y + 224),
                  f"웃음{item['signals']['웃음']} 음량+{item['signals']['음량']} "
                  f"감탄{item['signals']['감탄사']}", fill="#7f8c8d", font=small)

    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)


# --- 실행 ------------------------------------------------------------------

def _video_id(source: str) -> str:
    match = re.search(r"(?:v=|youtu\.be/|shorts/)([\w-]{11})", source)
    return match.group(1) if match else source


def run_standalone(source: str, day: str) -> None:
    video_id = _video_id(source)
    print(f"  소스: {video_id}")

    print("  오디오 받는 중...")
    audio = _fetch_audio(video_id)
    print("  자막 받는 중...")
    cues = _fetch_subs(video_id)
    print(f"    자막 {len(cues)}줄" + ("" if cues else " (없음 — 오디오 신호만 씁니다)"))

    print("  음량 분석 중...")
    series = _loudness(audio)
    values = [v for _, v in series]
    baseline = statistics.median(values)

    # 웃음 마커를 먼저 쓰고 음량 봉우리로 보충한다.
    laugh_times = _laugh_moments(cues)
    moments: list[float] = []
    for moment in sorted(laugh_times):
        if all(abs(moment - other) >= MIN_GAP for other in moments):
            moments.append(moment)
    audio_only = 0
    for moment in _peaks(series):
        if all(abs(moment - other) >= MIN_GAP for other in moments):
            moments.append(moment)
            audio_only += 1
    moments.sort()
    print(f"    웃음 마커 {len(laugh_times)}개 → 지점 {len(moments) - audio_only}개, "
          f"음량 봉우리로 {audio_only}개 보충")

    total = series[-1][0]
    candidates = []
    for moment in moments:
        # 인트로 타이틀 카드와 엔딩 인사는 소재가 안 된다
        if moment < SKIP_HEAD or moment > total - SKIP_TAIL:
            continue
        start = max(0.0, moment - PRE)
        end = min(total, moment + POST)
        if end - start < 20:
            continue
        loud = max(v for t, v in series if start <= t <= end) - baseline
        text = _text_in(cues, start, end)
        laughs = sum(1 for t in laugh_times if start <= t <= end)
        score, signals = _score(text, loud, _silence_before(series, moment), laughs)
        candidates.append({
            "start": round(start, 1), "end": round(end, 1), "peak": round(moment, 1),
            "score": score, "signals": signals, "text": text[:400],
        })

    candidates.sort(key=lambda c: -c["score"])
    candidates = candidates[:TOP_N]
    candidates.sort(key=lambda c: c["start"])
    if not candidates:
        raise StepFailed("후보 구간을 하나도 못 뽑았습니다. 다른 영상으로 시도하세요.")

    print(f"  대표 프레임 {len(candidates)}장 뽑는 중...")
    frames = _frames(video_id, [c["peak"] for c in candidates],
                     CACHE_DIR / f"{video_id}-frames")

    SEGMENT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"video_id": video_id, "url": f"https://www.youtube.com/watch?v={video_id}",
               "duration": round(total, 1), "candidates": candidates}
    (SEGMENT_DIR / f"{video_id}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    sheet = ROOT / day / f"00-구간후보-{video_id}.png"
    _contact_sheet(candidates, frames, sheet)

    print(f"\n  후보 {len(candidates)}개 → {sheet}")
    print(f"  구간 데이터 → {SEGMENT_DIR / f'{video_id}.json'}")
    print("  시트를 보고 쓸 구간 번호를 고르세요.")
