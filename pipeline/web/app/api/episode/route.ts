import fs from 'node:fs/promises';

import {InspectError, getEpisode} from '@/lib/inspect';
import {resolveInRoot, PathDenied} from '@/lib/safePath';
import {initializeEpisodeVoice} from '@/lib/tts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_RE = /^\d{1,3}$/;
const SLUG_RE = /^[^\/:*?"<>|]{1,60}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const track = url.searchParams.get('track');
  const date = url.searchParams.get('date');
  const num = url.searchParams.get('num');

  if (track !== 'A' && track !== 'B') {
    return Response.json({error: 'track은 A 또는 B여야 합니다.'}, {status: 400});
  }
  if (!date || !DATE_RE.test(date)) {
    return Response.json({error: 'date 형식이 올바르지 않습니다.'}, {status: 400});
  }
  if (!num || !NUM_RE.test(num)) {
    return Response.json({error: 'num 형식이 올바르지 않습니다.'}, {status: 400});
  }

  try {
    const data = await getEpisode(track, date, num);
    return Response.json(data);
  } catch (err) {
    if (err instanceof InspectError) {
      return Response.json({error: err.message}, {status: 404});
    }
    return Response.json({error: '알 수 없는 오류입니다.'}, {status: 500});
  }
}

export async function POST(req: Request) {
  let body: {track?: unknown; date?: unknown; num?: unknown; slug?: unknown};
  try {
    body = await req.json();
  } catch {
    return Response.json({error: '요청 본문이 JSON이 아닙니다.'}, {status: 400});
  }

  const {track, date, num, slug} = body;
  if (track !== 'A' && track !== 'B') {
    return Response.json({error: 'track은 A 또는 B여야 합니다.'}, {status: 400});
  }
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return Response.json({error: 'date 형식이 올바르지 않습니다.'}, {status: 400});
  }
  if (typeof num !== 'string' || !NUM_RE.test(num)) {
    return Response.json({error: 'num 형식이 올바르지 않습니다.'}, {status: 400});
  }
  if (typeof slug !== 'string' || !SLUG_RE.test(slug) || slug.includes('..')) {
    return Response.json({error: 'slug 형식이 올바르지 않습니다.'}, {status: 400});
  }

  const paddedNum = num.padStart(2, '0');
  const rel = `${date}/${track}-${paddedNum}-${slug}`;

  let abs: string;
  try {
    abs = resolveInRoot(rel);
  } catch (err) {
    if (err instanceof PathDenied) {
      return Response.json({error: err.message}, {status: 403});
    }
    throw err;
  }

  try {
    await fs.access(abs);
    return Response.json({error: '이미 존재하는 편 폴더입니다.'}, {status: 409});
  } catch {
    // 없으면 정상 경로
  }

  await fs.mkdir(abs, {recursive: true});
  await initializeEpisodeVoice(track, date, paddedNum, rel);
  return Response.json({dir: rel});
}
