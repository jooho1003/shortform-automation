import {analyzeStructure} from '@/lib/reels';
import {idParam, jsonBody, reelsErrorResponse} from '@/lib/reelsApi';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const id = await idParam(params);
    const body = await jsonBody<{provider?: 'claude' | 'codex'}>(req).catch(() => ({} as {provider?: 'claude' | 'codex'}));
    return Response.json({analysis: await analyzeStructure(id, body.provider === 'codex' ? 'codex' : 'claude')});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}
