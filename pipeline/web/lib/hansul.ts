// Design Ref: hansul-studio.design.md §4/6 — revision checks, snapshots, atomic file writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCarousel, updateCarousel} from './carousel';
import {runLlm} from './llm';
import {ROOT} from './paths';
import {readJson, readText, writeJsonLikePython} from './jsonio';
import {
  applyGenerated, assertApprovable, assertRevision, blankDraft, BOARD_SCHEMA,
  cleanDraft, cleanTopic, draftOf, editorSlides, generationPrompt, HansulError,
  HANSUL_RULES, nextEpisode, restoreVersion, saveVersion, TOPIC_SCHEMA,
  type HansulDraft, type HansulEpisode, type HansulStudio, type HansulTarget,
} from './hansulCore';

const dir = path.join(ROOT, '인스타툰', '시리즈');
const file = path.join(dir, 'hansul.json');
const sourceDir = path.join(path.dirname(ROOT), '한술툰');
const now = () => new Date().toISOString();

async function persist(studio: HansulStudio) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeJsonLikePython(temporary, studio);
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function seedStudio(): Promise<HansulStudio> {
  const text = await readText(path.join(sourceDir, '기획', '첫사연-연애-도시락-콘티.md'));
  if (!text) return {revision: 0, episodes: []};
  const first = text.split('## 1화 —')[1]?.split('## 2화 —')[0] ?? '';
  const plain = (s: string) => s.replace(/\*\*/g, '').trim();
  const cards = first.split('\n').filter(line => /^\|\s*\d/.test(line)).map(line => {
    const cells = line.split('|').slice(1, -1).map(plain);
    return {scene: cells[1], dialogue: cells[2].replace(/\s+\/\s+/g, '\n'), emotion: cells[3]};
  });
  if (!cards.length) return {revision: 0, episodes: []};
  const draft: HansulDraft = {
    ...blankDraft(),
    topic: {title: '남친 도시락을 싸줬더니 동료 것까지 싸 달란다', premise: '내 배려가 당연한 서비스가 된 순간. 이틀만 챙겨 준 도시락을 남자친구가 동료 두 명에게도 약속한다.', outline: ['이틀간 챙겨 준 호의가 동료들 몫까지 세 개로 늘어난다.', '동료들의 취향까지 전달하고 거절하자 체면을 내세운다. 보리는 도시락을 안 싸겠다고 말한다.', '보리가 거절을 실행하고 담이가 직접 세 개를 산다. 이후 도시락은 각자 챙긴다.']},
    cards,
    caption: first.split('### 1화 게시 캡션 초안')[1]?.trim() ?? '',
    brief: '연애 사연. 남자는 라쿤, 여자는 친칠라. 평소에는 점눈·짧은 입으로 담백하게.',
  };
  const episode = saveVersion(nextEpisode(undefined, randomUUID(), now()), cleanDraft(draft), '기존 도시락 콘티 불러오기', now());
  return {revision: 1, episodes: [episode]};
}

/** Reads never modify existing work. Only the initial file is seeded, using exclusive creation. */
export async function getHansul(): Promise<HansulStudio> {
  const existing = await readJson<HansulStudio>(file);
  if (existing) return existing;
  const seed = await seedStudio();
  await fs.mkdir(dir, {recursive: true});
  try {
    await fs.writeFile(file, JSON.stringify(seed, null, 2), {encoding: 'utf8', flag: 'wx'});
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return (await readJson<HansulStudio>(file))!;
  }
  return seed;
}

export async function getHansulRules() {
  const design = await readText(path.join(sourceDir, '기획', '한술툰-설계.md'));
  return HANSUL_RULES + (design ? `\n\n최신 설계 문서:\n${design.split('### 07 표정 자료의 활용')[0]}` : '');
}

async function withLock<T>(run: () => Promise<T>): Promise<T> {
  await fs.mkdir(dir, {recursive: true});
  const lockPath = `${file}.lock`;
  // A previous server may have exited during generation. Only remove a lock whose owner is gone.
  const prior = await readJson<{pid: number}>(lockPath).catch(() => null);
  if (prior?.pid) {
    try {process.kill(prior.pid, 0);} catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') await fs.unlink(lockPath).catch(() => {});
    }
  }
  let handle;
  try {handle = await fs.open(lockPath, 'wx');} catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new HansulError('다른 저장 또는 생성 작업이 진행 중입니다. 완료 후 다시 시도해 주세요.', 409);
    throw e;
  }
  try {
    await handle.writeFile(JSON.stringify({pid: process.pid}));
    return await run();
  } finally {
    await handle.close();
    await fs.unlink(lockPath).catch(() => {});
  }
}

