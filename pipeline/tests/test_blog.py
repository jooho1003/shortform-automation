from __future__ import annotations

import base64
import hashlib
import hmac
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from shortform import inspect as inspector
from shortform.blog import images, keywords, naver_api, naver_editor, publish, serp


@pytest.fixture
def blog_project(tmp_path, monkeypatch):
    root = tmp_path
    config = root / "pipeline" / "config"
    data = root / "pipeline" / "data"
    config.mkdir(parents=True)
    (config / "blog.yaml").write_text(yaml.safe_dump({"blog_id":"owner","draft_enabled":True,"max_posts_per_day":1,"min_hours_between_posts":12}, allow_unicode=True), encoding="utf-8")
    project_id = "20260918-test"
    directory = root / "블로그" / project_id
    (directory / "이미지").mkdir(parents=True)
    body = directory / "본문.md"
    body.write_text("## 소제목\n\n검증된 본문", encoding="utf-8")
    image = directory / "이미지" / "01.png"
    image.write_bytes(b"image")
    images = [{"n":1,"file":"이미지/01.png","alt":"설명","prompt":"p","kind":"body"}]
    (directory / "이미지" / "이미지.json").write_text(json.dumps(images, ensure_ascii=False), encoding="utf-8")
    project = {"id":project_id,"title":"제목","tags":[],"status":"ready","revision":1,"publish":{"mode":"draft","post_url":None,"published_at":None}}
    (directory / "프로젝트.json").write_text(json.dumps(project, ensure_ascii=False), encoding="utf-8")
    snapshot = {"body_sha256": hashlib.sha256(body.read_bytes()).hexdigest(), "images":[{"file":"이미지/01.png","sha256":hashlib.sha256(image.read_bytes()).hexdigest()}]}
    (directory / "02-원고-승인.txt").write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    (directory / "점검.json").write_text(json.dumps({"errors":[]}), encoding="utf-8")
    monkeypatch.setattr(publish, "ROOT", root)
    monkeypatch.setattr(publish, "CONFIG", config)
    monkeypatch.setattr(publish, "DATA", data)
    return directory, project_id


def test_signature_matches_official_formula():
    expected = base64.b64encode(hmac.new(b"secret", b"123.GET./keywordstool", hashlib.sha256).digest()).decode("ascii")
    assert naver_api._signature("123", "GET", "/keywordstool", "secret") == expected


def test_changed_body_invalidates_approval(blog_project):
    directory, _ = blog_project
    publish.validate_ready(directory)
    (directory / "본문.md").write_text("## 소제목\n\n한 글자 변경", encoding="utf-8")
    with pytest.raises(Exception, match="승인 이후"):
        publish.validate_ready(directory)


def test_unverified_marker_blocks_publish(blog_project):
    directory, _ = blog_project
    body = directory / "본문.md"
    body.write_text("## 소제목\n\n[확인필요]", encoding="utf-8")
    approval = json.loads((directory / "02-원고-승인.txt").read_text(encoding="utf-8"))
    approval["body_sha256"] = hashlib.sha256(body.read_bytes()).hexdigest()
    (directory / "02-원고-승인.txt").write_text(json.dumps(approval), encoding="utf-8")
    with pytest.raises(Exception, match="확인필요"):
        publish.validate_ready(directory)


def test_same_body_is_reserved_once(blog_project):
    directory, _ = blog_project
    connection = publish._db()
    snapshot = publish._snapshot(directory)
    connection.execute("INSERT INTO blog_publishing VALUES (?,?,?,?,?,?,?)", (snapshot["body_sha256"], "owner", directory.name, "unknown", None, "2026-09-18T00:00:00+00:00", "수동 확인 필요"))
    connection.commit()
    with pytest.raises(Exception):
        connection.execute("INSERT INTO blog_publishing VALUES (?,?,?,?,?,?,?)", (snapshot["body_sha256"], "owner", directory.name, "sending", None, "2026-09-18T00:00:00+00:00", None))
    connection.close()


def test_draft_execute_requires_explicit_confirmation(blog_project):
    _, project_id = blog_project
    args = SimpleNamespace(id=project_id, mode="draft", execute=True, confirmed=False)
    with pytest.raises(Exception, match="--confirmed"):
        publish.run_publish(args)


