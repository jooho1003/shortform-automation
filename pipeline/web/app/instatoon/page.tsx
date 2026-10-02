import {CarouselHome} from '@/components/carousel/CarouselHome';
import {listCarousels} from '@/lib/carousel';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function InstatoonPage() {
  const projects = await listCarousels('instatoon');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>인스타툰</h1>
          <p>연재할 이야기를 고르고, 주제와 콘티를 다듬어 컷 작업으로 이어가세요.</p>
        </div>
      </div>
      <Link href="/instatoon/hansul" className="card" style={{display: 'block', marginBottom: 24, borderLeft: '3px solid var(--accent)', padding: 24}}>
        <div className="row" style={{justifyContent: 'space-between'}}><h2 style={{margin: 0}}>한술툰</h2><span className="badge info">연재 작업실</span></div>
        <p style={{color: 'var(--text-dim)', margin: '10px 0 16px'}}>담이와 보리의 관계 이야기. 갈등부터 사이다까지, 사연 하나를 세 편으로.</p>
        <span style={{color: 'var(--accent)'}}>주제·콘티 작성 · 수정 반영 · 다음 화 생성</span>
      </Link>
      <CarouselHome kind="instatoon" projects={projects} />
    </>
  );
}
