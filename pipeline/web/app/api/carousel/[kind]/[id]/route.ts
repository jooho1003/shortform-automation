import {CarouselError, getCarousel, kindOk, lintCarousel, updateCarousel} from '@/lib/carousel';

export const dynamic = 'force-dynamic';

type Params = {params: Promise<{kind: string; id: string}>};

const errorResponse = (err: unknown) =>
  Response.json({error: (err as Error).message ?? '알 수 없는 오류'}, {status: err instanceof CarouselError ? err.status : 500});

async function read(params: Params['params']) {
  const {kind, id} = await params;
  if (!kindOk(kind)) throw new CarouselError('알 수 없는 종류', 404);
  return {kind, id};
}

export async function GET(_req: Request, {params}: Params) {
  try {
    const {kind, id} = await read(params);
    const project = await getCarousel(kind, id);
    return Response.json({project, lint: lintCarousel(project)});
  } catch (err) {
    return errorResponse(err);
  }
}

/** PUT 부분 패치 → 저장 후 {project, lint} */
export async function PUT(req: Request, {params}: Params) {
  try {
    const {kind, id} = await read(params);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new CarouselError('JSON 본문이 필요합니다.');
    const project = await updateCarousel(kind, id, body);
    return Response.json({project, lint: lintCarousel(project)});
  } catch (err) {
    return errorResponse(err);
  }
}
