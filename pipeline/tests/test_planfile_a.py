from pathlib import Path

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
