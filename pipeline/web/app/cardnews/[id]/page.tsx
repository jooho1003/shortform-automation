import '@/components/carousel/carousel.css';

import Link from 'next/link';

import {CardNewsEditor} from '@/components/carousel/CardNewsEditor';
import {CarouselError, getCarousel, lintCarousel, type CardNewsProject} from '@/lib/carousel';

export const dynamic = 'force-dynamic';

export default async function CardNewsDetailPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  let project: CardNewsProject;
  try {
    project = (await getCarousel('cardnews', id)) as CardNewsProject;
  } catch (err) {
    return (
      <div className="card">
        <div className="badge danger">{err instanceof CarouselError ? err.message : (err as Error).message}</div>
      </div>
    );
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{project.title}</h1>
          <p>
            <Link href="/cardnews">← 카드뉴스</Link> · 파일은 카드뉴스/{project.id}/프로젝트.json
          </p>
        </div>
      </div>
      <CardNewsEditor key={project.updated_at} project={project} lint={lintCarousel(project)} />
    </>
  );
}
