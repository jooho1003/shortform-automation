import assert from 'node:assert/strict';
import test from 'node:test';
import {applyGenerated, assertApprovable, assertRevision, blankDraft, cleanDraft, draftOf, editorSlides, generationPrompt, nextEpisode, restoreVersion, saveVersion} from './hansulCore.ts';

const at = '2026-10-01T00:00:00Z';
const ready = () => ({...blankDraft(), topic: {title: '도시락', premise: '호의가 의무가 되었다', outline: ['시작', '갈등', '해결']}, cards: [{scene: '도시락을 닫는다', dialogue: '보리: 내일은 안 싸.\n내레이션: 다음 날.', emotion: '점눈'}]});

test('3화가 끝나야 새 사연으로 넘어가고 중간 회차는 앞 주제를 이어받는다', () => {
  const one = saveVersion(nextEpisode(undefined, 'one', at), ready(), '시드', at);
  const two = nextEpisode(one, 'two', at);
  assert.deepEqual([two.number, two.arc, two.part], [2, 1, 2]);
  assert.deepEqual(two.topic, one.topic);
  assert.equal(two.cards.length, 0);
  const three = nextEpisode(two, 'three', at);
  const four = nextEpisode(three, 'four', at);
  assert.deepEqual([four.number, four.arc, four.part], [4, 2, 1]);
  assert.equal(four.topic.title, '');
});

test('수정본 저장과 복원은 기존 이력을 보존하고 승인 연결을 무효화한다', () => {
  const one = saveVersion(nextEpisode(undefined, 'one', at), ready(), '초안', at);
  const edited = {...draftOf(one), topic: {...one.topic, title: '수정 제목'}};
  const two = saveVersion({...one, status: 'approved', editorId: 'old'}, edited, '수정', at);
  const restored = restoreVersion(two, 1, at);
  assert.equal(restored.topic.title, '도시락');
  assert.equal(restored.history.length, 3);
  assert.equal(restored.history[1].draft.topic.title, '수정 제목');
  assert.equal(restored.editorId, null);
  assert.equal(restored.status, 'draft');
  edited.topic.title = '외부 변경';
  assert.equal(two.topic.title, '수정 제목');
});

test('재생성 프롬프트는 저장 전 직접 수정과 이전 회차, 현재 파트를 포함한다', () => {
  const one = saveVersion(nextEpisode(undefined, 'one', at), ready(), '초안', at);
  const two = nextEpisode(one, 'two', at);
  const draft = {...ready(), feedback: '큰 표정 빼기', cards: [{scene: '손으로 고친 장면', dialogue: '보리: 안 할래', emotion: '담백하게'}]};
  const prompt = generationPrompt({revision: 1, episodes: [one, two]}, two, draft, 'storyboard', true, '남자=라쿤');
  for (const text of ['손으로 고친 장면', '큰 표정 빼기', '2/3화', '내일은 안 싸', '남자=라쿤']) assert.ok(prompt.includes(text));
});

test('빈 콘티 승인과 잘못된 모델 결과, 길이 초과 입력은 거부한다', () => {
  assert.throws(() => assertApprovable(blankDraft()));
  assert.throws(() => assertApprovable({...ready(), cards: []}));
  assert.throws(() => applyGenerated(ready(), 'storyboard', {cards: [{scene: '', dialogue: '', emotion: ''}], caption: ''}));
  assert.throws(() => cleanDraft({...ready(), feedback: 'a'.repeat(6001)}));
  assert.throws(() => applyGenerated(ready(), 'topic', {title: '제목', premise: '갈등', outline: ['하나']}));
  assert.doesNotThrow(() => assertApprovable(ready()));
});

test('오래된 탭은 409이며 주제 생성은 기존 콘티를 지우지 않는다', () => {
  assert.throws(() => assertRevision({revision: 4, episodes: []}, 3), e => e.status === 409);
  const result = applyGenerated(ready(), 'topic', {title: '새 제목', premise: '새 갈등', outline: ['1', '2', '3']});
  assert.equal(result.cards[0].dialogue, ready().cards[0].dialogue);
});

test('컷 편집기 전달 시 화자와 내레이션을 구분한다', () => {
  const slide = editorSlides(ready().cards)[0];
  assert.equal(slide.panels[0].bubbles[0].speaker, '보리');
  assert.equal(slide.panels[0].bubbles[1].kind, 'narration');
  assert.equal(slide.panels[0].image, null);
});

test('기존 문서의 이어지는 대사와 표지 부제·회차 표기를 잃지 않는다', () => {
  const cards = [{scene: '표지', dialogue: '제목: 남친 도시락\n동료 것까지 싸 달란다. 작은 표기: 1/3\n담이 메시지: “세 개.”\n“동료 둘도 먹고 싶대.”', emotion: ''}];
  const bubbles = editorSlides(cards)[0].panels[0].bubbles;
  assert.equal(bubbles[1].text, '동료 것까지 싸 달란다');
  assert.equal(bubbles[2].text, '1/3');
  assert.equal(bubbles[3].speaker, '담이');
  assert.equal(bubbles[4].speaker, '담이');
});

test('기존 컷 편집기의 제한을 넘는 대사는 조용히 자르지 않고 승인을 막는다', () => {
  const draft = ready();
  draft.cards[0].dialogue = Array.from({length: 7}, () => '보리: 대사').join('\n');
  assert.throws(() => assertApprovable(draft), /최대 6줄/);
});
