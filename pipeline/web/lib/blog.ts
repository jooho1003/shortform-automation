import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import YAML from 'yaml';

import {blogDocument} from './blogRender';
import {reactionEmojis, readableBody, vaguePhrases} from './blogText';
import type {
  BlogBundle,
  BlogConfig,
  BlogFact,
  BlogImage,
  BlogKeyword,
  BlogLintItem,
  BlogLintReport,
  BlogOutline,
  BlogProject,
  BlogRankPoint,
  BlogState,
} from './blogTypes';
import {BLOG_STATUSES, SELF_PAID_CATEGORY} from './blogTypes';
import {exists, readJson, readText, removeIfExists, writeJsonLikePython, writeText} from './jsonio';
import {BLOG, CONFIG, ROOT} from './paths';

const PROJECT = '프로젝트.json';
const OUTLINE = '개요.json';
const FACTS = '근거.json';
const BODY = '본문.md';
const DRAFT = '본문.초안.md';
const IMAGES = '이미지/이미지.json';
const LINT = '점검.json';
const STATE = '상태.json';
const RANK = '순위.json';
const OUTLINE_OK = '01-개요-승인.txt';
const OUTLINE_FIX = '01-개요-수정요청.txt';
const BODY_OK = '02-원고-승인.txt';
const BODY_FIX = '02-원고-수정요청.txt';

const ID_RE = /^\d{8}-[A-Za-z0-9가-힣_-]{1,80}$/;
const DEFAULT_STATE: BlogState = {current: null, status: 'idle', started_at: null, ended_at: null, job_id: null, error: null};
const DEFAULT_CONFIG: BlogConfig = {
  blog_id: '',
  niche: '1인 사업자의 콘텐츠 자동화와 AI 제작',
  persona: '직접 해 본 과정을 친절하고 구체적으로 설명하는 실무자. 1인칭을 쓰되 과장하지 않는다.',
  seed_keywords: ['콘텐츠 자동화', 'AI 영상 제작', '쇼츠 자동화', '네이버 블로그 자동화'],
  min_volume: 0,
  max_saturation: 10000,
  weekly_target: 2,
  length: {min: 1200, max: 3200},
  banned_phrases: ['무조건', '100%', '완치', '원금 보장', '수익 보장'],
  vague_phrases: [],
  max_posts_per_day: 1,
  min_hours_between_posts: 12,
  default_publish_mode: 'copy',
  draft_enabled: false,
};

export class BlogError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const now = () => new Date().toISOString();
const cleanText = (value: unknown, max = 8000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const uniqueStrings = (value: unknown, max = 30) =>
  Array.isArray(value) ? [...new Set(value.map((item) => cleanText(item, 100)).filter(Boolean))].slice(0, max) : [];
export const resolveBlogId = (raw: string): string => {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw new BlogError('블로그 프로젝트 ID가 올바르지 않습니다.');
  }
  if (!ID_RE.test(id)) throw new BlogError('블로그 프로젝트 ID가 올바르지 않습니다.');
  return id;
};
const projectDir = (raw: string) => {
  const id = resolveBlogId(raw);
  return path.join(BLOG, id);
};
const projectFile = (id: string, relative = PROJECT) => path.join(projectDir(id), relative);

