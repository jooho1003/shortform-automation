# 네이버 블로그 자동화 (2026-09-18)

설계: [docs/설계/04-네이버블로그-자동화.md](../../docs/설계/04-네이버블로그-자동화.md)

사용자 결정: 플랫폼 = 네이버 블로그, 소재 = 블로그 전용 새 글. 글쓰기 API가 2020년에 닫혀 있어 자동화의 무게를 "게시 직전까지"에 싣고, 게시는 copy(기본)·draft(옵트인) 2모드로 나눈다. publish(자동 발행)는 범위 밖.

| id | 노드 | 도메인 | D1/D2/D3/D4 | 점수 | 티어 | 에이전트 | 상태 |
|---|---|---|---|---|---|---|---|
| B0 | 제약 조사 + 아키텍처 결정 | architecture | 2/2/1/2 | 7 | powerful | main | done |
| B1 | 저장소·타입·CRUD·lint·API | general | 1/1/0/1 | 3 | balanced | claude | done |
| B2 | /blog 페이지·에디터·Nav | frontend | 1/1/0/1 | 3 | balanced | bkit:frontend-architect | done |
| B3 | 네이버 API·키워드·상위글·순위 | general | 1/1/1/1 | 4 | balanced | claude | done |
| B4 | 프롬프트 4종·스키마·연쇄 실행기 | general | 1/1/0/2 | 4 | balanced | claude | done |
| B5 | 대표 이미지 Still + 본문 이미지 | general | 1/1/0/1 | 3 | balanced | claude | done |
| B6 | 키·서명·로그인 프로필 보안 검토 | security | 1/1/1/1 | 4 | powerful | bkit:security-architect | done |
| B7 | 에디터 실측 + 게시기 copy·draft | publishing | 2/1/2/1 | 6 | powerful | main | code done · **실계정 검증 승인 대기** |
| B8 | 주간 배치 + 스케줄러 | general | 1/0/1/1 | 3 | balanced | claude | done |
| B9 | 수용 기준 테스트 | qa | 1/1/1/1 | 4 | balanced | bkit:qa-lead | automated done · 실계정 2건 대기 |
| B10 | 최종 리뷰 | review | 1/2/1/2 | 6 | powerful | main | done |

의존: B0 → B1 → {B2, B4 → B5} · B0 → B3 → B6 → B7(+B1) · {B3, B4} → B8 · {B2, B5, B7, B8} → B9 → B10.
B1~B5만으로 copy 모드 실사용이 된다. B7은 사용자 승인 전에는 시작하지 않는다.

## 게이트

- **G1 완전성 — PASS.** 11개 노드 모두 domain·4축·tier·agent·claude/codex 모델·depends_on·산출물 기입.
- **G2 오버라이드 — PASS.** 아키텍처(B0)·최종 리뷰(B10)·보안(B6)·외부 발신(B7) 모두 powerful. B0·B7·B10은 위임하지 않고 main이 직접.
- **G3 클램프 — PASS.** B6은 점수 4지만 security floor로 powerful 승격. frontend·qa는 floor balanced 충족. ceiling 위반 없음.
- **G4 비용 — PASS.** powerful 4/11 = 36%로 30% 초과. 근거: B0 아키텍처 하드 오버라이드 / B6 security floor / B7 외부 계정 발신 D3=2 + 미확인 DOM / B10 최종 리뷰 하드 오버라이드. 넷 다 강등 불가.
- **G5 안전 — PASS.** D3=2는 B7 하나. `requires_approval: true` + 범위 한정(본인 계정 비공개 임시저장 1건까지).

## 구현 시 적용한 결정

1. 주제는 `1인 사업자의 콘텐츠 자동화와 AI 제작`, 말투는 직접 해 본 과정을 과장 없이 설명하는 실무자형으로 설정했다.
2. 기본은 `copy`; `draft_enabled: false`로 두고 코드와 안전장치만 구현했다.
3. 검색광고 API 계정이 없어도 설정의 시드 키워드가 `manual-fallback` 보드로 생성된다.
