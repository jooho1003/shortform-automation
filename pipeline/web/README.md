# 숏폼 콘솔 (web)

CLI 파이프라인(`python -m shortform ...`)을 브라우저에서 보고 조작하는 로컬 콘솔. "나만의 이지컷".

- **SSOT는 파일이다.** `<날짜>/<트랙-번호-슬러그>/`, `릴스기획/`, `외주/` 폴더의 JSON·MD·PNG·MP4를 그대로 읽고 쓴다. DB 없음. CLI는 무수정으로 계속 동작한다.
- 읽기는 Python `shortform inspect`가 JSON으로 준다(스키마 드리프트 방지). 쓰기는 게이트 txt·JSON 같은 단순 파일이라 Node가 직접 한다.
- 미리보기는 `@remotion/player` — 렌더 템플릿(React)이 그대로 브라우저에서 돈다.
- 파이썬·claude·codex·fal 호출은 전부 **잡 러너**를 거쳐 로그가 남는다(`<회차>/로그/`, `릴스기획/<id>/로그/`, `pipeline/data/logs/`).

## 실행

```
cd pipeline
py -3.10 -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt   # 처음 한 번
npm install                                                                          # 처음 한 번 (워크스페이스: remotion + web)
npm run dev                                                                          # http://localhost:3123
```

키는 `pipeline/.env`에 (git 무시됨):

```
FAL_KEY=...            # A안 영상 생성
PEXELS_API_KEY=...     # B안 stock 소재
YOUTUBE_API_KEY=...    # discover
NAVER_CLIENT_ID=...    # 블로그 검색 API
NAVER_CLIENT_SECRET=...
NAVER_AD_ACCESS_LICENSE=... # 선택: 검색광고 키워드 검색량
NAVER_AD_SECRET_KEY=...
NAVER_AD_CUSTOMER_ID=...
```

`환경 점검` 메뉴에서 뭐가 빠졌는지 본다.

## 화면

| 메뉴 | 하는 일 | 파일 |
|---|---|---|
| 회차 | 날짜별 회차 카드, 새 회차 | `<날짜>/<트랙-번호-슬러그>/` |
| 음성 스튜디오 | Qwen3 샘플 생성·재생·비교, 발음·속도 설정, 참조 음성, 프리셋, 회차 적용 | `pipeline/data/tts/`, `pipeline/data/voices/`, 회차 `03-소재/voice-settings.json` |
| 회차 상세 (B안) | 기획안 편집·승인 → 클립 후보 클릭 선택·승인 → Player 미리보기·타임라인 편집 → 완성본·업로드 승인 → 단계 실행·로그 | `01-기획안.md`, `02-이미지/클립목록.json`, `03-소재/타임라인.json`, 게이트 txt |
| 회차 상세 (A안) | 기획안(시놉시스·락 블록·컷표) → 시트·키프레임 검토(검사 결과) → 컷 영상 → 완성본 | 같은 규약, `02-이미지/시트.png`·`키프레임-NN.png`·`검사.json`, `03-소재/원본/`·`클립/` |
| C안 모션 | 12초 샘플 재생·컷별 대본과 모션 확인·제작 흐름 안내 | `/c-motion`, `2026-09-15/C-01-트리스탄다쿠냐-설계/04-영상/sample-12s.mp4` |
| 네이버 블로그 | 키워드 보드 → 개요 승인 → 근거·본문·이미지 생성 → 원고 승인 → 복사 패키지, 게시 글 순위 추적 | `블로그/<id>/`, `pipeline/data/blog/keywords/` |
| 조사·구간 | 주간 조사 실행, 소스 채널 상위 롱폼 → 구간 후보 뽑기 | `pipeline/data/research/`, `pipeline/data/segments/` |
| 릴스 기획 | 레퍼런스 라이브러리(즐겨찾기·태그) → 원본 받기 → 대본(자막/whisper) → 구조 분석 → 고객 설문 반영 기획안(썸네일 제목·스토리보드·촬영 가이드·대본·캡션) → 수정하기 → PDF | `릴스기획/라이브러리.json`, `릴스기획/<id>/` |
| 외주 | 고객·사전설문·패키지·계약, 월별 보드(진행 절차 4단계·칸반), 회차/기획안 링크 | `외주/<고객>/고객.json`, `외주/<고객>/YYYY-MM/월간.json`, `config/packages.yaml` |
| 작업 로그 | 실행한 모든 프로세스의 로그 | `pipeline/data/jobs/` |
| 환경 점검 | venv·의존성·ffmpeg·Remotion·claude·codex·키 | — |

## 안전 규칙

Qwen 엔진 설치·실행 방법은 [음성 스튜디오 실행 안내](../tts-service/README.md)를 참고한다. 웹에서 **음성 스튜디오 → 엔진 시작** 후 사용할 수 있다. Qwen 관련 키는 필요하지 않으며 모델은 이 PC의 GPU에서 실행된다.

- `/api/media`는 저장소 루트 밖·`pipeline/secrets`·`.env`·`.git`을 거부한다(`lib/safePath.ts`). 경로를 받는 모든 API가 이 가드를 탄다.
- **업로드(YouTube 외부 공개)와 fal 영상 생성(과금)은 확인 다이얼로그 없이 실행되지 않는다.** API도 `confirmed: true` 없이는 거부한다.
- 블로그는 `copy`가 기본이다. `draft`는 `config/blog.yaml`과 `config/naver-editor.yaml`에서 각각 켠 뒤, 사람이 직접 로그인한 전용 프로필로 임시저장까지만 한다. 자동 발행은 구현하지 않는다.
- 타임라인 편집은 `assets`(B안)/`video`(A안)를 다시 돌리면 덮어써진다. 고친 뒤에는 `render`만 다시.

## 모델 분담 (사용자 결정)

| 역할 | 도구 | 어디서 |
|---|---|---|
| 릴스 구조 분석·기획안·수정 | `claude -p`(주) / `codex exec`(대안) | `lib/llm.ts`, `pipeline/prompts/reels/*.md` |
| A안 캐릭터 시트·키프레임 | `codex exec`(이미지 생성 도구) | `shortform/steps/images_a.py`, `config/images.yaml` |
| A안 컷 영상 | fal.ai (MiniMax Hailuo 계열, 엔드포인트는 설정) | `shortform/steps/video_a.py`, `config/fal.yaml` |
| 기획안 PDF | 인쇄용 페이지 → 브라우저 "PDF로 저장" | `app/reels/[id]/print` |
| 업로드 | 파이프라인 `upload` 단계(YouTube Data API) | 인스타그램은 Graph API+비즈니스 계정 필요 — 아직 수동 |

## 구조

```
web/
  app/            페이지·API 라우트 (App Router)
  components/     클라이언트 컴포넌트
  lib/
    paths.ts      ROOT·PIPELINE·python 경로, .env 로드
    safePath.ts   파일 접근 경계
    inspect.ts    python inspect 브리지
    runner.ts     잡 러너(spawn·SSE·로그·취소)
    llm.ts        claude/codex 어댑터
    reels.ts      릴스 기획 CRUD + LLM 호출
    clients.ts    외주 CRUD
    types.ts      계약 타입 (Python·Remotion과 맞춘다)
```

`@composition/*`는 `../remotion/src/*`. Remotion 컴포지션에 `assetBase` 옵셔널 프롭이 추가됐다 — Player에서만 쓰고, 렌더에서는 안 넘기므로 기존 동작 그대로.
