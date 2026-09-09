import {ClientError, getClient, listMonths, slugOk, updateClient} from '@/lib/clients';

export async function GET(_req: Request, {params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params;
  if (!slugOk(slug)) {
    return Response.json({error: 'slug 형식이 올바르지 않습니다.'}, {status: 400});
  }
  try {
    const client = await getClient(slug);
    const months = await listMonths(slug);
    return Response.json({...client, months});
  } catch (err) {
    if (err instanceof ClientError) {
      return Response.json({error: err.message}, {status: err.status});
    }
    return Response.json({error: '알 수 없는 오류입니다.'}, {status: 500});
  }
}

export async function PUT(req: Request, {params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params;
  if (!slugOk(slug)) {
    return Response.json({error: 'slug 형식이 올바르지 않습니다.'}, {status: 400});
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({error: '요청 본문이 JSON이 아닙니다.'}, {status: 400});
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({error: '요청 본문이 올바르지 않습니다.'}, {status: 400});
  }

  try {
    const client = await updateClient(slug, body as Parameters<typeof updateClient>[1]);
    return Response.json(client);
  } catch (err) {
    if (err instanceof ClientError) {
      return Response.json({error: err.message}, {status: err.status});
    }
    return Response.json({error: '알 수 없는 오류입니다.'}, {status: 500});
  }
}
