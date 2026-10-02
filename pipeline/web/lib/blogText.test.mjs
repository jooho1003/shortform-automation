import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import YAML from 'yaml';

import {reactionEmojis, readableBody, vaguePhrases} from './blogText.ts';

test('위치 블록 기호는 감탄 이모지로 세지 않는다', () => {
  const body = '반가웠어요 🍣 맛있었어요 😋\n\n## 위치\n\n📍 서울 노원구\n\n[🗺️ 네이버 지도 보기](https://naver.me/abc)';
  assert.deepEqual(reactionEmojis(body), ['🍣', '😋']);
});

test('같은 감탄 이모지를 반복하면 그대로 드러난다', () => {
  const emojis = reactionEmojis('좋아요 😋 또 좋아요 😋');
  assert.equal(emojis.length, 2);
  assert.equal(new Set(emojis).size, 1);
});

test('blog.yaml의 막연한 평가 목록이 설계가 금지한 표현을 잡는다', () => {
  const config = YAML.parse(fs.readFileSync(new URL('../../config/blog.yaml', import.meta.url), 'utf8'));
  const found = vaguePhrases('종류도 다양하고 퀄리티도 괜찮아서 좋았어요. 선택지가 다양하다는 점, 퀄리티가 좋았습니다.', config.vague_phrases);
  assert.deepEqual(found.sort(), ['선택지가 다양', '종류도 다양', '퀄리티가 좋', '퀄리티도 괜찮'].sort());
  assert.deepEqual(vaguePhrases('연어 초밥이 두툼했어요.', config.vague_phrases), []);
});

test('붙여넣기 텍스트는 외부 링크 URL을 남기고 내부 링크는 글자만 남긴다', () => {
  const text = readableBody('![레일](이미지/01.jpg)\n\n[🗺️ 지도 보기](https://naver.me/abc)\n\n[메모](../메모.md)');
  assert.equal(text, '[이미지: 레일]\n\n🗺️ 지도 보기 https://naver.me/abc\n\n메모');
});
