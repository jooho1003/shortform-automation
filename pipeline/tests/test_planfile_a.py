from pathlib import Path

import pytest

from shortform import StepFailed
from shortform.planfile_a import load


def test_a_plan_separates_character_sheets_and_dialogue(tmp_path: Path):
    plan_path = tmp_path / "01-기획안.md"
    plan_path.write_text(
        """# 리버의 아침식사

## 시놉시스

리버가 토스트를 만들며 하루를 시작한다.

## 락 블록

### CHARACTER

작은 수달 캐릭터.

### COSTUME

노란 앞치마.

### GLOBAL STYLE

따뜻한 2D 애니메이션.

### NEGATIVE

워터마크 없음.

## 캐릭터 시트

### 리버
- 역할: 주인공
- 외형: 작은 수달
- 말투: 빠르고 밝음
- 고정 소품: 나무 주걱

### 토스트
- 역할: 말하는 조연
- 외형: 노릇한 식빵
- 말투: 느긋함
- 고정 소품: 없음

## 대사

| 시각 | 캐릭터 | 대사 | 연출 |
|---:|---|---|---|
| 0.0 | 리버 | 오늘은 완벽한 아침이야! | 눈을 반짝인다 |
| 3.5 | 토스트 | 나를 태우지는 말아줘. | 살짝 떤다 |

## 컷표

| 컷 | TC | 렌즈 | 액션 | 카메라 | 필수 |
|---|---|---|---|---|---|
| 1 | 0-4 | 35mm | 식탁으로 달려온다 | tracking | 필수 |

## 음향 설계

- 환경음: 주방 소리

## 메타데이터

- 제목: 리버의 아침식사
- 공개: unlisted
""",
        encoding="utf-8",
    )

    plan = load(plan_path)

    assert [(c.name, c.details["역할"]) for c in plan.characters] == [("리버", "주인공"), ("토스트", "말하는 조연")]
    assert [(d.at, d.character, d.text) for d in plan.dialogues] == [
        (0.0, "리버", "오늘은 완벽한 아침이야!"),
        (3.5, "토스트", "나를 태우지는 말아줘."),
    ]
    assert plan.comments == []


def test_a_dialogue_reads_optional_english_column(tmp_path: Path):
    plan_path = tmp_path / "01-기획안.md"
    plan_path.write_text(
        """# 시놉시스

첫 줄 훅

## 락 블록

### CHARACTER

a fox

## 컷표

| 컷 | TC | 렌즈 | 액션 | 카메라 | 필수 |
|---:|---:|---|---|---|---|
| 1 | 0-6 | 50mm | 선다 | 고정 | 필수 |

## 대사

| 시각 | 캐릭터 | 대사 | 연출 | 영어 |
|---:|---|---|---|---|
| 0.3 | 사구 | 넵! | 밝게 | Yes, sir! |
| 2.0 | 대표님 | 가볍게. | 지나가듯 | |
""",
        encoding="utf-8",
    )
    plan = load(plan_path)
    assert [(d.text, d.english) for d in plan.dialogues] == [("넵!", "Yes, sir!"), ("가볍게.", "")]


CHAIN_PLAN = """# 시놉시스

첫 출근.

## 락 블록

### CHARACTER

Sagu the fennec fox.

### COSTUME

Green vest.

### GLOBAL STYLE

Photoreal office.

### NEGATIVE

No text.

## 세트

- S1: 입구 밖. 유리 양문.
- S2: 사무실. 창 왼쪽, 책상 섬 2×2.
- V1: S1 보도에서 유리문 정면, 사구 눈높이
- V3: S2 안쪽에서 유리문을 향한 역방향

## 컷표

| 컷 | TC | 뷰 | 시작 | 렌즈 | 액션 | 끝 프레임 | 카메라 | 보이는 사람 | 필수 | 모션 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0-3 | V1 | 새로 | 35mm | 걸어오는 중 | 멈춰 올려다봄 | 고정 | 없음 | 필수 | The fox walks up. |
| 2 | 3-6 | V1 | 이어서 | 35mm | (=1 끝) | 사원증을 봄 | 고정 | 없음 | 필수 | He looks down. |
| 3 | 6-9 | V3 | 각도변경 | 50mm | 정면 | 입 열림 | 고정 | 윤이사·하대리 | 필수 | He speaks. |

## 대사

| 시각 | 캐릭터 | 대사 | 연출 |
|---|---|---|---|
| 0.3 | 사구 | 와 | 속마음 |

## 음향 설계

- 환경음: 사무실

## 메타데이터

- 제목: 테스트
"""


