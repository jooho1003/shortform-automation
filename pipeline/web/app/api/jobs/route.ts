import fs from 'node:fs';

import {discoverJob, researchJob, segmentsJob, statusJob, stepJob, type EpisodeKey} from '@/lib/presets';
import {JobError, listJobs, startJob} from '@/lib/runner';
import {PathDenied, resolveInRoot} from '@/lib/safePath';
import type {JobSpec, StepName} from '@/lib/types';
import {ALL_STEPS} from '@/lib/types';

export const dynamic = 'force-dynamic';

const EP_DIR = /^\d{4}-\d{2}-\d{2}\/[AB]-\d{1,3}-[^/\\]+$/;

function episodeKey(body: Record<string, unknown>): EpisodeKey {
  const {track, date, num, dir} = body as Partial<EpisodeKey>;
  if (track !== 'A' && track !== 'B') throw new JobError('track은 A 또는 B');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new JobError('date 형식 오류');
  if (!num || !/^\d{1,3}$/.test(num)) throw new JobError('num 형식 오류');
  if (!dir || !EP_DIR.test(dir)) throw new JobError('dir 형식 오류');
  if (!dir.startsWith(`${date}/${track}-`)) throw new JobError('dir이 track/date와 맞지 않습니다');
  if (!fs.existsSync(resolveInRoot(dir))) throw new JobError('회차 폴더가 없습니다', 404);
  return {track, date, num, dir};
}

export async function GET() {
  return Response.json({jobs: listJobs()});
}

/**
 * POST {preset: 'step', track, date, num, dir, step, force?, confirmed?}
 * POST {preset: 'research' | 'discover'}
 * POST {preset: 'segments', source, date}
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({error: 'JSON 본문이 필요합니다.'}, {status: 400});
  }
  try {
    let spec: JobSpec;
    switch (body.preset) {
      case 'step': {
        const step = body.step as StepName;
        if (!ALL_STEPS.includes(step)) throw new JobError('알 수 없는 단계');
        spec = stepJob(episodeKey(body), step, body.force === true, body.confirmed === true);
        break;
      }
      case 'status':
        spec = statusJob(episodeKey(body));
        break;
      case 'research':
        spec = researchJob();
        break;
      case 'discover':
        spec = discoverJob();
        break;
      case 'segments': {
        const source = String(body.source ?? '').trim();
        const date = String(body.date ?? '');
        if (!source || source.length > 200 || /[\s"'&|;<>]/.test(source)) throw new JobError('source는 유튜브 URL 또는 영상 ID');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new JobError('date 형식 오류');
        spec = segmentsJob(source, date);
        break;
      }
      default:
        throw new JobError('알 수 없는 preset');
    }
    const info = startJob(spec);
    return Response.json({job: info}, {status: 201});
  } catch (err) {
    if (err instanceof JobError) return Response.json({error: err.message}, {status: err.status});
    if (err instanceof PathDenied) return Response.json({error: err.message}, {status: 403});
    return Response.json({error: (err as Error).message}, {status: 500});
  }
}
