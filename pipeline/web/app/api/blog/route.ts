import {blogFailure, blogRequest, createBlogProject, listBlogProjects} from '@/lib/blog';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json({projects: await listBlogProjects()});
  } catch (error) {
    return blogFailure(error);
  }
}

export async function POST(req: Request) {
  try {
    const body = await blogRequest(req);
    const project = await createBlogProject({
      keyword: String(body.keyword ?? ''),
      week: typeof body.week === 'string' ? body.week : undefined,
      volumes: body.volumes && typeof body.volumes === 'object' ? (body.volumes as Record<string, number>) : undefined,
    });
    return Response.json({project}, {status: 201});
  } catch (error) {
    return blogFailure(error);
  }
}
