import '@/components/carousel/carousel.css';

import Link from 'next/link';

import {InstatoonEditor} from '@/components/carousel/InstatoonEditor';
import {CarouselError, getCarousel, lintCarousel, type InstatoonProject} from '@/lib/carousel';

export const dynamic = 'force-dynamic';

export default async function InstatoonDetailPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  let project: InstatoonProject;
  try {
    project = (await getCarousel('instatoon', id)) as InstatoonProject;
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
            <Link href="/instatoon">← 인스타툰</Link> · 파일은 인스타툰/{project.id}/프로젝트.json
            {project.brand_name === '한술툰' && <> · <Link href="/instatoon/hansul">한술툰 작업실</Link></>}
          </p>
        </div>
      </div>
      <InstatoonEditor key={project.updated_at} project={project} lint={lintCarousel(project)} />
    </>
  );
}
