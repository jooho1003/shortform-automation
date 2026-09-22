import fs from 'node:fs/promises';
import path from 'node:path';

import yaml from 'yaml';

import {episodePaths} from './episodeFiles';
import {LlmError, runLlm, type LlmProvider} from './llm';
import {CONFIG, DATA} from './paths';
import {resolveInRoot} from './safePath';

export type EpisodeTrack = 'A' | 'B';

type CharacterDraft = {
  name: string;
  role: string;
  appearance: string;
  personality: string;
  voice: string;
  props: string;
};

type DialogueDraft = {at: number; character: string; text: string; direction: string};
type CutDraft = {n: number; start: number; end: number; lens: string; action: string; camera: string; required: boolean};
type APlanDraft = {
  title: string;
  synopsis: string;
  characters: CharacterDraft[];
  locks: Record<string, string>;
  dialogues: DialogueDraft[];
  cuts: CutDraft[];
  sound: Record<string, string>;
  meta: Record<string, string>;
  research_notes: string[];
};
type BPlanDraft = {
  title: string;
  hook: string;
  lines: {n: number; text: string; source: string; queries: string[]}[];
  comments: {at: number; nick: string; text: string}[];
  meta: Record<string, string>;
};

const A_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'synopsis', 'characters', 'locks', 'dialogues', 'cuts', 'sound', 'meta', 'research_notes'],
  properties: {
    title: {type: 'string'},
    synopsis: {type: 'string'},
    characters: {
      type: 'array', minItems: 1,
      items: {type: 'object', additionalProperties: false, required: ['name', 'role', 'appearance', 'personality', 'voice', 'props'], properties: {
        name: {type: 'string'}, role: {type: 'string'}, appearance: {type: 'string'}, personality: {type: 'string'}, voice: {type: 'string'}, props: {type: 'string'},
      }},
    },
    locks: {type: 'object', additionalProperties: false, required: ['CHARACTER', 'COSTUME', 'GLOBAL STYLE', 'NEGATIVE'], properties: {
      CHARACTER: {type: 'string'}, COSTUME: {type: 'string'}, 'GLOBAL STYLE': {type: 'string'}, NEGATIVE: {type: 'string'},
    }},
    dialogues: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['at', 'character', 'text', 'direction'], properties: {
      at: {type: 'number', minimum: 0}, character: {type: 'string'}, text: {type: 'string'}, direction: {type: 'string'},
    }}},
    cuts: {type: 'array', minItems: 1, items: {type: 'object', additionalProperties: false, required: ['n', 'start', 'end', 'lens', 'action', 'camera', 'required'], properties: {
      n: {type: 'integer', minimum: 1}, start: {type: 'number', minimum: 0}, end: {type: 'number', exclusiveMinimum: 0}, lens: {type: 'string'}, action: {type: 'string'}, camera: {type: 'string'}, required: {type: 'boolean'},
    }}},
    sound: {type: 'object', additionalProperties: {type: 'string'}},
    meta: {type: 'object', additionalProperties: {type: 'string'}},
    research_notes: {type: 'array', items: {type: 'string'}},
  },
};

const B_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'hook', 'lines', 'comments', 'meta'],
  properties: {
    title: {type: 'string'}, hook: {type: 'string'},
    lines: {type: 'array', minItems: 1, items: {type: 'object', additionalProperties: false, required: ['n', 'text', 'source', 'queries'], properties: {
      n: {type: 'integer', minimum: 1}, text: {type: 'string'}, source: {type: 'string'}, queries: {type: 'array', items: {type: 'string'}},
    }}},
    comments: {type: 'array', items: {type: 'object', additionalProperties: false, required: ['at', 'nick', 'text'], properties: {
      at: {type: 'number', minimum: 0}, nick: {type: 'string'}, text: {type: 'string'},
    }}},
    meta: {type: 'object', additionalProperties: {type: 'string'}},
  },
};

function cell(value: unknown): string {
  return String(value ?? '').replace(/[|\r\n]/g, ' / ').trim();
}

function numberText(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(Number(n.toFixed(3))) : '0';
}

function bulletMap(values: Record<string, string>): string[] {
  return Object.entries(values).map(([key, value]) => `- ${key}: ${cell(value)}`);
}

