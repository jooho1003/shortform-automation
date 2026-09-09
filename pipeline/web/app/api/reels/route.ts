import {addToLibrary, listProjects, loadLibrary} from '@/lib/reels';
import {jsonBody, reelsErrorResponse} from '@/lib/reelsApi';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [library, projects] = await Promise.all([loadLibrary(), listProjects()]);
    return Response.json({library: library.items, projects});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}

/** POST {url, tags?} → 라이브러리에 추가(메타는 yt-dlp) */
export async function POST(req: Request) {
  try {
    const body = await jsonBody<{url?: string; tags?: string[]}>(req);
    const item = await addToLibrary(String(body.url ?? '').trim(), Array.isArray(body.tags) ? body.tags.map(String) : []);
    return Response.json({item}, {status: 201});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}
