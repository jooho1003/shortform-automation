/**
 * 카드뉴스·인스타툰 프로젝트 저장소. SSOT는 파일.
 *
 * 카드뉴스/<id>/프로젝트.json · 이미지/NN.png · 출력/NN.jpg · 로그/
 * 인스타툰/<id>/프로젝트.json · 캐릭터/<key>.png · 컷/SS-P.png · 출력/NN.jpg · 로그/
 *
 * 설계: docs/전략/37-카드뉴스-인스타툰-자동화.md
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  API_MAX_SLIDES,
  HARD_MAX_SLIDES,
  PANELS_PER_LAYOUT,
  type Bubble,
  type CardSlideData,
  type CarouselTheme,
  type ToonLayout,
  type ToonSlideData,
} from '@composition/carousel/types';

import {readJson, writeJsonLikePython} from './jsonio';
import {ROOT} from './paths';

export {API_MAX_SLIDES, HARD_MAX_SLIDES};

export type CarouselKind = 'cardnews' | 'instatoon';

export const KIND_DIR: Record<CarouselKind, string> = {cardnews: '카드뉴스', instatoon: '인스타툰'};
export const KIND_LABEL: Record<CarouselKind, string> = {cardnews: '카드뉴스', instatoon: '인스타툰'};

export type CarouselStatus = 'draft' | 'scripted' | 'illustrated' | 'rendered' | 'published';

type Base = {
  id: string;
  title: string;
  client: string | null;
  brand_name: string;
  /** 광고·협찬 여부. true면 표지 '광고' 표기 + 캡션 첫 줄 표기를 강제한다. */
  sponsored: boolean;
  status: CarouselStatus;
  caption: string;
  hashtags: string[];
  created_at: string;
  updated_at: string;
};

export type CardNewsProject = Base & {
  kind: 'cardnews';
  topic: string;
  audience: string;
  theme: CarouselTheme;
  slides: CardSlideData[];
};

export type ToonCharacter = {
  key: string;
  name: string;
  /** 외형·의상·화풍 락 블록. 컷 프롬프트는 이걸 되풀이하지 않는다. */
  lock: string;
  /** 캐릭터 시트 이미지(루트 기준 상대 경로). 모든 컷 생성에 참조로 붙는다. */
  sheet: string | null;
};

export type InstatoonProject = Base & {
  kind: 'instatoon';
  genre: '일상툰' | '정보툰' | '광고툰';
  logline: string;
  style: string;
  characters: ToonCharacter[];
  slides: ToonSlideData[];
};

export type CarouselProject = CardNewsProject | InstatoonProject;

export class CarouselError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const idOk = (id: string) => /^[A-Za-z0-9_-]{4,40}$/.test(id);
export const kindOk = (k: string): k is CarouselKind => k === 'cardnews' || k === 'instatoon';

