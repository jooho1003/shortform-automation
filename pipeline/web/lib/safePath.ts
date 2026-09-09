/**
 * 파일 접근 경계.
 *
 * 웹 서버는 로컬에서만 돌지만, /api/media 같은 "경로를 받아 파일을 여는" 엔드포인트는
 * 그 자체로 임의 파일 읽기 통로가 된다. 모든 경로는 반드시 여기를 통과시킨다.
 *
 * 규칙
 *  1. ROOT 밖으로 나가는 경로(../, 절대 경로, 드라이브 문자)는 거부한다.
 *  2. 비밀 파일(pipeline/secrets, .env*, .git)은 ROOT 안이어도 거부한다.
 *  3. Windows는 대소문자를 구분하지 않으므로 비교는 소문자로 한다.
 */
import path from 'node:path';

import {ROOT} from './paths';

export class PathDenied extends Error {}

const DENY_PREFIXES = ['pipeline/secrets', '.git'];
const DENY_BASENAMES = /^\.env(\..*)?$/i;

function norm(p: string): string {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** ROOT 기준 상대 경로를 절대 경로로. 경계를 벗어나면 PathDenied. */
export function resolveInRoot(rel: string): string {
  if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\0')) {
    throw new PathDenied('경로가 비어 있거나 잘못됐습니다.');
  }
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    throw new PathDenied('절대 경로는 받지 않습니다.');
  }
  const abs = path.resolve(ROOT, rel);
  const root = norm(ROOT);
  const target = norm(abs);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new PathDenied('저장소 밖 경로입니다.');
  }
  const relPosix = path.relative(ROOT, abs).split(path.sep).join('/');
  const lower = relPosix.toLowerCase();
  for (const deny of DENY_PREFIXES) {
    if (lower === deny || lower.startsWith(deny + '/')) {
      throw new PathDenied('접근이 금지된 경로입니다.');
    }
  }
  if (DENY_BASENAMES.test(path.basename(abs))) {
    throw new PathDenied('접근이 금지된 파일입니다.');
  }
  return abs;
}
