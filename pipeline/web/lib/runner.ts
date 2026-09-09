/**
 * 범용 잡 러너.
 *
 * python -m shortform, claude -p, codex exec, 임의 셸 명령을 같은 인터페이스로 spawn하고
 * stdout/stderr를 (1) 구독자에게 실시간으로 (2) 로그 파일에 흘린다.
 *
 * - Next dev는 모듈을 다시 로드하므로 레지스트리는 globalThis에 둔다.
 * - Windows에서 claude/codex는 .cmd 셔임이라 shell 없이 spawn하면 EINVAL이 난다(DEP0190).
 *   그래서 kind별로 shell 여부를 정하고, 인자는 직접 따옴표 처리한다. 긴 텍스트(프롬프트)는 stdin으로 넘긴다.
 * - 외부 발신·과금 잡(dangerous)은 confirmed 없이는 시작하지 않는다.
 */
import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {DATA, PIPELINE, childEnv, pythonCommand, relFromRoot} from './paths';
import {resolveInRoot} from './safePath';
import type {JobEvent, JobInfo, JobSpec} from './types';

type Listener = (ev: JobEvent) => void;

interface Job {
  info: JobInfo;
  spec: JobSpec;
  child: ChildProcess | null;
  backlog: string[]; // 최근 로그 줄 (구독이 늦게 붙어도 앞부분을 보여주기 위해)
  listeners: Set<Listener>;
  logStream: fs.WriteStream | null;
}

const BACKLOG_LINES = 3000;
const JOBS_DIR = path.join(DATA, 'jobs');
const DEFAULT_LOG_DIR = path.join(DATA, 'logs');

const g = globalThis as unknown as {__shortformJobs?: Map<string, Job>};
const registry: Map<string, Job> = g.__shortformJobs ?? (g.__shortformJobs = new Map());

export class JobError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

function newId(): string {
  const t = new Date();
  const stamp = t.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  return `${stamp}-${Math.random().toString(36).slice(2, 7)}`;
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
}

