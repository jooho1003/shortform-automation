"""R2 설정·키 생성 테스트. 네트워크 없이 순수 부분만 본다."""

from pathlib import Path

import pytest

from shortform import MissingKey, StepFailed, r2

FULL = {
    "R2_ACCOUNT_ID": "acc123",
    "R2_ACCESS_KEY_ID": "ak",
    "R2_SECRET_ACCESS_KEY": "sk",
    "R2_BUCKET": "shortform-media",
    "R2_PUBLIC_BASE_URL": "https://media.example.com",
}


@pytest.fixture
def env(monkeypatch):
    # 실제 pipeline/.env 가 테스트 환경을 다시 채우지 않게 막는다.
    # 여기서 보는 것은 os.environ 을 읽는 규칙이지 .env 로딩이 아니다.
    monkeypatch.setattr(r2, "load_dotenv", lambda: None)

    def apply(**overrides):
        values = {**FULL, **overrides}
        for k in r2.ENV_KEYS:
            v = values.get(k)
            if v is None:
                monkeypatch.delenv(k, raising=False)
            else:
                monkeypatch.setenv(k, v)
    return apply


class TestConfig:
    def test_reads_all_keys(self, env):
        env()
        cfg = r2.config()
        assert cfg.bucket == "shortform-media"
        assert cfg.endpoint_url == "https://acc123.r2.cloudflarestorage.com"

    def test_configured_flag(self, env):
        env()
        assert r2.configured() is True
        env(R2_BUCKET=None)
        assert r2.configured() is False

    def test_missing_key_names_what_is_missing(self, env):
        env(R2_BUCKET=None, R2_ACCOUNT_ID=None)
        with pytest.raises(MissingKey) as exc:
            r2.config()
        assert "R2_BUCKET" in str(exc.value)
        assert "R2_ACCOUNT_ID" in str(exc.value)

    def test_blank_value_counts_as_missing(self, env):
        env(R2_ACCESS_KEY_ID="   ")
        assert r2.configured() is False
        with pytest.raises(MissingKey):
            r2.config()

    def test_trailing_slash_is_trimmed(self, env):
        env(R2_PUBLIC_BASE_URL="https://media.example.com/")
        assert r2.config().public_url("a/b.mp4") == "https://media.example.com/a/b.mp4"

    def test_rejects_non_http_public_url(self, env):
        env(R2_PUBLIC_BASE_URL="media.example.com")
        with pytest.raises(StepFailed):
            r2.config()


class TestObjectKey:
    @pytest.mark.parametrize("prefix,rel,expected", [
        ("상세페이지/abc", "영상/section-1.mp4", "상세페이지/abc/영상/section-1.mp4"),
        ("/abc/", "/영상/x.png", "abc/영상/x.png"),
        ("", "a.mp4", "a.mp4"),
    ])
    def test_builds_key(self, prefix, rel, expected):
        assert r2.object_key(prefix, rel) == expected

    def test_normalises_backslashes(self):
        assert r2.object_key("p", "영상\\section-1.mp4") == "p/영상/section-1.mp4"

    def test_rejects_traversal(self):
        with pytest.raises(StepFailed):
            r2.object_key("p", "../../secret.env")

    def test_rejects_empty(self):
        with pytest.raises(StepFailed):
            r2.object_key("", "/")


class TestUpload:
    def test_missing_local_file_fails_before_network(self, env, tmp_path):
        env()
        with pytest.raises(StepFailed) as exc:
            r2.upload({"영상/x.mp4": tmp_path / "없음.mp4"}, "p")
        assert "업로드할 파일이 없습니다" in str(exc.value)
