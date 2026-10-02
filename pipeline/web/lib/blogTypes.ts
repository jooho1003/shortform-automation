export const BLOG_STATUSES = ['keyword', 'outline', 'facts', 'draft', 'images', 'review', 'ready', 'drafted', 'published'] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];
export const SELF_PAID_CATEGORY = '내돈내산';
export const BLOG_CATEGORIES = ['맛집', SELF_PAID_CATEGORY];
export type BlogDisclosure = 'none' | 'ad' | 'sponsored' | 'affiliate';
export type BlogPublishMode = 'copy' | 'draft';

export interface BlogKeyword {
  main: string;
  subs: string[];
  volume_pc: number;
  volume_mobile: number;
  docs: number;
  saturation: number;
  week: string;
}

export interface BlogProject {
  id: string;
  version: 1;
  revision: number;
  status: BlogStatus;
  keyword: BlogKeyword;
  intent: string;
  title: string;
  title_candidates: string[];
  category: string;
  tags: string[];
  disclosure: BlogDisclosure;
  publish: {mode: BlogPublishMode; post_url: string | null; published_at: string | null};
  createdAt: string;
  updatedAt: string;
}

export interface BlogOutline {
  title_candidates: string[];
  intent: string;
  reader: string;
  sections: {h2: string; h3: string[]; points: string[]; keyword_use: string}[];
  facts_needed: {id: string; question: string}[];
  images: {n: number; kind: 'thumb' | 'body'; brief: string; alt: string}[];
  faq: string[];
}

export interface BlogFact {
  id: string;
  claim: string;
  source_url: string;
  quote: string;
  checked_at: string;
}

export interface BlogImage {
  n: number;
  file: string;
  alt: string;
  prompt: string;
  kind: 'thumb' | 'body';
}

export interface BlogLintItem {
  code: string;
  message: string;
}

export interface BlogLintReport {
  errors: BlogLintItem[];
  warnings: BlogLintItem[];
  checked_at: string;
  body_sha256: string;
  approval_valid: boolean;
}

export interface BlogState {
  current: string | null;
  status: 'idle' | 'running' | 'done' | 'failed' | 'interrupted';
  started_at: string | null;
  ended_at: string | null;
  job_id: string | null;
  error: string | null;
}

export interface BlogRankPoint {
  date: string;
  keyword: string;
  rank: number | null;
}

export interface BlogBundle {
  project: BlogProject;
  outline: BlogOutline | null;
  facts: BlogFact[];
  body: string;
  draft: string;
  images: BlogImage[];
  lint: BlogLintReport | null;
  state: BlogState;
  ranks: BlogRankPoint[];
  gates: {outline: boolean; body: boolean; bodyValid: boolean};
  previewHtml: string;
}

export interface BlogKeywordCandidate extends BlogKeyword {
  score: number;
  status: 'unused' | 'writing' | 'published';
}

export interface BlogConfig {
  blog_id: string;
  niche: string;
  persona: string;
  seed_keywords: string[];
  min_volume: number;
  max_saturation: number;
  weekly_target: number;
  length: {min: number; max: number};
  banned_phrases: string[];
  vague_phrases: string[];
  max_posts_per_day: number;
  min_hours_between_posts: number;
  default_publish_mode: BlogPublishMode;
  draft_enabled: boolean;
}
