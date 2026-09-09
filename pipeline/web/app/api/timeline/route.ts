import {readJson, writeJsonLikePython} from '@/lib/jsonio';
import {episodePaths, InvalidEpisodeDir} from '@/lib/episodeFiles';
import {PathDenied} from '@/lib/safePath';
import type {Timeline} from '@/lib/types';

function resolveDir(dir: unknown) {
  if (typeof dir !== 'string') {
    throw {error: 'dir이 필요합니다.', status: 400};
  }
  try {
    return episodePaths(dir);
  } catch (err) {
    if (err instanceof InvalidEpisodeDir) {
      throw {error: err.message, status: 400};
    }
    if (err instanceof PathDenied) {
      throw {error: err.message, status: 403};
    }
    throw err;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dir = url.searchParams.get('dir');
  let paths;
  try {
    paths = resolveDir(dir);
  } catch (err) {
    const e = err as {error: string; status: number};
    return Response.json({error: e.error}, {status: e.status});
  }
  const timeline = await readJson<Timeline>(paths.timeline);
  if (timeline === null) {
    return Response.json({error: '타임라인이 없습니다.'}, {status: 404});
  }
  return Response.json(timeline);
}

export async function PUT(req: Request) {
  let body: {dir?: unknown; timeline?: unknown};
  try {
    body = await req.json();
  } catch {
    return Response.json({error: '요청 본문이 JSON이 아닙니다.'}, {status: 400});
  }
  const {dir, timeline} = body;

  if (typeof timeline !== 'object' || timeline === null) {
    return Response.json({error: 'timeline이 필요합니다.'}, {status: 400});
  }
  const tl = timeline as Record<string, unknown>;
  if (typeof tl.fps !== 'number') {
    return Response.json({error: 'timeline.fps는 숫자여야 합니다.'}, {status: 400});
  }
  if (!Array.isArray(tl.lines)) {
    return Response.json({error: 'timeline.lines는 배열이어야 합니다.'}, {status: 400});
  }
  for (const line of tl.lines) {
    if (
      typeof line !== 'object' ||
      line === null ||
      typeof (line as Record<string, unknown>).start !== 'number' ||
      typeof (line as Record<string, unknown>).end !== 'number' ||
      typeof (line as Record<string, unknown>).clip !== 'string'
    ) {
      return Response.json({error: 'line은 start·end(숫자)·clip(문자열)이 필요합니다.'}, {status: 400});
    }
    const start = (line as Record<string, unknown>).start as number;
    const end = (line as Record<string, unknown>).end as number;
    if (!(end > start)) {
      return Response.json({error: 'line.end는 line.start보다 커야 합니다.'}, {status: 400});
    }
  }

  let paths;
  try {
    paths = resolveDir(dir);
  } catch (err) {
    const e = err as {error: string; status: number};
    return Response.json({error: e.error}, {status: e.status});
  }

  const lines = tl.lines as Array<{end: number}>;
  if (lines.length > 0) {
    tl.durationSec = Math.max(...lines.map((l) => l.end));
  }
  const durationSec = typeof tl.durationSec === 'number' ? tl.durationSec : 0;

  await writeJsonLikePython(paths.timeline, tl);
  return Response.json({ok: true, durationSec});
}
