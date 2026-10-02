import {actHansul, getHansul} from '@/lib/hansul';
import {HansulError} from '@/lib/hansulCore';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;
export const runtime = 'nodejs';

export async function GET() {
  try {return Response.json({studio: await getHansul()});}
  catch (e) {return Response.json({error: (e as Error).message}, {status: 500});}
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HansulError('JSON 입력이 필요합니다.');
    return Response.json(await actHansul(body));
  } catch (e) {
    const status = e instanceof HansulError ? e.status : 500;
    return Response.json({error: (e as Error).message, ...(status === 502 ? {studio: await getHansul().catch(() => null)} : {})}, {status});
  }
}
