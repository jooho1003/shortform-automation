import {getClient} from '@/lib/clients';
import {createProject, startFetch} from '@/lib/reels';
import {jsonBody, reelsErrorResponse} from '@/lib/reelsApi';

export const dynamic = 'force-dynamic';

/** POST {url?|libraryId?, title?, client?, brand_name?, fetch?: boolean} → 프로젝트 생성(+원본 받기 잡) */
export async function POST(req: Request) {
  try {
    const body = await jsonBody<{url?: string; libraryId?: string; title?: string; client?: string | null; brand_name?: string; fetch?: boolean}>(req);
    let survey = null;
    let brand = body.brand_name ?? '';
    if (body.client) {
      const c = await getClient(body.client);
      survey = c.survey;
      brand = brand || c.name;
    }
    const project = await createProject({url: body.url, libraryId: body.libraryId, title: body.title, client: body.client ?? null, survey, brand_name: brand});
    const job = body.fetch === false ? null : startFetch(project);
    return Response.json({project, job}, {status: 201});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}
