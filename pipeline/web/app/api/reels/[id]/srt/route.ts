import path from 'node:path';

import {buildSrt} from '@/lib/reelsFrames';
import {readJson, readText} from '@/lib/jsonio';
import {REELS} from '@/lib/paths';
import type {ReelAnalysis} from '@/lib/reelsTypes';

export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;

export async function GET(_req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!ID_RE.test(id)) {
    return Response.json({error: '잘못된 프로젝트 id입니다.'}, {status: 400});
  }
  const projectDir = path.join(REELS, id);

  const existing = await readText(path.join(projectDir, '분석.srt'));
  let srt = existing;
  if (srt === null) {
    const analysis = await readJson<ReelAnalysis>(path.join(projectDir, '분석.json'));
    if (!analysis || !analysis.transcript || analysis.transcript.length === 0) {
      return Response.json({error: '자막을 찾을 수 없습니다.'}, {status: 404});
    }
    srt = buildSrt(analysis.transcript);
  }

  return new Response(srt, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${id}.srt"`,
    },
  });
}
