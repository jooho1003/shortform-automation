import {ClientError, getMonth, slugOk, upsertMonth} from '@/lib/clients';

const MONTH_RE = /^\d{4}-\d{2}$/;

export async function GET(_req: Request, {params}: {params: Promise<{slug: string; month: string}>}) {
  const {slug, month} = await params;
  if (!slugOk(slug) || !MONTH_RE.test(month)) {
    return Response.json({error: '경로 파라미터가 올바르지 않습니다.'}, {status: 400});
  }
  try {
    const data = await getMonth(slug, month);
    return Response.json(data);
  } catch (err) {
    if (err instanceof ClientError) {
      return Response.json({error: err.message}, {status: err.status});
    }
    return Response.json({error: '알 수 없는 오류입니다.'}, {status: 500});
  }
}

export async function PUT(req: Request, {params}: {params: Promise<{slug: string; month: string}>}) {
  const {slug, month} = await params;
  if (!slugOk(slug) || !MONTH_RE.test(month)) {
    return Response.json({error: '경로 파라미터가 올바르지 않습니다.'}, {status: 400});
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
    const data = await upsertMonth(slug, month, body as Parameters<typeof upsertMonth>[2]);
    return Response.json(data);
  } catch (err) {
    if (err instanceof ClientError) {
      return Response.json({error: err.message}, {status: err.status});
    }
    return Response.json({error: '알 수 없는 오류입니다.'}, {status: 500});
  }
}
