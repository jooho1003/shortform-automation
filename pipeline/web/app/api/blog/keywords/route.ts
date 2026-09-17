import {BlogError, blogFailure} from '@/lib/blog';
import {getBlogKeywords} from '@/lib/inspect';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const week = new URL(req.url).searchParams.get('week') ?? undefined;
    if (week && !/^\d{4}-W\d{2}$/.test(week)) throw new BlogError('week는 YYYY-Www 형식이어야 합니다.');
    return Response.json(await getBlogKeywords(week));
  } catch (error) {
    return blogFailure(error);
  }
}