function slugify(value: string): string {
  const slug = value.normalize('NFKC').replace(/[^A-Za-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  return slug || `글-${Math.random().toString(36).slice(2, 7)}`;
}

function currentWeek(date = new Date()): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function loadBlogConfig(): Promise<BlogConfig> {
  try {
    const parsed = YAML.parse(await fs.readFile(path.join(CONFIG, 'blog.yaml'), 'utf8')) as Partial<BlogConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      length: {...DEFAULT_CONFIG.length, ...(parsed.length ?? {})},
      seed_keywords: uniqueStrings(parsed.seed_keywords, 100),
      banned_phrases: uniqueStrings(parsed.banned_phrases, 100),
      vague_phrases: uniqueStrings(parsed.vague_phrases, 100),
      default_publish_mode: parsed.default_publish_mode === 'draft' ? 'draft' : 'copy',
      draft_enabled: parsed.draft_enabled === true,
      max_posts_per_day: Math.min(3, Math.max(1, Number(parsed.max_posts_per_day) || 1)),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_CONFIG;
    throw new BlogError(`blog.yaml을 읽을 수 없습니다: ${(error as Error).message}`, 500);
  }
}

function validateProject(input: BlogProject): BlogProject {
  if (input.version !== 1 || !BLOG_STATUSES.includes(input.status)) throw new BlogError('프로젝트 버전 또는 상태가 올바르지 않습니다.');
  if (!ID_RE.test(input.id)) throw new BlogError('프로젝트 ID가 올바르지 않습니다.');
  if (!input.keyword?.main?.trim()) throw new BlogError('주 키워드가 필요합니다.');
  if (!['none', 'ad', 'sponsored', 'affiliate'].includes(input.disclosure)) throw new BlogError('광고 표기 유형이 올바르지 않습니다.');
  if (!['copy', 'draft'].includes(input.publish.mode)) throw new BlogError('게시 모드가 올바르지 않습니다.');
  return input;
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeJsonLikePython(temporary, value);
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function listBlogProjects(): Promise<BlogProject[]> {
  let entries;
  try {
    entries = await fs.readdir(BLOG, {withFileTypes: true});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const values = await Promise.all(entries.filter((entry) => entry.isDirectory() && ID_RE.test(entry.name)).map((entry) => readJson<BlogProject>(projectFile(entry.name))));
  return values.filter((value): value is BlogProject => value !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBlogProject(id: string): Promise<BlogProject> {
  const project = await readJson<BlogProject>(projectFile(id));
  if (!project) throw new BlogError('블로그 프로젝트가 없습니다.', 404);
  return validateProject(project);
}

export async function updateGeneratedProject(
  id: string,
  patch: Partial<Pick<BlogProject, 'status' | 'title' | 'title_candidates' | 'intent' | 'tags'>>,
): Promise<BlogProject> {
  const file = projectFile(id);
  let lock: Awaited<ReturnType<typeof fs.open>>;
  try {
    lock = await fs.open(`${file}.lock`, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new BlogError('편집 저장과 생성 단계가 겹쳤습니다. 다시 실행해 주세요.', 409);
    throw error;
  }
  try {
    const current = await getBlogProject(id);
    const next: BlogProject = {
      ...current,
      status: patch.status && BLOG_STATUSES.includes(patch.status) ? patch.status : current.status,
      title: patch.title === undefined ? current.title : cleanText(patch.title, 200),
      title_candidates: patch.title_candidates === undefined ? current.title_candidates : uniqueStrings(patch.title_candidates, 5),
      intent: patch.intent === undefined ? current.intent : cleanText(patch.intent, 80),
      tags: patch.tags === undefined ? current.tags : uniqueStrings(patch.tags, 30),
      revision: current.revision + 1,
      updatedAt: now(),
    };
    await atomicJson(file, next);
    return next;
  } finally {
    await lock.close();
    await fs.unlink(`${file}.lock`).catch(() => undefined);
  }
}

export async function createBlogProject(input: {keyword: string; week?: string; volumes?: Partial<BlogKeyword>}): Promise<BlogProject> {
  const keyword = cleanText(input.keyword, 120);
  if (!keyword) throw new BlogError('키워드를 입력해 주세요.');
  const stamp = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul'}).format(new Date()).replace(/-/g, '');
  const base = `${stamp}-${slugify(keyword)}`;
  let id = base;
  for (let attempt = 2; await exists(path.join(BLOG, id)); attempt++) id = `${base}-${attempt}`;
  const config = await loadBlogConfig();
  const createdAt = now();
  const project: BlogProject = {
    id,
    version: 1,
    revision: 1,
    status: 'keyword',
    keyword: {
      main: keyword,
      subs: [],
      volume_pc: Math.max(0, Number(input.volumes?.volume_pc) || 0),
      volume_mobile: Math.max(0, Number(input.volumes?.volume_mobile) || 0),
      docs: Math.max(0, Number(input.volumes?.docs) || 0),
      saturation: Math.max(0, Number(input.volumes?.saturation) || 0),
      week: input.week && /^\d{4}-W\d{2}$/.test(input.week) ? input.week : currentWeek(),
    },
    intent: '',
    title: '',
    title_candidates: [],
    category: '',
    tags: [],
    disclosure: 'none',
    publish: {mode: config.default_publish_mode, post_url: null, published_at: null},
    createdAt,
    updatedAt: createdAt,
  };
  await atomicJson(projectFile(id), project);
  await atomicJson(projectFile(id, STATE), DEFAULT_STATE);
  return project;
}

function cleanProjectPatch(current: BlogProject, patch: Record<string, unknown>): BlogProject {
  const keywordRaw = patch.keyword && typeof patch.keyword === 'object' ? (patch.keyword as Record<string, unknown>) : {};
  const publishRaw = patch.publish && typeof patch.publish === 'object' ? (patch.publish as Record<string, unknown>) : {};
  const disclosure = ['none', 'ad', 'sponsored', 'affiliate'].includes(String(patch.disclosure)) ? (patch.disclosure as BlogProject['disclosure']) : current.disclosure;
  const mode = publishRaw.mode === 'draft' ? 'draft' : publishRaw.mode === 'copy' ? 'copy' : current.publish.mode;
  return validateProject({
    ...current,
    keyword: {
      ...current.keyword,
      main: cleanText(keywordRaw.main ?? current.keyword.main, 120),
      subs: 'subs' in keywordRaw ? uniqueStrings(keywordRaw.subs, 20) : current.keyword.subs,
    },
    intent: 'intent' in patch ? cleanText(patch.intent, 80) : current.intent,
    title: 'title' in patch ? cleanText(patch.title, 200) : current.title,
    title_candidates: 'title_candidates' in patch ? uniqueStrings(patch.title_candidates, 5) : current.title_candidates,
    category: 'category' in patch ? cleanText(patch.category, 100) : current.category,
    tags: 'tags' in patch ? uniqueStrings(patch.tags, 30) : current.tags,
    disclosure,
    publish: {
      mode,
      post_url: typeof publishRaw.post_url === 'string' && /^https:\/\//.test(publishRaw.post_url) ? publishRaw.post_url.slice(0, 1000) : current.publish.post_url,
      published_at: current.publish.published_at,
    },
    updatedAt: now(),
    revision: current.revision + 1,
  });
}

export async function updateBlogProject(id: string, input: Record<string, unknown>): Promise<BlogBundle> {
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1) throw new BlogError('저장 버전이 필요합니다.');
  const file = projectFile(id);
  let lock: fs.FileHandle;
  try {
    lock = await fs.open(`${file}.lock`, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new BlogError('다른 저장이 진행 중입니다. 잠시 후 다시 저장해 주세요.', 409);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BlogError('프로젝트가 없습니다.', 404);
    throw error;
  }
  try {
    const current = await getBlogProject(id);
    if (current.revision !== input.revision) throw new BlogError('다른 창에서 수정되었습니다. 새로고침 후 다시 저장해 주세요.', 409);
    const oldBody = (await readText(projectFile(id, BODY))) ?? '';
    const oldImages = (await readJson<BlogImage[]>(projectFile(id, IMAGES))) ?? [];
    const oldFacts = (await readJson<BlogFact[]>(projectFile(id, FACTS))) ?? [];
    const next = cleanProjectPatch(current, (input.project as Record<string, unknown>) ?? input);
    if ('body' in input) await writeText(projectFile(id, BODY), cleanText(input.body, 200_000));
    if ('outline' in input) await atomicJson(projectFile(id, OUTLINE), input.outline ?? null);
    if ('facts' in input) {
      const nextFacts = Array.isArray(input.facts) ? (input.facts as BlogFact[]) : [];
      await atomicJson(projectFile(id, FACTS), nextFacts);
      const nextIds = new Set(nextFacts.map((fact) => fact.id));
      const removed = oldFacts.filter((fact) => !nextIds.has(fact.id));
      if (removed.length) {
        const currentBody = (await readText(projectFile(id, BODY))) ?? '';
        const notices = removed.map((fact) => `[확인필요] 삭제된 근거 ${fact.id}와 연결된 내용을 재검토하세요.`).filter((notice) => !currentBody.includes(notice));
        if (notices.length) await writeText(projectFile(id, BODY), `${notices.join('\n')}\n\n${currentBody}`);
      }
    }
    if ('images' in input) await atomicJson(projectFile(id, IMAGES), Array.isArray(input.images) ? input.images : []);
    const newBody = (await readText(projectFile(id, BODY))) ?? '';
    const newImages = (await readJson<BlogImage[]>(projectFile(id, IMAGES))) ?? [];
    if (oldBody !== newBody || JSON.stringify(oldImages) !== JSON.stringify(newImages)) {
      await removeIfExists(projectFile(id, BODY_OK));
      if (next.status === 'ready' || next.status === 'drafted') next.status = 'review';
    }
    await atomicJson(file, next);
    return getBlogBundle(id);
  } finally {
    await lock.close();
    await fs.unlink(`${file}.lock`).catch(() => undefined);
  }
}

const shaText = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
async function shaFile(file: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function approvalSnapshot(id: string): Promise<{body_sha256: string; images: {file: string; sha256: string}[]}> {
  const body = (await readText(projectFile(id, BODY))) ?? '';
  const images = (await readJson<BlogImage[]>(projectFile(id, IMAGES))) ?? [];
  const hashes: {file: string; sha256: string}[] = [];
  for (const image of images) {
    const absolute = projectFile(id, image.file);
    try {
      hashes.push({file: image.file, sha256: await shaFile(absolute)});
    } catch {
      hashes.push({file: image.file, sha256: 'missing'});
    }
  }
  return {body_sha256: shaText(body), images: hashes};
}

export async function bodyApprovalValid(id: string): Promise<boolean> {
  const approved = await readJson<{body_sha256: string; images: {file: string; sha256: string}[]}>(projectFile(id, BODY_OK));
  if (!approved) return false;
  return JSON.stringify(approved) === JSON.stringify(await approvalSnapshot(id));
}

const firstParagraph = (body: string) => body.split(/\n\s*\n/).find((part) => part.trim() && !part.trim().startsWith('#')) ?? '';
const plainBody = (body: string) => body.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#>|`_-]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (body: string) => plainBody(body).toLowerCase().split(/\s+/).filter(Boolean);
function ngrams(body: string): Set<string> {
  const values = words(body);
  const out = new Set<string>();
  for (let i = 0; i <= values.length - 5; i++) out.add(values.slice(i, i + 5).join(' '));
  return out;
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const value of a) if (b.has(value)) common++;
  return common / Math.min(a.size, b.size);
}

export async function lintBlog(id: string): Promise<BlogLintReport> {
  const project = await getBlogProject(id);
  const config = await loadBlogConfig();
  const body = (await readText(projectFile(id, BODY))) ?? '';
  const images = (await readJson<BlogImage[]>(projectFile(id, IMAGES))) ?? [];
  const errors: BlogLintItem[] = [];
  const warnings: BlogLintItem[] = [];
  const error = (code: string, message: string) => errors.push({code, message});
  const warn = (code: string, message: string) => warnings.push({code, message});

  if (!project.title.trim()) error('title.empty', '제목이 비었습니다.');
  if (body.includes('[확인필요]')) error('fact.unverified', '[확인필요] 표식이 남아 있습니다.');
  if (/^#\s/m.test(body) || /^#{4,}\s/m.test(body) || /```/.test(body) || /^\s*<[^>]+>/m.test(body)) error('markdown.unsupported', 'H1·H4 이하·코드 펜스·HTML은 허용하지 않습니다.');
  const length = plainBody(body).replace(/\s/g, '').length;
  if (length < config.length.min) error('length.short', `본문 ${length}자 — 최소 ${config.length.min}자보다 짧습니다.`);
  if (length > config.length.max) warn('length.long', `본문 ${length}자 — 권장 최대 ${config.length.max}자를 넘습니다.`);
  for (const phrase of config.banned_phrases) if (phrase && (project.title.includes(phrase) || body.includes(phrase))) error('phrase.banned', `금칙 표현 “${phrase}”가 포함되어 있습니다.`);
  for (const phrase of vaguePhrases(body, config.vague_phrases)) warn('phrase.vague', `막연한 평가 “${phrase}…” 대신 직접 본 장면이나 먹은 느낌으로 바꿔 보세요.`);
  const emojis = reactionEmojis(body);
  if (emojis.length > 3) warn('emoji.count', `감탄 이모지가 ${emojis.length}개입니다. 1~3개로 줄이세요(위치 블록 기호는 제외).`);
  const repeated = [...new Set(emojis.filter((emoji, index) => emojis.indexOf(emoji) !== index))];
  if (repeated.length) warn('emoji.repeat', `같은 이모지를 반복했습니다: ${repeated.join(' ')}`);
  if (project.category === SELF_PAID_CATEGORY && project.disclosure !== 'none') error('category.disclosure', '광고·협찬·제휴 글은 내돈내산 카테고리에 넣을 수 없습니다.');
  if (project.disclosure !== 'none') {
    const start = plainBody(body).slice(0, 160);
    if (!/(광고|협찬|제휴|수수료|경제적 이해관계)/.test(start)) error('disclosure.missing', '광고·협찬·제휴 글은 첫머리에 경제적 이해관계를 밝혀야 합니다.');
  }
  for (const image of images) {
    if (!image.file.startsWith('이미지/') || image.file.includes('..') || path.isAbsolute(image.file) || !(await exists(projectFile(id, image.file)))) error('image.missing', `이미지 파일이 없습니다: ${image.file}`);
    if (!image.alt.trim()) warn('image.alt', `${image.file}의 대체 텍스트가 비었습니다.`);
  }
  if (images.length < 3) warn('image.count', '본문 이미지가 3장 미만입니다.');
  const keyword = project.keyword.main.toLowerCase();
  if (keyword && !project.title.toLowerCase().includes(keyword)) warn('keyword.title', '제목에 주 키워드가 없습니다.');
  if (keyword && !firstParagraph(body).toLowerCase().includes(keyword)) warn('keyword.intro', '첫 문단에 주 키워드가 없습니다.');
  const bodyWords = words(body);
  const count = keyword ? plainBody(body).toLowerCase().split(keyword).length - 1 : 0;
  if (bodyWords.length && count / bodyWords.length > 0.03) warn('keyword.density', '주 키워드 밀도가 3%를 넘습니다. 자연스럽게 줄여 보세요.');
  const links = [...body.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)];
  if (links.length > 5) warn('link.count', '외부 링크가 5개를 넘습니다.');
  const h2 = [...body.matchAll(/^##\s+/gm)].length;
  if (h2 < 3) warn('heading.count', 'H2 소제목이 3개 미만입니다.');

  const target = ngrams(body);
  for (const other of await listBlogProjects()) {
    if (other.id === id) continue;
    const otherBody = await readText(projectFile(other.id, BODY));
    if (otherBody && overlap(target, ngrams(otherBody)) > 0.3) {
      error('duplicate.ngram', `기존 글 “${other.title || other.keyword.main}”과 5-gram 중복률이 30%를 넘습니다.`);
      break;
    }
  }
  const report: BlogLintReport = {errors, warnings, checked_at: now(), body_sha256: shaText(body), approval_valid: await bodyApprovalValid(id)};
  await atomicJson(projectFile(id, LINT), report);
  return report;
}

export async function setBlogGate(id: string, gate: 'outline' | 'body', action: 'ok' | 'fix', note = '', category?: string): Promise<BlogBundle> {
  const project = await getBlogProject(id);
  const nextCategory = category === undefined ? project.category : cleanText(category, 100);
  if (gate === 'body' && action === 'ok' && nextCategory !== project.category) {
    // 점검(lintBlog)이 파일에서 카테고리를 다시 읽으므로 승인 전에 먼저 저장한다.
    if (nextCategory === SELF_PAID_CATEGORY && project.disclosure !== 'none') throw new BlogError('광고·협찬·제휴 글은 내돈내산 카테고리에 넣을 수 없습니다.');
    project.category = nextCategory;
    await atomicJson(projectFile(id), project);
  }
  if (gate === 'outline') {
    const outline = await readJson<BlogOutline>(projectFile(id, OUTLINE));
    if (!outline) throw new BlogError('승인할 개요가 없습니다.');
    if (action === 'ok') {
      await writeText(projectFile(id, OUTLINE_OK), shaText(JSON.stringify(outline)));
      await removeIfExists(projectFile(id, OUTLINE_FIX));
      project.status = 'outline';
    } else {
      if (!note.trim()) throw new BlogError('수정 요청 내용을 입력해 주세요.');
      await writeText(projectFile(id, OUTLINE_FIX), note.trim());
      await removeIfExists(projectFile(id, OUTLINE_OK));
    }
  } else if (action === 'ok') {
    const report = await lintBlog(id);
    if (report.errors.length) throw new BlogError(`원고 점검 오류 ${report.errors.length}개를 먼저 해결해 주세요.`);
    await atomicJson(projectFile(id, BODY_OK), await approvalSnapshot(id));
    await removeIfExists(projectFile(id, BODY_FIX));
    project.status = 'ready';
  } else {
    if (!note.trim()) throw new BlogError('수정 요청 내용을 입력해 주세요.');
    await writeText(projectFile(id, BODY_FIX), note.trim());
    await removeIfExists(projectFile(id, BODY_OK));
    project.status = 'review';
  }
  project.revision += 1;
  project.updatedAt = now();
  await atomicJson(projectFile(id), project);
  return getBlogBundle(id);
}

export async function createCopyPackage(id: string): Promise<{dir: string; html: string; text: string; tags: string}> {
  const project = await getBlogProject(id);
  const report = await lintBlog(id);
  if (report.errors.length) throw new BlogError(`게시 패키지를 만들 수 없습니다. 점검 오류 ${report.errors.length}개가 남았습니다.`);
  if (!(await bodyApprovalValid(id))) throw new BlogError('현재 본문·이미지가 승인본과 다릅니다. 원고를 다시 승인해 주세요.');
  const body = (await readText(projectFile(id, BODY))) ?? '';
  const packageDir = projectFile(id, '게시패키지');
  await fs.mkdir(packageDir, {recursive: true});
  const html = blogDocument(project.title, body.replace(/\]\(이미지\//g, '](../이미지/'));
  const text = `${project.title}\n\n${readableBody(body)}`;
  const tags = project.tags.map((tag) => `#${tag.replace(/^#/, '').replace(/\s+/g, '')}`).join(' ');
  await Promise.all([
    writeText(path.join(packageDir, '본문.html'), html),
    writeText(path.join(packageDir, '본문.txt'), text),
    writeText(path.join(packageDir, '태그.txt'), tags),
  ]);
  return {dir: path.relative(ROOT, packageDir).split(path.sep).join('/'), html, text, tags};
}

export async function getBlogBundle(id: string): Promise<BlogBundle> {
  const [project, outline, facts, body, draft, images, lint, state, ranks] = await Promise.all([
    getBlogProject(id),
    readJson<BlogOutline>(projectFile(id, OUTLINE)),
    readJson<BlogFact[]>(projectFile(id, FACTS)),
    readText(projectFile(id, BODY)),
    readText(projectFile(id, DRAFT)),
    readJson<BlogImage[]>(projectFile(id, IMAGES)),
    readJson<BlogLintReport>(projectFile(id, LINT)),
    readJson<BlogState>(projectFile(id, STATE)),
    readJson<BlogRankPoint[]>(projectFile(id, RANK)),
  ]);
  let resolvedState = state ?? DEFAULT_STATE;
  if (resolvedState.status === 'running' && resolvedState.job_id) {
    const live = (globalThis as unknown as {__blogPipelineJobs?: Map<string, {status: string}>}).__blogPipelineJobs?.get(resolvedState.job_id);
    if (!live || live.status !== 'running') {
      resolvedState = {...resolvedState, status: 'interrupted', ended_at: now(), error: '서버 재시작으로 작업이 중단됐습니다. 해당 단계부터 이어서 실행하세요.'};
      await atomicJson(projectFile(id, STATE), resolvedState);
    }
  }
  const bodyValid = await bodyApprovalValid(id);
  return {
    project,
    outline,
    facts: facts ?? [],
    body: body ?? '',
    draft: draft ?? '',
    images: images ?? [],
    lint: lint ? {...lint, approval_valid: bodyValid} : null,
    state: resolvedState,
    ranks: ranks ?? [],
    gates: {outline: await exists(projectFile(id, OUTLINE_OK)), body: await exists(projectFile(id, BODY_OK)), bodyValid},
    previewHtml: blogDocument(project.title || project.keyword.main, body ?? ''),
  };
}

export function assertBlogOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) throw new BlogError('다른 사이트의 요청은 허용하지 않습니다.', 403);
}

export async function blogRequest(req: Request): Promise<Record<string, unknown>> {
  assertBlogOrigin(req);
  if (!req.headers.get('content-type')?.includes('application/json')) throw new BlogError('JSON 요청이 필요합니다.', 415);
  const reader = req.body?.getReader();
  if (!reader) throw new BlogError('요청 본문이 없습니다.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) {
      await reader.cancel();
      throw new BlogError('요청은 1MB 이하여야 합니다.', 413);
    }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new BlogError('JSON 형식을 확인해 주세요.');
  }
}

export function blogFailure(error: unknown): Response {
  if (error instanceof BlogError) return Response.json({error: error.message}, {status: error.status});
  console.error('blog error', error instanceof Error ? error.message : String(error));
  return Response.json({error: '블로그 처리 중 오류가 발생했습니다.'}, {status: 500});
}

export const blogPath = (id: string, relative: string) => projectFile(id, relative);
export const blogAtomicJson = atomicJson;
export const blogNow = now;
export const blogShaText = shaText;
export const blogWeek = currentWeek;
