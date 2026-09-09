import {generatePlan} from '@/lib/reels';
import {idParam, jsonBody, reelsErrorResponse} from '@/lib/reelsApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const id = await idParam(params);
    const body = await jsonBody<{target_seconds?: number; thumbnail_style?: string; provider?: string; extra?: string}>(req).catch(() => ({}) as Record<string, never>);
    const target = [15, 30, 50].includes(Number(body.target_seconds)) ? (Number(body.target_seconds) as 15 | 30 | 50) : 30;
    const plan = await generatePlan(id, {target_seconds: target, thumbnail_style: body.thumbnail_style, provider: body.provider === 'codex' ? 'codex' : 'claude', extra: body.extra});
    return Response.json({plan});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}