async function characterSheets() {
  const name = '한술툰-05-보리담이-손그림.png';
  const relative = `인스타툰/시리즈/한술툰/${name}`;
  try {
    await fs.mkdir(path.dirname(path.join(ROOT, relative)), {recursive: true});
    await fs.copyFile(path.join(sourceDir, '캐릭터', name), path.join(ROOT, relative));
    return relative;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function actHansul(body: Record<string, unknown>): Promise<{studio: HansulStudio; selectedId: string}> {
  const actions = ['create', 'save', 'topic', 'storyboard', 'revise', 'restore', 'approve'];
  if (!actions.includes(String(body.action))) throw new HansulError('지원하지 않는 작업입니다.');
  return withLock(async () => {
    const studio = await getHansul();
    assertRevision(studio, body.revision);
    if (body.action === 'create') {
      const episode = nextEpisode(studio.episodes.at(-1), randomUUID(), now());
      studio.episodes.push(episode);
      studio.revision++;
      await persist(studio);
      return {studio, selectedId: episode.id};
    }
    const index = studio.episodes.findIndex(e => e.id === body.episodeId);
    if (index < 0) throw new HansulError('회차를 찾을 수 없습니다.', 404);
    let episode = studio.episodes[index];
    const commit = async (next: HansulEpisode) => {
      episode = next;
      studio.episodes[index] = next;
      studio.revision++;
      await persist(studio);
    };
    if (body.action === 'restore') {
      await commit(restoreVersion(episode, Number(body.version), now()));
      return {studio, selectedId: episode.id};
    }
    const draft = cleanDraft(body.draft);
    const changed = JSON.stringify(draftOf(episode)) !== JSON.stringify(draft);
    const target: HansulTarget = body.action === 'topic' || (body.action === 'revise' && body.target === 'topic') ? 'topic' : 'storyboard';
    if (['topic', 'storyboard', 'revise'].includes(String(body.action))) {
      if (body.provider !== 'claude' && body.provider !== 'codex') throw new HansulError('생성 도구를 선택해 주세요.');
      if (body.action === 'revise' && !draft.feedback.trim()) throw new HansulError('반영할 수정 요청을 적어 주세요.');
      if (body.action === 'revise' && body.target !== 'topic' && body.target !== 'storyboard') throw new HansulError('수정 대상을 선택해 주세요.');
      if (target === 'storyboard') cleanTopic(draft.topic, true);
      // Persist unsaved edits before the long-running call. A failed model cannot discard them.
      if (changed || !episode.version) await commit(saveVersion(episode, draft, '생성 전 편집본 저장', now()));
      let output;
      try {
        output = await runLlm({provider: body.provider, prompt: generationPrompt(studio, episode, draft, target, body.action === 'revise', await getHansulRules()), schema: target === 'topic' ? TOPIC_SCHEMA : BOARD_SCHEMA, title: `한술툰 ${episode.number}화 ${target === 'topic' ? '주제' : '콘티'} ${body.action === 'revise' ? '수정' : '생성'}`, logDir: '인스타툰/시리즈/로그'});
        const next = applyGenerated(draft, target, output.json);
        await commit(saveVersion(episode, next, `${target === 'topic' ? '주제' : '콘티'} ${body.action === 'revise' ? '수정 반영' : '자동 생성'} · ${body.provider}`, now()));
      } catch (e) {
        throw new HansulError(`생성을 완료하지 못했습니다. 현재 편집본은 보관되어 있습니다. ${(e as Error).message}`, 502);
      }
    } else if (body.action === 'approve') {
      assertApprovable(draft);
      if (changed || !episode.version) await commit(saveVersion(episode, draft, '승인 전 편집본 저장', now()));
      if (episode.status !== 'approved' || !episode.editorId) {
        const sheet = await characterSheets();
        const project = await createCarousel('instatoon', {title: `${draft.topic.title} · ${episode.part}/${draft.topic.outline.length}`, topic: draft.topic.premise, brand_name: '한술툰'});
        const approved = await updateCarousel('instatoon', project.id, {caption: draft.caption, logline: draft.topic.premise, style: HANSUL_RULES, slides: editorSlides(draft.cards), characters: [
          {key: 'bori', name: '보리', lock: '친칠라 여자 기본형. 블루그레이 몸, 큰 둥근 귀, 겨자색 스카프. 05 손그림. 간결한 얼굴 선을 유지하며 감정에 따라 눈썹·눈꺼풀·입 모양을 바꾼다.', sheet},
          {key: 'dami', name: '담이', lock: '라쿤 남자 기본형. 회색 눈가 무늬, 둥근 삼각 귀, 꼬리 띠, 세이지 가방. 05 손그림. 간결한 얼굴 선을 유지하며 감정에 따라 눈썹·눈꺼풀·입 모양을 바꾼다.', sheet},
        ]});
        await writeJsonLikePython(path.join(ROOT, '인스타툰', project.id, '프로젝트.json'), {...approved, status: 'scripted'});
        await commit({...episode, status: 'approved', editorId: project.id, updatedAt: now()});
      }
    } else if (changed || !episode.version) {
      await commit(saveVersion(episode, draft, '직접 수정 저장', now()));
    }
    return {studio, selectedId: episode.id};
  });
}
