import {BlogError, blogFailure, blogRequest, getBlogProject, resolveBlogId} from '@/lib/blog';
import {blogPipelineStages, startBlogPipeline, type BlogPipelineStage} from '@/lib/blogPipeline';

type Context = {params: Promise<{id: string}>};

export async function POST(req: Request, {params}: Context) {
  try {
    const id = resolveBlogId((await params).id);
    await getBlogProject(id);
    const body = await blogRequest(req);
    if (typeof body.from !== 'string' || !blogPipelineStages.includes(body.from as BlogPipelineStage)) throw new BlogError('실행 시작 단계가 올바르지 않습니다.');
    return Response.json({job: startBlogPipeline(id, body.from as BlogPipelineStage)}, {status: 202});
  } catch (error) {
    return blogFailure(error);
  }
}
