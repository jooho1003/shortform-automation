import {revisePlan} from '@/lib/reels';
import {idParam, jsonBody, reelsErrorResponse} from '@/lib/reelsApi';
import type {ReviseRequest} from '@/lib/reelsTypes';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const id = await idParam(params);
    const body = await jsonBody<ReviseRequest>(req);
    const target = body.target_seconds && [15, 30, 50].includes(Number(body.target_seconds)) ? (Number(body.target_seconds) as 15 | 30 | 50) : undefined;
    const plan = await revisePlan(id, {...body, target_seconds: target, provider: body.provider === 'codex' ? 'codex' : 'claude'});
    return Response.json({plan});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}
