"""상세페이지 섹션 영상 단계 — 시드 이미지 → fal i2v → mp4 + 포스터 → 검사.

두 가지 소재 경로를 지원한다(사용자 결정).
  source: image — 이미 만든 섹션 이미지를 그대로 i2v 시드로 쓴다. 섹션당 fal 1회.
  source: sheet — 제품 레퍼런스 시트(제품 다각도 한 장)를 먼저 만들고, 그 시트를 참조로
                  섹션별 키프레임을 뽑은 뒤 i2v에 넣는다. A안 캐릭터 시트와 같은 구조다.

영상은 상세페이지 폴더 안에 파일로 남기고 HTML은 상대 경로로 참조한다(data URI 인라인 금지 —
3초 영상 다섯 개만 넣어도 HTML이 50MB를 넘긴다).

  상세페이지/{id}/이미지/{섹션}.png   시드 이미지
  상세페이지/{id}/시트.png            제품 레퍼런스 시트 (source: sheet)
  상세페이지/{id}/영상/{섹션}.mp4     결과 영상
  상세페이지/{id}/영상/{섹션}.png     포스터(첫 프레임)
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import yaml

from .. import MissingKey, StepFailed
from .. import codex
from .. import fal
from ..paths import CONFIG, ROOT
from .check_detail_media import check_media

PROJECTS = ROOT / "상세페이지"
SHEET = "시트.png"
MEDIA_DIR = "영상"
SEED_DIR = "이미지"


def _config() -> dict:
    path = CONFIG / "detail-video.yaml"
    if not path.exists():
        raise StepFailed(f"설정이 없습니다: {path}")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def project_dir(project_id: str) -> Path:
    d = PROJECTS / project_id
    if not (d / "프로젝트.json").is_file():
        raise StepFailed(f"프로젝트를 찾을 수 없습니다: {d / '프로젝트.json'}")
    return d


def load_project(project_id: str) -> dict:
    return json.loads((project_dir(project_id) / "프로젝트.json").read_text(encoding="utf-8"))


def _sheet_prompt(project: dict, out: Path, hint: str) -> str:
    """제품 레퍼런스 시트. 인물이 아니라 제품의 정식 외형을 고정하는 것이 목적이다."""
    return (
        f"이미지 생성 도구({hint})로 제품 레퍼런스 시트 PNG 한 장을 만들어 정확히 이 경로에 저장하세요: {out}\n"
        "다른 파일은 만들지 마세요. 코드 작성이나 설명 대신 이미지 생성 결과 파일만 남기면 됩니다.\n\n"
        "규격: 정사각 1:1, 최소 1600x1600. 한 장 안에 같은 제품 하나를 정면·3/4·측면·후면, "
        "패키지 단독, 재질·마감 클로즈업으로 격자 배치하세요. 모든 칸은 하나의 고정된 정식 디자인을 "
        "같은 모습으로 보여야 합니다. 색상 변형, 대체 디자인, 다른 용량, 여러 제품을 만들지 마세요.\n"
        "흰 배경, 균일한 스튜디오 조명, 라벨 텍스트 최소, 워터마크 없음.\n\n"
        f"제품: {project.get('product', '')}\n"
        f"브랜드·색상·스타일: {project.get('brand', '')}\n"
        f"확인된 제품 정보: {project.get('facts', '')}\n"
        f"제공 자산·사용 조건: {project.get('assetNotes', '')}\n\n"
        "확인되지 않은 수치·효능·인증·후기를 이미지 안에 넣지 마세요."
    )


def _keyframe_prompt(project: dict, section: dict, video: dict, sheet: Path, out: Path, hint: str) -> str:
    return (
        f"첨부한 제품 레퍼런스 시트({sheet.name})의 제품을 그대로 써서, 이미지 생성 도구({hint})로 "
        f"'{section.get('title', '')}' 섹션의 키프레임 PNG를 만들어 정확히 이 경로에 저장하세요: {out}\n"
        "다른 파일은 만들지 마세요.\n\n"
        "이 이미지는 움직임이 시작되기 직전의 단 하나의 시작 프레임입니다. 한 장의 연속된 장면만 만들고, "
        "분할 패널·콜라주·컨택트시트·대체 구도를 만들지 마세요.\n"
        "규격: 가로 3:2, 최소 1800x1200, 워터마크 없음. 시트에 정의된 제품 형태·비율·색상·라벨을 정확히 보존하세요.\n"
        f"연출: {section.get('visual', '')}\n"
        f"이어질 움직임: {video.get('motion', '')}\n\n"
        "이미지 안에 문자를 넣지 마세요. 카피는 편집 단계에서 배치합니다. "
        "확인되지 않은 수치·효능·인증·후기를 만들지 마세요."
    )


def _video_prompt(project: dict, section: dict, video: dict) -> str:
    """상세페이지용 프롬프트. 숏폼과 달리 '거의 움직이지 않는' 쪽이 기본이다."""
    return (
        "Generate one continuous product video from the supplied still. Keep the product identity, shape, "
        "proportions, color, label text, and packaging exactly as in the reference image. "
        "Do not make a montage, cut, split screen, time jump, or style change.\n"
        "Motion must be subtle and premium — a slow camera push, a gentle parallax, or the natural flow of "
        "liquid or fabric. Do not add people, hands, text, logos, watermarks, or new objects.\n\n"
        f"PRODUCT: {project.get('product', '')}\n"
        f"BRAND STYLE: {project.get('brand', '')}\n"
        f"SCENE: {section.get('visual', '')}\n"
        f"MOTION: {video.get('motion', '')}\n"
        f"DURATION: {video.get('seconds', 4):g} seconds\n\n"
        "NEGATIVE: extra products, duplicated bottles, morphing shapes, label distortion, invented text, "
        "certification marks, before-after comparison, rapid cuts, camera shake."
    )


def _poster(src: Path, dst: Path) -> None:
    """첫 프레임을 포스터로 뽑는다. 영상이 로드되기 전 레이아웃이 무너지지 않게 한다."""
    res = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-frames:v", "1", str(dst)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if res.returncode != 0:
        raise StepFailed(f"포스터 추출 실패 {src.name}: {res.stderr[-300:]}")


def _resolve_seed(base: Path, seed: str) -> Path:
    """시드 경로는 프로젝트 폴더 안으로 제한한다. 임의 파일을 fal 로 올리지 않는다."""
    if not seed:
        raise StepFailed("시드 이미지 경로(seed)가 비어 있습니다.")
    path = (base / seed).resolve()
    if path != base.resolve() and base.resolve() not in path.parents:
        raise StepFailed(f"시드 이미지는 프로젝트 폴더 안이어야 합니다: {seed}")
    if not path.is_file():
        raise StepFailed(f"시드 이미지가 없습니다: {path}")
    return path


def _sections_with_video(project: dict) -> list[tuple[dict, dict]]:
    return [(s, s["video"]) for s in project.get("sections", []) if isinstance(s.get("video"), dict)]


def run(project_id: str) -> dict:
    base = project_dir(project_id)
    project = load_project(project_id)
    cfg = _config()
    hint = cfg.get("image_model_hint", "gpt-image")
    media = base / MEDIA_DIR
    media.mkdir(parents=True, exist_ok=True)

    targets = _sections_with_video(project)
    if not targets:
        print("  영상을 넣을 섹션이 없습니다.")
        return check_media(media)

    todo = [(s, v) for s, v in targets if not (base / v["file"]).is_file()]
    est = len(todo) * float(cfg.get("cost_per_section_usd", 0.6))
    cap = float(cfg.get("max_cost_per_project_usd", 6))
    print(f"  생성할 섹션 {len(todo)}개 · 예상 ${est:.2f} (상한 ${cap:.0f})")
    if not todo:
        print("  모든 섹션 영상이 이미 있습니다.")
        return check_media(media, [Path(v["file"]).name for _, v in targets])
    if est > cap:
        raise StepFailed(
            f"프로젝트 비용 상한 ${cap:.0f}를 넘깁니다 (예상 ${est:.2f}). "
            "config/detail-video.yaml 을 조정하거나 영상 섹션을 줄이세요."
        )
    key = os.environ.get("FAL_KEY")
    if not key:
        raise MissingKey("FAL_KEY 가 없습니다. https://fal.ai/dashboard/keys 에서 발급해 pipeline/.env 에 넣으세요.")

    # source: sheet 가 하나라도 있으면 제품 시트를 먼저 확보한다. 시트는 프로젝트당 한 장이다.
    sheet = base / SHEET
    if any(v.get("source") == "sheet" for _, v in todo) and not sheet.exists():
        print("  제품 레퍼런스 시트 생성 중 (codex)...")
        codex.run(_sheet_prompt(project, sheet, hint), base, [], cfg)
        if not sheet.exists():
            raise StepFailed(
                f"제품 레퍼런스 시트가 없습니다: {sheet}\n"
                "  codex가 이미지를 만들지 못했습니다. 직접 만들어 이 이름으로 넣고 다시 실행하세요."
            )

    failed: list[str] = []
    for section, video in todo:
        sid = section["id"]
        out = base / video["file"]
        source = video.get("source", "image")
        try:
            if source == "sheet":
                keyframe = base / SEED_DIR / f"{sid}.png"
                if not keyframe.exists():
                    print(f"  {sid} 키프레임 생성 중 (codex, 시트 참조)...")
                    keyframe.parent.mkdir(parents=True, exist_ok=True)
                    codex.run(_keyframe_prompt(project, section, video, sheet, keyframe, hint), base, [sheet], cfg)
                if not keyframe.exists():
                    raise StepFailed(f"키프레임이 없습니다: {keyframe}")
            else:
                keyframe = _resolve_seed(base, video.get("seed", ""))

            print(f"  {sid} 영상 생성 (fal, source={source})...")
            fal.generate(cfg, key, out, {
                "prompt": _video_prompt(project, section, video),
                "keyframe": fal.data_uri(keyframe),
                "sheet": fal.data_uri(sheet) if sheet.exists() else "",
            })
            _poster(out, base / video["poster"])
        except StepFailed as exc:
            print(f"  ! {sid} 실패: {exc}")
            failed.append(sid)

    report = check_media(media, [Path(v["file"]).name for _, v in targets])
    print(f"  검사: 파일 {len(report['files'])}개 · 누락 {report['missing']} · 문제 {report['problems']}")
    if failed:
        raise StepFailed(f"실패한 섹션: {failed}. 직접 만들어 해당 경로에 넣고 다시 실행하세요.")
    return report
