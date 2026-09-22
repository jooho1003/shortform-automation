import {generateEpisodePlan} from '@/lib/episodePlanning';
import {InvalidEpisodeDir, episodePaths} from '@/lib/episodeFiles';
import {LlmError, type LlmProvider} from '@/lib/llm';
import {PathDenied} from '@/lib/safePath';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: Request) {
  let body: {dir?: unknown; track?: unknown; provider?: unknown};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({error: 'JSON 본문이 필요합니다.'}, {status: 400});
  }

  const dir = body.dir;
  const track = body.track;
  if (typeof dir !== 'string' || typeof track !== 'string' || (track !== 'A' && track !== 'B')) {
    return Response.json({error: 'dir과 track(A/B)이 필요합니다.'}, {status: 400});
  }
  const provider: LlmProvider = body.provider === 'codex' ? 'codex' : 'claude';
  try {
    // 경로 검증을 먼저 수행해 LLM 호출 전에 잘못된 회차를 거부한다.
    episodePaths(dir);
    const result = await generateEpisodePlan(dir, track, provider);
    return Response.json({ok: true, jobId: result.jobId});
  } catch (err) {
    if (err instanceof InvalidEpisodeDir || err instanceof PathDenied) return Response.json({error: err.message}, {status: 400});
    if (err instanceof LlmError) return Response.json({error: err.message, jobId: err.jobId}, {status: 502});
    return Response.json({error: (err as Error).message}, {status: 500});
  }
}
