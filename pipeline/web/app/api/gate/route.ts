import {exists, removeIfExists, writeText} from '@/lib/jsonio';
import {episodePaths, InvalidEpisodeDir} from '@/lib/episodeFiles';
import {PathDenied} from '@/lib/safePath';
import type {Gates} from '@/lib/types';

type GateName = 'plan' | 'clips' | 'upload';
type Action = 'approve' | 'revoke' | 'fix';

interface Body {
  dir?: unknown;
  gate?: unknown;
  action?: unknown;
  note?: unknown;
  confirmed?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({error: '요청 본문이 JSON이 아닙니다.'}, {status: 400});
  }

  const {dir, gate, action, note, confirmed} = body;
  if (typeof dir !== 'string') {
    return Response.json({error: 'dir이 필요합니다.'}, {status: 400});
  }
  if (gate !== 'plan' && gate !== 'clips' && gate !== 'upload') {
    return Response.json({error: 'gate는 plan|clips|upload여야 합니다.'}, {status: 400});
  }
  if (action !== 'approve' && action !== 'revoke' && action !== 'fix') {
    return Response.json({error: 'action은 approve|revoke|fix여야 합니다.'}, {status: 400});
  }

  let paths;
  try {
    paths = episodePaths(dir);
  } catch (err) {
    if (err instanceof InvalidEpisodeDir) {
      return Response.json({error: err.message}, {status: 400});
    }
    if (err instanceof PathDenied) {
      return Response.json({error: err.message}, {status: 403});
    }
    throw err;
  }

  const gateName = gate as GateName;
  const actionName = action as Action;

  if (gateName === 'upload' && actionName === 'fix') {
    return Response.json({error: 'upload 게이트에는 fix가 없습니다.'}, {status: 400});
  }

  if (gateName === 'upload' && actionName === 'approve' && confirmed !== true) {
    return Response.json({error: '업로드 승인은 확인이 필요합니다.'}, {status: 400});
  }

  const okPath = gateName === 'plan' ? paths.plan_ok : gateName === 'clips' ? paths.clips_ok : paths.upload_ok;
  const fixPath = gateName === 'plan' ? paths.plan_fix : gateName === 'clips' ? paths.clips_fix : null;

  if (actionName === 'approve') {
    await writeText(okPath, '');
    if (fixPath) {
      await removeIfExists(fixPath);
    }
  } else if (actionName === 'revoke') {
    await removeIfExists(okPath);
  } else if (actionName === 'fix') {
    if (typeof note !== 'string' || note.trim().length === 0) {
      return Response.json({error: 'note가 필요합니다.'}, {status: 400});
    }
    if (!fixPath) {
      return Response.json({error: '이 게이트에는 fix가 없습니다.'}, {status: 400});
    }
    await writeText(fixPath, note);
    await removeIfExists(okPath);
  }

  const gates: Gates = {
    plan_ok: await exists(paths.plan_ok),
    plan_fix: await exists(paths.plan_fix),
    clips_ok: await exists(paths.clips_ok),
    clips_fix: await exists(paths.clips_fix),
    upload_ok: await exists(paths.upload_ok),
  };

  return Response.json({gates});
}