async function researchContext(): Promise<{references: {name: string; url: string; note: string}[]; highlights: string[]}> {
  let references: {name: string; url: string; note: string}[] = [];
  try {
    const raw = await fs.readFile(path.join(CONFIG, 'research.yaml'), 'utf8');
    const cfg = yaml.parse(raw) as {ai_character_references?: unknown[]};
    references = (cfg.ai_character_references ?? []).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      return [{name: String(value.name ?? ''), url: String(value.url ?? ''), note: String(value.note ?? '')}].filter((v) => v.name);
    });
  } catch {
    // Config is optional; the user can still generate a plan without it.
  }

  const highlights: string[] = [];
  try {
    const files = (await fs.readdir(path.join(DATA, 'research'))).filter((name) => name.endsWith('.json')).sort();
    const latest = files.at(-1);
    if (latest) {
      const data = JSON.parse(await fs.readFile(path.join(DATA, 'research', latest), 'utf8')) as {benchmarks?: {name?: string; items?: {title?: string; views?: number}[]}[]};
      for (const benchmark of data.benchmarks ?? []) {
        for (const item of (benchmark.items ?? []).slice(0, 3)) {
          if (item.title) highlights.push(`${benchmark.name ?? '벤치마크'}: ${item.title} (${(item.views ?? 0).toLocaleString()} views)`);
        }
      }
    }
  } catch {
    // A fresh weekly report is helpful, not required for A안 generation.
  }
  return {references, highlights};
}

function contextText(context: Awaited<ReturnType<typeof researchContext>>): string {
  const refs = context.references.length
    ? context.references.map((ref) => `- ${ref.name}: ${ref.url || '(링크 없음)'} — ${ref.note}`).join('\n')
    : '- 등록된 AI 캐릭터 참고군이 없습니다. 이름·말투를 지어내지 말고 사용자 의도를 우선하세요.';
  const highlights = context.highlights.length ? context.highlights.join('\n') : '- 최신 주간 조사 결과 없음';
  return `AI 캐릭터 참고군(그대로 복제하지 말고 구조·말투·캐릭터 운용만 참고):\n${refs}\n\n최근 조사 하이라이트(사실처럼 단정하지 말고 기획 방향 참고):\n${highlights}`;
}

function aPrompt(brief: string, context: Awaited<ReturnType<typeof researchContext>>): string {
  return `당신은 숏폼 제작 PD다. 아래 제작 의도를 읽고 A안(캐릭터 기반 AI 생성 영상) 기획안을 JSON으로 작성한다.

제작 의도/유형:
${brief}

${contextText(context)}

반드시 지킬 것:
1. 캐릭터 시트와 대사를 완전히 분리한다. 캐릭터 시트는 이후 모든 이미지·영상 컷에서 고정할 외모·성격·말투·소품을 정의한다.
2. A안에는 AI 댓글을 만들지 않는다. 댓글 대신 실제 등장 캐릭터의 대사만 만든다.
3. 대사는 캐릭터 이름, 시작 시각(초), 말풍선에 표시할 문장, 표정·행동 연출을 갖는다. 대사 없는 컷도 허용한다.
4. CHARACTER 락에는 캐릭터의 해부학과 정체성을 명확히 쓰고, COSTUME/GLOBAL STYLE/NEGATIVE에도 생성 모델이 흔들리지 않을 제약을 쓴다.
5. 컷은 최소 4개, 총 20~60초 사이로 구성한다. 각 컷의 start/end는 겹치지 않는 오름차순 구간으로 쓴다.
6. 특정 AI 캐릭터를 복제하거나 이름·대사를 베끼지 않는다. 참고는 포맷과 연출 원리만 흡수한다.
7. JSON 외의 설명은 쓰지 않는다.

출력은 제공한 JSON 스키마를 정확히 따른다.`;
}

function bPrompt(brief: string, context: Awaited<ReturnType<typeof researchContext>>): string {
  return `당신은 숏폼 제작 PD다. 아래 제작 의도와 조사 맥락을 바탕으로 B안(원본 클립 재편집) 기획안을 JSON으로 작성한다.

제작 의도/유형:
${brief}

${contextText(context)}

대본 문장은 실제 편집에 쓸 수 있게 짧게 쓰고, 각 줄의 source와 검색어를 채운다. 댓글은 실제 신원을 지어내지 않는 가상 반응으로만 만들고, 필요 없으면 빈 배열로 둔다. JSON 외의 설명은 쓰지 않는다.`;
}

