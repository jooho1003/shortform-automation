# 사구 음색 + 사용자 녹음 변환 실험

사용자가 승인한 원본 녹음과 사구 3B 참조 음성을 Seed-VC의 서로 다른 입력으로 사용한다. 일회성 미디어 생성이며 제품 기능·기본 프리셋은 변경하지 않는다.
로컬 실행 모델과 최소 의존성을 pipeline/data/tools/seed-vc 아래에 격리한다. 다른 GPU 작업은 종료하지 않는다. 원본을 보존하고 원래 속도 및 1.2배속 MP3/WAV를 만든다.
원본/참조/출력 해시 및 재현 매개변수, decode·clipping QA를 기록한다. 실제 청취를 하지 않았으면 음색 일치나 발음 보존을 확정하지 않는다.

노드 runtime-inspect: domain explore, D1/D2/D3/D4=0/0/0/0, score 0, tier fast, agent explorer, claude_model haiku, codex_model gpt-5.6-luna, depends_on 없음, 산출물 로컬 변환 환경 조사. 기존 탐색 에이전트로 실행.
노드 conversion: domain general, D1/D2/D3/D4=1/1/0/2, score 4, tier powerful(모호한 음색 판단 override), agent main, claude_model opus, codex_model gpt-5.6-sol, depends_on runtime-inspect, 산출물 비교 오디오/manifest. 현재 메인 세션에서 수행하며 모델 전환을 주장하지 않는다.
G1/G2/G3/G4/G5: PASS. powerful 50% 예외 근거: 음색 변환 방식 선택과 최종 검토는 메인 직접 판단 대상.
