import assert from 'node:assert/strict';
import test from 'node:test';

import {markdownToHtml} from './blogRender.ts';

test('consecutive quote lines form one block and preserve line breaks and escaping', () => {
  assert.equal(
    markdownToHtml('> 첫 줄 **요약**\n> 둘째 줄 <script>\n\n도입 문단'),
    '<blockquote>첫 줄 <strong>요약</strong><br>둘째 줄 &lt;script&gt;</blockquote>\n<p>도입 문단</p>',
  );
});

test('blank lines separate quote blocks and following content remains outside', () => {
  assert.equal(
    markdownToHtml('> 첫 요약\n\n> 다음 요약\n## 소제목\n설명'),
    '<blockquote>첫 요약</blockquote>\n<blockquote>다음 요약</blockquote>\n<h2>소제목</h2>\n<p>설명</p>',
  );
});
