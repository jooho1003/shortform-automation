'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import type {EpisodeSummary} from '@/lib/types';
import type {StudioSummary} from '@/lib/studioTypes';

export function StudioHome({projects, episodes}: {projects: StudioSummary[]; episodes: EpisodeSummary[]}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    setBusy(true); setError('');
    try {
      const episode = episodes.find(e => e.dir === source);
      const response = await fetch('/api/studio', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({title: title || episode?.title || '새 프로젝트', ...(episode ? {episode: {track: episode.track, date: episode.date, num: episode.num}} : {})})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      router.push(`/studio/${result.id}`);
    } catch (e) {setError(e instanceof Error ? e.message : '프로젝트 생성 실패'); setBusy(false);}
  }
  return <div className="take-studio studio-home">
    <div className="studio-eyebrow">YOUR NEXT TAKE</div><h1>아이디어를, 다음 테이크로.</h1>
    <p className="studio-muted">참조를 연결하고, 컷을 만들고, 가장 좋은 테이크로 완성하세요.</p>
    <section className="studio-create"><div><h2>새 프로젝트</h2><p>기존 회차를 가져오면 원본을 보존한 복사본으로 시작합니다.</p></div>
      <label>프로젝트 이름<input value={title} onChange={e => setTitle(e.target.value)} placeholder="어떤 이야기를 만들까요?" maxLength={120} /></label>
      <label>시작 방법<select value={source} onChange={e => setSource(e.target.value)}><option value="">빈 프로젝트에서 시작</option>{episodes.map(e => <option key={e.dir} value={e.dir}>{e.date} · {e.track}-{e.num} · {e.title}</option>)}</select></label>
      <button className="studio-primary" disabled={busy} onClick={create}>{busy ? '프로젝트 준비 중…' : '프로젝트 만들기 ↗'}</button>
      {error && <p role="alert" className="studio-error">{error}</p>}
    </section>
    <div className="studio-row"><h2>내 프로젝트 <span className="studio-muted">{projects.length}</span></h2><span className="studio-muted">최근 수정 순</span></div>
    <div className="studio-projects">{projects.map((p, i) => <Link className="studio-project" key={p.id} href={`/studio/${p.id}`}><div className="studio-cover"><span>{String(i+1).padStart(2, '0')}</span><span>TAKE<br/>STUDIO</span></div><h3>{p.title}</h3><p>{p.shots}컷 · 출력 {p.exports}개</p><small>{p.updatedAt.slice(0, 10)}</small></Link>)}</div>
    {!projects.length && <div className="studio-empty">첫 프로젝트를 만들고 참조 이미지나 영상을 추가해 보세요.</div>}
  </div>;
}
