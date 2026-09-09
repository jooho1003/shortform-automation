import {getBacklog, getJob} from '@/lib/runner';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^[\w-]+$/.test(id)) return Response.json({error: '잘못된 id'}, {status: 400});
  const job = getJob(id);
  if (!job) return Response.json({error: '잡이 없습니다.'}, {status: 404});
  return Response.json({job, log: getBacklog(id).join('\n')});
}