def test_empty_editor_selectors_stop_before_playwright(tmp_path, monkeypatch):
    config = tmp_path / "naver-editor.yaml"
    config.write_text("editor_url: https://blog.naver.com/PostWriteForm.naver?blogId={blog_id}\nselectors: {}\n", encoding="utf-8")
    monkeypatch.setattr(naver_editor, "CONFIG", tmp_path)
    with pytest.raises(naver_editor.EditorPreflightError, match="셀렉터"):
        naver_editor.save_draft(blog_id="x", title="t", body="b", tags=[], images=[], log_dir=tmp_path / "logs")


def test_inspect_blog_keywords(tmp_path, monkeypatch):
    directory = tmp_path / "blog" / "keywords"
    directory.mkdir(parents=True)
    (directory / "2026-W38.json").write_text(json.dumps({"week":"2026-W38","keywords":[{"main":"테스트 키워드","status":"unused"}]}), encoding="utf-8")
    project_dir = tmp_path / "블로그" / "20260918-test"
    project_dir.mkdir(parents=True)
    (project_dir / "프로젝트.json").write_text(json.dumps({"status":"ready","keyword":{"main":"테스트 키워드"}}), encoding="utf-8")
    monkeypatch.setattr(inspector, "DATA", tmp_path)
    result = inspector.run_blog_keywords("2026-W38", root=tmp_path)
    assert result["data"]["week"] == "2026-W38"
    assert result["data"]["keywords"][0]["status"] == "writing"


def test_manual_blog_images_use_visit_photos_only(tmp_path, monkeypatch):
    project_id = "20260929-sushi"
    project_dir = tmp_path / "블로그" / project_id
    photo_dir = project_dir / "이미지"
    photo_dir.mkdir(parents=True)
    (project_dir / "프로젝트.json").write_text(json.dumps({"keyword": {"main": "노원 새벽스시"}}, ensure_ascii=False), encoding="utf-8")
    (project_dir / "개요.json").write_text(json.dumps({"images": [{"kind": "body", "alt": "초밥 접시", "brief": "생성하지 않음"}]}), encoding="utf-8")
    (photo_dir / "00-대표.jpg").write_bytes(b"real cover")
    (photo_dir / "01.jpeg").write_bytes(b"real body")
    (photo_dir / "01-보정.jpg").write_bytes(b"corrected real body")
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "blog.yaml").write_text("image_source: manual\n", encoding="utf-8")
    monkeypatch.setattr(images, "ROOT", tmp_path)
    monkeypatch.setattr(images, "CONFIG", config_dir)
    monkeypatch.setattr(images.subprocess, "run", lambda *a, **kw: pytest.fail("image generation should not run"))

    result = images.generate(project_id)

    assert [item["file"] for item in result] == ["이미지/00-대표.jpg", "이미지/01-보정.jpg"]
    assert all(item["prompt"] == "실제 방문 사진" for item in result)


def test_manual_blog_images_require_visit_photo(tmp_path, monkeypatch):
    project_id = "20260929-sushi"
    project_dir = tmp_path / "블로그" / project_id
    project_dir.mkdir(parents=True)
    (project_dir / "프로젝트.json").write_text("{}", encoding="utf-8")
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "blog.yaml").write_text("image_source: manual\n", encoding="utf-8")
    monkeypatch.setattr(images, "ROOT", tmp_path)
    monkeypatch.setattr(images, "CONFIG", config_dir)

    with pytest.raises(Exception, match="실제 방문 사진이 없습니다"):
        images.generate(project_id)


def test_blog_cli_paths_reject_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(keywords, "CONFIG", tmp_path)
    with pytest.raises(ValueError, match="week"):
        keywords.discover("../../outside")
    monkeypatch.setattr(serp, "ROOT", tmp_path)
    args = SimpleNamespace(keyword="test", project="../../outside")
    monkeypatch.setattr(serp, "analyze", lambda _keyword: {})
    with pytest.raises(ValueError, match="ID"):
        serp.run(args)
