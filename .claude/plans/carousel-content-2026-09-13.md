# 카드뉴스·인스타툰 자동화 플랜 (2026-09-13)

설계: `docs/전략/37-카드뉴스-인스타툰-자동화.md`

| id | 노드 | 도메인 | D1/D2/D3/D4 | 점수 | 티어 | 에이전트 | 상태 |
|---|---|---|---|---|---|---|---|
| K0 | 규격·관행·리스크 리서치 | research | 1/0/0/1 | 2 | balanced | general-purpose | done |
| K1 | 카드뉴스·인스타툰 아키텍처 결정 | architecture | 2/2/1/2 | 7 | powerful | main | done |
| K2 | 저장소·API·페이지·에디터·Still 컴포넌트 | frontend | 1/1/0/1 | 3 | balanced | main | done |
| K3 | Pretendard 번들 + 캐러셀 렌더 스크립트(bundle 1회·renderStill N회·JPEG) | render | 1/1/1/1 | 4 | balanced | worker | todo |
| K4 | 카드뉴스 원고 LLM(스키마·프롬프트) | llm-prompt | 1/1/0/2 | 4 | balanced | worker | todo |
| K5 | 인스타툰 기획 LLM(캐릭터 락·콘티) | llm-prompt | 1/1/0/2 | 4 | balanced | worker | todo |
| K6 | Python carousel images: 카드 배경·캐릭터 시트·컷(codex, images_a 재사용) | image-gen | 1/1/0/1 | 3 | balanced | worker | todo |
| K7 | 캐러셀 게시(Buffer 이미지 assets 또는 Graph API) | publishing | 1/2/2/1 | 6 | powerful | main | todo · 승인필요 |
| K8 | 최종 리뷰 | review | 1/2/1/2 | 6 | powerful | main | todo |

## 게이트
- G1 완전성: PASS — 전 노드 4축·티어·모델 채움
- G2 오버라이드: PASS — 아키텍처(K1)·외부 게시(K7)·최종 리뷰(K8) powerful, 메인이 직접
- G3 클램프: PASS
- G4 비용: PASS — powerful 3/9 = 33% — 30% 초과. 초과 근거: 3개 모두 하드 오버라이드(K1 아키텍처·K7 외부 발신·K8 최종 리뷰)라 강등 불가
- G5 안전: PASS — D3=2인 K7에 requires_approval
