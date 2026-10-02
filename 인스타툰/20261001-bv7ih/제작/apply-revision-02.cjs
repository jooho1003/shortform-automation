const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dir = path.resolve(__dirname, '..');
  const repo = path.resolve(dir, '../..');
  const workspace = path.dirname(repo);
  const projectFile = path.join(dir, '프로젝트.json');
  const studioFile = path.join(repo, '인스타툰/시리즈/hansul.json');
  const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
  const source = await read(path.join(workspace, '한술툰/기획/첫사연-친구-단톡방-콘티-03.json'));
  const manifest = await read(path.join(__dirname, '이미지생성-수정02-기록.json'));
  const project = await read(projectFile);
  const studio = await read(studioFile);
  assert.deepEqual(project, await read(path.join(__dirname, '표정흐름수정전-프로젝트.json')), '컷 편집기 변경 감지: 최신 편집본과 병합 필요');
  assert.deepEqual(studio, await read(path.join(__dirname, '표정흐름수정전-작업실.json')), '작업실 변경 감지: 최신 편집본과 병합 필요');
  assert.equal(manifest.pages.length, 10);
  const previousOutput = path.join(__dirname, '이전출력-01');
  await fs.mkdir(previousOutput, {recursive: true});
  for (const name of await fs.readdir(path.join(dir, '출력'))) {
    await fs.copyFile(path.join(dir, '출력', name), path.join(previousOutput, name));
  }
  for (const item of manifest.pages) {
    await fs.copyFile(item.path, path.join(dir, '컷', `${String(item.page).padStart(2, '0')}-수정02.png`));
  }
  const now = new Date().toISOString();
  for (const ep of source.episodes) {
    const existing = studio.episodes.find(e => e.arc === 1 && e.part === ep.part);
    assert.ok(existing);
    assert.equal(ep.cards.length, 10);
    ep.cards.forEach(c => {
      assert.ok(c.dialogue.split('\n').length <= 6);
      assert.ok(c.dialogue.split('\n').every(line => line.length <= 200));
      assert.ok((c.scene + '\n표정: ' + c.emotion).length <= 1000);
    });
    assert.ok(ep.cards[0].dialogue.includes(`${ep.part}/${source.totalParts}`));
    assert.ok(ep.cards[9].dialogue.endsWith(ep.part === source.totalParts ? '-끝-' : '-계속-'));
    const draft = {
      topic: {title: ep.title, premise: source.premise, outline: source.outline},
      cards: ep.cards, caption: ep.caption,
      brief: source.brief + '\n\n' + source.cast.join('\n'), feedback: source.direction,
      topicMode: existing.topicMode, storyboardMode: existing.storyboardMode,
    };
    Object.assign(existing, draft, {version: existing.version + 1, updatedAt: now});
    existing.history.push({version: existing.version, at: now, label: '표정·이야기 흐름·부작 표기 수정', draft: structuredClone(draft)});
  }
  studio.revision += source.episodes.length;
  const first = source.episodes[0];
  project.title = `${first.title} · 1/${source.totalParts}`;
  project.logline = source.premise;
  project.caption = first.caption;
  project.style = source.direction + '\n\n' + source.cast.join('\n') + '\n그림체는 기존 완성본의 갈색 손그림 선과 낮은 채도를 유지한다. 손글씨는 이미지에 포함되며 수정 콘티와 생성 지시를 제작 폴더에 보관한다.';
  project.slides = first.cards.map((c, i) => ({layout: 'single', fullBleed: true, panels: [{scene: c.scene + '\n표정: ' + c.emotion, image: `인스타툰/${project.id}/컷/${String(i + 1).padStart(2, '0')}-수정02.png`, bubbles: []}]}));
  project.status = 'illustrated';
  project.updated_at = now;
  const atomic = async (file, value) => {
    const temp = file + '.revision02.tmp';
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await fs.rename(temp, file);
  };
  // Preserve the existing approved editor link while updating its corresponding storyboard.
  assert.equal(studio.episodes[0].editorId, project.id);
  await atomic(projectFile, project);
  await atomic(studioFile, studio);
  await fs.writeFile(path.join(dir, '출력', '캡션.txt'), project.caption + '\n', 'utf8');
  const response = await fetch(`http://localhost:3123/api/carousel/instatoon/${project.id}`);
  const verified = await response.json();
  assert.ok(response.ok);
  assert.equal(verified.project.slides.length, 10);
  assert.deepEqual(verified.project.slides, project.slides);
  console.log(JSON.stringify({revision: studio.revision, versions: studio.episodes.map(e => e.version), title: project.title, images: 10, lint: verified.lint, editorLinkPreserved: true}));
})().catch(e => {console.error(e); process.exitCode = 1;});
