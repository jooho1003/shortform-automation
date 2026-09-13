import '@/app/detail-pages/[id]/preview/preview.css';

import Link from 'next/link';
import {notFound} from 'next/navigation';
import type {Metadata} from 'next';

import {DetailError, getDetailProject} from '@/lib/detailProjects';
import type {DetailProject, DetailSection} from '@/lib/detailTypes';
import {BeautyPreview} from '@/components/detail-pages/BeautyPreview';
import {DesignEditor} from '@/components/detail-pages/DesignEditor';
import {getDetailDesign} from '@/lib/detailDesign';
import {isDetailAdmin} from '@/lib/detailAdmin';

const SAMPLE_ID = '90a6d633-6baf-4473-8a70-80bd6822a9de';
const BEAUTY_SAMPLE_ID = 'db6b2f93-2d77-436c-b560-8d9ab2208102';

export const dynamic = 'force-dynamic';

export async function generateMetadata({params}: {params: Promise<{id: string}>}): Promise<Metadata> {
  const {id} = await params;
  let title = '상세페이지';
  try { title = (await getDetailProject(id))?.title || title; } catch { /* 페이지 본문이 오류를 처리한다. */ }
  return {title: `${title} · 상세페이지 시안`, robots: {index: false, follow: false}};
}

function visualImage(project: DetailProject, section: DetailSection) {
  if (project.id === SAMPLE_ID) return <img src="/detail-samples/ongi-mug.png" alt={`${project.product} ${section.title}`} />;
  return <div className="dp-preview-placeholder">이미지 자료가 아직 없습니다<br /><small>{section.visual || '의뢰서에서 이미지 연출을 확인하세요.'}</small></div>;
}

function ProductInfo({project, admin = false}: {project: DetailProject; admin?: boolean}) {
  return <section className="dp-preview-info"><p className="dp-preview-eyebrow">PRODUCT INFORMATION</p><h2>{project.product || '상품 정보'}</h2><dl><dt>용량</dt><dd>실제 자료 확인 필요</dd><dt>크기</dt><dd>실제 자료 확인 필요</dd><dt>재질</dt><dd>실제 자료 확인 필요</dd><dt>가격</dt><dd>실제 자료 확인 필요</dd><dt>배송</dt><dd>실제 자료 확인 필요</dd></dl><p className="dp-preview-disclaimer">이 페이지는 의뢰서 내용을 보여 주는 디자인 샘플이며, 판매 또는 구매 기능을 제공하지 않습니다.</p>{admin ? <Link data-admin-ui="" href={`/detail-pages/${project.id}`} className="dp-preview-back">의뢰서로 돌아가기</Link> : null}</section>;
}

export default async function DetailPreviewPage({params, searchParams}: {params: Promise<{id: string}>; searchParams: Promise<{output?:string}>}) {
  const {id} = await params;
  let project: DetailProject | null;
  try { project = await getDetailProject(id); } catch (error) { if (error instanceof DetailError && error.status === 400) notFound(); throw error; }
  if (!project) notFound();
  const admin = (await searchParams).output !== '1' && await isDetailAdmin();
  if (project.id === BEAUTY_SAMPLE_ID) {
    const design = await getDetailDesign(id);
    return admin ? <DesignEditor project={project} initialDesign={design} /> : <BeautyPreview project={project} design={design} />;
  }
  const [hero, ...sections] = project.sections;
  const brand = project.id === SAMPLE_ID ? 'ONGI' : project.client || 'DETAIL STUDIO';
  const eyebrow = project.id === SAMPLE_ID ? 'OBJECTS FOR A QUIET DAY' : project.product || 'PRODUCT STORY';
  return <article className="detail-preview">
    {admin ? <header data-admin-ui="" className="dp-preview-topbar"><Link href={`/detail-pages/${project.id}`}>← 편집으로 돌아가기</Link><span>이 화면은 저장된 의뢰서로 만든 고객용 결과 샘플입니다.</span></header> : null}
    <section className="dp-preview-hero"><div className="dp-preview-brand">{brand}</div><span className="dp-preview-sample">{project.id === SAMPLE_ID ? '가상 제품 디자인 샘플' : '제작 시안'}</span><div className="dp-preview-hero-grid"><div><p className="dp-preview-eyebrow">{eyebrow}</p><h1>{hero?.title || project.keyMessage || project.title}</h1><p>{hero?.copy || project.keyMessage}</p></div><div className="dp-preview-image dp-preview-hero-image">{hero ? visualImage(project, hero) : <div className="dp-preview-placeholder">섹션을 입력하세요.</div>}</div></div></section>
    <div>
      {sections.map((section, index) => {
        if (index === 2) return <section className="dp-preview-olive" key={section.id}><span>{section.title}</span><p>{section.copy || '내용을 준비 중입니다.'}</p></section>;
        if (index === 3) return <section className="dp-preview-text-info" key={section.id}><div className="dp-preview-copy"><span>0{index + 2}</span><h2>{section.title}</h2><p>{section.copy || '내용을 준비 중입니다.'}</p></div><ProductInfo project={project} admin={admin} /></section>;
        const crop = index === 1;
        return <section className={`dp-preview-section ${index % 2 ? 'reverse' : ''}`} key={section.id}><div className={`dp-preview-image ${crop ? 'dp-preview-crop' : ''}`}>{visualImage(project, section)}{crop ? <span className="dp-preview-caption">동일 이미지 확대</span> : null}</div><div className="dp-preview-copy"><span>0{index + 2}</span><h2>{section.title}</h2><p>{section.copy || '내용을 준비 중입니다.'}</p></div></section>;
      })}
      {sections.length < 4 ? <ProductInfo project={project} admin={admin} /> : null}
    </div>
  </article>;
}
