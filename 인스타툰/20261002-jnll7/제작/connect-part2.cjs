const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dir = path.resolve(__dirname, '..');
  const repo = path.resolve(dir, '../..');
  const workspace = path.dirname(repo);
  const read = async p => JSON.parse(await fs.readFile(p, 'utf8'));
  const projectFile = path.join(dir, '프로젝트.json');
  const project = await read(projectFile);
  const studioFile = path.join(repo, '인스타툰/시리즈/hansul.json');
  const studio = await read(studioFile);
  const manifest = await read(path.join(__dirname, '이미지생성-기록.json'));
  assert.deepEqual(project, await read(path.join(__dirname, '그림생성전-프로젝트.json')), '편집기 변경 감지');
  assert.deepEqual(studio, await read(path.join(__dirname, '그림생성전-작업실.json')), '작업실 변경 감지');
  const episode = studio.episodes.find(e => e.editorId === project.id);
  assert.equal(episode.part, 2);
  assert.equal(episode.cards.length, 10);
  assert.equal(manifest.pages.length, 10);
  const previousPartFile = path.join(repo, '인스타툰/20261001-bv7ih/프로젝트.json');
  const previousPartBytes = await fs.readFile(previousPartFile);
  const previousPart = JSON.parse(previousPartBytes.toString('utf8'));
  assert.equal(previousPart.status, 'published');
  const characters = previousPart.characters.map(c => ({...c, sheet: `인스타툰/${project.id}/캐릭터/01-보리-수진-미소-기준.png`}));
  for (const item of manifest.pages) await fs.access(item.path);
  project.characters = characters;
  project.style = previousPart.style + '\n이번 제작은 2/3, 표지 포함 10장. 수진의 회사 앞에서 전달 후 그날 밤 단톡방으로 이어진다.';
  project.slides = episode.cards.map((c, i) => ({
    layout: 'single', fullBleed: true,
    panels: [{scene: c.scene + '\n표정: ' + c.emotion, image: `인스타툰/${project.id}/컷/${path.basename(manifest.pages[i].path)}`, bubbles: []}],
  }));
  project.status = 'illustrated';
  project.updated_at = new Date().toISOString();
  assert.ok(episode.cards[0].dialogue.includes('2/3'));
  assert.ok(episode.cards[9].dialogue.endsWith('-계속-'));
  await fs.writeFile(projectFile + '.tmp', JSON.stringify(project, null, 2) + '\n', 'utf8');
  await fs.rename(projectFile + '.tmp', projectFile);
  await fs.writeFile(path.join(dir, '출력/캡션.txt'), project.caption + '\n', 'utf8');
  const finalBoard = {part: 2, totalParts: 3, projectId: project.id, title: episode.topic.title, cards: episode.cards, caption: episode.caption};
  await fs.writeFile(path.join(__dirname, '최종콘티.json'), JSON.stringify(finalBoard, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(workspace, '한술툰/기획/첫사연-친구-2부-제작본.json'), JSON.stringify(finalBoard, null, 2) + '\n', 'utf8');
  const boardMd = `# ${episode.topic.title} · 2/3\n\n` + episode.cards.map((c,i) => `## ${i+1}장\n\n${c.scene}\n\n${c.dialogue}\n\n표정: ${c.emotion}\n`).join('\n') + `\n## 캡션\n\n${episode.caption}\n`;
  await fs.writeFile(path.join(workspace, '한술툰/기획/첫사연-친구-2부-제작본.md'), boardMd, 'utf8');
  assert.deepEqual(await fs.readFile(previousPartFile), previousPartBytes);
  assert.deepEqual(await read(studioFile), studio);
  const response = await fetch(`http://localhost:3123/api/carousel/instatoon/${project.id}`);
  assert.ok(response.ok);
  const verified = await response.json();
  assert.deepEqual(verified.project.slides, project.slides);
  console.log(JSON.stringify({id:project.id,images:project.slides.length,previousPartUnchanged:true,studioUnchanged:true,lint:verified.lint}));
})().catch(e=>{console.error(e);process.exitCode=1;});
