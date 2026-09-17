import {BlogError, blogFailure, blogRequest, createBlogProject} from '@/lib/blog';
import {generateBlogOutline} from '@/lib/blogPipeline';
import {getBlogKeywords} from '@/lib/inspect';

export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const body = await blogRequest(req);
    const count = Math.max(1, Math.min(10, Number(body.count) || 1));
    const board = await getBlogKeywords(typeof body.week === 'string' ? body.week : undefined);
    const candidates = (board.data?.keywords ?? []).filter((row) => row.status === 'unused').slice(0, count);
    if (!candidates.length) throw new BlogError('사용할 키워드 후보가 없습니다. 키워드 발굴을 먼저 실행해 주세요.');
    const projects = [];
    for (const candidate of candidates) {
      const project = await createBlogProject({keyword: candidate.main, week: candidate.week, volumes: candidate});
      await generateBlogOutline(project.id);
      projects.push(project.id);
    }
    return Response.json({projects}, {status: 201});
  } catch (error) {
    return blogFailure(error);
  }
}
