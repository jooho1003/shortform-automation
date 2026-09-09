"""업로드. 승인 파일이 있어야만 실행한다. 설계 문서 4.7절.

재시도하지 않는다. 실패하면 오류를 남기고 끝낸다. 같은 영상이 두 번 올라가는 쪽이
한 번 실패하는 쪽보다 나쁘기 때문이다.
"""

from __future__ import annotations

import json
from datetime import datetime

from .. import GateBlocked, MissingKey, StepFailed
from .. import planfile
from ..paths import SECRETS, Episode

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
CLIENT_SECRET = SECRETS / "client_secret.json"
TOKEN = SECRETS / "youtube-token.json"


def _credentials():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    if TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
        if creds.valid:
            return creds
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            TOKEN.write_text(creds.to_json(), encoding="utf-8")
            return creds

    if not CLIENT_SECRET.exists():
        raise MissingKey(
            f"{CLIENT_SECRET} 가 없습니다.\n"
            "  https://console.cloud.google.com 에서 YouTube Data API v3 를 켜고\n"
            "  사용자 인증 정보 > OAuth 클라이언트 ID > 데스크톱 앱 을 만든 뒤\n"
            f"  받은 JSON을 이 경로에 두세요:  {CLIENT_SECRET}"
        )
    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES)
    creds = flow.run_local_server(port=0)
    SECRETS.mkdir(parents=True, exist_ok=True)
    TOKEN.write_text(creds.to_json(), encoding="utf-8")
    return creds


def _description(plan: planfile.Plan, ep: Episode) -> str:
    body = [plan.meta.get("설명", "")]
    timeline_path = ep.assets_dir / "타임라인.json"
    if timeline_path.exists():
        credits = json.loads(timeline_path.read_text(encoding="utf-8")).get("credits", [])
        seen, broadcast, stock = set(), [], []
        for c in credits:
            key = (c["author"], c["page"])
            if key in seen:
                continue
            seen.add(key)
            if c["provider"] == "youtube":
                title = c.get("title", "").strip()
                broadcast.append(f"- {title} / {c['author']}\n  {c['page']}")
            else:
                stock.append(f"- {c['author']} ({c['provider']}) {c['page']}")
        if broadcast:
            body += [
                "",
                "인용한 영상 (저작권은 각 저작권자에게 있습니다)",
                "본 영상은 작품 소개와 비평을 위해 원저작물의 일부를 인용했습니다.",
                *broadcast,
            ]
        if stock:
            body += ["", "배경 영상", *stock]
    return "\n".join(body).strip()


def run(ep: Episode) -> None:
    if not ep.upload_ok.exists():
        raise GateBlocked(
            "업로드 승인이 없습니다.\n"
            f"  완성본을 보세요:  {ep.final_mp4}\n"
            f"  올려도 되면 빈 파일을 만드세요:  {ep.upload_ok}"
        )
    if not ep.final_mp4.exists():
        raise StepFailed(f"완성본이 없습니다: {ep.final_mp4}")

    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    plan = planfile.load(ep.plan_md)
    privacy = plan.meta.get("공개", "unlisted").strip() or "unlisted"
    if privacy not in {"private", "unlisted", "public"}:
        raise StepFailed(f"공개 상태 값이 이상합니다: {privacy}")

    youtube = build("youtube", "v3", credentials=_credentials())
    request = youtube.videos().insert(
        part="snippet,status",
        body={
            "snippet": {
                "title": plan.title[:100],
                "description": _description(plan, ep)[:5000],
                "tags": [t.strip() for t in plan.meta.get("태그", "").split(",") if t.strip()],
                "categoryId": "24",  # Entertainment
            },
            "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False},
        },
        media_body=MediaFileUpload(str(ep.final_mp4), chunksize=-1, resumable=True),
    )
    try:
        response = request.execute()
    except Exception as e:  # 재시도하지 않는다
        ep.result_json.write_text(
            json.dumps({"error": str(e), "at": datetime.now().isoformat(timespec="seconds")},
                       ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        raise StepFailed(f"업로드 실패 (재시도하지 않습니다): {e}")

    result = {
        "videoId": response["id"],
        "url": f"https://youtube.com/shorts/{response['id']}",
        "privacy": privacy,
        "at": datetime.now().isoformat(timespec="seconds"),
    }
    ep.result_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  업로드 완료 ({privacy}) → {result['url']}")
