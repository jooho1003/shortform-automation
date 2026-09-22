import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const remotionDir = path.resolve(here, '..');
const repoRoot = path.resolve(remotionDir, '..', '..');
const kindDir = {cardnews: '카드뉴스', instatoon: '인스타툰'};

const [kind, id] = process.argv.slice(2);
if (!(kind in kindDir) || !/^[A-Za-z0-9_-]{4,40}$/.test(id ?? '')) {
  throw new Error('사용법: node scripts/render-carousel.mjs <cardnews|instatoon> <project-id>');
}

const projectDir = path.join(repoRoot, kindDir[kind], id);
const projectFile = path.join(projectDir, '프로젝트.json');
const outputDir = path.join(projectDir, '출력');
const project = JSON.parse(await fs.readFile(projectFile, 'utf8'));

if (project.kind !== kind || !Array.isArray(project.slides) || project.slides.length === 0) {
  throw new Error('프로젝트 종류 또는 slides가 올바르지 않습니다.');
}

await fs.mkdir(outputDir, {recursive: true});

const serveUrl = await bundle({
  entryPoint: path.join(remotionDir, 'src', 'index.ts'),
  publicDir: projectDir,
  webpackOverride: (config) => config,
});

const projectAsset = (value) => {
  if (!value) return null;
  const absolute = path.resolve(repoRoot, value);
  const relative = path.relative(projectDir, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`프로젝트 폴더 밖의 이미지 경로입니다: ${value}`);
  }
  return relative.split(path.sep).join('/');
};

for (let index = 0; index < project.slides.length; index += 1) {
  const rawSlide = project.slides[index];
  const slide =
    kind === 'cardnews'
      ? {...rawSlide, image: projectAsset(rawSlide.image)}
      : {
          ...rawSlide,
          panels: rawSlide.panels.map((panel) => ({...panel, image: projectAsset(panel.image)})),
        };
  const inputProps =
    kind === 'cardnews'
      ? {
          slide,
          index,
          total: project.slides.length,
          theme: project.theme,
          brand: project.brand_name,
          sponsored: project.sponsored,
        }
      : {
          slide,
          index,
          total: project.slides.length,
          title: project.title,
          sponsored: project.sponsored,
        };
  const composition = await selectComposition({
    serveUrl,
    id: kind === 'cardnews' ? 'CardSlide' : 'ToonSlide',
    inputProps,
  });
  await renderStill({
    composition,
    serveUrl,
    inputProps,
    output: path.join(outputDir, `${String(index + 1).padStart(2, '0')}.jpg`),
    imageFormat: 'jpeg',
    jpegQuality: 92,
  });
}

project.status = 'rendered';
project.updated_at = new Date().toISOString();
await fs.writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
console.log(`${kindDir[kind]}/${id}: ${project.slides.length}장 렌더 완료`);
