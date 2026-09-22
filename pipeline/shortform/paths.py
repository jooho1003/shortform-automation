"""편 폴더와 승인 파일 경로 규칙. 설계 문서 3절을 코드로 옮긴 것."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # 숏폼/
PIPELINE = ROOT / "pipeline"
CONFIG = PIPELINE / "config"
DATA = PIPELINE / "data"
SECRETS = PIPELINE / "secrets"
BGM = PIPELINE / "assets" / "bgm"


def load_dotenv() -> None:
    """pipeline/.env 를 환경변수로 올린다. 이미 있는 셸 환경변수는 덮어쓰지 않는다.

    web/lib/paths.ts 의 loadDotEnv() 와 같은 역할. 웹에서 돌릴 때는 그쪽이 자식 프로세스에
    넣어 주지만, CLI나 내보내기 스크립트를 직접 실행할 때는 아무도 안 읽어 준다.
    """
    path = PIPELINE / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", raw)
        if not match:
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if value and not value.startswith("#"):
            os.environ.setdefault(match.group(1), value)


@dataclass(frozen=True)
class Episode:
    date: str
    track: str
    num: str
    dir: Path

    @classmethod
    def find(cls, date: str, track: str, num: str) -> "Episode":
        base = ROOT / date
        hits = sorted(base.glob(f"{track}-{num}-*"))
        if not hits:
            raise FileNotFoundError(f"{base}\{track}-{num}-* 폴더가 없습니다.")
        return cls(date, track, num, hits[0])

    @classmethod
    def create(cls, date: str, track: str, num: str, slug: str) -> "Episode":
        d = ROOT / date / f"{track}-{num}-{slug}"
        is_new = not d.exists()
        d.mkdir(parents=True, exist_ok=True)
        ep = cls(date, track, num, d)
        if is_new:
            from .tts.episode import load_voice
            load_voice(ep, freeze=True, inherit_default=True)
        return ep

    # --- 산출물 ---
    @property
    def plan_md(self) -> Path:
        return self.dir / "01-기획안.md"

    @property
    def clips_dir(self) -> Path:
        return self.dir / "02-이미지"

    @property
    def contact_sheet(self) -> Path:
        return self.clips_dir / "컨택트시트.png"

    @property
    def clip_list(self) -> Path:
        return self.clips_dir / "클립목록.json"

    @property
    def assets_dir(self) -> Path:
        return self.dir / "03-소재"

    @property
    def render_config(self) -> Path:
        """렌더 경로 선택. {"route": "remotion" | "capcut"}. 없으면 remotion."""
        return self.dir / "렌더설정.json"

    @property
    def video_dir(self) -> Path:
        return self.dir / "04-영상"

    @property
    def final_mp4(self) -> Path:
        return self.video_dir / "final.mp4"

    @property
    def result_json(self) -> Path:
        return self.dir / "05-업로드결과.json"

    @property
    def state_json(self) -> Path:
        return self.dir / "상태.json"

    # --- 게이트 ---
    @property
    def plan_ok(self) -> Path:
        return self.dir / "01-기획-승인.txt"

    @property
    def plan_fix(self) -> Path:
        return self.dir / "01-기획-수정요청.txt"

    @property
    def clips_ok(self) -> Path:
        return self.dir / "02-이미지-승인.txt"

    @property
    def clips_fix(self) -> Path:
        return self.dir / "02-이미지-수정요청.txt"

    @property
    def upload_ok(self) -> Path:
        return self.dir / "04-업로드-승인.txt"
