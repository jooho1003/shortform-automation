import {readText, writeText} from '@/lib/jsonio';
import {episodePaths, InvalidEpisodeDir} from '@/lib/episodeFiles';
import {PathDenied} from '@/lib/safePath';

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
  const markdown = await readText(paths.plan_md);
  if (markdown === null) {
    return Response.json({error: '기획안이 없습니다.'}, {status: 404});
  }
  return Response.json({markdown});
}

export async function PUT(req: Request) {
  let body: {dir?: unknown; markdown?: unknown};
  try {
    body = await req.json();
  } catch {
    return Response.json({error: '요청 본문이 JSON이 아닙니다.'}, {status: 400});
  }
  const {dir, markdown} = body;
  if (typeof markdown !== 'string') {
    return Response.json({error: 'markdown이 필요합니다.'}, {status: 400});
  }
  let paths;
  try {
    paths = resolveDir(dir);
  } catch (err) {
    const e = err as {error: string; status: number};
    return Response.json({error: e.error}, {status: e.status});
  }
  await writeText(paths.plan_md, markdown);
  return Response.json({ok: true});
}
