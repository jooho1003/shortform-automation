'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import type {ClipCandidate, ClipEntry} from '@/lib/types';

const media = (rel: string) => '/api/media?path=' + encodeURIComponent(rel);

function formatViews(n: number): string {
  return n >= 10000 ? Math.round(n / 10000) + '만' : n.toLocaleString();
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ClipPicker({
  dir,
  entries,
  contactSheet,
}: {
  dir: string;
  entries: ClipEntry[];
  contactSheet: string | null;
}) {
  const router = useRouter();
  const [pendingN, setPendingN] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateEntry(
    n: number,
    body: {chosen?: number | null; media_layout?: 'landscape' | 'portrait'}
  ) {
    setPendingN(n);
    setError(null);
    try {
      const res = await fetch('/api/clips', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({dir, n, ...body}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '클립을 저장하지 못했습니다.');
        return;
      }
      router.refresh();
    } catch {
      setError('요청 중 오류가 발생했습니다.');
    } finally {
      setPendingN(null);
    }
  }

  function pickChosen(entry: ClipEntry, index: number | null) {
    updateEntry(entry.n, {chosen: index});
  }

  function pickLayout(entry: ClipEntry, layout: 'landscape' | 'portrait') {
    updateEntry(entry.n, {chosen: entry.chosen, media_layout: layout});
  }

  const sorted = [...entries].sort((a, b) => a.n - b.n);

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 16}}>
      {error && <div className="badge danger">{error}</div>}

      {contactSheet && (
        <details className="card">
          <summary style={{cursor: 'pointer', fontWeight: 600}}>컨택트시트 보기</summary>
          <img
            src={media(contactSheet)}
            alt="컨택트시트"
            style={{width: '100%', marginTop: 10, borderRadius: 8}}
          />
        </details>
      )}

      {sorted.length === 0 && (
        <div className="empty">클립 후보가 없습니다. clips 단계를 실행하세요.</div>
      )}

      {sorted.map((entry) => {
        const chosenCand: ClipCandidate | undefined =
          entry.chosen !== null ? entry.candidates[entry.chosen] : undefined;
        const isPending = pendingN === entry.n;
        return (
          <div className="card" key={entry.n} style={{opacity: isPending ? 0.6 : 1}}>
            <div className="row" style={{marginBottom: 10}}>
              <span className="badge">#{entry.n}</span>
              <span>{entry.text}</span>
              <span className="badge info">{entry.source}</span>
              {entry.source === 'clip' && chosenCand && chosenCand.official === false && (
                <span className="badge danger">비공식 확인 필요</span>
              )}
            </div>
            {entry.queries.length > 0 && (
              <div className="faint" style={{marginBottom: 10}}>
                검색어: {entry.queries.join(', ')}
              </div>
            )}

            <div className="row" style={{marginBottom: 10}}>
              <button
                className={`btn sm${entry.media_layout === 'landscape' ? ' primary' : ''}`}
                disabled={isPending}
                onClick={() => pickLayout(entry, 'landscape')}
              >
                가로(landscape)
              </button>
              <button
                className={`btn sm${entry.media_layout === 'portrait' ? ' primary' : ''}`}
                disabled={isPending}
                onClick={() => pickLayout(entry, 'portrait')}
              >
                세로(portrait)
              </button>
              <button className="btn sm" disabled={isPending} onClick={() => pickChosen(entry, null)}>
                직접 넣기(선택 해제)
              </button>
            </div>
            {entry.chosen === null && (
              <div className="faint" style={{marginBottom: 10}}>
                선택 해제됨: 03-소재/클립/{String(entry.n).padStart(2, '0')}.mp4에 직접 넣어야 합니다.
              </div>
            )}

            <div className="thumb-grid">
              {entry.candidates.map((c: ClipCandidate, index: number) => (
                <div
                  key={`${c.provider}-${c.id}-${index}`}
                  className={`cand${entry.chosen === index ? ' chosen' : ''}`}
                  onClick={() => !isPending && pickChosen(entry, index)}
                  style={{pointerEvents: isPending ? 'none' : 'auto'}}
                >
                  {c.official === false && <span className="badge danger unofficial">비공식</span>}
                  <img src={c.thumb} alt={c.title ?? c.provider} referrerPolicy="no-referrer" />
                  <div className="meta">
                    <div className="t">{c.title ?? c.provider}</div>
                    {c.provider === 'youtube' ? (
                      <div className="faint">
                        {c.author ?? ''} · {c.views !== undefined ? formatViews(c.views) : '?'} ·{' '}
                        {c.duration !== undefined ? formatDuration(c.duration) : '?'} ·{' '}
                        {c.start !== undefined ? `${c.start}s` : '0s'}
                      </div>
                    ) : (
                      <div className="faint">
                        {c.width ?? '?'}×{c.height ?? '?'}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
