# 한술툰 작업실 Design

## Context Anchor

WHY: 사용자 검토와 수정 반복. WHO: 로컬 작가. RISK: 수정 유실. SUCCESS: 자동/수동→수정반영→버전→승인. SCOPE: 주제·텍스트 콘티.

## 1. 개요·설계 선택

기존 carousel 모델 직접 확장은 카드뉴스와 이미지 편집 상태에 영향을 준다. 별도 DB는 현재 파일 저장 구조에 과하다. 기존 파일 저장과 CLI를 재사용하는 별도 시리즈 문서를 선택한다.

## 2. 구조

/instatoon → /instatoon/hansul → POST /api/instatoon/hansul.
클라이언트 편집기 → 서버 저장/생성 서비스 → 기존 runLlm + 인스타툰/시리즈/hansul.json.
승인 시 createCarousel/updateCarousel로 별도 컷 프로젝트 생성.

## 3. 데이터

Studio {revision, episodes[]}; Episode {id, number, arc, part, topic, cards, caption, feedback, status, version, history[], editorId}.
topic {title, premise, outline[3]}; card {scene, dialogue, emotion}.
history는 각 저장 시 전체 편집 가능한 필드의 스냅샷. 복원도 새 버전으로 추가한다.

## 4. API

GET: 현재 문서와 작품 규칙. POST: action(create/save/topic/storyboard/revise/restore/approve), revision, episodeId, draft, provider, target, version.
모든 변경은 revision 검증 후 잠금 안에서 실행. 잘못된 입력400, 없는회차404, 충돌409, 생성실패502. 생성 실패 응답에는 저장된 현재 문서를 포함해 입력을 보존한다.

## 5. UI

기존 어두운 콘솔과 폰트를 유지한다: 배경 #0f1117, 패널 #161a24, 경계 #262c3a, 본문 #e6e8ee, 보조 #9aa3b5, 강조 #ffb703.
회차 목록 / 가운데 단계별 편집 / 버전·피드백 영역. 장별 콘티는 세로로 넘기는 원고 카드로 표시. 과한 대시보드 장식 없이 편집 내용에 공간을 배분한다.

- 목록: 한술툰 카드, 기존 프로젝트 목록 유지.
- 작업실: 다음 화 생성, 기존 회차, 사연/파트 표시, 미저장 표시.
- 주제: 자동/직접 작성, 생성 방향, 제목·핵심갈등·3화 흐름.
- 콘티: 자동/직접 작성, 장 추가·삭제, 장면·대사·표정, 캡션.
- 검토: 수정 요청, 적용 대상(주제/콘티), 수정 반영 재생성, 저장, 콘티 승인.
- 이력: 버전 미리보기, 선택 버전 복원, 최신본으로 돌아가기.
- 입력에 label, 상태 aria-live, 오류 role=alert, 생성 중 중복 작업 차단.

## 6. 오류·보안

오래된 저장은 덮어쓰기 금지. 실패 시 원본과 편집본 보존. 모든 모델 출력은 서버에서 검증한다. 고정된 파일 경로만 사용하며 사용자 입력을 셸 명령에 삽입하지 않는다. 생성 프롬프트는 기존 CLI의 stdin을 사용한다.

## 7. 테스트

수동 편집→재생성 프롬프트 포함, 3화→새 사연 번호, 빈 콘티 승인 거부, 버전 복원, 오래된 revision 거부, 잘못된 모델 출력 거부, JSON 저장 재로드. 브라우저에서 한술툰 진입·모드 전환·편집·저장·복원·승인·모바일 가독성 확인.

## 8. 구현 순서

1. 순수 타입/검증/버전/프롬프트와 테스트.
2. 파일 저장 서비스·기존 CLI 생성 연결·API.
3. 작업실·목록 진입·기존 도시락 초안 시드.
4. 타입 검사와 실제 UI/API 확인, 발견한 문제 수정.

## 9. 범위 점검

이미지 자동 생성·게시·범용 시리즈 관리 기능을 추가하지 않는다. 기존 데이터 및 다른 진행 중인 변경을 보존한다.
