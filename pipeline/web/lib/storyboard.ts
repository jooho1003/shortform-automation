/**
 * 스토리보드 순수 헬퍼. 파일 이름·체인 규칙은 pipeline/shortform/steps/check_frames.py 와 같아야 한다.
 * 화면은 회차 폴더의 파일 목록과 기획안 JSON만 보고 그린다.
 */
import type {PlanADialogue, PlanCut} from './types';

export type SpeechWindow = {index: number; character: string; text: string; start: number; end: number};
export type FrameRef = {cut: number; which: 'start' | 'end'};
type TimelineDialogue = {at: number; speechStart?: number; speechEnd?: number};

const pad = (n: number) => String(n).padStart(2, '0');

export const endFrameName = (cut: PlanCut) => `키프레임-${pad(cut.n)}-끝.png`;

/** '이어서' 컷은 자기 시작 파일이 없다. 앞 컷의 끝 프레임이 시작이다. */
export function startFrameName(cuts: PlanCut[], cut: PlanCut): string {
  if (cut.start_mode !== '이어서') return `키프레임-${pad(cut.n)}.png`;
  const prev = cuts.filter((c) => c.n < cut.n).sort((a, b) => b.n - a.n)[0];
  return prev ? endFrameName(prev) : `키프레임-${pad(cut.n)}.png`;
}

export function chainGroups(cuts: PlanCut[]): PlanCut[][] {
  const groups: PlanCut[][] = [];
  for (const cut of [...cuts].sort((a, b) => a.n - b.n)) {
    if (cut.start_mode === '이어서' && groups.length) groups[groups.length - 1].push(cut);
    else groups.push([cut]);
  }
  return groups;
}

const SYLLABLES_PER_SECOND = 5; // 설계 09 실측: 레퍼런스 3.5~5.2음절/초, 사구 TTS +8%
const EDGE_LEAD_SECONDS = 0.2;  // Edge mp3 앞 무음

export function speechWindows(dialogues: PlanADialogue[], timeline: TimelineDialogue[] | null | undefined): {windows: SpeechWindow[]; estimated: boolean} {
  const measured = timeline?.filter((d) => typeof d.speechStart === 'number' && typeof d.speechEnd === 'number') ?? [];
  const estimated = measured.length !== dialogues.length;
  const windows = dialogues.map((d, index) => {
    const hit = estimated ? undefined : measured.find((m) => Math.abs(m.at - d.at) < 0.001);
    if (hit) return {index, character: d.character, text: d.text, start: hit.speechStart as number, end: hit.speechEnd as number};
    const syllables = d.text.replace(/[\s…,.!?~'"“”‘’]/g, '').length;
    const start = Math.round((d.at + EDGE_LEAD_SECONDS) * 10) / 10;
    return {index, character: d.character, text: d.text, start, end: Math.round((start + syllables / SYLLABLES_PER_SECOND) * 10) / 10};
  });
  return {windows, estimated};
}

/** 대사 없는 구간. 설계 10 §1: 0.6초를 넘으면 안 된다. 앞·사이·뒤를 모두 본다. */
export function coverageGaps(windows: {start: number; end: number}[], total: number, maxGap = 0.6): {from: number; to: number}[] {
  const gaps: {from: number; to: number}[] = [];
  let prevEnd = 0;
  for (const w of [...windows].sort((a, b) => a.start - b.start)) {
    if (w.start - prevEnd > maxGap) gaps.push({from: prevEnd, to: w.start});
    prevEnd = Math.max(prevEnd, w.end);
  }
  if (total - prevEnd > maxGap) gaps.push({from: prevEnd, to: total});
  return gaps;
}

const frameOrder = (a: FrameRef, b: FrameRef) => a.cut - b.cut || (a.which === 'start' ? -1 : 1);

export function fixRequestNote(frames: FrameRef[], instruction: string): string {
  const unique = Array.from(new Map(frames.map((f) => [`${f.cut}-${f.which}`, f])).values()).sort(frameOrder);
  return JSON.stringify({version: 2, frames: unique, instruction: instruction.trim()});
}

export function formatFixRequest(note: string): string {
  try {
    const value = JSON.parse(note) as {cuts?: unknown; frames?: unknown; instruction?: unknown};
    if (Array.isArray(value.frames) && typeof value.instruction === 'string') {
      const parts = (value.frames as FrameRef[]).map((f) => `컷 ${f.cut} ${f.which === 'start' ? '시작' : '끝'}`);
      return `${parts.join(', ')}: ${value.instruction}`;
    }
    if (Array.isArray(value.cuts) && typeof value.instruction === 'string') return `컷 ${value.cuts.join(', ')}: ${value.instruction}`;
  } catch {
    // 기존 일반 텍스트 요청도 그대로 보여준다.
  }
  return note;
}

/**
 * 프레임을 다시 만들면 영상이 바뀌는 컷. 파이썬 expand_frames 와 같은 규칙:
 * 시작이 바뀌면 그 컷의 끝도 바뀌고, 끝은 다음 '이어서' 컷의 시작이므로 그 컷의 끝도 바뀐다.
 */
export function affectedCuts(cuts: PlanCut[], frames: FrameRef[]): number[] {
  const byN = new Map(cuts.map((c) => [c.n, c]));
  const changed = new Set<string>();
  const todo = [...frames];
  while (todo.length) {
    const f = todo.pop() as FrameRef;
    const cut = byN.get(f.cut);
    if (!cut) continue;
    if (f.which === 'start' && cut.start_mode === '이어서') { todo.push({cut: f.cut - 1, which: 'end'}); continue; }
    const key = `${f.cut}-${f.which}`;
    if (changed.has(key)) continue;
    changed.add(key);
    if (f.which === 'start') todo.push({cut: f.cut, which: 'end'});
    else if (byN.get(f.cut + 1)?.start_mode === '이어서') todo.push({cut: f.cut + 1, which: 'end'});
  }
  return Array.from(new Set(Array.from(changed).map((k) => Number(k.split('-')[0])))).sort((a, b) => a - b);
}
