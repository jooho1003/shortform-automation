import {readJson, writeJsonLikePython} from '@/lib/jsonio';
import {episodePaths, InvalidEpisodeDir} from '@/lib/episodeFiles';
import {PathDenied} from '@/lib/safePath';
import type {ClipEntry} from '@/lib/types';

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
  const list = await readJson<ClipEntry[]>(paths.clip_list);
  if (list === null) {
    return Response.json({error: '클립목록이 없습니다.'}, {status: 404});
  }
  return Response.json(list);
}

export async function PUT(req: Request) {
  let body: {dir?: unknown; n?: unknown; chosen?: unknown; media_layout?: unknown};
  try {
    body = await req.json();
  } catch {
    return Response.json({error: '요청 본문이 JSON이 아닙니다.'}, {status: 400});
  }
  const {dir, n, chosen, media_layout} = body;

  if (typeof n !== 'number' || !Number.isInteger(n)) {
    return Response.json({error: 'n이 필요합니다.'}, {status: 400});
  }
  if (chosen !== null && (typeof chosen !== 'number' || !Number.isInteger(chosen))) {
    return Response.json({error: 'chosen은 null 또는 정수여야 합니다.'}, {status: 400});
  }
  if (
    media_layout !== undefined &&
    media_layout !== 'landscape' &&
    media_layout !== 'portrait'
  ) {
    return Response.json({error: 'media_layout은 landscape|portrait여야 합니다.'}, {status: 400});
  }

  let paths;
  try {
    paths = resolveDir(dir);
  } catch (err) {
    const e = err as {error: string; status: number};
    return Response.json({error: e.error}, {status: e.status});
  }

  const list = await readJson<ClipEntry[]>(paths.clip_list);
  if (list === null) {
    return Response.json({error: '클립목록이 없습니다.'}, {status: 404});
  }

  const entry = list.find((e) => e.n === n);
  if (!entry) {
    return Response.json({error: '해당 번호의 클립을 찾을 수 없습니다.'}, {status: 404});
  }

  if (chosen !== null && (chosen < 0 || chosen >= entry.candidates.length)) {
    return Response.json({error: 'chosen이 candidates 범위를 벗어났습니다.'}, {status: 400});
  }

  entry.chosen = chosen;
  if (media_layout !== undefined) {
    entry.media_layout = media_layout;
  }

  await writeJsonLikePython(paths.clip_list, list);
  return Response.json(entry);
}
