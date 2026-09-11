/**
 * 회차의 렌더 경로. remotion(기본) 또는 capcut.
 *
 * 파일 하나가 진실이다 — `<회차>/렌더설정.json`. 파이썬 render 단계가 같은 파일을 읽는다.
 */
import fs from 'node:fs';

import {readJson, writeJsonLikePython} from '@/lib/jsonio';
import {episodePaths, InvalidEpisodeDir} from '@/lib/episodeFiles';
import {PathDenied, resolveInRoot} from '@/lib/safePath';
import {RENDER_ROUTES, type RenderRoute} from '@/lib/types';

const isRoute = (value: unknown): value is RenderRoute =>
  typeof value === 'string' && (RENDER_ROUTES as readonly string[]).includes(value);

function resolve(dir: unknown) {
  if (typeof dir !== 'string') {
    return {error: Response.json({error: 'dir이 필요합니다.'}, {status: 400})};
  }
  try {
    const paths = episodePaths(dir);
    // 없는 회차에 쓰면 폴더가 새로 생긴다. 셸에서 한글 경로가 깨진 채 들어오면
    // 쓰레기 폴더가 남으므로, 잡 API와 같이 존재부터 확인한다.
    if (!fs.existsSync(resolveInRoot(dir))) {
      return {error: Response.json({error: '회차 폴더가 없습니다.'}, {status: 404})};
    }
    return {paths};
  } catch (err) {
    if (err instanceof InvalidEpisodeDir) {
      return {error: Response.json({error: err.message}, {status: 400})};
    }
    if (err instanceof PathDenied) {
      return {error: Response.json({error: err.message}, {status: 403})};
    }
    throw err;
  }
}

export async function GET(req: Request) {
  const {paths, error} = resolve(new URL(req.url).searchParams.get('dir'));
  if (error) {
    return error;
  }
  const saved = await readJson<{route?: unknown}>(paths!.render_config);
  // 파일이 없거나 알 수 없는 값이면 기본값으로 본다. 화면이 빈 채로 뜨지 않게.
  return Response.json({route: isRoute(saved?.route) ? saved.route : 'remotion'});
}

export async function POST(req: Request) {
  let body: {dir?: unknown; route?: unknown};
  try {
    body = await req.json();
  } catch {
    return Response.json({error: '요청 본문이 JSON이 아닙니다.'}, {status: 400});
  }

  const {paths, error} = resolve(body.dir);
  if (error) {
    return error;
  }
  if (!isRoute(body.route)) {
    return Response.json({error: `route는 ${RENDER_ROUTES.join('|')} 중 하나여야 합니다.`}, {status: 400});
  }

  await writeJsonLikePython(paths!.render_config, {route: body.route});
  return Response.json({route: body.route});
}
