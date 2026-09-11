/**
 * 웹 콘솔 타입 계약.
 *
 * 파일 규약의 SSOT는 Python(shortform/paths.py, planfile.py, steps/assets.py)이다.
 * 여기 타입은 `python -m shortform inspect ...`가 뱉는 JSON과 remotion/src/Short.tsx의 Timeline을
 * 그대로 옮긴 것이며, 새 필드는 Python·Remotion 쪽에 먼저 넣고 여기에 반영한다.
 */
import type {Timeline as RemotionTimeline} from '@composition/Short';

export type Track = 'A' | 'B';
export type StepName = 'plan' | 'clips' | 'assets' | 'images' | 'video' | 'render' | 'upload';
/** B안 단계. A안은 STEPS_BY_TRACK.A (cli.py STEP_NAMES / STEP_NAMES_A 와 같아야 한다). */
export const STEP_ORDER: StepName[] = ['plan', 'clips', 'assets', 'render', 'upload'];
export const STEPS_BY_TRACK: Record<Track, StepName[]> = {
  A: ['plan', 'images', 'video', 'render', 'upload'],
  B: STEP_ORDER,
};
export const ALL_STEPS: StepName[] = ['plan', 'clips', 'assets', 'images', 'video', 'render', 'upload'];
export const STEP_LABEL: Record<StepName, string> = {
  plan: '기획',
  clips: '소재 후보',
  assets: '소재 준비',
  images: '시트·키프레임',
  video: '컷 영상(fal)',
  render: '렌더',
  upload: '업로드',
};

export interface StepState {
  done: boolean;
  at: string;
  [key: string]: unknown;
}

export interface StepError {
  step: string;
  message: string;
  at: string;
}

export interface Gates {
  plan_ok: boolean;
  plan_fix: boolean;
  clips_ok: boolean;
  clips_fix: boolean;
  upload_ok: boolean;
}

export interface EpisodeFiles {
  plan_md: string | null;
  contact_sheet: string | null;
  clip_list: string | null;
  timeline: string | null;
  final_mp4: string | null;
  thumb: string | null;
  result_json: string | null;
}

export interface EpisodeSummary {
  track: Track;
  date: string;
  num: string;
  slug: string;
  dir: string;
  steps: Record<string, StepState>;
  errors: StepError[];
  gates: Gates;
  files: EpisodeFiles;
  title: string;
  template_id: string | null;
  template_name: string | null;
}

export interface PlanLine {
  n: number;
  text: string;
  source: string;
  queries: string[];
}

export interface PlanComment {
  at: number;
  nick: string;
  text: string;
}

/**
 * 렌더 경로. 기본은 remotion(코드가 mp4까지 자동으로 뽑는다).
 * capcut은 CapCut 드래프트를 만들어 손으로 마무리하는 길이다 — CapCut은 내보내기를
 * 자동화할 방법이 없어서 사람이 열어서 내보내야 한다.
 */
export const RENDER_ROUTES = ['remotion', 'capcut'] as const;
export type RenderRoute = (typeof RENDER_ROUTES)[number];

/** B안 기획안. 훅과 대본 문장이 축이다. */
export interface Plan {
  title: string;
  hook: string;
  lines: PlanLine[];
  template_id: string;
  template_name: string;
  comments: PlanComment[];
  meta: Record<string, string>;
}

export interface PlanCut {
  n: number;
  start: number;
  end: number;
  lens: string;
  action: string;
  camera: string;
  required: boolean;
}

/**
 * A안 기획안. B안과 필드가 겹치지 않는다 — 훅·대본 대신 시놉시스·락 블록·컷표다.
 * `planfile_a.py`가 만들고 `inspect episode`가 그대로 내보낸다.
 */
export interface PlanA {
  title: string;
  synopsis: string;
  locks: Record<string, string>;
  cuts: PlanCut[];
  sound: Record<string, string>;
  template_id: string;
  template_name: string;
  comments: PlanComment[];
  meta: Record<string, string>;
}

export interface ClipCandidate {
  provider: 'youtube' | 'pexels';
  id: string;
  page: string;
  thumb: string;
  author?: string;
  title?: string;
  duration?: number;
  views?: number;
  official?: boolean;
  start?: number;
  download?: string;
  width?: number;
  height?: number;
}

export interface ClipEntry {
  n: number;
  text: string;
  source: string;
  queries: string[];
  chosen: number | null;
  candidates: ClipCandidate[];
  media_layout?: 'landscape' | 'portrait';
}

export interface Credit {
  n: number;
  provider: string;
  author: string;
  page: string;
  title: string;
  start: number;
  seconds: number;
}

/** 03-소재/타임라인.json. Remotion Timeline + assets.py가 덧붙이는 credits. */
export type Timeline = RemotionTimeline & {credits?: Credit[]};

export interface UploadResult {
  videoId?: string;
  url?: string;
  privacy?: string;
  error?: string;
  at: string;
}

export interface EpisodeAssets {
  clips: string[];
  tts: string[];
  narration: string | null;
  images: string[];
}

export interface EpisodeDetail {
  root: string;
  episode: EpisodeSummary;
  plan: Plan | PlanA | null;
  plan_error: string | null;
  plan_md: string | null;
  fix_requests: {plan: string | null; clips: string | null};
  clip_list: ClipEntry[] | null;
  timeline: Timeline | null;
  result: UploadResult | null;
  assets: EpisodeAssets;
}

export interface EpisodeList {
  root: string;
  episodes: EpisodeSummary[];
}

export interface TemplateInfo {
  id: string;
  name: string;
  duration: [number, number];
  enforce_duration: boolean;
}

export interface ConfigInfo {
  root: string;
  templates: TemplateInfo[];
  default_template: string;
  voice: Record<string, unknown>;
  channels: Record<string, unknown>;
}

export interface ResearchInfo {
  root: string;
  latest: {file: string; data: Record<string, unknown>} | null;
  fresh: boolean;
}

// ---- 잡 러너 ----------------------------------------------------------------

export type JobKind = 'python' | 'claude' | 'codex' | 'shell';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobSpec {
  kind: JobKind;
  /** 사람이 읽는 제목. 로그 파일 이름에도 쓴다. */
  title: string;
  args: string[];
  cwd?: string;
  /** 표준 입력으로 넣을 텍스트(프롬프트 등). */
  stdin?: string;
  env?: Record<string, string>;
  /** 로그를 남길 회차 폴더(ROOT 상대). 없으면 pipeline/data/logs. */
  logDir?: string;
  /** 외부 발신·과금 잡. UI가 확인을 받은 뒤에만 confirmed=true로 보낸다. */
  dangerous?: boolean;
  confirmed?: boolean;
}

export interface JobInfo {
  id: string;
  kind: JobKind;
  title: string;
  status: JobStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  logFile: string | null;
}

export type JobEvent =
  | {type: 'status'; job: JobInfo}
  | {type: 'log'; stream: 'stdout' | 'stderr'; text: string}
  | {type: 'end'; job: JobInfo};
