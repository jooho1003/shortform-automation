"""images_a의 순수 함수들: 수정요청 파싱(v1·v2), 체인 확장, 프레임 작업 목록, 프롬프트 내용.
codex는 호출하지 않는다."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from shortform import StepFailed
from shortform.steps import images_a
from shortform.steps.check_frames import END_KEYFRAME, KEYFRAME, SET_SHEET, SHEET


def _cut(n, start_mode="새로", end_action="끝", view="V1", visible="없음", action="시작"):
    return SimpleNamespace(n=n, start_mode=start_mode, end_action=end_action, view=view, visible=visible,
                           action=action, camera="고정", lens="50mm", start=3.0 * (n - 1), end=3.0 * n,
                           required=True, chained=start_mode == "이어서")


def _plan(cuts):
    return SimpleNamespace(cuts=cuts, locks={"CHARACTER": "fox", "COSTUME": "vest", "GLOBAL STYLE": "office", "NEGATIVE": "no text"},
                           sets={"S1": "입구", "V1": "문 정면", "V3": "역방향"}, synopsis="첫 출근")


CHAIN = _plan([_cut(1), _cut(2, "이어서"), _cut(3, "이어서"), _cut(4, "각도변경", view="V3", visible="박대표")])


class TestParseFix:
    def test_v2_frames(self):
        note = '{"version":2,"frames":[{"cut":2,"which":"end"},{"cut":1,"which":"start"}],"instruction":"귀를 더 세워"}'
        assert images_a._parse_fix(note, {1, 2, 3, 4}) == (False, [(1, "start"), (2, "end")], "귀를 더 세워")

    def test_v1_cuts_mean_both_frames(self):
        note = '{"version":1,"cuts":[3],"instruction":"더 밝게"}'
        assert images_a._parse_fix(note, {1, 2, 3, 4}) == (False, [(3, "end"), (3, "start")], "더 밝게")

    def test_number_list_means_both_frames(self):
        assert images_a._parse_fix("2", {1, 2}) == (False, [(2, "end"), (2, "start")], "")

    @pytest.mark.parametrize("note", [
        '{"version":2,"frames":[{"cut":9,"which":"end"}],"instruction":"x"}',   # 없는 컷
        '{"version":2,"frames":[{"cut":1,"which":"middle"}],"instruction":"x"}', # 모르는 which
        '{"version":2,"frames":[],"instruction":"x"}',                          # 빈 목록
        '{"version":2,"frames":[{"cut":1,"which":"end"}],"instruction":""}',   # 빈 지시
    ])
    def test_v2_rejects_bad_input(self, note):
        with pytest.raises(StepFailed):
            images_a._parse_fix(note, {1, 2, 3, 4})


class TestExpandFrames:
    def test_start_implies_end(self):
        # 끝 프레임은 시작 프레임을 참조하므로 시작을 바꾸면 끝도 다시 만든다
        assert images_a.expand_frames(CHAIN, [(1, "start")]) == [(1, "start"), (1, "end"), (2, "end"), (3, "end")]

    def test_expand_frames_follows_chain(self):
        # '이어서' 컷의 시작은 앞 컷의 끝 파일이다. 그 뒤 체인의 끝 프레임이 모두 무효가 된다.
        assert images_a.expand_frames(CHAIN, [(3, "start")]) == [(2, "end"), (3, "end")]

    def test_end_of_last_in_chain_changes_only_itself(self):
        assert images_a.expand_frames(CHAIN, [(3, "end")]) == [(3, "end")]

    def test_angle_change_start_is_its_own_file(self):
        assert images_a.expand_frames(CHAIN, [(4, "start")]) == [(4, "start"), (4, "end")]


def test_frame_name_maps_chained_start_to_previous_end():
    assert images_a.frame_name(CHAIN, 2, "start") == END_KEYFRAME.format(n=1)
    assert images_a.frame_name(CHAIN, 1, "start") == KEYFRAME.format(n=1)
    assert images_a.frame_name(CHAIN, 4, "end") == END_KEYFRAME.format(n=4)


class TestFrameJobs:
    def test_jobs_skip_existing_and_chain_starts(self, tmp_path: Path):
        ep = SimpleNamespace(clips_dir=tmp_path)
        sheet = tmp_path / SHEET
        set_sheet = tmp_path / SET_SHEET
        for p in (sheet, set_sheet, tmp_path / KEYFRAME.format(n=1)):
            p.write_bytes(b"png")
        jobs = images_a._frame_jobs(ep, CHAIN, CHAIN.cuts, sheet, [set_sheet], "gpt-image", lambda n: "")
        assert [(j.cut.n, j.kind, j.out.name) for j in jobs] == [
            (1, "end", "키프레임-01-끝.png"),
            (2, "end", "키프레임-02-끝.png"),      # 이어서: 시작 파일 없음
            (3, "end", "키프레임-03-끝.png"),
            (4, "start", "키프레임-04.png"),
            (4, "end", "키프레임-04-끝.png"),
        ]
        # 끝 프레임은 자기 시작 프레임을 참조한다. 2번의 시작은 1번의 끝이다.
        assert jobs[1].refs[-1].name == "키프레임-01-끝.png"
        # 각도변경 시작은 앞 컷의 끝 프레임을 자세 참조로 붙인다
        assert jobs[3].refs[-1].name == "키프레임-03-끝.png"

    def test_prompts_carry_view_visible_and_pose_rules(self, tmp_path: Path):
        ep = SimpleNamespace(clips_dir=tmp_path)
        sheet, set_sheet = tmp_path / SHEET, tmp_path / SET_SHEET
        jobs = images_a._frame_jobs(ep, CHAIN, CHAIN.cuts, sheet, [set_sheet], "gpt-image", lambda n: "귀 더 크게" if n == 4 else "")
        start4 = next(j for j in jobs if j.cut.n == 4 and j.kind == "start")
        end1 = next(j for j in jobs if j.cut.n == 1 and j.kind == "end")
        assert "V3" in start4.prompt and "박대표" in start4.prompt and "같은 순간" in start4.prompt and "귀 더 크게" in start4.prompt
        assert "자세만" in end1.prompt and "키프레임-01.png" in end1.prompt and "그 외 사람·동물" in end1.prompt
        assert "시트-세트.png" in end1.prompt


def test_set_sheet_prompt_lists_places_and_views():
    prompt = images_a._set_sheet_prompt(CHAIN, Path("x/시트-세트.png"), "gpt-image")
    assert "- S1: 입구" in prompt and "- V1: 문 정면" in prompt and "- V3: 역방향" in prompt
    assert "사람·동물 없이" in prompt and "office" in prompt  # 락 블록 포함
