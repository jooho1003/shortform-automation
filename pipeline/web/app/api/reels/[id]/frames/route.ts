import path from 'node:path';

import {extractFrames} from '@/lib/reelsFrames';
import {readJson, writeJsonLikePython} from '@/lib/jsonio';
import {REELS} from '@/lib/paths';
import type {ReelPlan} from '@/lib/reelsTypes';

export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;

export async function POST(req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!ID_RE.test(id)) {
    return Response.json({error: '잘못된 프로젝트 id입니다.'}, {status: 400});
  }
  const projectDir = path.join(REELS, id);
  const planPath = path.join(projectDir, '기획안.json');

  let body: {times?: number[]} = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const plan = await readJson<ReelPlan>(planPath);

  let times = body.times;
  if (!times) {
    if (!plan) {
      return Response.json({error: 'times가 없고 기획안도 없습니다.'}, {status: 400});
    }
    times = plan.storyboard.map((f) => f.tc);
  }

  let frames: string[];
  try {
    frames = await extractFrames(id, times);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('원본 영상이 없습니다') ? 404 : 500;
    return Response.json({error: message}, {status});
  }

  if (plan) {
    for (let i = 0; i < frames.length && i < plan.storyboard.length; i++) {
      plan.storyboard[i].frame = frames[i];
    }
    await writeJsonLikePython(planPath, plan);
  }

  return Response.json({frames});
}
