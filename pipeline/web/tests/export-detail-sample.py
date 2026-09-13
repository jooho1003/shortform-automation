import base64
import html
import json
import os
import re
from pathlib import Path
from urllib.request import urlopen

BASE = os.environ.get("DETAIL_PAGES_BASE_URL", "http://localhost:3123").rstrip("/")
if __import__("urllib.parse", fromlist=["urlparse"]).urlparse(BASE).hostname not in ("localhost", "127.0.0.1", "::1"):
    raise RuntimeError("DETAIL_PAGES_BASE_URL must target localhost")
PROJECT_ID = "90a6d633-6baf-4473-8a70-80bd6822a9de"
web = Path(__file__).resolve().parents[1]
root = Path(os.environ.get("SHORTFORM_ROOT", web.parents[1])).resolve()
article_re = re.compile(r'<article\s+class="detail-preview">.*?</article>', re.DOTALL)

with urlopen(f"{BASE}/detail-pages/{PROJECT_ID}/preview", timeout=10) as response:
    source = response.read().decode("utf-8")
match = article_re.search(source)
assert match, "detail preview article not found"
article = match.group(0)
css = (web / "app" / "detail-pages" / "[id]" / "preview" / "preview.css").read_text(encoding="utf-8")
asset = web / "public" / "detail-samples" / "ongi-mug.png"
assert asset.is_file(), f"missing asset: {asset}"
data_uri = "data:image/png;base64," + base64.b64encode(asset.read_bytes()).decode("ascii")
article = article.replace('src="/detail-samples/ongi-mug.png"', f'src="{data_uri}"')
article = re.sub(r'((?:href|src)=["\'])/detail-pages/([^"\']+)', rf'\1{BASE}/detail-pages/\2', article)
assert "<script" not in article.lower()

project = json.loads((root / "상세페이지" / PROJECT_ID / "프로젝트.json").read_text(encoding="utf-8"))
for section in project["sections"]:
    assert html.unescape(section["title"]) in html.unescape(article)
assert article.count("<img") == 3
assert article.count("data:image/png;base64,") == 3

base_css = "body { margin: 0; } :root { --font: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; } *, *::before, *::after { box-sizing: border-box; } a { color: inherit; text-decoration: none; }"
document = "<!-- generated snapshot -->\n<!doctype html>\n<html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>온기 머그 상세페이지 샘플</title><style>" + base_css + "\n" + css + "</style></head><body>" + article + "</body></html>\n"
output = root / "상세페이지" / PROJECT_ID / "결과.html"
output.write_text(document, encoding="utf-8")
assert output.is_file()
