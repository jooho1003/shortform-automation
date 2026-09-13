"""Buffer GraphQL transport. Tokens stay local; requests are never retried.

Reference: https://developers.buffer.com/reference.md (checked 2026-09-12).
Buffer retrieves videos from an explicitly configured public HTTPS URL.
"""
from __future__ import annotations

import json
import hashlib
import ipaddress
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

from . import MissingKey, StepFailed
from .paths import ROOT, SECRETS

ENDPOINT = "https://api.buffer.com"
KEY_FILE = SECRETS / "buffer-api-key.txt"
POST_FIELDS = "id status dueAt sentAt externalLink"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def credentials_present() -> bool:
    return bool(os.environ.get("BUFFER_API_KEY", "").strip()) or KEY_FILE.is_file()


class BufferClient:
    def __init__(self):
        token = os.environ.get("BUFFER_API_KEY", "").strip()
        if not token and KEY_FILE.is_file():
            token = KEY_FILE.read_text(encoding="utf-8-sig").strip()
        if not token:
            raise MissingKey(
                "Buffer 계정 연결이 필요합니다. Buffer에서 게시할 3개 계정을 연결한 뒤 "
                "API 키를 BUFFER_API_KEY 환경변수 또는 "
                f"{KEY_FILE}에 저장하세요. 키는 채팅에 붙여 넣지 마세요."
            )
        if any(c.isspace() for c in token):
            raise MissingKey("Buffer API 키 파일에 공백이 포함되어 있습니다. 키만 저장하세요.")
        self._token = token
        self._opener = urllib.request.build_opener(_NoRedirect())

    def _request(self, query: str, variables: dict | None = None) -> dict:
        request = urllib.request.Request(
            ENDPOINT,
            data=json.dumps({"query": query, "variables": variables or {}}).encode("utf-8"),
            headers={"Authorization": f"Bearer {self._token}",
                     "Content-Type": "application/json", "User-Agent": "shortform-pipeline/0.1"},
            method="POST",
        )
        try:
            with self._opener.open(request, timeout=60) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise StepFailed("Buffer 응답이 예상 크기를 초과했습니다. 자동 재전송하지 않습니다.")
            payload = json.loads(raw)
        except urllib.error.HTTPError as exc:
            # Do not print response bodies or request URLs containing credentials.
            raise StepFailed(f"Buffer HTTP {exc.code}. 계정/요청 상태를 확인하세요. 자동 재전송하지 않습니다.") from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise StepFailed("Buffer 응답을 확인하지 못했습니다. 자동 재전송하지 않습니다.") from None
        if not isinstance(payload, dict) or payload.get("errors"):
            raise StepFailed("Buffer API가 요청 오류를 반환했습니다. 공식 API 설정과 입력을 확인하세요.")
        if not isinstance(payload.get("data"), dict):
            raise StepFailed("Buffer API 응답에 data가 없습니다.")
        return payload["data"]

    def channels(self) -> list[dict]:
        data = self._request("query { account { organizations { id } } }")
        account = data.get("account") or {}
        result = []
        for organization in account.get("organizations", []):
            data = self._request(
                "query($id: OrganizationId!) { channels(input:{organizationId:$id}) { "
                "id name displayName service externalLink organizationId "
                "isDisconnected isLocked isQueuePaused } }",
                {"id": organization["id"]},
            )
            result.extend(data.get("channels") or [])
        return result

    def verify_media(self, item: dict) -> None:
        """Verify the provider will fetch the reviewed video, without sending a token."""
        parsed = urllib.parse.urlsplit(item["video_url"])
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise StepFailed("영상 주소는 인증 없이 접근 가능한 HTTPS 주소여야 합니다.")
        try:
            addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                raise StepFailed("로컬·사설망 영상 주소는 사용할 수 없습니다.")
            path = (ROOT / item["file"]).resolve()
            if not path.is_relative_to(ROOT.resolve()):
                raise StepFailed("영상 파일이 프로젝트 밖에 있습니다.")
            expected_size = path.stat().st_size
            digest = hashlib.sha256()
            size = 0
            # Never use the Authorization header for third-party media storage.
            request = urllib.request.Request(item["video_url"], headers={"User-Agent": "shortform-pipeline/0.1"})
            with self._opener.open(request, timeout=60) as response:
                if response.status != 200:
                    raise StepFailed("영상 URL이 정상 파일 응답을 반환하지 않았습니다.")
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > expected_size:
                        raise StepFailed("원격 영상이 검토한 로컬 파일과 다릅니다.")
                    digest.update(block)
            if size != expected_size or digest.hexdigest() != item["sha256"]:
                raise StepFailed("원격 영상이 검토한 로컬 파일과 다릅니다. URL을 확인하세요.")
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise StepFailed("영상 URL에 접근하지 못했습니다. 공개 저장소 연결을 확인하세요.") from None

    @staticmethod
    def post_input(item: dict) -> dict:
        mode = item["mode"]
        if mode not in {"draft", "now", "schedule"}:
            raise StepFailed("게시 방식이 정해지지 않았습니다.")
        platform = item["platform"]
        if platform not in {"youtube", "instagram", "tiktok"}:
            raise StepFailed("지원하지 않는 게시 플랫폼입니다.")
        generated_video = bool(re.search(r"(?:^|[/\\])A-", item.get("episode", "")))
        body = {
            "channelId": item["channel_id"],
            "text": item["text"],
            "schedulingType": "automatic",
            "mode": {"draft": "addToQueue", "now": "shareNow", "schedule": "customScheduled"}[mode],
            "saveToDraft": mode == "draft",
            "assets": [{"video": {"url": item["video_url"]}}],
            "aiAssisted": True,
        }
        if mode == "schedule":
            body["dueAt"] = item["due_at"]
        if platform == "youtube":
            if item.get("privacy") not in {"private", "unlisted", "public"}:
                raise StepFailed("YouTube 공개 범위를 지정하세요.")
            body["metadata"] = {"youtube": {
                "title": item["title"], "categoryId": "24",
                "privacy": item["privacy"], "madeForKids": False,
                "isAiGenerated": generated_video,
            }}
        elif platform == "instagram":
            body["metadata"] = {"instagram": {
                "type": "reel", "shouldShareToFeed": True, "isAiGenerated": generated_video,
            }}
        else:
            body["metadata"] = {"tiktok": {"isAiGenerated": generated_video}}
        return body

    def create_post(self, item: dict) -> dict:
        data = self._request(
            "mutation($input: CreatePostInput!) { createPost(input:$input) { "
            "__typename ... on PostActionSuccess { post { " + POST_FIELDS + " } } "
            "... on MutationError { message } } }",
            {"input": self.post_input(item)},
        )
        result = data.get("createPost") or {}
        if result.get("__typename") != "PostActionSuccess":
            raise StepFailed("Buffer가 게시 요청을 수락하지 않았습니다. 대시보드에서 확인하세요.")
        post = result.get("post") or {}
        if not post.get("id") or not post.get("status"):
            raise StepFailed("Buffer 게시 결과가 불완전합니다. 대시보드에서 확인하세요.")
        return post

    def get_post(self, post_id: str) -> dict:
        if not re.fullmatch(r"[0-9a-fA-F]{24}", post_id):
            raise StepFailed("게시물 ID 형식이 잘못되었습니다.")
        data = self._request(
            "query($id: PostId!) { post(input:{id:$id}) { " + POST_FIELDS + " } }",
            {"id": post_id},
        )
        post = data.get("post") or {}
        if not post.get("id") or not post.get("status"):
            raise StepFailed("Buffer에서 게시 상태를 확인하지 못했습니다.")
        return post