/** cmd.exe용 인자 따옴표. 공백·특수문자가 있으면 감싸고 내부 따옴표는 \" 로. */
function quoteWin(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"')}"`;
}

function resolveCommand(spec: JobSpec): {cmd: string; args: string[]; shell: boolean} {
  const win = process.platform === 'win32';
  switch (spec.kind) {
    case 'python': {
      const py = pythonCommand();
      return {cmd: py.cmd, args: [...py.prefix, '-m', 'shortform', ...spec.args], shell: false};
    }
    case 'claude':
      return {cmd: 'claude', args: spec.args, shell: win};
    case 'codex':
      return {cmd: 'codex', args: spec.args, shell: win};
    case 'shell': {
      const [cmd, ...rest] = spec.args;
      if (!cmd) throw new JobError('실행할 명령이 없습니다.');
      return {cmd, args: rest, shell: win};
    }
  }
}

function persist(job: Job) {
  try {
    fs.mkdirSync(JOBS_DIR, {recursive: true});
    fs.writeFileSync(path.join(JOBS_DIR, `${job.info.id}.json`), JSON.stringify({...job.info, spec: {...job.spec, stdin: undefined}}, null, 2), 'utf8');
  } catch {
    // 잡 인덱스 저장 실패는 실행을 막지 않는다
  }
}

function emit(job: Job, ev: JobEvent) {
  for (const l of job.listeners) {
    try {
      l(ev);
    } catch {
      // 리스너 오류는 무시
    }
  }
}

function pushLog(job: Job, stream: 'stdout' | 'stderr', chunk: string) {
  const lines = chunk.split(/\r?\n/);
  for (const line of lines) {
    if (line === '') continue;
    const tagged = stream === 'stderr' ? `[stderr] ${line}` : line;
    job.backlog.push(tagged);
    if (job.backlog.length > BACKLOG_LINES) job.backlog.splice(0, job.backlog.length - BACKLOG_LINES);
    job.logStream?.write(tagged + '\n');
  }
  emit(job, {type: 'log', stream, text: chunk});
}

function finish(job: Job, status: JobInfo['status'], code: number | null) {
  if (job.info.status === 'done' || job.info.status === 'failed' || job.info.status === 'cancelled') return;
  job.info.status = status;
  job.info.exitCode = code;
  job.info.endedAt = new Date().toISOString();
  job.logStream?.end(`\n--- ${status} (exit ${code ?? '?'}) ${job.info.endedAt} ---\n`);
  job.logStream = null;
  job.child = null;
  persist(job);
  emit(job, {type: 'end', job: {...job.info}});
}

export function startJob(spec: JobSpec): JobInfo {
  if (spec.dangerous && !spec.confirmed) {
    throw new JobError('외부 발신·과금 작업은 확인 후에만 실행됩니다.', 400);
  }
  const {cmd, args, shell} = resolveCommand(spec);
  const cwd = spec.cwd ? resolveInRoot(spec.cwd) : PIPELINE;
  const logDir = spec.logDir ? resolveInRoot(spec.logDir) : DEFAULT_LOG_DIR;
  fs.mkdirSync(logDir, {recursive: true});

  const id = newId();
  const logFile = path.join(logDir, `${id}-${safeName(spec.title)}.log`);
  const info: JobInfo = {
    id,
    kind: spec.kind,
    title: spec.title,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    logFile: relFromRoot(logFile),
  };
  const job: Job = {info, spec, child: null, backlog: [], listeners: new Set(), logStream: fs.createWriteStream(logFile, {flags: 'a'})};
  registry.set(id, job);
  job.logStream!.write(`--- ${spec.kind} ${cmd} ${args.map(quoteWin).join(' ')}\n--- cwd ${cwd}\n--- ${info.startedAt}\n`);

  let child: ChildProcess;
  try {
    child = spawn(cmd, shell ? args.map(quoteWin) : args, {
      cwd,
      env: childEnv(spec.env ?? {}),
      shell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    pushLog(job, 'stderr', `spawn 실패: ${(err as Error).message}`);
    finish(job, 'failed', null);
    return {...info};
  }
  job.child = child;
  persist(job);

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (d: string) => pushLog(job, 'stdout', d));
  child.stderr?.on('data', (d: string) => pushLog(job, 'stderr', d));
  child.on('error', (err) => {
    pushLog(job, 'stderr', `프로세스 오류: ${err.message}`);
    finish(job, 'failed', null);
  });
  child.on('close', (code, signal) => {
    if (job.info.status === 'cancelled') return finish(job, 'cancelled', code);
    finish(job, code === 0 ? 'done' : 'failed', code ?? (signal ? -1 : null));
  });

  if (spec.stdin !== undefined) {
    child.stdin?.end(spec.stdin, 'utf8');
  } else {
    child.stdin?.end();
  }
  return {...info};
}

export function getJob(id: string): JobInfo | null {
  const job = registry.get(id);
  if (job) return {...job.info};
  try {
    const raw = fs.readFileSync(path.join(JOBS_DIR, `${id}.json`), 'utf8');
    const parsed = JSON.parse(raw) as JobInfo & {spec?: unknown};
    delete parsed.spec;
    return parsed;
  } catch {
    return null;
  }
}

export function getBacklog(id: string): string[] {
  const job = registry.get(id);
  if (job) return [...job.backlog];
  const info = getJob(id);
  if (!info?.logFile) return [];
  try {
    return fs.readFileSync(resolveInRoot(info.logFile), 'utf8').split(/\r?\n/).slice(-BACKLOG_LINES);
  } catch {
    return [];
  }
}

export function listJobs(limit = 100): JobInfo[] {
  const live = [...registry.values()].map((j) => ({...j.info}));
  const seen = new Set(live.map((j) => j.id));
  let stored: JobInfo[] = [];
  try {
    stored = fs
      .readdirSync(JOBS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf8')) as JobInfo & {spec?: unknown};
          delete j.spec;
          return j;
        } catch {
          return null;
        }
      })
      .filter((j): j is JobInfo => !!j && !seen.has(j.id));
  } catch {
    // 아직 잡이 없음
  }
  return [...live, ...stored].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, limit);
}

export function subscribe(id: string, listener: Listener): (() => void) | null {
  const job = registry.get(id);
  if (!job) return null;
  job.listeners.add(listener);
  return () => job.listeners.delete(listener);
}

export function cancelJob(id: string): JobInfo | null {
  const job = registry.get(id);
  if (!job) return null;
  if (!job.child || job.info.status !== 'running') return {...job.info};
  job.info.status = 'cancelled';
  pushLog(job, 'stderr', '사용자가 취소했습니다.');
  const pid = job.child.pid;
  if (process.platform === 'win32' && pid) {
    // 자식(ffmpeg·yt-dlp·npx)까지 같이 끊는다
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  } else {
    job.child.kill('SIGTERM');
  }
  return {...job.info};
}

/** 잡이 끝날 때까지 기다린다(LLM 호출처럼 결과를 바로 써야 하는 경우). */
export function waitJob(id: string): Promise<JobInfo> {
  return new Promise((resolve) => {
    const job = registry.get(id);
    if (!job) return resolve(getJob(id) ?? ({id, status: 'failed'} as JobInfo));
    if (job.info.status !== 'running') return resolve({...job.info});
    const off = subscribe(id, (ev) => {
      if (ev.type === 'end') {
        off?.();
        resolve(ev.job);
      }
    });
  });
}

export function isRunning(id: string): boolean {
  return registry.get(id)?.info.status === 'running';
}
