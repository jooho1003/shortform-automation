import fs from 'node:fs/promises';

import {readText} from '@/lib/jsonio';
import {resolveInRoot, PathDenied} from '@/lib/safePath';

const ALLOWED_EXT = new Set(['md', 'txt', 'json', 'vtt', 'srt']);
const MAX_SIZE = 2 * 1024 * 1024;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rel = url.searchParams.get('path');
  if (!rel) {
    return Response.json({error: 'path가 필요합니다.'}, {status: 400});
  }

  const ext = rel.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXT.has(ext)) {
    return Response.json({error: '지원하지 않는 파일 형식입니다.'}, {status: 415});
  }

  let abs: string;
  try {
    abs = resolveInRoot(rel);
  } catch (err) {
    if (err instanceof PathDenied) {
      return Response.json({error: err.message}, {status: 403});
    }
    throw err;
  }

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return Response.json({error: '파일을 찾을 수 없습니다.'}, {status: 404});
  }
  if (!stat.isFile()) {
    return Response.json({error: '파일을 찾을 수 없습니다.'}, {status: 404});
  }
  if (stat.size > MAX_SIZE) {
    return Response.json({error: '파일이 너무 큽니다.'}, {status: 415});
  }

  const text = await readText(abs);
  if (text === null) {
    return Response.json({error: '파일을 찾을 수 없습니다.'}, {status: 404});
  }
  return Response.json({text});
}