def _write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "01-기획안.md"
    path.write_text(text, encoding="utf-8")
    return path


def test_chain_columns_and_sets_are_parsed(tmp_path: Path):
    plan = load(_write(tmp_path, CHAIN_PLAN))
    assert plan.sets == {
        "S1": "입구 밖. 유리 양문.", "S2": "사무실. 창 왼쪽, 책상 섬 2×2.",
        "V1": "S1 보도에서 유리문 정면, 사구 눈높이", "V3": "S2 안쪽에서 유리문을 향한 역방향",
    }
    c1, c2, c3 = plan.cuts
    assert (c1.view, c1.start_mode, c1.end_action, c1.visible) == ("V1", "새로", "멈춰 올려다봄", "없음")
    assert c2.chained and c2.start_mode == "이어서"
    assert c3.start_mode == "각도변경" and c3.visible == "윤이사·하대리"
    assert c1.motion == "The fox walks up."


def test_plan_without_chain_columns_still_loads(tmp_path: Path):
    legacy = CHAIN_PLAN.replace(
        "| 컷 | TC | 뷰 | 시작 | 렌즈 | 액션 | 끝 프레임 | 카메라 | 보이는 사람 | 필수 | 모션 |\n|---|---|---|---|---|---|---|---|---|---|---|\n"
        "| 1 | 0-3 | V1 | 새로 | 35mm | 걸어오는 중 | 멈춰 올려다봄 | 고정 | 없음 | 필수 | The fox walks up. |\n"
        "| 2 | 3-6 | V1 | 이어서 | 35mm | (=1 끝) | 사원증을 봄 | 고정 | 없음 | 필수 | He looks down. |\n"
        "| 3 | 6-9 | V3 | 각도변경 | 50mm | 정면 | 입 열림 | 고정 | 윤이사·하대리 | 필수 | He speaks. |",
        "| 컷 | TC | 렌즈 | 액션 | 카메라 | 필수 |\n|---|---|---|---|---|---|\n| 1 | 0-6.5 | 35mm | 서 있다 | 고정 | 필수 |",
    )
    plan = load(_write(tmp_path, legacy))
    assert plan.cuts[0].start_mode == "새로" and plan.cuts[0].end_action == "" and not plan.cuts[0].chained
    assert plan.sets  # 세트 절은 그대로 읽힌다


@pytest.mark.parametrize("bad, message", [
    # 첫 컷은 새로여야 한다
    ("| 1 | 0-3 | V1 | 새로 |", "| 1 | 0-3 | V1 | 이어서 |"),
    # 이어서는 앞 컷과 같은 뷰
    ("| 2 | 3-6 | V1 | 이어서 |", "| 2 | 3-6 | V3 | 이어서 |"),
    # TC가 이어져야 한다
    ("| 3 | 6-9 | V3 | 각도변경 |", "| 3 | 7-10 | V3 | 각도변경 |"),
    # 정수 초
    ("| 1 | 0-3 | V1 | 새로 |", "| 1 | 0-2.5 | V1 | 새로 |"),
    # 모르는 시작 값
    ("| 3 | 6-9 | V3 | 각도변경 |", "| 3 | 6-9 | V3 | 점프 |"),
    # 세트 절에 없는 뷰
    ("| 3 | 6-9 | V3 | 각도변경 |", "| 3 | 6-9 | V9 | 각도변경 |"),
])
def test_chain_rules_are_enforced(tmp_path: Path, bad: str, message: str):
    broken = CHAIN_PLAN.replace(bad, message)
    assert broken != CHAIN_PLAN
    with pytest.raises(StepFailed):
        load(_write(tmp_path, broken))
    # 정수 초 케이스는 TC 불연속도 함께 걸리지만, 어느 쪽이든 StepFailed면 된다
