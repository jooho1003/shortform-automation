const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const projectDir = path.resolve(__dirname, '..');
  const id = path.basename(projectDir);
  const prefix = `인스타툰/${id}`;
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, '이미지생성-기록.json'), 'utf8'));
  const backup = JSON.parse(await fs.readFile(path.join(__dirname, '그림생성전-프로젝트.json'), 'utf8'));
  const url = `http://localhost:3123/api/carousel/instatoon/${id}`;
  const current = (await (await fetch(url)).json()).project;
  assert.deepEqual(current, backup, '편집 내용이 바뀌었습니다. 최신본과 병합한 뒤 연결해야 합니다.');
  assert.equal(manifest.pages.length, current.slides.length);
  for (const item of manifest.pages) {
    await fs.copyFile(item.path, path.join(projectDir, '컷', `${String(item.page).padStart(2, '0')}-완성.png`));
  }
  const sheet = `${prefix}/캐릭터/01-보리-수진-미소-기준.png`;
  const characters = [
    {key: 'bori', name: '보리', lock: '여자 친칠라. 블루그레이 몸, 크고 넓게 벌어진 둥근 귀, 넓은 볼, 겨자색 스카프. 작은 점눈과 짧은 입. 05 손그림 기준.', sheet},
    {key: 'sujin', name: '수진', lock: '여자 친칠라. 좁고 긴 얼굴, 보리보다 작고 가까운 둥근 귀. 따뜻한 회갈색 몸, 크림색 아랫얼굴과 배, 연보라색 스카프. 고정된 악역 표정 없이 점눈과 작은 입.', sheet},
    {key: 'miso', name: '미소', lock: '여자 친칠라. 짧고 넓은 얼굴, 옆으로 벌어진 둥근 귀. 옅은 살구색 몸과 크림색 배. 액세서리 없음. 점눈과 작은 입. 보리·수진과 동일한 갈색 손그림 선.', sheet},
  ];
  const slides = current.slides.map((s, i) => ({...s, fullBleed: true, panels: [{...s.panels[0], image: `${prefix}/컷/${String(i + 1).padStart(2, '0')}-완성.png`, bubbles: []}]}));
  const response = await fetch(url, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({characters, slides, style: current.style + '\n1화 완성본: 따뜻한 갈색 손그림 선, 흰 바탕과 단순한 가구, 옅은 라벤더·살구색 말풍선. 둥근 한국어 손글씨는 이미지 안에 포함. 표지 포함 10장, 완성 이미지 전체를 표시한다. 여자 조연은 수진·미소 친칠라 변형. 생성 전 대사와 장면은 제작/그림생성전-프로젝트.json에 보관.'})});
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result));
  assert.ok(result.project.slides.every(s => s.fullBleed && s.panels[0].image && !s.panels[0].bubbles.length));
  assert.equal(result.project.characters.length, 3);
  console.log(JSON.stringify({project: id, pages: result.project.slides.length, characters: result.project.characters.map(c => c.name), lint: result.lint}));
})().catch(e => {console.error(e); process.exitCode = 1;});
