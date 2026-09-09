'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useMemo, useState} from 'react';

import {api, fmtSec} from '@/lib/client';
import type {LibraryItem, ReelProject} from '@/lib/reelsTypes';
import type {JobInfo} from '@/lib/types';

const STATUS: Record<ReelProject['status'], {label: string; cls: string}> = {
  new: {label: '새 프로젝트', cls: ''},
  fetched: {label: '원본 확보', cls: 'info'},
  analyzed: {label: '분석 완료', cls: 'info'},
  planned: {label: '기획안 있음', cls: 'ok'},
  exported: {label: '출력 완료', cls: 'ok'},
};

const views = (n: number | null) => (n == null ? '' : n >= 10000 ? `${Math.round(n / 10000)}만` : n.toLocaleString());

export function ReelsHome({library, projects, clients}: {library: LibraryItem[]; projects: ReelProject[]; clients: {slug: string; name: string}[]}) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'fav'>('all');
  const [tag, setTag] = useState('');
  const [pick, setPick] = useState<LibraryItem | null>(null);
  const [client, setClient] = useState('');
  const [brand, setBrand] = useState('');

  const tags = useMemo(() => [...new Set(library.flatMap((i) => i.tags))].sort(), [library]);
  const shown = library.filter((i) => (filter === 'fav' ? i.favorite : true)).filter((i) => (tag ? i.tags.includes(tag) : true));

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/reels', {method: 'POST', json: {url: url.trim()}});
      setUrl('');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleFav = async (item: LibraryItem) => {
    await api(`/api/reels/library/${item.id}`, {method: 'PUT', json: {favorite: !item.favorite}}).catch(() => {});
    router.refresh();
  };

  const editTags = async (item: LibraryItem) => {
    const next = window.prompt('태그(쉼표 구분)', item.tags.join(', '));
    if (next === null) return;
    await api(`/api/reels/library/${item.id}`, {method: 'PUT', json: {tags: next.split(',')}}).catch(() => {});
    router.refresh();
  };

  const createProject = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const {project} = await api<{project: ReelProject; job: JobInfo | null}>('/api/reels/projects', {method: 'POST', json: {libraryId: pick.id, client: client || null, brand_name: brand}});
      router.push(`/reels/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid" style={{gap: 18}}>
      <div className="card">
        <div className="row">
          <input className="field" style={{flex: 1}} placeholder="유튜브 쇼츠 · 인스타 릴스 · 틱톡 URL" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn primary" disabled={busy || !url.trim()} onClick={add}>
            라이브러리에 추가
          </button>
        </div>
        {error ? <div className="badge danger" style={{marginTop: 8}}>{error}</div> : null}
        <div className="faint" style={{marginTop: 6}}>메타(제목·채널·조회수·썸네일)는 yt-dlp로 읽습니다. 인스타그램은 로그인 없이 읽히는 공개 릴스만 됩니다.</div>
      </div>

      <section>
        <div className="row" style={{justifyContent: 'space-between', marginBottom: 10}}>
          <h2 style={{margin: 0, fontSize: 15}}>레퍼런스 라이브러리 <span className="faint">{library.length}</span></h2>
          <div className="row">
            <button className={`btn sm ${filter === 'all' ? 'primary' : ''}`} onClick={() => setFilter('all')}>
              전체
            </button>
            <button className={`btn sm ${filter === 'fav' ? 'primary' : ''}`} onClick={() => setFilter('fav')}>
              ★ 즐겨찾기
            </button>
            <select className="field" style={{width: 160}} value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">태그 전체</option>
              {tags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="empty">저장된 레퍼런스가 없습니다. 위에 URL을 넣으세요.</div>
        ) : (
          <div className="thumb-grid">
            {shown.map((item) => (
              <div key={item.id} className={`cand ${pick?.id === item.id ? 'chosen' : ''}`} onClick={() => setPick(item)}>
                {item.thumb ? <img src={item.thumb} alt="" referrerPolicy="no-referrer" style={{aspectRatio: '9/16', objectFit: 'cover'}} /> : <div style={{aspectRatio: '9/16', background: '#0a0c12'}} />}
                <button
                  className="btn sm"
                  style={{position: 'absolute', top: 6, right: 6, padding: '2px 7px'}}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleFav(item);
                  }}
                  title="즐겨찾기"
                >
                  {item.favorite ? '★' : '☆'}
                </button>
                <div className="meta">
                  <div className="t">{item.title || item.url}</div>
                  <div className="faint">
                    {item.author} · {views(item.views)}
                    {item.likes != null ? ` · ♥${views(item.likes)}` : ''}
                    {item.duration != null ? ` · ${fmtSec(item.duration)}` : ''}
                  </div>
                  <div className="row" style={{gap: 4, marginTop: 4}}>
                    {item.tags.map((t) => (
                      <span key={t} className="badge">
                        {t}
                      </span>
                    ))}
                    <button
                      className="btn sm"
                      style={{padding: '0 6px'}}
                      onClick={(e) => {
                        e.stopPropagation();
                        void editTags(item);
                      }}
                    >
                      태그
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {pick ? (
          <div className="card" style={{marginTop: 12}}>
            <div className="row" style={{justifyContent: 'space-between'}}>
              <div>
                <strong>나만의 릴스로 생성</strong> <span className="muted">— {pick.title}</span>
              </div>
              <div className="row">
                <select className="field" style={{width: 180}} value={client} onChange={(e) => setClient(e.target.value)}>
                  <option value="">고객 없이(직접 입력)</option>
                  {clients.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input className="field" style={{width: 160}} placeholder="브랜드/계정 이름" value={brand} onChange={(e) => setBrand(e.target.value)} />
                <button className="btn primary" disabled={busy} onClick={createProject}>
                  프로젝트 만들기
                </button>
              </div>
            </div>
            <div className="faint" style={{marginTop: 6}}>고객을 고르면 사전설문이 자동으로 들어갑니다. 만들면 원본 영상·자막을 바로 내려받기 시작합니다.</div>
          </div>
        ) : null}
      </section>

      <section>
        <h2 style={{margin: '0 0 10px', fontSize: 15}}>내 프로젝트 <span className="faint">{projects.length}</span></h2>
        {projects.length === 0 ? (
          <div className="empty">아직 프로젝트가 없습니다. 라이브러리에서 레퍼런스를 골라 만드세요.</div>
        ) : (
          <div className="grid cols-3">
            {projects.map((p) => (
              <Link key={p.id} href={`/reels/${p.id}`} className="card" style={{display: 'flex', gap: 12}}>
                <div style={{width: 64, aspectRatio: '9/16', borderRadius: 6, overflow: 'hidden', background: '#0a0c12', flexShrink: 0}}>{p.reference.thumb ? <img src={p.reference.thumb} alt="" referrerPolicy="no-referrer" style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null}</div>
                <div style={{minWidth: 0}}>
                  <div className="row" style={{gap: 6}}>
                    <span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>
                    {p.client ? <span className="badge info">{clients.find((c) => c.slug === p.client)?.name ?? p.client}</span> : null}
                  </div>
                  <div style={{fontWeight: 700, marginTop: 6}}>{p.title}</div>
                  <div className="faint" style={{fontSize: 12}}>
                    {p.reference.author} · {p.updated.slice(0, 10)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
