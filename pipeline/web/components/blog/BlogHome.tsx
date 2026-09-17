'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState} from 'react';

import type {BlogKeywordCandidate, BlogProject, BlogRankPoint} from '@/lib/blogTypes';
import styles from './blog.module.css';

type Board = {version: number; week: string; generated_at: string; source: string; keywords: BlogKeywordCandidate[]};
type Performance = {project: BlogProject; ranks: BlogRankPoint[]};
const STATUS: Record<BlogProject['status'], string> = {keyword: '개요 생성 전', outline: '개요 승인', facts: '근거 조사', draft: '본문 생성', images: '이미지 생성', review: '원고 검토', ready: '게시 준비', drafted: '임시저장', published: '게시됨'};
const KEYWORD_STATUS: Record<BlogKeywordCandidate['status'], string> = {unused: '미사용', writing: '작성 중', published: '게시됨'};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? '요청 실패');
  return value as T;
}

function Sparkline({values}: {values: (number | null)[]}) {
  const points = values.length ? values : [null];
  const coords = points.map((value, index) => `${(index / Math.max(1, points.length - 1)) * 110 + 5},${value == null ? 34 : 5 + (Math.min(100, value) / 100) * 32}`).join(' ');
  return <svg width="120" height="44" viewBox="0 0 120 44" role="img" aria-label="순위 추이"><polyline points={coords} fill="none" stroke="#4cd964" strokeWidth="2.5" strokeLinecap="round" /></svg>;
}

export function BlogHome({initialProjects, initialBoard, initialPerformance}: {initialProjects: BlogProject[]; initialBoard: Board | null; initialPerformance: Performance[]}) {
  const router = useRouter();
  const [tab, setTab] = useState<'posts' | 'keywords' | 'performance'>('posts');
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [batchCount, setBatchCount] = useState(2);

  const create = async (value = keyword) => {
    setBusy(true); setMessage(null);
    try {
      const {project} = await json<{project: BlogProject}>('/api/blog', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({keyword: value})});
      router.push(`/blog/${project.id}`);
    } catch (error) { setMessage((error as Error).message); setBusy(false); }
  };
  const discover = async () => {
    setBusy(true); setMessage(null);
    try {
      const {job} = await json<{job: {id: string}}>('/api/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({preset: 'blog-keywords'})});
      setMessage(`키워드 발굴을 시작했습니다. 작업 ${job.id} 완료 후 새로고침하세요.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  const batch = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await json<{projects: string[]}>('/api/blog/batch', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({count: batchCount})});
      setMessage(`${result.projects.length}개 글의 개요를 만들었습니다.`); router.refresh();
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  return <div className="grid" style={{gap: 18}}>
    <div className="tabs" role="tablist" aria-label="블로그 보기">
      <button className={tab === 'posts' ? 'active' : ''} onClick={() => setTab('posts')}>글</button>
      <button className={tab === 'keywords' ? 'active' : ''} onClick={() => setTab('keywords')}>키워드</button>
      <button className={tab === 'performance' ? 'active' : ''} onClick={() => setTab('performance')}>성과</button>
    </div>
    {message ? <div className="card"><span className="badge info">안내</span> <span className="muted">{message}</span></div> : null}
    {tab === 'posts' ? <>
      <div className="card row">
        <input className="field" style={{flex: 1}} placeholder="주 키워드 — 예: 쇼츠 자동화 시작하기" value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && keyword.trim() && create()} />
        <button className="btn primary" disabled={busy || !keyword.trim()} onClick={() => create()}>새 글</button>
      </div>
      {initialProjects.length ? <table className="tbl"><thead><tr><th>키워드·제목</th><th>상태</th><th>모드</th><th>수정</th></tr></thead><tbody>{initialProjects.map((project) => <tr key={project.id}><td><Link href={`/blog/${project.id}`}><strong>{project.title || project.keyword.main}</strong></Link><div className="faint">{project.keyword.main}</div></td><td><span className={`badge ${project.status === 'published' ? 'ok' : project.status === 'ready' ? 'info' : ''}`}>{STATUS[project.status]}</span></td><td>{project.publish.mode}</td><td className="faint">{new Date(project.updatedAt).toLocaleString('ko-KR')}</td></tr>)}</tbody></table> : <div className="empty">아직 만든 글이 없습니다.</div>}
    </> : null}
    {tab === 'keywords' ? <>
      <div className="card row"><button className="btn" disabled={busy} onClick={discover}>키워드 발굴 실행</button><label className="row">이번 주 <input className="field" style={{width: 70}} type="number" min={1} max={10} value={batchCount} onChange={(event) => setBatchCount(Number(event.target.value))} />편</label><button className="btn primary" disabled={busy || !initialBoard?.keywords.length} onClick={batch}>상위 키워드로 개요 만들기</button><span className="faint">{initialBoard ? `${initialBoard.week} · ${initialBoard.source}` : '보드 없음'}</span></div>
      {initialBoard?.keywords.length ? <div className={styles.tableScroll}><table className="tbl"><thead><tr><th>키워드</th><th>PC</th><th>모바일</th><th>문서</th><th>포화도</th><th>점수</th><th>상태</th><th /></tr></thead><tbody>{initialBoard.keywords.map((row) => <tr key={row.main}><td>{row.main}</td><td>{row.volume_pc.toLocaleString()}</td><td>{row.volume_mobile.toLocaleString()}</td><td>{row.docs.toLocaleString()}</td><td>{row.saturation.toFixed(2)}</td><td>{row.score.toFixed(4)}</td><td>{KEYWORD_STATUS[row.status]}</td><td><button className="btn sm" disabled={busy || row.status !== 'unused'} onClick={() => create(row.main)}>이 키워드로 글 만들기</button></td></tr>)}</tbody></table></div> : <div className="empty">키워드 API 키가 없어도 설정의 시드 키워드로 보드를 만들 수 있습니다.</div>}
    </> : null}
    {tab === 'performance' ? initialPerformance.length ? <table className="tbl"><thead><tr><th>글</th><th>키워드</th><th>최근 순위</th><th>추이</th></tr></thead><tbody>{initialPerformance.map(({project, ranks}) => {
      const ordered = [...ranks].sort((a, b) => a.date.localeCompare(b.date));
      const latest = ordered.at(-1)?.rank ?? null;
      return <tr key={project.id}><td><Link href={`/blog/${project.id}`}>{project.title || project.keyword.main}</Link></td><td>{project.keyword.main}</td><td>{latest == null ? '-' : `${latest}위`}</td><td><Sparkline values={ordered.slice(-14).map((point) => point.rank)} /></td></tr>;
    })}</tbody></table> : <div className="empty">임시저장 또는 게시된 글이 생기면 최근 14회 순위 추이가 표시됩니다.</div> : null}
  </div>;
}
