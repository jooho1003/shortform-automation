/**
 * 저장소 루트와 파이썬 실행 파일을 찾는다.
 *
 * ROOT = shortform-automation/ (날짜 폴더·pipeline/·docs/가 있는 곳). Python 쪽 paths.ROOT와 같은 위치다.
 * SHORTFORM_ROOT 환경변수로 덮어쓸 수 있다.
 */
import fs from 'node:fs';
import path from 'node:path';

const marker = path.join('pipeline', 'shortform', 'cli.py');

function findRoot(): string {
  if (process.env.SHORTFORM_ROOT) {
    return path.resolve(process.env.SHORTFORM_ROOT);
  }
  let cur = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(cur, marker))) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(`저장소 루트를 찾지 못했습니다 (cwd=${process.cwd()}). SHORTFORM_ROOT를 지정하세요.`);
}

export const ROOT = findRoot();
export const PIPELINE = path.join(ROOT, 'pipeline');
export const REMOTION = path.join(PIPELINE, 'remotion');
export const CONFIG = path.join(PIPELINE, 'config');
export const DATA = path.join(PIPELINE, 'data');
export const OUTSOURCING = path.join(ROOT, '외주');
export const REELS = path.join(ROOT, '릴스기획');
export const BGM = path.join(PIPELINE, 'assets', 'bgm');

/** 파이썬 실행 파일. venv가 있으면 그것, 없으면 py -3 런처. */
export function pythonCommand(): {cmd: string; prefix: string[]} {
  const venv = path.join(PIPELINE, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venv)) return {cmd: venv, prefix: []};
  const venvPosix = path.join(PIPELINE, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPosix)) return {cmd: venvPosix, prefix: []};
  return process.platform === 'win32' ? {cmd: 'py', prefix: ['-3']} : {cmd: 'python3', prefix: []};
}

/** pipeline/.env 를 읽는다(KEY=value, # 주석). 값은 셸 환경변수가 우선. git에는 올라가지 않는 파일. */
export function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(path.join(PIPELINE, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v && !v.startsWith('#')) out[m[1]] = v;
    }
  } catch {
    // .env 없음
  }
  return out;
}

/** 자식 프로세스 공통 환경. 한글 Windows 콘솔(cp949)에서 로그가 깨지지 않게 UTF-8을 강제하고 .env 키를 넣는다. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...loadDotEnv(),
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    ...extra,
  };
}

/** ROOT 기준 상대 경로(POSIX 슬래시). inspect JSON과 같은 표기. */
export function relFromRoot(abs: string): string {
  return path.relative(ROOT, abs).split(path.sep).join('/');
}
