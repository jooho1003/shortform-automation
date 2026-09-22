"""아카이브 스캐너 테스트. 가짜 저장소를 만들어 목록 생성만 본다(R2 없음)."""

import json
from pathlib import Path

from shortform import archive


def _write(path: Path, text: str = "x") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _episode(root: Path, date: str, name: str, *, plan: str = "", video=False, image=False):
    ep = root / date / name
    ep.mkdir(parents=True, exist_ok=True)
    if plan:
        _write(ep / "01-기획안.md", plan)
    if video:
        _write(ep / "04-영상" / "final.mp4")
        _write(ep / "04-영상" / "thumb.jpg")
    if image:
        _write(ep / "02-이미지" / "컨택트시트.png")
        _write(ep / "02-이미지" / "클립목록.json")  # 이미지가 아니므로 제외돼야 한다
    return ep


class TestEpisodeTitle:
    def test_b_track_uses_first_candidate(self, tmp_path):
        _episode(tmp_path, "2026-09-11", "B-01-건강검진",
                 plan="# 제목 후보\n\n1. 건강검진 결과 나온 날\n2. 두 번째 후보\n")
        item = archive.scan_episodes(tmp_path)[0]
        assert item.title == "건강검진 결과 나온 날"

    def test_strips_quotes_from_candidate(self, tmp_path):
        _episode(tmp_path, "2026-09-11", "B-01-x", plan='# 제목 후보\n\n1. "따옴표 제목"\n')
        assert archive.scan_episodes(tmp_path)[0].title == "따옴표 제목"

    def test_a_track_uses_synopsis_first_line(self, tmp_path):
        _episode(tmp_path, "2026-09-12", "A-01-팬케이크",
                 plan="# 시놉시스\n\n비 오는 아침, 리트리버가 팬케이크를 굽는다.\n")
        item = archive.scan_episodes(tmp_path)[0]
        assert item.title == "비 오는 아침, 리트리버가 팬케이크를 굽는다."
        assert item.title != "시놉시스", "섹션 제목을 그대로 쓰면 안 된다"

    def test_falls_back_to_slug(self, tmp_path):
        _episode(tmp_path, "2026-09-12", "B-09-슬러그이름", video=True)
        assert archive.scan_episodes(tmp_path)[0].title == "슬러그이름"


class TestScanEpisodes:
    def test_collects_video_and_poster(self, tmp_path):
        _episode(tmp_path, "2026-09-11", "B-01-x", video=True)
        item = archive.scan_episodes(tmp_path)[0]
        assert item.video.endswith("04-영상/final.mp4")
        assert item.poster.endswith("04-영상/thumb.jpg")

    def test_only_image_suffixes(self, tmp_path):
        _episode(tmp_path, "2026-09-11", "B-01-x", image=True)
        item = archive.scan_episodes(tmp_path)[0]
        assert len(item.images) == 1
        assert item.images[0].endswith("컨택트시트.png")

    def test_skips_empty_episode(self, tmp_path):
        (tmp_path / "2026-09-11" / "B-01-빈편").mkdir(parents=True)
        assert archive.scan_episodes(tmp_path) == []

    def test_ignores_non_date_and_non_episode_dirs(self, tmp_path):
        _write(tmp_path / "docs" / "readme.md")
        (tmp_path / "2026-09-11" / "그냥폴더").mkdir(parents=True)
        _episode(tmp_path, "2026-09-11", "B-01-x", video=True)
        assert [i.id for i in archive.scan_episodes(tmp_path)] == ["2026-09-11/B-01-x"]

    def test_newest_date_first(self, tmp_path):
        _episode(tmp_path, "2026-09-10", "B-01-old", video=True)
        _episode(tmp_path, "2026-09-12", "B-01-new", video=True)
        assert [i.date for i in archive.scan_episodes(tmp_path)] == ["2026-09-12", "2026-09-10"]


