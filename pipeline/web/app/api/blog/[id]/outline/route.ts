import {assertBlogOrigin, blogFailure, resolveBlogId} from '@/lib/blog';
import {generateBlogOutline} from '@/lib/blogPipeline';

export const maxDuration = 600;
type Context = {params: Promise<{id: string}>};

export async function POST(req: Request, {params}: Context) {
  try {
    assertBlogOrigin(req);
    const id = resolveBlogId((await params).id);
    return Response.json(await generateBlogOutline(id));
  } catch (error) {
    return blogFailure(error);
  }
}
