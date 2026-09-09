/**
 * 릴스 기획 — 라이브러리·프로젝트 파일 CRUD + LLM 호출.
 *
 * 파일 규약은 lib/reelsTypes.ts 머리말. 다운로드·대본은 Python(`shortform reels ...`)이 잡으로 돌고,
 * 구조 분석·기획안 생성·수정은 runLlm(claude/codex)이 한다.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import type {ClientSurvey} from './clientTypes';
import {readJson, writeJsonLikePython, writeText} from './jsonio';
import {runLlm, type LlmProvider} from './llm';
import {PIPELINE, REELS, childEnv, pythonCommand, relFromRoot} from './paths';
import type {Library, LibraryItem, ReelAnalysis, ReelMeta, ReelPlan, ReelProject, ReviseRequest, StoryboardFrame, TranscriptCue} from './reelsTypes';
import {startJob} from './runner';
import type {JobInfo} from './types';

const execFileAsync = promisify(execFile);
const LIBRARY = path.join(REELS, '라이브러리.json');
const PROMPTS = path.join(PIPELINE, 'prompts', 'reels');

export class ReelsError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export const idOk = (id: string) => /^[A-Za-z0-9_-]{4,40}$/.test(id);

export function newId(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 7)}`;
}

function projectDir(id: string): string {
  if (!idOk(id)) throw new ReelsError('잘못된 프로젝트 id');
  return path.join(REELS, id);
}

export const projectRel = (id: string) => `릴스기획/${id}`;

// ---- 메타 ---------------------------------------------------------------

export async function fetchMeta(url: string): Promise<ReelMeta> {
  if (!/^https?:\/\/[^\s"'<>]+$/.test(url)) throw new ReelsError('URL 형식이 아닙니다');
  const py = pythonCommand();
  try {
    const {stdout} = await execFileAsync(py.cmd, [...py.prefix, '-m', 'shortform', 'reels', 'meta', '--url', url], {
      cwd: PIPELINE,
      env: childEnv(),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      timeout: 120_000,
    });
    const start = stdout.indexOf('{');
    return JSON.parse(stdout.slice(start)) as ReelMeta;
  } catch (err) {
    const e = err as {stderr?: string; stdout?: string; message: string};
    throw new ReelsError(`메타를 읽지 못했습니다: ${(e.stdout || e.stderr || e.message).slice(-400)}`, 502);
  }
}

// ---- 라이브러리 ---------------------------------------------------------

export async function loadLibrary(): Promise<Library> {
  return (await readJson<Library>(LIBRARY)) ?? {items: []};
}

async function saveLibrary(lib: Library) {
  await writeJsonLikePython(LIBRARY, lib);
}

export async function addToLibrary(url: string, tags: string[] = []): Promise<LibraryItem> {
  const lib = await loadLibrary();
  const existing = lib.items.find((i) => i.url === url);
  if (existing) return existing;
  const meta = await fetchMeta(url);
  const dup = lib.items.find((i) => i.provider === meta.provider && i.video_id === meta.video_id);
  if (dup) return dup;
  const item: LibraryItem = {...meta, id: newId(), tags, favorite: false, note: '', added: new Date().toISOString()};
  lib.items.unshift(item);
  await saveLibrary(lib);
  return item;
}

export async function updateLibraryItem(id: string, patch: Partial<Pick<LibraryItem, 'tags' | 'favorite' | 'note'>>): Promise<LibraryItem> {
  const lib = await loadLibrary();
  const item = lib.items.find((i) => i.id === id);
  if (!item) throw new ReelsError('라이브러리 항목이 없습니다', 404);
  if (patch.tags) item.tags = patch.tags.map((t) => t.trim()).filter(Boolean);
  if (typeof patch.favorite === 'boolean') item.favorite = patch.favorite;
  if (typeof patch.note === 'string') item.note = patch.note;
  await saveLibrary(lib);
  return item;
}

export async function removeLibraryItem(id: string): Promise<void> {
  const lib = await loadLibrary();
  lib.items = lib.items.filter((i) => i.id !== id);
  await saveLibrary(lib);
}

// ---- 프로젝트 -----------------------------------------------------------

export async function listProjects(): Promise<ReelProject[]> {
  let dirs: string[] = [];
  try {
    dirs = (await fsp.readdir(REELS, {withFileTypes: true})).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const out: ReelProject[] = [];
  for (const d of dirs) {
    const p = await readJson<ReelProject>(path.join(REELS, d, '프로젝트.json'));
    if (p) out.push(p);
  }
  return out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

export async function getProject(id: string): Promise<{project: ReelProject; analysis: ReelAnalysis | null; plan: ReelPlan | null; planMd: string | null}> {
  const dir = projectDir(id);
  const project = await readJson<ReelProject>(path.join(dir, '프로젝트.json'));
  if (!project) throw new ReelsError('프로젝트가 없습니다', 404);
  const analysis = await readJson<ReelAnalysis>(path.join(dir, '분석.json'));
  const plan = await readJson<ReelPlan>(path.join(dir, '기획안.json'));
  let planMd: string | null = null;
  try {
    planMd = await fsp.readFile(path.join(dir, '기획안.md'), 'utf8');
  } catch {}
  // 원본이 나중에 생겼을 수 있다
  if (!project.local_video && fs.existsSync(path.join(dir, '원본.mp4'))) {
    project.local_video = `${projectRel(id)}/원본.mp4`;
    if (project.status === 'new') project.status = 'fetched';
    await saveProject(project);
  }
  return {project, analysis, plan, planMd};
}

async function saveProject(p: ReelProject) {
  p.updated = new Date().toISOString();
  await writeJsonLikePython(path.join(projectDir(p.id), '프로젝트.json'), p);
}

export async function createProject(input: {url?: string; libraryId?: string; title?: string; client?: string | null; survey?: ClientSurvey | null; brand_name?: string}): Promise<ReelProject> {
  let meta: ReelMeta | null = null;
  if (input.libraryId) {
    const lib = await loadLibrary();
    const item = lib.items.find((i) => i.id === input.libraryId);
    if (!item) throw new ReelsError('라이브러리 항목이 없습니다', 404);
    meta = item;
  } else if (input.url) {
    meta = await fetchMeta(input.url);
  } else {
    throw new ReelsError('url 또는 libraryId가 필요합니다');
  }
  const id = newId();
  const project: ReelProject = {
    id,
    title: input.title?.trim() || meta.title || id,
    status: 'new',
    client: input.client ?? null,
    reference: {
      url: meta.url,
      provider: meta.provider,
      video_id: meta.video_id,
      title: meta.title,
      author: meta.author,
      views: meta.views,
      likes: meta.likes,
      duration: meta.duration,
      thumb: meta.thumb,
      upload_date: meta.upload_date,
    },
    local_video: null,
    survey: input.survey ?? null,
    brand_name: input.brand_name ?? '',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  await fsp.mkdir(path.join(projectDir(id), '로그'), {recursive: true});
  await saveProject(project);
  return project;
}

export async function updateProject(id: string, patch: Partial<Pick<ReelProject, 'title' | 'client' | 'survey' | 'brand_name' | 'status'>>): Promise<ReelProject> {
  const {project} = await getProject(id);
  if (typeof patch.title === 'string' && patch.title.trim()) project.title = patch.title.trim();
  if (patch.client !== undefined) project.client = patch.client;
  if (patch.survey !== undefined) project.survey = patch.survey;
  if (typeof patch.brand_name === 'string') project.brand_name = patch.brand_name;
  if (patch.status) project.status = patch.status;
  await saveProject(project);
  return project;
}

// ---- 잡: 다운로드·대본 --------------------------------------------------

export function startFetch(project: ReelProject): JobInfo {
  return startJob({
    kind: 'python',
    title: `릴스 원본 받기 ${project.id}`,
    args: ['reels', 'fetch', '--url', project.reference.url, '--dir', projectRel(project.id)],
    logDir: `${projectRel(project.id)}/로그`,
  });
}

export function startTranscribe(project: ReelProject): JobInfo {
  return startJob({
    kind: 'python',
    title: `릴스 대본 추출 ${project.id}`,
    args: ['reels', 'transcribe', '--dir', projectRel(project.id)],
    logDir: `${projectRel(project.id)}/로그`,
  });
}

// ---- LLM ----------------------------------------------------------------

function loadPrompt(name: string, vars: Record<string, string>): string {
  const raw = fs.readFileSync(path.join(PROMPTS, `${name}.md`), 'utf8');
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

const fmtTc = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function transcriptText(cues: TranscriptCue[]): string {
  return cues.map((c) => `[${fmtTc(c.start)}] ${c.text}`).join('\n');
}

const STRUCTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'flow', 'why_it_works', 'tone', 'cta', 'duration_sec'],
  properties: {
    hook: {type: 'string'},
    flow: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['tc', 'role', 'summary'], properties: {tc: {type: 'string'}, role: {type: 'string'}, summary: {type: 'string'}}}},
    why_it_works: {type: 'array', items: {type: 'string'}},
    tone: {type: 'string'},
    cta: {type: 'string'},
    duration_sec: {type: 'number'},
  },
};

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['thumbnail_titles', 'storyboard', 'shooting_guide', 'script', 'caption', 'hashtags', 'notes'],
  properties: {
    thumbnail_titles: {type: 'array', items: {type: 'string'}},
    storyboard: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['tc', 'caption', 'direction'], properties: {tc: {type: 'number'}, caption: {type: 'string'}, direction: {type: 'string'}}}},
    shooting_guide: {type: 'string'},
    script: {type: 'string'},
    caption: {type: 'string'},
    hashtags: {type: 'array', items: {type: 'string'}},
    notes: {type: 'string'},
  },
};

type PlanOut = {thumbnail_titles: string[]; storyboard: {tc: number; caption: string; direction: string}[]; shooting_guide: string; script: string; caption: string; hashtags: string[]; notes: string};

export async function analyzeStructure(id: string, provider: LlmProvider = 'claude'): Promise<ReelAnalysis> {
  const {project, analysis} = await getProject(id);
  if (!analysis?.transcript?.length) throw new ReelsError('대본이 없습니다. 먼저 대본 추출을 실행하세요.');
  const prompt = loadPrompt('analyze', {
    title: project.reference.title,
    author: project.reference.author,
    duration: String(project.reference.duration ?? Math.round(analysis.transcript.at(-1)?.end ?? 0)),
    views: project.reference.views?.toLocaleString() ?? '?',
    transcript: transcriptText(analysis.transcript),
  });
  const res = await runLlm<ReelAnalysis['structure']>({provider, prompt, schema: STRUCTURE_SCHEMA, title: `릴스 구조 분석 ${id}`, logDir: `${projectRel(id)}/로그`});
  if (!res.json) throw new ReelsError(`구조 분석 결과를 읽지 못했습니다 (잡 ${res.jobId})`, 502);
  const next: ReelAnalysis = {...analysis, structure: res.json, analyzed_at: new Date().toISOString()};
  await writeJsonLikePython(path.join(projectDir(id), '분석.json'), next);
  await updateProject(id, {status: 'analyzed'});
  return next;
}

function surveyVars(s: ClientSurvey | null): Record<string, string> {
  const v = s ?? {industry: '', main_product: '', instagram_url: '', external_channels: '', key_message: '', target: '', purpose: '', tone: ''};
  return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val || '(미입력)']));
}

function toPlan(out: PlanOut, base: Partial<ReelPlan>, provider: LlmProvider): ReelPlan {
  const storyboard: StoryboardFrame[] = out.storyboard.map((f, i) => ({n: i + 1, tc: Math.max(0, Number(f.tc) || 0), frame: null, caption: f.caption, direction: f.direction}));
  return {
    version: base.version ?? 1,
    target_seconds: base.target_seconds ?? 30,
    thumbnail_titles: out.thumbnail_titles.slice(0, 3),
    thumbnail_style: base.thumbnail_style ?? '',
    storyboard,
    shooting_guide: out.shooting_guide,
    script: out.script,
    caption: out.caption,
    hashtags: out.hashtags.map((h) => h.replace(/^#/, '').trim()).filter(Boolean),
    notes: out.notes,
    provider,
    generated_at: new Date().toISOString(),
    revisions: base.revisions ?? [],
  };
}

function renderPlanMd(project: ReelProject, plan: ReelPlan): string {
  const lines: string[] = [];
  lines.push(`# 릴스 기획안 — ${project.title}`, '', `- 레퍼런스: ${project.reference.url}`, `- 브랜드: ${project.brand_name || '(미입력)'}`, `- 목표 길이: ${plan.target_seconds}초 · v${plan.version} · ${plan.provider} · ${plan.generated_at.slice(0, 16).replace('T', ' ')}`, '');
  lines.push('## 썸네일 제목', '', ...plan.thumbnail_titles.map((t, i) => `${i + 1}. ${t.replace(/\n/g, ' / ')}`), '');
  lines.push('## 스토리보드', '', '| # | TC | 자막 | 연출 |', '|---|---|---|---|', ...plan.storyboard.map((f) => `| ${f.n} | ${fmtTc(f.tc)} | ${f.caption} | ${f.direction.replace(/\|/g, '/')} |`), '');
  lines.push('## 촬영 가이드', '', plan.shooting_guide.trim(), '');
  lines.push('## 대본', '', ...plan.script.split(/\r?\n/).filter(Boolean).map((l) => `- ${l}`), '');
  lines.push('## 캡션', '', plan.caption.trim(), '', plan.hashtags.map((h) => `#${h}`).join(' '), '');
  if (plan.notes) lines.push('## 기획 노트', '', plan.notes.trim(), '');
  if (plan.revisions.length) lines.push('## 수정 이력', '', ...plan.revisions.map((r) => `- ${r.at.slice(0, 16).replace('T', ' ')} (${r.provider}, ${r.target_seconds}초): ${r.instructions}`), '');
  return lines.join('\n');
}

export async function generatePlan(id: string, opts: {target_seconds?: 15 | 30 | 50; thumbnail_style?: string; provider?: LlmProvider; extra?: string}): Promise<ReelPlan> {
  const {project, analysis, plan: prev} = await getProject(id);
  if (!analysis?.transcript?.length) throw new ReelsError('대본이 없습니다. 먼저 대본 추출을 실행하세요.');
  const s = analysis.structure;
  const target = opts.target_seconds ?? 30;
  const style = opts.thumbnail_style?.trim() || '숫자·대비 강조';
  const prompt = loadPrompt('plan', {
    target_seconds: String(target),
    thumbnail_style: style,
    brand_name: project.brand_name || '(미입력)',
    extra: opts.extra ? `추가 요청: ${opts.extra}` : '',
    ...surveyVars(project.survey),
    hook: s?.hook ?? '(분석 전)',
    flow: s ? s.flow.map((f) => `${f.tc} ${f.role}: ${f.summary}`).join(' / ') : '(분석 전)',
    why: s ? s.why_it_works.join(' / ') : '(분석 전)',
    ref_tone: s?.tone ?? '',
    ref_cta: s?.cta ?? '',
    transcript: transcriptText(analysis.transcript),
  });
  const provider = opts.provider ?? 'claude';
  const res = await runLlm<PlanOut>({provider, prompt, schema: PLAN_SCHEMA, title: `릴스 기획안 생성 ${id}`, logDir: `${projectRel(id)}/로그`});
  if (!res.json?.storyboard) throw new ReelsError(`기획안 결과를 읽지 못했습니다 (잡 ${res.jobId})`, 502);
  const plan = toPlan(res.json, {version: (prev?.version ?? 0) + 1, target_seconds: target, thumbnail_style: style, revisions: prev?.revisions ?? []}, provider);
  await writeJsonLikePython(path.join(projectDir(id), '기획안.json'), plan);
  await writeText(path.join(projectDir(id), '기획안.md'), renderPlanMd(project, plan));
  await updateProject(id, {status: 'planned'});
  return plan;
}

export async function revisePlan(id: string, req: ReviseRequest): Promise<ReelPlan> {
  const {project, plan: prev} = await getProject(id);
  if (!prev) throw new ReelsError('기획안이 없습니다. 먼저 생성하세요.');
  if (!req.instructions?.trim() && !req.target_seconds && !req.must_include && !req.must_exclude) throw new ReelsError('수정 방향을 적어 주세요.');
  const target = req.target_seconds ?? prev.target_seconds;
  const style = req.thumbnail_style?.trim() || prev.thumbnail_style;
  const prompt = loadPrompt('revise', {
    instructions: req.instructions?.trim() || '(없음)',
    target_seconds: String(target),
    thumbnail_style: style || '(유지)',
    must_include: req.must_include?.trim() || '(없음)',
    must_exclude: req.must_exclude?.trim() || '(없음)',
    brand_name: project.brand_name || '(미입력)',
    ...surveyVars(project.survey),
    plan: JSON.stringify({thumbnail_titles: prev.thumbnail_titles, storyboard: prev.storyboard.map(({tc, caption, direction}) => ({tc, caption, direction})), shooting_guide: prev.shooting_guide, script: prev.script, caption: prev.caption, hashtags: prev.hashtags, notes: prev.notes}, null, 2),
  });
  const provider = req.provider ?? 'claude';
  const res = await runLlm<PlanOut>({provider, prompt, schema: PLAN_SCHEMA, title: `릴스 기획안 수정 ${id}`, logDir: `${projectRel(id)}/로그`});
  if (!res.json?.storyboard) throw new ReelsError(`수정 결과를 읽지 못했습니다 (잡 ${res.jobId})`, 502);
  const plan = toPlan(res.json, {
    version: prev.version + 1,
    target_seconds: target,
    thumbnail_style: style,
    revisions: [...prev.revisions, {at: new Date().toISOString(), instructions: [req.instructions, req.must_include && `넣기: ${req.must_include}`, req.must_exclude && `빼기: ${req.must_exclude}`].filter(Boolean).join(' · '), target_seconds: target, provider}],
  }, provider);
  // 프레임은 tc가 같은 컷만 유지
  plan.storyboard = plan.storyboard.map((f) => ({...f, frame: prev.storyboard.find((p) => Math.abs(p.tc - f.tc) < 0.01)?.frame ?? null}));
  await writeJsonLikePython(path.join(projectDir(id), '기획안.json'), plan);
  await writeText(path.join(projectDir(id), '기획안.md'), renderPlanMd(project, plan));
  return plan;
}

export async function writeManualTranscript(id: string, cues: TranscriptCue[]): Promise<ReelAnalysis> {
  const dir = projectDir(id);
  const prev = await readJson<ReelAnalysis>(path.join(dir, '분석.json'));
  const next: ReelAnalysis = {source: 'manual', language: 'ko', transcript: cues, structure: prev?.structure ?? null, analyzed_at: new Date().toISOString()};
  await writeJsonLikePython(path.join(dir, '분석.json'), next);
  return next;
}

export const projectRelPath = (id: string, name: string) => relFromRoot(path.join(projectDir(id), name));
