import base64
import hashlib
import html
import json
import os
import re
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlparse

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

with urlopen(f"{BASE}/detail-pages/{PROJECT_ID}/preview?output=1", timeout=60) as response:
    source = response.read().decode("utf-8")
match = re.search(r'<article\s+class="beauty-preview"[^>]*>.*?</article>', source, re.DOTALL)
assert match, "beauty preview article not found"
article = match.group(0)
css_path = web / "components" / "detail-pages" / "beauty-preview.css"
css = css_path.read_text(encoding="utf-8")
digests = set()
for name in names:
    asset = asset_dir / f"{name}.png"
    digest = hashlib.sha256(asset.read_bytes()).hexdigest()
    assert digest not in digests, f"duplicate image: {name}"
    digests.add(digest)
    uri = "data:image/png;base64," + base64.b64encode(asset.read_bytes()).decode("ascii")
    article, count = re.subn(rf'((?:src|data-src)=["\'])/detail-samples/lumen/{name}\.png', rf'\1{uri}', article)
    assert count == 1, f"expected one {name} image, found {count}"

project = json.loads((root / "상세페이지" / PROJECT_ID / "프로젝트.json").read_text(encoding="utf-8"))
for section in project["sections"]:
    assert f'data-design-text="section-{section["id"]}-title"' in article
assert article.count("<script") == 0 and article.count("data:image/png;base64,") == 5
assert "관리자" not in article and "detail-admin" not in article
assert re.search(r"(?:overlay|caption|label|문구|표시)", article, re.I), "display overlay text missing"
base_css = "body { margin: 0; } :root { --font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; } *, *::before, *::after { box-sizing: border-box; } a { color: inherit; text-decoration: none; }"
document = "<!-- generated snapshot -->\n<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>뷰티 리디자인 샘플</title><style>" + base_css + "\n" + css + "</style></head><body>" + article + "</body></html>\n"
output = root / "상세페이지" / PROJECT_ID / "화장품-리디자인.html"
output.write_text(document, encoding="utf-8")
print(f"output={output}")
print(f"bytes={output.stat().st_size}")
print(f"images={article.count('data:image/png;base64,')}")
print(f"unique_sha256={len(digests)}")
