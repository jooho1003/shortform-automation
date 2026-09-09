import {cancelJob} from '@/lib/runner';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^[\w-]+$/.test(id)) return Response.json({error: '잘못된 id'}, {status: 400});
  const job = cancelJob(id);
  if (!job) return Response.json({error: '실행 중인 잡이 아닙니다.'}, {status: 404});
  return Response.json({job});
}
