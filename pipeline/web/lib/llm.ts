/**
 * 로컬 LLM 어댑터 — claude CLI와 codex CLI를 서버가 spawn한다(사용자 결정: API 키 대신 구독 CLI).
 *
 * 역할 분담(사용자 결정)
 *   기획·대본·분석 → claude(주) / codex(대안 초안·교차검토)
 *   이미지 생성   → codex
 *   PDF·업로드    → claude(문서·스크립트) — 실제 PDF는 결정적 렌더(print 페이지)로 만든다
 *
 * 둘 다 잡 러너로 돌려 로그가 남게 하고, 결과는 마지막 메시지 텍스트로 받는다.
 * 구조화 출력이 필요하면 JSON 스키마를 넘긴다(claude --json-schema / codex --output-schema).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {DATA} from './paths';
import {getBacklog, startJob, waitJob} from './runner';

export type LlmProvider = 'claude' | 'codex';

export interface LlmRequest {
  provider: LlmProvider;
  prompt: string;
  system?: string;
  /** JSON 스키마(객체). 넘기면 결과를 JSON.parse해서 돌려준다. */
  schema?: Record<string, unknown>;
  /** claude: 'opus'|'sonnet'|'haiku' 별칭 또는 모델 ID. codex: gpt-5.6-sol 등. */
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
  /** 이미지 첨부(절대 경로). codex -i / claude는 프롬프트에 경로를 적어 Read하게 한다. */
  images?: string[];
  cwd?: string;
  logDir?: string;
  title?: string;
  /** claude CLI에서만 허용할 도구. 기본은 도구 없음(이미지 첨부 시 Read). */
  allowedTools?: string[];
  /** claude CLI 최대 에이전트 턴. 도구가 없으면 기본 1. */
  maxTurns?: number;
}

export interface LlmResult<T = unknown> {
  text: string;
  json: T | null;
  jobId: string;
  provider: LlmProvider;
}

export class LlmError extends Error {
  constructor(message: string, public readonly jobId?: string) {
    super(message);
  }
}

const DEFAULT_MODEL: Record<LlmProvider, string> = {claude: 'opus', codex: 'gpt-5.6-terra'};

function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function tmpFile(prefix: string, ext: string): string {
  const dir = path.join(DATA, 'tmp');
  fs.mkdirSync(dir, {recursive: true});
  return path.join(dir, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`);
}

export async function runLlm<T = unknown>(req: LlmRequest): Promise<LlmResult<T>> {
  const model = req.model ?? DEFAULT_MODEL[req.provider];
  const title = req.title ?? `${req.provider} 호출`;
  let prompt = req.prompt;
  if (req.images?.length && req.provider === 'claude') {
    prompt = `다음 이미지 파일들을 먼저 Read 도구로 확인한 뒤 답하세요:\n${req.images.map((p) => `- ${p}`).join('\n')}\n\n${prompt}`;
  }

  if (req.provider === 'claude') {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--model', model];
    const tools = [...new Set([...(req.allowedTools ?? []), ...(req.images?.length ? ['Read'] : [])])];
    args.push('--max-turns', String(Math.max(1, Math.min(30, req.maxTurns ?? (tools.length ? 6 : 1)))));
    if (tools.length) args.push('--allowedTools', tools.join(','));
    if (req.system) args.push('--system-prompt', req.system);
    if (req.schema) args.push('--json-schema', JSON.stringify(req.schema));
    const job = startJob({kind: 'claude', title, args, stdin: prompt, cwd: req.cwd, logDir: req.logDir});
    const done = await waitJob(job.id);
    const out = getBacklog(job.id).filter((l) => !l.startsWith('[stderr]')).join('\n');
    if (done.status !== 'done') throw new LlmError(`claude 실패 (${done.status})\n${out.slice(-600)}`, job.id);
    const parsed = extractJson(out) as {result?: unknown; structured_output?: unknown; is_error?: boolean} | null;
    if (!parsed) throw new LlmError('claude 출력을 JSON으로 읽지 못했습니다.', job.id);
    if (parsed.is_error) throw new LlmError(`claude 오류: ${String(parsed.result).slice(0, 400)}`, job.id);
    const structured = parsed.structured_output ?? null;
    const text = typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result ?? structured);
    const json = (req.schema ? structured ?? extractJson(text) : extractJson(text)) as T | null;
    return {text, json, jobId: job.id, provider: 'claude'};
  }

  // codex
  const outFile = tmpFile('codex-out', '.txt');
  const args = ['exec', '-m', model, '-c', `model_reasoning_effort=${req.effort ?? 'medium'}`, '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '-o', outFile];
  if (req.cwd) args.push('-C', req.cwd);
  let schemaFile: string | null = null;
  if (req.schema) {
    schemaFile = tmpFile('codex-schema', '.json');
    fs.writeFileSync(schemaFile, JSON.stringify(req.schema), 'utf8');
    args.push('--output-schema', schemaFile);
  }
  for (const img of req.images ?? []) args.push('-i', img);
  args.push('-'); // 프롬프트는 stdin
  const full = req.system ? `${req.system}\n\n---\n\n${prompt}` : prompt;
  const job = startJob({kind: 'codex', title, args, stdin: full, cwd: req.cwd, logDir: req.logDir});
  const done = await waitJob(job.id);
  let text = '';
  try {
    text = fs.readFileSync(outFile, 'utf8');
  } catch {
    text = getBacklog(job.id).filter((l) => !l.startsWith('[stderr]')).join('\n');
  } finally {
    try {
      fs.unlinkSync(outFile);
    } catch {}
    if (schemaFile) {
      try {
        fs.unlinkSync(schemaFile);
      } catch {}
    }
  }
  if (done.status !== 'done') throw new LlmError(`codex 실패 (${done.status})\n${text.slice(-600)}`, job.id);
  return {text, json: extractJson(text) as T | null, jobId: job.id, provider: 'codex'};
}

export const tmpdir = () => os.tmpdir();
