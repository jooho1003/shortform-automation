from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import yaml

from ..paths import CONFIG, PIPELINE


class EditorError(RuntimeError):
    pass


class EditorPreflightError(EditorError):
    """No editor field was mutated before this failure."""


PROFILE = PIPELINE / "secrets" / "naver-profile"


def _playwright():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise EditorError("Playwright가 없습니다. .venv\\Scripts\\python -m pip install playwright 후 python -m playwright install chromium을 실행하세요.") from exc
    return sync_playwright


def _config() -> dict:
    path = CONFIG / "naver-editor.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
    url = str(data.get("editor_url", ""))
    host = (urlparse(url.replace("{blog_id}", "placeholder")).hostname or "").lower()
    if not url.startswith("https://") or not (host == "naver.com" or host.endswith(".naver.com")):
        raise EditorPreflightError("naver-editor.yaml editor_url은 네이버 HTTPS 주소여야 합니다.")
    selectors = data.get("selectors")
    if not isinstance(selectors, dict):
        selectors = {}
    data["selectors"] = selectors
    return data


def _screenshot(page, log_dir: Path, reason: str) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    target = log_dir / f"editor-{datetime.now():%Y%m%d-%H%M%S}-{reason}.png"
    try:
        page.screenshot(path=str(target), full_page=True)
    except Exception:
        pass
    return target


def login() -> None:
    PROFILE.mkdir(parents=True, exist_ok=True)
    sync_playwright = _playwright()
    with sync_playwright() as manager:
        context = manager.chromium.launch_persistent_context(str(PROFILE), headless=False)
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://nid.naver.com/nidlogin.login", wait_until="domcontentloaded")
        print("브라우저에서 직접 로그인하세요. 비밀번호·쿠키는 파이프라인 로그에 저장하지 않습니다.")
        print("로그인을 확인한 뒤 브라우저 창을 닫으면 종료됩니다.")
        try:
            while context.pages:
                time.sleep(1)
        finally:
            context.close()


def save_draft(*, blog_id: str, title: str, body: str, tags: list[str], images: list[Path], log_dir: Path) -> dict:
    cfg = _config()
    selectors = cfg["selectors"]
    required = ["ready", "title", "body", "tag", "save_draft"]
    missing = [name for name in required if not isinstance(selectors.get(name), str) or not selectors[name].strip()]
    if missing:
        raise EditorPreflightError(f"naver-editor.yaml 셀렉터가 비었습니다: {', '.join(missing)}")
    if images and (not isinstance(selectors.get("image_input"), str) or not selectors["image_input"].strip()):
        raise EditorPreflightError("이미지가 있지만 image_input 셀렉터가 비었습니다.")
    if not PROFILE.exists():
        raise EditorPreflightError("네이버 로그인 프로필이 없습니다. 먼저 blog login을 실행하세요.")
    PROFILE.mkdir(parents=True, exist_ok=True)
    sync_playwright = _playwright()
    with sync_playwright() as manager:
        context = manager.chromium.launch_persistent_context(str(PROFILE), headless=False)
        page = context.pages[0] if context.pages else context.new_page()
        mutated = False
        try:
            timeout = int(cfg.get("timeouts", {}).get("selector_ms", 10000))
            page.goto(str(cfg["editor_url"]).replace("{blog_id}", blog_id), wait_until="domcontentloaded", timeout=int(cfg.get("timeouts", {}).get("navigation_ms", 30000)))
            target = page
            iframe = str(cfg.get("iframe", "")).strip()
            if iframe:
                page.wait_for_selector(iframe, state="attached", timeout=timeout)
                target = page.frame_locator(iframe)
            # Every selector is checked before the first fill/click. A DOM change therefore cannot create a partial draft.
            for name in required:
                target.locator(selectors[name]).wait_for(state="visible", timeout=timeout)
            if images:
                target.locator(selectors["image_input"]).wait_for(state="attached", timeout=timeout)
        except Exception as exc:
            shot = _screenshot(page, log_dir, "preflight")
            context.close()
            raise EditorPreflightError(f"에디터 셀렉터 확인 실패. 아무것도 입력하지 않았습니다. 스크린샷: {shot.name}") from exc
        try:
            target.locator(selectors["title"]).fill(title)
            target.locator(selectors["body"]).fill(body)
            mutated = True
            if images:
                target.locator(selectors["image_input"]).set_input_files([str(path) for path in images])
            if tags:
                target.locator(selectors["tag"]).fill(" ".join(tags))
            target.locator(selectors["save_draft"]).click()
            saved = str(selectors.get("saved", "")).strip()
            if saved:
                target.locator(saved).wait_for(state="visible", timeout=int(cfg.get("timeouts", {}).get("selector_ms", 10000)))
            page.wait_for_timeout(800)
            shot = _screenshot(page, log_dir, "drafted")
            return {"state": "drafted", "screenshot": shot.name}
        except Exception as exc:
            shot = _screenshot(page, log_dir, "unknown" if mutated else "preflight")
            if mutated:
                raise EditorError(f"임시저장 결과를 확인할 수 없습니다. 네이버 임시저장함을 직접 확인하세요. 스크린샷: {shot.name}") from exc
            raise EditorPreflightError(f"에디터 입력 전 실패. 스크린샷: {shot.name}") from exc
        finally:
            context.close()
