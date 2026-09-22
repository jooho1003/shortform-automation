"""Cloudflare R2 업로드 — 상세페이지 납품용 이미지·영상을 버킷에 올린다.

R2는 S3 호환이라 boto3를 endpoint_url 만 바꿔서 쓴다.

설정은 pipeline/.env 의 R2_* 다섯 개. 하나라도 비면 MissingKey 로 멈추고,
호출부는 그때 로컬 상대 경로 모드로 되돌아가면 된다(버킷 없이도 내보내기는 된다).
"""

from __future__ import annotations

import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path

from . import MissingKey, StepFailed
from .paths import load_dotenv

ENV_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL")

# 납품 페이지는 한 번 올리면 내용이 바뀌지 않는 파일들이다(바뀌면 새 키로 올린다).
# 고객이 열 때마다 다시 받지 않도록 길게 캐시한다.
CACHE_CONTROL = "public, max-age=31536000, immutable"


@dataclass(frozen=True)
class R2Config:
    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket: str
    public_base_url: str

    @property
    def endpoint_url(self) -> str:
        return f"https://{self.account_id}.r2.cloudflarestorage.com"

    def public_url(self, key: str) -> str:
        return f"{self.public_base_url}/{key}"


def configured() -> bool:
    load_dotenv()
    return all(os.environ.get(k, "").strip() for k in ENV_KEYS)


def config() -> R2Config:
    load_dotenv()
    missing = [k for k in ENV_KEYS if not os.environ.get(k, "").strip()]
    if missing:
        raise MissingKey(
            f"R2 설정이 없습니다: {', '.join(missing)}\n"
            "  Cloudflare 대시보드 → R2 → 버킷/API 토큰에서 발급해 pipeline/.env 에 넣으세요."
        )
    base = os.environ["R2_PUBLIC_BASE_URL"].strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        raise StepFailed(f"R2_PUBLIC_BASE_URL 은 http(s) 주소여야 합니다: {base}")
    return R2Config(
        account_id=os.environ["R2_ACCOUNT_ID"].strip(),
        access_key_id=os.environ["R2_ACCESS_KEY_ID"].strip(),
        secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"].strip(),
        bucket=os.environ["R2_BUCKET"].strip(),
        public_base_url=base,
    )


def object_key(prefix: str, rel: str) -> str:
    """버킷 키. 경로 구분자는 항상 '/' 이고 앞뒤 슬래시는 정리한다."""
    parts = [p for p in (prefix.strip("/"), rel.replace("\\", "/").strip("/")) if p]
    key = "/".join(parts)
    if not key or ".." in key.split("/"):
        raise StepFailed(f"버킷 키가 올바르지 않습니다: {rel}")
    return key


def _client(cfg: R2Config):
    import boto3  # 업로드할 때만 필요하다. 로컬 내보내기에는 없어도 된다.
    from botocore.config import Config as BotoConfig

    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint_url,
        aws_access_key_id=cfg.access_key_id,
        aws_secret_access_key=cfg.secret_access_key,
        # R2는 리전 개념이 없지만 SigV4 서명에 값이 필요하다.
        region_name="auto",
        config=BotoConfig(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
    )


def upload(files: dict[str, Path], prefix: str, cfg: R2Config | None = None) -> dict[str, str]:
    """{상대경로: 로컬파일} 을 올리고 {상대경로: 공개 URL} 을 돌려준다."""
    cfg = cfg or config()
    client = _client(cfg)
    urls: dict[str, str] = {}
    for rel, path in files.items():
        if not path.is_file():
            raise StepFailed(f"업로드할 파일이 없습니다: {path}")
        key = object_key(prefix, rel)
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        try:
            client.upload_file(
                str(path), cfg.bucket, key,
                ExtraArgs={"ContentType": content_type, "CacheControl": CACHE_CONTROL},
            )
        except Exception as exc:  # boto3 예외 계층이 넓어 메시지만 정리해 올린다
            raise StepFailed(f"R2 업로드 실패 {key}: {exc}") from exc
        urls[rel] = cfg.public_url(key)
        print(f"    up {key}  ({path.stat().st_size:,} bytes)")
    return urls
