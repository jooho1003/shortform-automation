import Link from 'next/link';

import {DETAIL_STATUS_LABELS, type DetailProject} from '@/lib/detailTypes';

export function DetailProjectList({projects}: {projects: DetailProject[]}) {
  if (projects.length === 0) {
    return <div className="empty">등록된 상세페이지 의뢰서가 없습니다. 오른쪽 위에서 새 의뢰서를 만드세요.</div>;
  }
  return <div className="dp-list">
    {projects.map((project) => <div key={project.id} className="card dp-project-card">
      <div className="dp-status-row"><span className="badge info">{DETAIL_STATUS_LABELS[project.status]}</span><span className="faint">{project.deadline || '납기 미정'}</span></div>
      <Link href={`/detail-pages/${project.id}`} style={{fontWeight: 700, fontSize: 16}}>{project.title}</Link>
      <span className="muted">{project.client || '고객 미입력'} · {project.product || '제품 미입력'}</span>
      <div className="dp-status-row" style={{marginTop: 'auto', justifyContent: 'space-between'}}><span className="faint">섹션 {project.sections.length}개 · {project.updatedAt ? `수정 ${project.updatedAt}` : '방금 생성'}</span><Link href={`/detail-pages/${project.id}/preview`} className="btn sm">결과 보기</Link></div>
    </div>)}
  </div>;
}
