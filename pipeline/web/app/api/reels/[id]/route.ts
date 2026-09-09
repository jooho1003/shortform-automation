import {getProject, updateProject} from '@/lib/reels';
import {idParam, jsonBody, reelsErrorResponse} from '@/lib/reelsApi';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    return Response.json(await getProject(await idParam(params)));
  } catch (err) {
    return reelsErrorResponse(err);
  }
}

export async function PUT(req: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const id = await idParam(params);
    const body = await jsonBody<Parameters<typeof updateProject>[1]>(req);
    return Response.json({project: await updateProject(id, body)});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}
