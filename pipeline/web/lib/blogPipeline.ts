import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

import {
  BlogError,
  blogAtomicJson,
  blogNow,
  blogPath,
  getBlogBundle,
  getBlogProject,
  lintBlog,
  loadBlogConfig,
  updateGeneratedProject,
} from './blog';
import type {BlogFact, BlogOutline, BlogState} from './blogTypes';
import {runLlm} from './llm';
import {PIPELINE, childEnv, pythonCommand} from './paths';

const execFileAsync = promisify(execFile);
const STAGES = ['facts', 'draft', 'polish', 'images', 'lint'] as const;
export type BlogPipelineStage = (typeof STAGES)[number];
export interface BlogPipelineJob {
  id: string;
  projectId: string;
  from: BlogPipelineStage;
  status: 'running' | 'done' | 'failed';
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

const globalState = globalThis as unknown as {
  __blogPipelineJobs?: Map<string, BlogPipelineJob>;
  __blogLlmTail?: Promise<void>;
};
const jobs = globalState.__blogPipelineJobs ?? (globalState.__blogPipelineJobs = new Map());

const newJobId = () => `blog-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;

async function withLlmLock<T>(task: () => Promise<T>): Promise<T> {
  const before = globalState.__blogLlmTail ?? Promise.resolve();
  let release!: () => void;
  globalState.__blogLlmTail = new Promise<void>((resolve) => (release = resolve));
  await before.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
  }
}

async function prompt(name: string, values: Record<string, string>): Promise<string> {
  let value = await fs.readFile(path.join(PIPELINE, 'prompts', 'blog', `${name}.md`), 'utf8');
  for (const [key, replacement] of Object.entries(values)) value = value.replaceAll(`{{${key}}}`, replacement);
  return value;
}

const outlineSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title_candidates', 'intent', 'reader', 'sections', 'facts_needed', 'images', 'faq'],
  properties: {
    title_candidates: {type: 'array', minItems: 3, maxItems: 3, items: {type: 'string'}},
    intent: {type: 'string'},
    reader: {type: 'string'},
    sections: {type: 'array', minItems: 3, items: {type: 'object', additionalProperties: false, required: ['h2', 'h3', 'points', 'keyword_use'], properties: {h2: {type: 'string'}, h3: {type: 'array', items: {type: 'string'}}, points: {type: 'array', items: {type: 'string'}}, keyword_use: {type: 'string'}}}},
    facts_needed: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['id', 'question'], properties: {id: {type: 'string'}, question: {type: 'string'}}}},
    images: {type: 'array', minItems: 3, items: {type: 'object', additionalProperties: false, required: ['n', 'kind', 'brief', 'alt'], properties: {n: {type: 'integer'}, kind: {type: 'string', enum: ['thumb', 'body']}, brief: {type: 'string'}, alt: {type: 'string'}}}},
    faq: {type: 'array', items: {type: 'string'}},
  },
};

const factsSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {facts: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['id', 'claim', 'source_url', 'quote', 'checked_at'], properties: {id: {type: 'string'}, claim: {type: 'string'}, source_url: {type: 'string'}, quote: {type: 'string'}, checked_at: {type: 'string'}}}}},
};

async function python(args: string[]): Promise<string> {
  const executable = pythonCommand();
  const {stdout} = await execFileAsync(executable.cmd, [...executable.prefix, '-m', 'shortform', ...args], {cwd: PIPELINE, env: childEnv(), encoding: 'utf8', timeout: 15 * 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024});
  return stdout;
}

function validateOutline(value: unknown): BlogOutline {
  if (!value || typeof value !== 'object') throw new BlogError('개요 생성 결과가 올바르지 않습니다.', 500);
  const outline = value as BlogOutline;
  if (!Array.isArray(outline.title_candidates) || outline.title_candidates.length !== 3 || !Array.isArray(outline.sections) || outline.sections.length < 3) throw new BlogError('개요 필수 항목이 부족합니다.', 500);
  return outline;
}

export async function generateBlogOutline(projectId: string): Promise<ReturnType<typeof getBlogBundle>> {
  const [project, config] = await Promise.all([getBlogProject(projectId), loadBlogConfig()]);
  await python(['blog', 'serp', '--keyword', project.keyword.main, '--project', projectId]);
  const serp = (await fs.readFile(blogPath(projectId, '상위글.json'), 'utf8').catch(() => '{"items":[]}')).slice(0, 30_000);
  const request = await prompt('outline', {niche: config.niche, persona: config.persona, keyword: project.keyword.main, serp});
  const result = await withLlmLock(() => runLlm<BlogOutline>({provider: 'claude', model: 'sonnet', prompt: request, schema: outlineSchema, title: `블로그 개요 · ${project.keyword.main}`, logDir: `블로그/${projectId}/로그`}));
  const outline = validateOutline(result.json);
  await blogAtomicJson(blogPath(projectId, '개요.json'), outline);
  await updateGeneratedProject(projectId, {status: 'outline', title: outline.title_candidates[0] ?? project.keyword.main, title_candidates: outline.title_candidates, intent: outline.intent});
  return getBlogBundle(projectId);
}

async function writeState(projectId: string, state: BlogState): Promise<void> {
  await blogAtomicJson(blogPath(projectId, '상태.json'), state);
}

async function runFacts(projectId: string): Promise<void> {
  const [project, config, outline] = await Promise.all([getBlogProject(projectId), loadBlogConfig(), fs.readFile(blogPath(projectId, '개요.json'), 'utf8')]);
  const request = await prompt('facts', {niche: config.niche, outline});
  const result = await withLlmLock(() => runLlm<{facts: BlogFact[]}>({provider: 'claude', model: 'sonnet', prompt: request, schema: factsSchema, allowedTools: ['WebSearch', 'WebFetch'], maxTurns: 12, title: `블로그 근거 · ${project.keyword.main}`, logDir: `블로그/${projectId}/로그`}));
  const facts = result.json?.facts;
  if (!Array.isArray(facts)) throw new BlogError('근거 조사 결과를 읽지 못했습니다.', 500);
  await blogAtomicJson(blogPath(projectId, '근거.json'), facts);
  await updateGeneratedProject(projectId, {status: 'facts'});
}

async function runDraft(projectId: string): Promise<void> {
  const [project, config, outline, facts] = await Promise.all([
    getBlogProject(projectId),
    loadBlogConfig(),
    fs.readFile(blogPath(projectId, '개요.json'), 'utf8'),
    fs.readFile(blogPath(projectId, '근거.json'), 'utf8'),
  ]);
  const request = await prompt('draft', {niche: config.niche, persona: config.persona, keyword: project.keyword.main, length: `${config.length.min}~${config.length.max}자`, outline, facts, disclosure: project.disclosure});
  const result = await withLlmLock(() => runLlm({provider: 'claude', model: 'sonnet', prompt: request, title: `블로그 초안 · ${project.keyword.main}`, logDir: `블로그/${projectId}/로그`}));
  const body = result.text.trim();
  if (!body.includes('##')) throw new BlogError('초안에 소제목이 없습니다.', 500);
  await Promise.all([fs.writeFile(blogPath(projectId, '본문.초안.md'), body, 'utf8'), fs.writeFile(blogPath(projectId, '본문.md'), body, 'utf8')]);
  await updateGeneratedProject(projectId, {status: 'draft'});
}

async function runPolish(projectId: string): Promise<void> {
  const [project, config, draft] = await Promise.all([getBlogProject(projectId), loadBlogConfig(), fs.readFile(blogPath(projectId, '본문.md'), 'utf8')]);
  const request = await prompt('polish', {persona: config.persona, keyword: project.keyword.main, banned: config.banned_phrases.join(', '), draft});
  const result = await withLlmLock(() => runLlm({provider: 'claude', model: 'sonnet', prompt: request, title: `블로그 윤문 · ${project.keyword.main}`, logDir: `블로그/${projectId}/로그`}));
  const body = result.text.trim();
  if (!body.includes('##')) throw new BlogError('윤문 결과에 소제목이 없습니다.', 500);
  await fs.writeFile(blogPath(projectId, '본문.md'), body, 'utf8');
  await updateGeneratedProject(projectId, {status: 'draft'});
}

async function runImages(projectId: string): Promise<void> {
  await python(['blog', 'images', '--id', projectId]);
  await updateGeneratedProject(projectId, {status: 'images'});
}

async function executePipeline(job: BlogPipelineJob): Promise<void> {
  const start = STAGES.indexOf(job.from);
  try {
    for (const stage of STAGES.slice(start)) {
      await writeState(job.projectId, {current: stage, status: 'running', started_at: job.startedAt, ended_at: null, job_id: job.id, error: null});
      if (stage === 'facts') await runFacts(job.projectId);
      if (stage === 'draft') await runDraft(job.projectId);
      if (stage === 'polish') await runPolish(job.projectId);
      if (stage === 'images') await runImages(job.projectId);
      if (stage === 'lint') {
        await lintBlog(job.projectId);
        await updateGeneratedProject(job.projectId, {status: 'review'});
      }
    }
    job.status = 'done';
    job.endedAt = blogNow();
    await writeState(job.projectId, {current: null, status: 'done', started_at: job.startedAt, ended_at: job.endedAt, job_id: job.id, error: null});
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    job.endedAt = blogNow();
    await writeState(job.projectId, {current: null, status: 'failed', started_at: job.startedAt, ended_at: job.endedAt, job_id: job.id, error: job.error});
  }
}

export function startBlogPipeline(projectId: string, from: BlogPipelineStage): BlogPipelineJob {
  if (!STAGES.includes(from)) throw new BlogError('알 수 없는 블로그 생성 단계입니다.');
  if ([...jobs.values()].some((job) => job.projectId === projectId && job.status === 'running')) throw new BlogError('이 글의 생성 작업이 이미 진행 중입니다.', 409);
  const job: BlogPipelineJob = {id: newJobId(), projectId, from, status: 'running', error: null, startedAt: blogNow(), endedAt: null};
  jobs.set(job.id, job);
  void executePipeline(job);
  return {...job};
}

export function getBlogPipelineJob(id: string): BlogPipelineJob | null {
  const job = jobs.get(id);
  return job ? {...job} : null;
}

export const blogPipelineStages = STAGES;
