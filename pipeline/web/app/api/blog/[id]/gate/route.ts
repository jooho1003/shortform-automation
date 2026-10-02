import {BlogError, blogFailure, blogRequest, resolveBlogId, setBlogGate} from '@/lib/blog';
import {startBlogPipeline} from '@/lib/blogPipeline';

type Context = {params: Promise<{id: string}>};

export async function POST(req: Request, {params}: Context) {
  try {
    const id = resolveBlogId((await params).id);
    const body = await blogRequest(req);
    if (body.gate !== 'outline' && body.gate !== 'body') throw new BlogError('gate는 outline 또는 body여야 합니다.');
    if (body.action !== 'ok' && body.action !== 'fix') throw new BlogError('action은 ok 또는 fix여야 합니다.');
    const bundle = await setBlogGate(id, body.gate, body.action, typeof body.note === 'string' ? body.note : '', typeof body.category === 'string' ? body.category : undefined);
    const job = body.gate === 'outline' && body.action === 'ok' ? startBlogPipeline(id, 'facts') : null;
    return Response.json({bundle, job});
  } catch (error) {
    return blogFailure(error);
  }
}
