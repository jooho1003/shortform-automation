import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';

const templateSource = await readFile(new URL('../src/template.ts', import.meta.url), 'utf8');
const strippedSource = stripTypeScriptTypes(templateSource, {mode: 'strip'}).replace(
  "from 'remotion'",
  `from '${import.meta.resolve('remotion')}'`
);
const templateModule = await import(
  `data:text/javascript;base64,${Buffer.from(strippedSource).toString('base64')}`
);
const {resolveTemplate, resolveTimelineTemplate, selectComment} = templateModule;

test('resolveTemplate falls back to the legacy briefing template when the id is missing', () => {
  assert.deepEqual(resolveTemplate(), {
    kind: 'valid',
    id: 'briefing-focus',
    theme: 'legacy',
  });
});

test('resolveTemplate maps every supported id to its rendering theme', () => {
  assert.deepEqual(resolveTemplate('briefing-focus'), {
    kind: 'valid',
    id: 'briefing-focus',
    theme: 'legacy',
  });
  assert.deepEqual(resolveTemplate('feed-card-light'), {
    kind: 'valid',
    id: 'feed-card-light',
    theme: 'light',
  });
  assert.deepEqual(resolveTemplate('feed-card-dark'), {
    kind: 'valid',
    id: 'feed-card-dark',
    theme: 'dark',
  });
});

test('resolveTemplate preserves an unsupported id in an invalid result', () => {
  assert.deepEqual(resolveTemplate('unknown-template'), {
    kind: 'invalid',
    id: 'unknown-template',
  });
});

test('timeline display metadata does not select a visual template', () => {
  assert.deepEqual(resolveTimelineTemplate({templateName: '피드 카드 라이트'}), {
    kind: 'valid',
    id: 'briefing-focus',
    theme: 'legacy',
  });
});

test('selectComment uses timeline order rather than input order', () => {
  const comments = [
    {at: 8, nick: 'late', text: 'third'},
    {at: 2, nick: 'early', text: 'first'},
    {at: 5, nick: 'middle', text: 'second'},
  ];

  assert.deepEqual(selectComment(comments, 0), comments[1]);
  assert.deepEqual(selectComment(comments, 5), comments[2]);
  assert.deepEqual(selectComment(comments, 20), comments[0]);
});

test('selectComment returns null for an empty timeline', () => {
  assert.equal(selectComment([], 10), null);
});
