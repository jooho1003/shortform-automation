"""아카이브 발행 — 목록을 만들고 바뀐 파일만 R2에 올린다.

편 영상은 한 편에 20MB 가 넘는다. 매번 전부 다시 올리지 않도록 업로드할 때 원본 MD5를
객체 메타데이터에 적어 두고, 다음 발행 때 그 값과 비교해 같으면 건너뛴다.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from .. import StepFailed
from .. import archive
from .. import r2
from ..paths import ROOT

MD5_META = "srcmd5"


def _unchanged(client, bucket: str, key: str, path: Path, digest: str, content_type: str) -> bool:
    try:
        head = client.head_object(Bucket=bucket, Key=key)
    except Exception:
        return False  # 없거나 못 읽으면 올린다
    # Content-Type 도 본다. 내용이 같아도 타입이 틀리게 올라간 객체(charset 없는 .md 등)는 다시 올린다.
    return (
        head.get("Metadata", {}).get(MD5_META) == digest
        and head.get("ContentLength") == path.stat().st_size
        and head.get("ContentType") == content_type
    )


def run(root: Path | None = None, dry_run: bool = False) -> dict:
    root = root or ROOT
    manifest = archive.build_manifest(root)
    files = archive.manifest_files(manifest, root)
    counts = manifest["counts"]
    total_bytes = sum(p.stat().st_size for p in files.values())
    print(f"  항목 {counts} · 파일 {len(files)}개 · {total_bytes / 1_048_576:.1f}MB")

    if dry_run:
        for key in sorted(files):
            print(f"    - {key}")
        return {"manifest": manifest, "uploaded": [], "skipped": [], "dry_run": True}

    cfg = r2.config()
    client = r2._client(cfg)
    uploaded: list[str] = []
    skipped: list[str] = []

    for rel, path in sorted(files.items()):
        key = r2.object_key("archive", rel)
        digest = archive.file_md5(path)
        content_type = r2.content_type(path)
        if _unchanged(client, cfg.bucket, key, path, digest, content_type):
            skipped.append(rel)
            continue
        try:
            client.upload_file(
                str(path), cfg.bucket, key,
                ExtraArgs={"ContentType": content_type, "Metadata": {MD5_META: digest}},
            )
        except Exception as exc:
            raise StepFailed(f"R2 업로드 실패 {key}: {exc}") from exc
        uploaded.append(rel)
        print(f"    up {rel}  ({path.stat().st_size:,} bytes)")

    # 목록은 항상 마지막에 올린다. 파일이 먼저 올라가 있어야 뷰어가 깨진 링크를 보지 않는다.
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        index_path = Path(handle.name)
    try:
        client.upload_file(
            str(index_path), cfg.bucket, archive.INDEX_KEY,
            ExtraArgs={"ContentType": "application/json; charset=utf-8", "CacheControl": "no-cache"},
        )
    finally:
        index_path.unlink(missing_ok=True)

    print(f"  올림 {len(uploaded)}개 · 건너뜀 {len(skipped)}개 · 목록 → {archive.INDEX_KEY}")
    return {"manifest": manifest, "uploaded": uploaded, "skipped": skipped, "dry_run": False}
