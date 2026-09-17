import {assertBlogOrigin, blogFailure, createCopyPackage, resolveBlogId} from '@/lib/blog';

type Context = {params: Promise<{id: string}>};

export async function POST(req: Request, {params}: Context) {
  try {
    assertBlogOrigin(req);
    const id = resolveBlogId((await params).id);
    return Response.json(await createCopyPackage(id));
  } catch (error) {
    return blogFailure(error);
  }
}