class TestScanDetailPages:
    def _project(self, root: Path, pid: str, meta: dict, *, html=True, video=False):
        d = root / "상세페이지" / pid
        d.mkdir(parents=True, exist_ok=True)
        _write(d / "프로젝트.json", json.dumps(meta, ensure_ascii=False))
        if html:
            _write(d / "결과.html", "<html></html>")
        if video:
            _write(d / "영상" / "section-1.mp4")
            _write(d / "영상" / "section-1.png")
        return d

    def test_reads_title_and_page(self, tmp_path):
        self._project(tmp_path, "p1", {"title": "머그 상세페이지", "client": "온기", "product": "머그", "updatedAt": "2026-09-22T11:00:00Z"})
        item = archive.scan_detail_pages(tmp_path)[0]
        assert item.title == "머그 상세페이지"
        assert item.subtitle == "온기 · 머그"
        assert item.date == "2026-09-22"
        assert item.page.endswith("결과.html")

    def test_picks_up_section_video_and_poster(self, tmp_path):
        self._project(tmp_path, "p1", {"title": "t"}, video=True)
        item = archive.scan_detail_pages(tmp_path)[0]
        assert item.video.endswith("section-1.mp4")
        assert item.images and item.images[0].endswith("section-1.png")

    def test_skips_dir_without_project_json(self, tmp_path):
        (tmp_path / "상세페이지" / "쓰레기").mkdir(parents=True)
        assert archive.scan_detail_pages(tmp_path) == []

    def test_survives_broken_json(self, tmp_path):
        d = tmp_path / "상세페이지" / "p1"
        d.mkdir(parents=True)
        _write(d / "프로젝트.json", "{not json")
        assert archive.scan_detail_pages(tmp_path) == []


class TestScanReels:
    def test_reads_reference_author(self, tmp_path):
        d = tmp_path / "릴스기획" / "20260910-h2tvg"
        d.mkdir(parents=True)
        _write(d / "프로젝트.json", json.dumps(
            {"title": "침착맨 아니야?", "brand_name": "TestCafe", "reference": {"author": "스낵타운"}},
            ensure_ascii=False))
        _write(d / "기획안.md", "# 기획")
        item = archive.scan_reels(tmp_path)[0]
        assert item.title == "침착맨 아니야?"
        assert item.subtitle == "스낵타운 · TestCafe"
        assert any(p.endswith("기획안.md") for p in item.docs)


class TestManifest:
    def test_counts_and_files(self, tmp_path):
        _episode(tmp_path, "2026-09-11", "B-01-x", video=True, image=True, plan="# 제목 후보\n\n1. 제목\n")
        d = tmp_path / "상세페이지" / "p1"
        d.mkdir(parents=True)
        _write(d / "프로젝트.json", json.dumps({"title": "t"}))
        _write(d / "결과.html", "<html></html>")

        manifest = archive.build_manifest(tmp_path)
        assert manifest["counts"] == {"episode": 1, "detail": 1, "reels": 0}
        files = archive.manifest_files(manifest, tmp_path)
        # final.mp4, thumb.jpg, 컨택트시트.png, 01-기획안.md, 결과.html, 프로젝트.json
        assert len(files) == 6
        assert all(p.is_file() for p in files.values())

    def test_keys_are_repo_relative_posix(self, tmp_path):
        _episode(tmp_path, "2026-09-11", "B-01-x", video=True)
        files = archive.manifest_files(archive.build_manifest(tmp_path), tmp_path)
        assert "2026-09-11/B-01-x/04-영상/final.mp4" in files
        assert not any("\\" in k for k in files)

    def test_missing_file_is_dropped_from_upload_list(self, tmp_path):
        ep = _episode(tmp_path, "2026-09-11", "B-01-x", video=True)
        manifest = archive.build_manifest(tmp_path)
        (ep / "04-영상" / "final.mp4").unlink()
        files = archive.manifest_files(manifest, tmp_path)
        assert not any(k.endswith("final.mp4") for k in files)


class TestFileMd5:
    def test_matches_known_digest(self, tmp_path):
        p = _write(tmp_path / "a.txt", "hello")
        assert archive.file_md5(p) == "5d41402abc4b2a76b9719d911017c592"
