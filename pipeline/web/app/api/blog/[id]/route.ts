import {blogFailure, blogRequest, getBlogBundle, resolveBlogId, updateBlogProject} from '@/lib/blog';

export const dynamic = 'force-dynamic';

type Context = {params: Promise<{id: string}>};

export async function GET(_req: Request, {params}: Context) {
  try {
    const id = resolveBlogId((await params).id);
    return Response.json(await getBlogBundle(id));
  } catch (error) {
    return blogFailure(error);
  }
}

export async function PUT(req: Request, {params}: Context) {
  try {
    const id = resolveBlogId((await params).id);
    return Response.json(await updateBlogProject(id, await blogRequest(req)));
  } catch (error) {
    return blogFailure(error);
  }
}
