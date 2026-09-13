import '@/app/detail-pages/detail-pages.css';

import {NewDetailProject} from '@/components/detail-pages/NewDetailProject';
import {DetailProjectList} from '@/components/detail-pages/DetailProjectList';
import {listDetailProjects} from '@/lib/detailProjects';
import {isDetailAdmin} from '@/lib/detailAdmin';
import {redirect} from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DetailPagesPage() {
  if (!await isDetailAdmin()) redirect('/detail-admin');
  const projects = await listDetailProjects();
  return <div className="detail-page">
    <div className="page-head">
      <div><h1>상세페이지 의뢰서</h1><p>고객 의뢰, 섹션 구성, 검수와 납품 정보를 한 곳에서 정리합니다.</p></div>
      <NewDetailProject />
    </div>
    <DetailProjectList projects={projects} />
  </div>;
}
