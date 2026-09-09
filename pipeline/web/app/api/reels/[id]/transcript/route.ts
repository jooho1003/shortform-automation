import {writeManualTranscript} from '@/lib/reels';
import {idParam, jsonBody, reelsErrorResponse} from '@/lib/reelsApi';
import type {TranscriptCue} from '@/lib/reelsTypes';

export const dynamic = 'force-dynamic';

/** PUT {text} — "m:ss 문장" 줄 또는 그냥 문장 줄을 큐로 저장(자막·whisper가 없을 때 손으로). */
export async function PUT(req: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const id = await idParam(params);
    const {text} = await jsonBody<{text: string}>(req);
    const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const cues: TranscriptCue[] = [];
    lines.forEach((l, i) => {
      const m = l.match(/^\[?(\d{1,2}):(\d{2})(?:\.(\d+))?\]?\s*(.+)$/);
      const start = m ? Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0) : i * 3;
      cues.push({start, end: start + 3, text: m ? m[4] : l});
    });
    for (let i = 0; i < cues.length - 1; i++) cues[i].end = Math.max(cues[i].start + 0.5, cues[i + 1].start);
    return Response.json({analysis: await writeManualTranscript(id, cues)});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}
