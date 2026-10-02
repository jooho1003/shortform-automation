import assert from 'node:assert/strict';
import test from 'node:test';

import {affectedCuts, chainGroups, coverageGaps, endFrameName, fixRequestNote, formatFixRequest, speechWindows, startFrameName} from './storyboard.ts';

const cut = (n, start_mode = '새로', view = 'V1') => ({n, start: 3 * (n - 1), end: 3 * n, lens: '', action: '', camera: '', required: true, view, start_mode, end_action: 'e'});
const cuts = [cut(1), cut(2, '이어서'), cut(3, '이어서'), cut(4, '각도변경', 'V3'), cut(5, '이어서', 'V3')];

test('이어서 컷은 앞 컷 끝 프레임에서 시작한다', () => {
  assert.equal(startFrameName(cuts, cuts[1]), '키프레임-01-끝.png');
  assert.equal(startFrameName(cuts, cuts[0]), '키프레임-01.png');
  assert.equal(startFrameName(cuts, cuts[3]), '키프레임-04.png');
  assert.equal(endFrameName(cuts[4]), '키프레임-05-끝.png');
});

test('이어서가 아닌 컷에서 체인 묶음을 나눈다', () => {
  assert.deepEqual(chainGroups(cuts).map((g) => g.map((c) => c.n)), [[1, 2, 3], [4, 5]]);
});

test('타임라인의 실측 발화 구간을 사용한다', () => {
  const dialogues = [{at: 0.3, character: '사구', text: '와'}, {at: 6.1, character: '사구', text: '회의'}];
  const timeline = [{at: 0.3, speechStart: 0.5, speechEnd: 5.7}, {at: 6.1, speechStart: 6.3, speechEnd: 9.0}];
  const {windows, estimated} = speechWindows(dialogues, timeline);
  assert.equal(estimated, false);
  assert.deepEqual(windows.map((w) => [w.start, w.end]), [[0.5, 5.7], [6.3, 9.0]]);
});

test('타임라인이 없으면 글자 수로 발화 구간을 추정한다', () => {
  const dialogues = [{at: 1.0, character: '사구', text: '넵!'}, {at: 2.0, character: '박대표', text: '오늘 오기로 했던 인턴이에요'}];
  const {windows, estimated} = speechWindows(dialogues, null);
  assert.equal(estimated, true);
  assert.equal(windows[0].start, 1.2);
  assert.ok(windows[0].end > windows[0].start);
  // 12음절(공백 제외) / 초당 5음절 = 2.4초
  assert.equal(Math.round((windows[1].end - windows[1].start) * 10) / 10, 2.4);
});

test('허용치를 넘는 앞·사이·뒤 공백을 찾는다', () => {
  const windows = [{start: 0.5, end: 5.7}, {start: 6.9, end: 9.0}];
  assert.deepEqual(coverageGaps(windows, 10.0), [{from: 5.7, to: 6.9}, {from: 9.0, to: 10.0}]);
  assert.deepEqual(coverageGaps([{start: 1.0, end: 2.0}], 2.3), [{from: 0, to: 1.0}]);
});

test('v2 수정 요청과 기존 요청을 표시한다', () => {
  const note = fixRequestNote([{cut: 3, which: 'end'}, {cut: 1, which: 'start'}], '귀를 더 세워');
  assert.deepEqual(JSON.parse(note), {version: 2, frames: [{cut: 1, which: 'start'}, {cut: 3, which: 'end'}], instruction: '귀를 더 세워'});
  assert.equal(formatFixRequest(note), '컷 1 시작, 컷 3 끝: 귀를 더 세워');
  assert.equal(formatFixRequest('{"version":1,"cuts":[2],"instruction":"x"}'), '컷 2: x');
  assert.equal(formatFixRequest('그냥 글'), '그냥 글');
});

test('공유 프레임 영향이 체인을 따라 전파된다', () => {
  // 1의 끝 = 2의 시작. 2의 끝은 1의 끝을 참조하고 3의 시작이다 → 1,2,3 영상이 모두 바뀐다
  assert.deepEqual(affectedCuts(cuts, [{cut: 1, which: 'end'}]), [1, 2, 3]);
  assert.deepEqual(affectedCuts(cuts, [{cut: 5, which: 'end'}]), [5]);
  assert.deepEqual(affectedCuts(cuts, [{cut: 4, which: 'start'}]), [4, 5]);
});
