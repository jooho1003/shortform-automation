import {BlogHome} from '@/components/blog/BlogHome';
import {getBlogBundle, listBlogProjects} from '@/lib/blog';
import {getBlogKeywords} from '@/lib/inspect';

export const dynamic = 'force-dynamic';

export default async function BlogPage() {
  const [projects, board] = await Promise.all([listBlogProjects(), getBlogKeywords().catch(() => null)]);
  const performance = await Promise.all(
    projects
      .filter((project) => ['drafted', 'published'].includes(project.status))
      .map(async (project) => {
        const bundle = await getBlogBundle(project.id);
        return {project, ranks: bundle.ranks};
      }),
  );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>네이버 블로그</h1>
          <p>키워드 → 개요 승인 → 근거·본문·이미지 → 원고 승인 → 복사 패키지. 발행은 사람이 합니다.</p>
        </div>
      </div>
      <BlogHome initialProjects={projects} initialBoard={board?.data ?? null} initialPerformance={performance} />
    </>
  );
}
