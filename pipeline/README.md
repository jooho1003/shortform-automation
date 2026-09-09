# 숏폼 파이프라인

설계는 `../docs/설계/00-파이프라인-설계.md`. 이 문서는 돌리는 법만 적는다.

## 실행

Windows 경로에 한글이 있어서 `pip install -e .`(editable)은 쓰지 않는다.
site-packages의 `.pth` 파일을 파이썬이 cp949로 읽다가 죽는다. 대신 이 폴더에서 직접 실행한다.

```
cd pipeline
.venv\Scripts\python -m shortform run --track B --date 2026-09-08 --episode 01
```

### 명령

| 명령 | 하는 일 |
|---|---|
| `new --slug 제목` | 편 폴더를 만든다 |
| `run` | plan → clips → assets → render → upload 을 순서대로. 승인 없으면 멈춘다 |
| `run --only clips,assets` | 특정 단계만 |
| `run --force` | 완료로 기록된 단계도 다시 |
| `status` | 단계별 완료 여부와 승인 파일 존재 여부 |
| `discover` | 인급동·조회수 상위·CC 검색으로 레퍼런스를 쌓는다 |

종료 코드: `0` 정상, `1` 실패, `2` 승인 대기, `3` API 키 없음.

## 기획안 템플릿

`01-기획안.md`에 다음 절을 넣고, 아래 세 이름 중 하나를 **정확히** 적는다. 목록 기호(`-`)는 생략해도 된다.

```md
## 템플릿

- 화이트 피드 카드
```

사용 가능한 이름은 `브리핑 포커스`, `화이트 피드 카드`, `블랙 피드 카드`다. 절을 생략하면
`브리핑 포커스`를 쓴다. 브리핑 포커스의 35~60초는 작성 지침이며 실행을 막지 않는다.
두 피드 카드는 실제 TTS 길이가 15~30초(경계 포함)여야 하며, 범위를 벗어나면 소재 단계가
클립 결합이나 다운로드 전에 멈춘다. 짧은 카드 기획안은 `examples/B-feed-card-light.md`를 참고한다.

## 필요한 키

| 환경변수 / 파일 | 쓰는 단계 | 받는 곳 | 없으면 |
|---|---|---|---|
| `PEXELS_API_KEY` | clips | pexels.com/api — 가입 즉시 무료 | clips에서 멈춤 |
| `YOUTUBE_API_KEY` | discover | Google Cloud Console, YouTube Data API v3 | discover만 못 씀 |
| `secrets/client_secret.json` | upload | 같은 콘솔의 OAuth 클라이언트 ID (데스크톱 앱) | upload에서 멈춤 |

`secrets/`는 공유하지 않는다.

## 승인 게이트

편 폴더에 빈 파일을 만들면 통과한다. 지우고 다시 돌리면 그 단계에서 다시 멈춘다.

| 파일 | 막는 단계 |
|---|---|
| `01-기획-승인.txt` | plan |
| `02-이미지-승인.txt` | clips |
| `04-업로드-승인.txt` | upload |

고칠 게 있으면 승인 파일 대신 `01-기획-수정요청.txt` / `02-이미지-수정요청.txt`에 적는다.
클립 수정요청은 적힌 문장 번호를 다음 후보로 돌리고 파일을 지운다.

직접 만든 세로 영상을 쓰려면 `클립목록.json`에서 해당 문장의 `chosen`을 `null`로 두고
`media_layout: portrait`를 지정한다. 생략하면 기존 수동 클립과 호환되도록 `landscape`로 본다.

## Remotion

```
cd remotion
npm install          # 처음 한 번
npx remotion studio  # 눈으로 보며 고칠 때
```

`render` 단계가 소재를 `remotion/public/ep/`로 ASCII 이름으로 옮긴 뒤 렌더하고 지운다.
한글 파일명이 staticFile URL에서 말썽이라 그렇다.

## 알려진 제약

- **자막 어절 타이밍은 추정치다.** edge-tts 7.2.8은 `WordBoundary`를 주지 않는다(한국어·영어 모두).
  문장 구간은 합성기가 주는 `SentenceBoundary`(정확)를 쓰고, 그 안에서 어절 위치만
  합성 발음의 글자 수 비례로 나눈다. 표시 자막은 기획안 원문 그대로이며 몇십 ms 어긋날 수 있다.
  더 필요하면 강제 정렬기를 끼운다.
- **자동 소재 검색은 `stock`(Pexels)만 붙어 있다.** 기획안에서 소재를 `pd`나 `trailer`로
  적으면 후보를 찾지 않고, `03-소재/클립/NN.mp4`에 직접 넣으라고 알린다.
- **업로드는 재시도하지 않는다.** 같은 영상이 두 번 올라가는 쪽이 더 나쁘다.
