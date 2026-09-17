import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const remotionDir = path.resolve(here, '..');
const repoRoot = path.resolve(remotionDir, '..', '..');
const id = process.argv[2] ?? '';
if (!/^\d{8}-[A-Za-z0-9가-힣_-]{1,80}$/u.test(id)) throw new Error('사용법: node scripts/render-blog-thumb.mjs <blog-project-id>');
const projectDir = path.join(repoRoot, '블로그', id);
const project = JSON.parse(await fs.readFile(path.join(projectDir, '프로젝트.json'), 'utf8'));
const imageDir = path.join(projectDir, '이미지');
await fs.mkdir(imageDir, {recursive: true});
const serveUrl = await bundle({entryPoint: path.join(remotionDir, 'src', 'index.ts'), publicDir: projectDir, webpackOverride: (config) => config});
const inputProps = {title: project.title || project.title_candidates?.[0] || project.keyword.main, keyword: project.keyword.main, niche: '콘텐츠 자동화 · AI 제작 노트'};
const composition = await selectComposition({serveUrl, id: 'BlogThumb', inputProps});
await renderStill({composition, serveUrl, inputProps, output: path.join(imageDir, '00-대표.jpg'), imageFormat: 'jpeg', jpegQuality: 92});
console.log(`블로그/${id}/이미지/00-대표.jpg`);
