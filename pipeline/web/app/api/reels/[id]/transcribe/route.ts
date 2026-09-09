import {getProject, startTranscribe} from '@/lib/reels';
import {idParam, reelsErrorResponse} from '@/lib/reelsApi';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const {project} = await getProject(await idParam(params));
    return Response.json({job: startTranscribe(project)}, {status: 201});
  } catch (err) {
    return reelsErrorResponse(err);
  }
}
