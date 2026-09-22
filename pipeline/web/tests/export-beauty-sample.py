import base64
import hashlib
import html
import json
import os
import re
import shutil
import sys
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlparse

# 한국어 Windows 콘솔은 cp949라 경로와 기호가 깨진다 (cli.py 와 같은 처리).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

BASE = os.environ.get("DETAIL_PAGES_BASE_URL", "http://localhost:3123").rstrip("/")
if urlparse(BASE).hostname not in ("localhost", "127.0.0.1", "::1"):
    raise RuntimeError("DETAIL_PAGES_BASE_URL must target localhost")
PROJECT_ID = "db6b2f93-2d77-436c-b560-8d9ab2208102"
web = Path(__file__).resolve().parents[1]
root = Path(os.environ.get("SHORTFORM_ROOT", web.parents[1])).resolve()
asset_dir = web / "public" / "detail-samples" / "lumen"
names = ("hero", "texture", "cgi", "ritual", "pack")
missing = [name for name in names if not (asset_dir / f"{name}.png").is_file()]
if missing:
    raise SystemExit("waiting for assets: " + ", ".join(missing))

sys.path.insert(0, str(web.parent))
from shortform import r2  # noqa: E402  (경로를 먼저 잡아야 import 된다)

project_dir = root / "상세페이지" / PROJECT_ID
project = json.loads((project_dir / "프로젝트.json").read_text(encoding="utf-8"))

with urlopen(f"{BASE}/detail-pages/{PROJECT_ID}/preview?output=1", timeout=60) as response:
    source = response.read().decode("utf-8")
match = re.search(r'<article\s+class="beauty-preview"[^>]*>.*?</article>', source, re.DOTALL)
assert match, "beauty preview article not found"
article = match.group(0)
css_path = web / "components" / "detail-pages" / "beauty-preview.css"
css = css_path.read_text(encoding="utf-8")

# 이미지는 지금까지처럼 인라인한다. 영상은 파일로 두고 상대 경로로 참조한다 —
# 3초 클립 몇 개만 data URI로 넣어도 HTML이 수십 MB가 되어 브라우저가 버티지 못한다.
digests = set()
for name in names:
    asset = asset_dir / f"{name}.png"
    digest = hashlib.sha256(asset.read_bytes()).hexdigest()
    assert digest not in digests, f"duplicate image: {name}"
    digests.add(digest)
    uri = "data:image/png;base64," + base64.b64encode(asset.read_bytes()).decode("ascii")
    article, count = re.subn(rf'((?:src|data-src)=["\'])/detail-samples/lumen/{name}\.png', rf'\1{uri}', article)
    # 해당 슬롯이 영상으로 바뀌었으면 이미지 태그가 없는 것이 정상이다.
    assert count <= 1, f"expected at most one {name} image, found {count}"


# 기본 납품 폴더는 프로젝트 폴더 자체다(영상이 이미 그 안에 있으므로 복사가 필요 없다).
# DETAIL_EXPORT_DIR 로 다른 폴더에 모아 내보낼 수 있다.
out_dir = Path(os.environ["DETAIL_EXPORT_DIR"]).resolve() if os.environ.get("DETAIL_EXPORT_DIR") else project_dir


def place_media(rel: str) -> None:
    src = project_dir / rel
    if not src.is_file():
        raise SystemExit(f"missing media file: {src}")
    dst = out_dir / rel
    if dst.resolve() == src.resolve():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


videos = [s["video"] for s in project["sections"] if isinstance(s.get("video"), dict)]
# data-media-rel / data-poster-rel 은 프리뷰 컴포넌트가 붙여 둔 표식이다. /api/media 쿼리 URL을
# 납품 폴더 기준 상대 경로로 바꾸고, 실제 파일을 같은 폴더 구조로 복사한다.
# R2 설정이 있으면 버킷에 올리고 공개 URL을 쓴다. 없으면 지금까지처럼 상대 경로 + 폴더 납품.
# 버킷 키에 리비전을 넣어 같은 파일을 덮어쓰지 않게 한다(캐시를 길게 잡기 때문).
uploads: dict[str, str] = {}
if r2.configured():
    prefix = f"상세페이지/{PROJECT_ID}/rev{project['revision']}"
    to_upload = {rel: project_dir / rel for v in videos for rel in (v["file"], v["poster"])}
    if to_upload:
        print(f"R2 업로드 → {prefix}")
        uploads = r2.upload(to_upload, prefix)
else:
    print("R2 미설정 — 상대 경로로 내보냅니다.")

for attr, rel_attr in (("src", "data-media-rel"), ("poster", "data-poster-rel")):
    for m in list(re.finditer(rf'{rel_attr}="([^"]+)"', article)):
        rel = html.unescape(m.group(1))
        tag_start = article.rfind("<video", 0, m.start())
        tag_end = article.find(">", m.start())
        assert tag_start >= 0 and tag_end > tag_start, f"video tag not found for {rel}"
        tag = article[tag_start:tag_end]
        target = uploads.get(rel, f"./{rel}")
        new_tag = re.sub(rf'{attr}="[^"]*"', f'{attr}="{target}"', tag, count=1)
        article = article[:tag_start] + new_tag + article[tag_start + len(tag):]

# 버킷에 올렸으면 납품 폴더에 영상을 복사할 필요가 없다.
if not uploads:
    for video in videos:
        place_media(video["file"])
        place_media(video["poster"])

for section in project["sections"]:
    assert f'data-design-text="section-{section["id"]}-title"' in article
assert article.count("<script") == 0
assert article.count("data:image/png;base64,") == len(names) - len(videos)
assert "data:video/" not in article, "video must stay an external file"
assert "/api/media" not in article, "media URLs must be rewritten to relative or bucket paths"
assert "관리자" not in article and "detail-admin" not in article
assert re.search(r"(?:overlay|caption|label|문구|표시)", article, re.I), "display overlay text missing"
base_css = "body { margin: 0; } :root { --font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; } *, *::before, *::after { box-sizing: border-box; } a { color: inherit; text-decoration: none; }"
document = "<!-- generated snapshot -->\n<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>뷰티 리디자인 샘플</title><style>" + base_css + "\n" + css + "</style></head><body>" + article + "</body></html>\n"
out_dir.mkdir(parents=True, exist_ok=True)
output = out_dir / "화장품-리디자인.html"
output.write_text(document, encoding="utf-8")
print(f"output={output}")
print(f"bytes={output.stat().st_size}")
print(f"images={article.count('data:image/png;base64,')}")
print(f"videos={len(videos)} ({'R2' if uploads else '로컬 상대 경로'})")
print(f"unique_sha256={len(digests)}")