const newId = () => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${ymd}-${Math.random().toString(36).slice(2, 7)}`;
};

const dirOf = (kind: CarouselKind, id: string) => path.join(ROOT, KIND_DIR[kind], id);
const fileOf = (kind: CarouselKind, id: string) => path.join(dirOf(kind, id), '프로젝트.json');

export const projectRel = (kind: CarouselKind, id: string) => `${KIND_DIR[kind]}/${id}`;

export async function listCarousels(kind: CarouselKind): Promise<CarouselProject[]> {
  const base = path.join(ROOT, KIND_DIR[kind]);
  let names: string[] = [];
  try {
    names = await fs.readdir(base);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const items = await Promise.all(names.filter(idOk).map((n) => readJson<CarouselProject>(fileOf(kind, n)).catch(() => null)));
  return items.filter((p): p is CarouselProject => p != null).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getCarousel(kind: CarouselKind, id: string): Promise<CarouselProject> {
  if (!idOk(id)) throw new CarouselError('잘못된 프로젝트 id');
  const p = await readJson<CarouselProject>(fileOf(kind, id));
  if (!p) throw new CarouselError('프로젝트가 없습니다.', 404);
  return p;
}

const emptyCard = (role: CardSlideData['role']): CardSlideData => ({role, eyebrow: '', title: '', body: '', image: null});

export async function createCarousel(kind: CarouselKind, input: {title?: string; topic?: string; client?: string | null; brand_name?: string; sponsored?: boolean}): Promise<CarouselProject> {
  const now = new Date().toISOString();
  const title = (input.title ?? '').trim() || (input.topic ?? '').trim().slice(0, 40) || '제목 없음';
  const base: Base = {
    id: newId(),
    title,
    client: input.client ?? null,
    brand_name: input.brand_name ?? '',
    sponsored: Boolean(input.sponsored),
    status: 'draft',
    caption: '',
    hashtags: [],
    created_at: now,
    updated_at: now,
  };
  const project: CarouselProject =
    kind === 'cardnews'
      ? {
          ...base,
          kind,
          topic: input.topic ?? '',
          audience: '',
          theme: {bg: '#111318', fg: '#f5f5f2', accent: '#ffd43b'},
          slides: [{...emptyCard('cover'), title}, emptyCard('body'), emptyCard('body'), emptyCard('body'), emptyCard('cta')],
        }
      : {
          ...base,
          kind,
          genre: '일상툰',
          logline: input.topic ?? '',
          style: '굵은 외곽선, 단순한 2등신, 파스텔 평면 채색, 배경 최소화',
          characters: [{key: 'main', name: '주인공', lock: '', sheet: null}],
          slides: [{layout: 'single', panels: [{scene: '', image: null, bubbles: []}]}],
        };
  await writeJsonLikePython(fileOf(kind, project.id), project);
  return project;
}

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
const relOrNull = (v: unknown) => (typeof v === 'string' && v && !path.isAbsolute(v) && !v.includes('..') ? v : null);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function cleanSlides(kind: CarouselKind, raw: unknown): CardSlideData[] | ToonSlideData[] {
  if (!Array.isArray(raw)) throw new CarouselError('slides는 배열이어야 합니다.');
  if (raw.length === 0) throw new CarouselError('슬라이드가 최소 1장 필요합니다.');
  if (raw.length > HARD_MAX_SLIDES) throw new CarouselError(`슬라이드는 최대 ${HARD_MAX_SLIDES}장입니다.`);
  if (kind === 'cardnews') {
    return raw.map((s: Record<string, unknown>): CardSlideData => ({
      role: s.role === 'cover' || s.role === 'cta' ? s.role : 'body',
      eyebrow: str(s.eyebrow, 60),
      title: str(s.title, 200),
      body: str(s.body, 1000),
      image: relOrNull(s.image),
    }));
  }
  return raw.map((s: Record<string, unknown>): ToonSlideData => {
    const layout: ToonLayout = s.layout === 'two' || s.layout === 'four' ? s.layout : 'single';
    const panels = (Array.isArray(s.panels) ? s.panels : []).slice(0, PANELS_PER_LAYOUT[layout]).map((p: Record<string, unknown>) => ({
      scene: str(p.scene, 1000),
      image: relOrNull(p.image),
      bubbles: (Array.isArray(p.bubbles) ? p.bubbles : []).slice(0, 6).map((b: Record<string, unknown>): Bubble => ({
        speaker: str(b.speaker, 40),
        text: str(b.text, 200),
        kind: b.kind === 'thought' || b.kind === 'narration' ? b.kind : 'speech',
        x: num(b.x, 0, 100, 50),
        y: num(b.y, 0, 100, 20),
      })),
    }));
    return {layout, panels, ...(layout === 'single' && s.fullBleed === true ? {fullBleed: true} : {})};
  });
}

/** 편집 가능한 필드만 받아서 덮어쓴다. id·kind·created_at은 바꿀 수 없다. */
export async function updateCarousel(kind: CarouselKind, id: string, patch: Record<string, unknown>): Promise<CarouselProject> {
  const cur = await getCarousel(kind, id);
  const next = {...cur} as CarouselProject & Record<string, unknown>;
  for (const k of ['title', 'brand_name', 'caption'] as const) if (k in patch) next[k] = str(patch[k]);
  if ('sponsored' in patch) next.sponsored = Boolean(patch.sponsored);
  if ('hashtags' in patch && Array.isArray(patch.hashtags)) next.hashtags = patch.hashtags.map((h) => str(h, 60).replace(/^#/, '').trim()).filter(Boolean).slice(0, 30);
  if ('slides' in patch) (next as {slides: unknown}).slides = cleanSlides(kind, patch.slides);

  if (next.kind === 'cardnews') {
    for (const k of ['topic', 'audience'] as const) if (k in patch) next[k] = str(patch[k]);
    if (patch.theme && typeof patch.theme === 'object') {
      const t = patch.theme as Record<string, unknown>;
      const color = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
      next.theme = {bg: color(t.bg, next.theme.bg), fg: color(t.fg, next.theme.fg), accent: color(t.accent, next.theme.accent)};
    }
  } else {
    for (const k of ['logline', 'style'] as const) if (k in patch) next[k] = str(patch[k]);
    if (patch.genre === '일상툰' || patch.genre === '정보툰' || patch.genre === '광고툰') next.genre = patch.genre;
    if (Array.isArray(patch.characters)) {
      next.characters = patch.characters.slice(0, 8).map((c: Record<string, unknown>, i) => ({
        key: /^[a-z0-9_-]{1,20}$/.test(str(c.key)) ? str(c.key) : `c${i + 1}`,
        name: str(c.name, 40),
        lock: str(c.lock, 2000),
        sheet: relOrNull(c.sheet),
      }));
    }
  }
  next.updated_at = new Date().toISOString();
  await writeJsonLikePython(fileOf(kind, id), next);
  return next;
}

/** 게시 전 점검. 막는 것(error)과 알리는 것(warn)을 나눈다. */
export function lintCarousel(p: CarouselProject): {level: 'error' | 'warn'; msg: string}[] {
  const out: {level: 'error' | 'warn'; msg: string}[] = [];
  if (p.slides.length > API_MAX_SLIDES) out.push({level: 'warn', msg: `${p.slides.length}장 — API·Buffer 자동 게시는 ${API_MAX_SLIDES}장까지. 앱 수동 게시만 가능.`});
  if (p.sponsored && !/^(\[?광고\]?|#광고|\[?협찬\]?|#협찬)/.test(p.caption.trim())) out.push({level: 'error', msg: '광고·협찬 콘텐츠는 캡션 첫 줄 맨 앞에 "광고" 또는 "협찬" 표기가 필요합니다.'});
  if (p.caption.length > 2200) out.push({level: 'error', msg: `캡션 ${p.caption.length}자 — 2,200자 한도 초과.`});
  if (p.hashtags.length > 30) out.push({level: 'error', msg: '해시태그 30개 초과.'});
  if (p.kind === 'cardnews') {
    if (p.slides[0]?.role !== 'cover') out.push({level: 'warn', msg: '첫 장이 표지(cover)가 아닙니다.'});
    p.slides.forEach((s, i) => {
      if (!s.title.trim()) out.push({level: 'warn', msg: `${i + 1}장 제목이 비었습니다.`});
      if (s.body.split('\n').length > 4) out.push({level: 'warn', msg: `${i + 1}장 본문이 4줄을 넘습니다 — 한 장 한 메시지.`});
    });
    if (p.slides[0] && p.slides[0].title.length > 22) out.push({level: 'warn', msg: '표지 제목이 22자를 넘습니다 — 피드에서 한눈에 안 읽힘.'});
  } else {
    p.characters.forEach((c) => {
      if (!c.lock.trim()) out.push({level: 'warn', msg: `캐릭터 "${c.name}" 락 블록이 비었습니다 — 컷마다 외형이 흔들립니다.`});
      if (!c.sheet) out.push({level: 'warn', msg: `캐릭터 "${c.name}" 시트 이미지가 없습니다.`});
    });
    p.slides.forEach((s, i) => {
      if (s.panels.length < PANELS_PER_LAYOUT[s.layout]) out.push({level: 'warn', msg: `${i + 1}장 레이아웃에 비해 패널이 모자랍니다.`});
    });
  }
  return out;
}
