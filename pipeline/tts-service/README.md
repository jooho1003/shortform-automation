# Qwen3 음성 스튜디오 실행

숏폼 콘솔의 [음성 스튜디오](http://localhost:3123/voices)에서 한국어 대본을 입력하고 Qwen3 음성을 생성·재생·비교한다. 음성 설정은 프리셋으로 저장한 후 원하는 회차에 적용할 수 있다.

## 설치

Windows / Python 3.10 / NVIDIA CUDA GPU 기준. 기존 제작 환경 `.venv`와 분리한다. 아래 명령은 `pipeline` 폴더의 PowerShell에서 실행한다. 이 PC에는 설치와 실제 GPU 합성 확인을 마쳤다.

```powershell
py -3.10 -m venv .venv-tts
.venv-tts/Scripts/python.exe -m pip install --upgrade pip setuptools wheel
# qwen-tts가 사용하는 sox 패키지는 설치 메타데이터 생성에도 numpy가 필요하다.
.venv-tts/Scripts/python.exe -m pip install "numpy>=2,<2.3"
.venv-tts/Scripts/python.exe -m pip install torch==2.9.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/cu128
.venv-tts/Scripts/python.exe -m pip install -r tts-service/requirements.txt
```

FFmpeg와 FFprobe도 PATH에 있어야 한다. 기존 숏폼 파이프라인의 설치를 공유한다. FlashAttention 설치는 필요하지 않으며 PyTorch SDPA를 사용한다.

```powershell
npm run dev -w web
```

브라우저에서 **음성 스튜디오 → 엔진 시작**을 누른다. 엔진은 `127.0.0.1:8765`에서 실행되고 모델은 최초 선택 시 내려받는다. 자동 시작 로그는 `data/tts/service.log`에 쌓인다. 직접 실행할 수도 있다.

```powershell
$env:PYTHONUTF8='1'
.venv-tts/Scripts/python.exe -m shortform.tts.service
```

엔진은 한 프로세스만 실행할 수 있다. 코드를 수정했다면 진행 중인 작업을 끝낸 후 기존 엔진을 종료하고 다시 시작한다. 웹 페이지를 닫아도 이미 접수한 작업과 엔진은 계속 실행된다. 시작 시 GPU를 미리 점유하지 않으며 첫 합성 또는 ‘선택 모델 준비’에서 모델을 로딩한다.

## 사용 순서

1. 기본 목소리 / 설명으로 만들기 / 참조 음성 사용 중 하나를 선택한다.
2. 대본, 언어, 발음 사전, 속도와 문장 간격을 설정한다. 기본 초안은 0.6B CustomVoice · Korean · Sohee다.
3. **샘플 만들기**를 누른 후 **재생** 또는 오디오 플레이어로 듣는다. 최대 세 후보를 비교 고정할 수 있다. WAV 저장과 탐색도 지원한다.
4. 들은 결과를 보관하려면 샘플의 **이 설정 선택 → 새 프리셋 저장**을 누른다. 청취 전 설정도 ‘현재 초안’으로 저장할 수 있지만 VoiceDesign은 완성된 샘플이 필요하다.
5. 회차 상세의 **음성 스튜디오에서 듣기**로 들어와 프리셋을 선택하고 **이 회차에 적용 → 새 음성·타임라인 만들기**를 실행한다. 완료 후 영상을 다시 렌더한다.

‘설명으로 만들기’는 선택한 샘플의 원본 WAV와 실제 읽은 문장을 참조 음성으로 보관하고 **0.6B Base 프리셋**으로 저장한다. 이후 새 문장에 이 참조를 사용한다. 원래 설명과 모델은 원본 샘플 기록에 남는다. 음색을 완전히 동일하게 재현한다는 보장은 없다.

**새 회차 기본값으로**는 이후 생성하는 회차에만 적용된다. 프리셋을 수정해도 이미 생성된 회차는 고정된 리비전과 설정 사본을 유지한다. 음성 설정 파일이 없는 과거 회차는 기존 `config/voice.yaml`의 Edge 설정을 계속 사용한다. 전역 기본값은 사용자가 변경하기 전까지 Edge다.

## 모델과 설정

| 모델 | 화면 기능 |
|---|---|
| 0.6B CustomVoice | 미리 정해진 화자, 언어 |
| 1.7B CustomVoice | 화자, 언어, 읽는 방식 지시 |
| 1.7B VoiceDesign | 자연어 설명으로 음성 후보 생성 |
| 0.6B / 1.7B Base | WAV·MP3·M4A 참조 음성과 해당 대본으로 합성 |

- 미리듣기는 1–500자. 회차 갱신은 총 10,000자·200문장, 문장당 500자 이내다.
- 참조 음성은 3–30초, 최대 20MB. 실제 디코딩·길이·무음을 검사한다.
- 속도 0.8–1.2배는 생성 후 FFmpeg `atempo`로 적용된다. 원본 파형은 보존한다. 문장 간격은 B안 문장 사이에만 추가된다.
- A안은 기획안의 대사 시작 시각과 컷 구성을 유지한다. 대사가 구간을 초과하거나 컷 시각이 달라졌다면 기존 결과를 유지하고 오류를 알린다. 음성 갱신에서는 fal 영상 생성을 호출하지 않는다.
- B안 원음 템플릿은 TTS 적용 대상이 아니다. B안 브리핑의 수동 클립이 새 음성보다 짧으면 더 긴 클립이나 짧은 대본이 필요하다.
- 자막 어절 위치는 음성 길이를 기준으로 추정한다. 강제 정렬·실시간 스트리밍은 구현 범위에 포함하지 않았다.

## 저장·취소·복구

| 경로 | 내용 |
|---|---|
| `data/tts/huggingface/` | 내려받은 모델과 토크나이저 |
| `data/tts/cache/` | 원본·속도 적용 WAV, 측정값 |
| `data/tts/jobs/` | 큐 상태, 접수된 설정 사본, 결과·오류 |
| `data/voices/presets/<id>/<revision>.json` | 수정 이력을 보존하는 프리셋 |
| `data/voices/references/<id>/` | 참조 음성과 대본·해시 |
| `config/tts.yaml` | 새 회차 기본 프리셋 포인터 |
| `<회차>/03-소재/voice-settings.json` | 해당 회차의 고정 설정 |
| `<회차>/03-소재/tts-manifest.json` | 생성 입력 해시와 문장별 결과 |
| `<회차>/.tts-previous-<id>/` | 성공적인 음성 갱신 전 소재 백업 |

GPU 작업은 한 번에 하나씩 수행한다. ‘샘플 만들기’는 같은 조건·테이크의 오디오를 재사용하고 ‘다른 테이크 만들기’는 새 seed를 만든다. 모델 버전·합성 문장·발음·참조·속도가 결과 식별에 반영된다. 속도와 간격만 바꾸면 원본 합성 캐시를 재사용한다. 다른 모델이 로딩되어 있으면 모델 교체 시간이 추가될 수 있다.

대기 작업 취소는 즉시 반영된다. 진행 중 추론은 호출이 반환되는 안전한 지점에서 결과 공개를 중단한다. 서비스 재시작 시 미완료 작업은 ‘중단됨’으로 바뀌며 자동 재접수하지 않는다. 회차 생성은 별도 소재 폴더에서 완성한 뒤 교체하므로 실패 중간 결과가 기존 완성본에 섞이지 않는다. 작업 프로세스를 강제 종료하면 임시 폴더가 남을 수 있다.

현재 자동 파일 정리 기능은 없다. 음성 캐시·참조·작업 내역과 소재 백업은 유지되며 git에서 제외된다. 비교 고정은 현재 화면 세션에서만 유지되고 최근 작업 30개에서 후보를 선택한다. C안 모션 파이프라인 연결은 별도 작업이다.

## 검증

```powershell
.venv/Scripts/python.exe -m pytest tests -q
.venv-tts/Scripts/python.exe -m pip install pytest httpx
.venv-tts/Scripts/python.exe -m pytest tests/test_tts_service.py -q
npm run typecheck -w web
npm run build -w web
```

실제 완료한 샘플을 임시 B안 회차로 연결하는 통합 검사는 다음과 같다. 임시 테스트 클립과 소재만 생성하며 기존 회차, 유료 API, 업로드는 사용하지 않는다.

```powershell
.venv/Scripts/python.exe tts-service/smoke_episode.py <완료한-미리듣기-job-id>
```

실측 결과와 브라우저 검증은 [검증 기록](VALIDATION.md)에 정리한다. 공식 API 기준은 [Qwen3-TTS 저장소](https://github.com/QwenLM/Qwen3-TTS), CUDA 휠 설치 기준은 [PyTorch 공식 설치 기록](https://pytorch.org/get-started/previous-versions/)이다.
