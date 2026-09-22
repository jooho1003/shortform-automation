import {CarouselError, createCarousel, kindOk, listCarousels} from '@/lib/carousel';

export const dynamic = 'force-dynamic';

const errorResponse = (err: unknown) =>
  Response.json({error: (err as Error).message ?? '알 수 없는 오류'}, {status: err instanceof CarouselError ? err.status : 500});

async function kindParam(params: Promise<{kind: string}>) {
  const {kind} = await params;
  if (!kindOk(kind)) throw new CarouselError('알 수 없는 종류', 404);
  return kind;
}

export async function GET(_req: Request, {params}: {params: Promise<{kind: string}>}) {
  try {
    return Response.json({projects: await listCarousels(await kindParam(params))});
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST {title?, topic?, client?, brand_name?, sponsored?} → 새 프로젝트 */
export async function POST(req: Request, {params}: {params: Promise<{kind: string}>}) {
  try {
    const kind = await kindParam(params);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const project = await createCarousel(kind, {
      title: typeof body.title === 'string' ? body.title : undefined,
      topic: typeof body.topic === 'string' ? body.topic : undefined,
      client: typeof body.client === 'string' ? body.client : null,
      brand_name: typeof body.brand_name === 'string' ? body.brand_name : undefined,
      sponsored: Boolean(body.sponsored),
    });
    return Response.json({project}, {status: 201});
  } catch (err) {
    return errorResponse(err);
  }
}