function renderA(plan: APlanDraft, brief: string): string {
  const locks = plan.locks ?? {};
  const characters = plan.characters ?? [];
  const dialogues = [...(plan.dialogues ?? [])].sort((a, b) => Number(a.at) - Number(b.at));
  const cuts = [...(plan.cuts ?? [])].sort((a, b) => Number(a.n) - Number(b.n));
  const meta = {...(plan.meta ?? {}), 제목: plan.title, 공개: plan.meta?.공개 || 'unlisted'};
  const lines = [
    `# ${cell(plan.title)}`,
    '',
    '## 제작 의도',
    '',
    brief.trim(),
    '',
    '## 시놉시스',
    '',
    plan.synopsis.trim(),
    '',
    '## 캐릭터 시트',
    '',
  ];
  for (const character of characters) {
    lines.push(`### ${cell(character.name)}`, ...bulletMap({역할: character.role, 외형: character.appearance, 성격: character.personality, 말투: character.voice, '고정 소품': character.props}), '');
  }
  lines.push(
    '## 락 블록', '',
    '### CHARACTER', '', locks.CHARACTER || characters.map((c) => `${c.name}: ${c.appearance}`).join('\n'), '',
    '### COSTUME', '', locks.COSTUME || characters.map((c) => `${c.name}: ${c.props}`).join('\n'), '',
    '### GLOBAL STYLE', '', locks['GLOBAL STYLE'] || '일관된 세로 9:16 AI 애니메이션 스타일', '',
    '### NEGATIVE', '', locks.NEGATIVE || 'no watermark, no text, no anatomy drift, no extra characters', '',
    '## 대사', '',
    '| 시각 | 캐릭터 | 대사 | 연출 |', '|---:|---|---|---|',
    ...dialogues.map((d) => `| ${Number(d.at).toFixed(1)} | ${cell(d.character)} | ${cell(d.text)} | ${cell(d.direction)} |`), '',
    '## 컷표', '',
    '| 컷 | TC | 렌즈 | 액션 | 카메라 | 필수 |', '|---|---|---|---|---|---|',
    ...cuts.map((cut) => `| ${cut.n} | ${numberText(cut.start)}-${numberText(cut.end)} | ${cell(cut.lens)} | ${cell(cut.action)} | ${cell(cut.camera)} | ${cut.required ? '필수' : ''} |`), '',
    '## 음향 설계', '',
    ...bulletMap(plan.sound ?? {}), '',
    '## 조사 참고', '',
    ...(plan.research_notes ?? []).map((note) => `- ${note}`), '',
    '## 메타데이터', '',
    ...bulletMap(meta), '',
  );
  return lines.join('\n');
}

function renderB(plan: BPlanDraft, brief: string): string {
  const lines = [
    '# 제목 후보', '', `1. ${cell(plan.title)}`, '',
    '## 제작 의도', '', brief.trim(), '',
    '## 템플릿', '', '브리핑 포커스', '',
    '## 훅', '', plan.hook.trim(), '',
    '## 대본', '', '| # | 문장 | 소재 | 검색어 |', '|---|---|---|---|',
    ...(plan.lines ?? []).map((line) => `| ${line.n} | ${cell(line.text)} | ${cell(line.source || 'clip')} | ${cell((line.queries ?? []).join(', '))} |`), '',
    '## AI 댓글', '', '| 시각 | 닉네임 | 내용 |', '|---:|---|---|',
    ...(plan.comments ?? []).map((comment) => `| ${comment.at} | ${cell(comment.nick)} | ${cell(comment.text)} |`), '',
    '## 메타데이터', '',
    ...bulletMap({...plan.meta, 설명: plan.meta?.설명 || brief.trim(), 공개: plan.meta?.공개 || 'unlisted'}), '',
  ];
  return lines.join('\n');
}

export async function generateEpisodePlan(dir: string, track: EpisodeTrack, provider: LlmProvider = 'claude') {
  const paths = episodePaths(dir);
  const brief = (await fs.readFile(paths.brief_md, 'utf8')).trim();
  if (!brief) throw new Error('제작 의도/유형을 먼저 입력해 주세요.');
  const context = await researchContext();
  const result = await runLlm<APlanDraft | BPlanDraft>({
    provider,
    prompt: track === 'A' ? aPrompt(brief, context) : bPrompt(brief, context),
    schema: track === 'A' ? A_SCHEMA : B_SCHEMA,
    title: `${track}안 AI 기획안 생성`,
    cwd: dir,
    logDir: `${dir}/로그`,
  });
  if (!result.json) throw new LlmError(`AI가 구조화된 기획안을 반환하지 않았습니다. (잡 ${result.jobId})`, result.jobId);
  const markdown = track === 'A' ? renderA(result.json as APlanDraft, brief) : renderB(result.json as BPlanDraft, brief);
  await fs.writeFile(paths.plan_md, markdown, 'utf8');
  await fs.rm(paths.plan_ok, {force: true});
  await fs.rm(paths.plan_fix, {force: true});
  return {jobId: result.jobId, markdown};
}

export function episodeDirFromPaths(dir: string): string {
  resolveInRoot(dir);
  return dir;
}
