"""조사. 기획 전에 반드시 돌아야 하는 단계.

하이타치(@hi_tachy) 방식대로 소스를 한 채널에 고정하지 않고 인물 축으로 묶는다.
매주 이 단계를 돌려 (1) 그 주에 조회수가 오른 롱폼과 (2) 벤치마크 채널이 최근 잘 뽑은
숏폼을 모은다. `plan` 단계는 이 리포트가 없거나 오래되면 멈춘다.
"""

from __future__ import annotations

import json
import statistics
import subprocess
import sys
from datetime import datetime

import yaml

from .. import StepFailed
from ..paths import CONFIG, DATA, ROOT

RESEARCH_DIR = DATA / "research"


def _config() -> dict:
    return yaml.safe_load((CONFIG / "research.yaml").read_text(encoding="utf-8"))


def week_id(when: datetime | None = None) -> str:
    year, week, _ = (when or datetime.now()).isocalendar()
    return f"{year}-W{week:02d}"


def report_path(when: datetime | None = None):
    return RESEARCH_DIR / f"{week_id(when)}.json"


def _rows(url: str, tab: str, limit: int) -> list[dict]:
    try:
        out = subprocess.run(
            [sys.executable, "-m", "yt_dlp", f"{url}/{tab}", "--flat-playlist",
             "--dump-json", "--playlist-end", str(limit), "--no-warnings"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=180,
        )
    except subprocess.TimeoutExpired:
        return []
    return [json.loads(l) for l in out.stdout.splitlines() if l.strip().startswith("{")]


def _summarize(rows: list[dict], top: int) -> list[dict]:
    """조회수 상위만 남긴다. 채널 목록은 최신순이라 상위 = 최근 것 중 잘 된 것."""
    ranked = sorted(rows, key=lambda r: -(r.get("view_count") or 0))[:top]
    return [
        {
            "id": r.get("id"),
            "title": (r.get("title") or "")[:120],
            "views": r.get("view_count") or 0,
            "duration": r.get("duration"),
            "url": f"https://www.youtube.com/watch?v={r.get('id')}",
        }
        for r in ranked
    ]


def _markdown(data: dict) -> str:
    lines = [
        f"# 주간 조사 리포트 {data['week']}",
        "",
        f"작성: {data['generated']}",
        f"인물 축: {data['axis']}",
        f"이번 주 목표: {data['weekly_target']}편",
        "",
        "## 1. 소재 후보 — 소스 채널의 최근 롱폼 중 조회수 상위",
        "",
    ]
    if not data["sources"]:
        lines += ["소스 채널이 설정되지 않았습니다. `pipeline/config/research.yaml`의",
                  "`source_channels`를 채우세요.", ""]
    for source in data["sources"]:
        lines.append(f"### {source['name']}")
        lines.append("")
        if not source["items"]:
            lines += ["조회 실패 또는 결과 없음", ""]
            continue
        lines.append("| 조회 | 길이 | 제목 |")
        lines.append("|---:|---:|---|")
        for item in source["items"]:
            minutes = f"{(item['duration'] or 0) // 60}분" if item["duration"] else "-"
            lines.append(f"| {item['views']:,} | {minutes} | [{item['title']}]({item['url']}) |")
        lines.append("")

    lines += ["## 2. 벤치마크 — 경쟁 채널이 최근 잘 뽑은 숏폼", "",
              "어떤 장면과 제목이 먹혔는지 본다. 그대로 베끼지 않고 구조만 가져온다.", ""]
    for bench in data["benchmarks"]:
        lines.append(f"### {bench['name']}  (중앙 {bench['views_median']:,} / 최대 {bench['views_max']:,})")
        lines.append("")
        lines.append("| 조회 | 제목 |")
        lines.append("|---:|---|")
        for item in bench["items"]:
            lines.append(f"| {item['views']:,} | [{item['title']}]({item['url']}) |")
        lines.append("")

    if data.get("own"):
        own = data["own"]
        lines += ["## 3. 우리 채널 지난 성과", "",
                  f"최근 {own['count']}편 · 중앙 {own['views_median']:,} · 최대 {own['views_max']:,}", "",
                  "| 조회 | 제목 |", "|---:|---|"]
        for item in own["items"]:
            lines.append(f"| {item['views']:,} | {item['title']} |")
        lines.append("")

    lines += [
        "## 4. 다음",
        "",
        f"위 후보 중 {data['weekly_target']}개를 골라 편 폴더를 만들고 기획안을 쓴다.",
        "이 리포트는 " + str(data["freshness_days"]) + "일간 유효하다. 지나면 조사를 다시 한다.",
    ]
    return "\n".join(lines)


def run_standalone() -> None:
    config = _config()
    axis = config.get("axis", {})
    RESEARCH_DIR.mkdir(parents=True, exist_ok=True)

    print(f"  인물 축: {axis.get('name')}  {axis.get('people') or ''}")

    sources = []
    for source in config.get("source_channels") or []:
        print(f"  롱폼 조회: {source['name']}")
        rows = _rows(source["url"], "videos", 15)
        sources.append({"name": source["name"], "url": source["url"],
                        "items": _summarize(rows, 6)})

    benchmarks = []
    for bench in config.get("benchmark_channels") or []:
        print(f"  벤치마크 조회: {bench['name']}")
        rows = _rows(bench["url"], "shorts", 30)
        views = [r.get("view_count") or 0 for r in rows] or [0]
        benchmarks.append({
            "name": bench["name"], "url": bench["url"],
            "views_median": int(statistics.median(views)),
            "views_max": max(views),
            "items": _summarize(rows, 8),
        })

    own = None
    if config.get("own_channel"):
        print("  우리 채널 조회")
        rows = _rows(config["own_channel"], "shorts", 30)
        if rows:
            views = [r.get("view_count") or 0 for r in rows]
            own = {"count": len(rows),
                   "views_median": int(statistics.median(views)),
                   "views_max": max(views),
                   "items": _summarize(rows, 8)}

    data = {
        "week": week_id(),
        "generated": datetime.now().isoformat(timespec="seconds"),
        "axis": f"{axis.get('name')} {axis.get('people') or ''}".strip(),
        "weekly_target": config.get("weekly_target", 3),
        "freshness_days": config.get("freshness_days", 7),
        "sources": sources,
        "benchmarks": benchmarks,
        "own": own,
    }
    report_path().write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    day_dir = ROOT / datetime.now().strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    md = day_dir / "00-조사리포트.md"
    md.write_text(_markdown(data), encoding="utf-8")

    print(f"  조사 완료 → {md}")
    if not sources:
        print("  ! 소스 채널이 비어 있습니다. config/research.yaml 을 채우세요.")


def latest() -> tuple[dict | None, int]:
    """가장 최근 조사 리포트와 며칠 지났는지를 돌려준다."""
    if not RESEARCH_DIR.exists():
        return None, 999
    files = sorted(RESEARCH_DIR.glob("*.json"))
    if not files:
        return None, 999
    data = json.loads(files[-1].read_text(encoding="utf-8"))
    generated = datetime.fromisoformat(data["generated"])
    return data, (datetime.now() - generated).days


def require_fresh() -> dict:
    """기획 전에 조사가 있었는지, 그리고 묵지 않았는지 확인한다."""
    data, age = latest()
    limit = _config().get("freshness_days", 7)
    if data is None:
        raise StepFailed(
            "조사 리포트가 없습니다. 기획 전에 조사를 먼저 합니다.\n"
            "  python -m shortform research"
        )
    if age > limit:
        raise StepFailed(
            f"조사 리포트가 {age}일 지났습니다 (유효 {limit}일).\n"
            "  python -m shortform research 로 다시 조사하세요."
        )
    return data


def run(ep) -> None:
    run_standalone()
