import {ClientError, createClient, listClients} from '@/lib/clients';

export async function GET() {
  try {
    const clients = await listClients();
    return Response.json({clients});
  } catch (err) {
    if (err instanceof ClientError) {
      return Response.json({error: err.message}, {status: err.status});
    }
    return Response.json({error: '알 수 없는 오류입니다.'}, {status: 500});
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({error: '요청 본문이 JSON이 아닙니다.'}, {status: 400});
  }

  if (typeof body !== 'object' || body === null) {
    return Response.json({error: '요청 본문이 올바르지 않습니다.'}, {status: 400});
  }

  const input = body as {slug?: unknown; name?: unknown};
  if (typeof input.slug !== 'string' || typeof input.name !== 'string') {
    return Response.json({error: 'slug와 name이 필요합니다.'}, {status: 400});
  }

  try {
    const client = await createClient(body as Parameters<typeof createClient>[0]);
    return Response.json(client, {status: 201});
  } catch (err) {
    if (err instanceof ClientError) {
      return Response.json({error: err.message}, {status: err.status});
    }
    return Response.json({error: '알 수 없는 오류입니다.'}, {status: 500});
  }
}
