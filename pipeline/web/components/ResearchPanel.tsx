'use client';

import {useRouter} from 'next/navigation';
import {useCallback, useState} from 'react';

import {JobLog} from '@/components/RunConsole';
import {api} from '@/lib/client';
import type {JobInfo, ResearchInfo} from '@/lib/types';

type Source = {name: string; url: string; items: {id: string; title: string; views: number; duration: number; url: string}[]};
type Bench = {name: string; url: string; views_median: number; views_max: number; items: {id: string; title: string; views: number; url: string}[]};

export function ResearchPanel({info}: {info: ResearchInfo | null}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const onEnd = useCallback(() => router.refresh(), [router]);

  const run = async (json: unknown) => {
    setError(null);
    try {
      const {job} = await api<{job: JobInfo}>('/api/jobs', {method: 'POST', json});
      setJobId(job.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const data = info?.latest?.data as {week?: string; generated?: string; axis?: string; sources?: Source[]; benchmarks?: Bench[]} | undefined;
  const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 10000)}만` : n.toLocaleString());

  return (
    <div className="grid" style={{gap: 14}}>
      <div className="card row" style={{justifyContent: 'space-between'}}>
        <div>
          {info?.latest ? (
            <>
              <span className={`badge ${info.fresh ? 'ok' : 'warn'}`}>{info.fresh ? '신선함' : '묵음 — 다시 조사'}</span>
              <span className="muted" style={{marginLeft: 10}}>
                {data?.week} · {data?.generated?.slice(0, 16).replace('T', ' ')} · 축: {data?.axis}
              </span>
            </>
          ) : (
            <span className="badge warn">조사 리포트 없음</span>
          )}
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => run({preset: 'research'})}>
            주간 조사 실행
          </button>
          <button className="btn" onClick={() => run({preset: 'discover'})} title="YOUTUBE_API_KEY 필요">
            레퍼런스 발굴(discover)
          </button>
        </div>
      </div>
      <div className="card">
        <strong>구간 후보 뽑기 (segments)</strong>
        <div className="row" style={{marginTop: 8}}>
          <input className="field" style={{flex: 1}} placeholder="유튜브 URL 또는 영상 ID" value={source} onChange={(e) => setSource(e.target.value)} />
          <input className="field" type="date" style={{width: 160}} value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn primary" disabled={!source.trim()} onClick={() => run({preset: 'segments', source: source.trim(), date})}>
            실행
          </button>
        </div>
        <div className="faint" style={{marginTop: 6}}>결과: pipeline/data/segments/&lt;id&gt;.json + &lt;날짜&gt;/00-구간후보-&lt;id&gt;.png (음량 봉우리 + 자막 신호로 20개)</div>
      </div>
      {error ? <div className="badge danger">{error}</div> : null}
      {jobId ? (
        <div className="card">
          <JobLog jobId={jobId} onEnd={onEnd} />
        </div>
      ) : null}
      {data?.sources?.length ? (
        <div className="card">
          <strong>소스 채널 상위 롱폼</strong>
          <table className="tbl" style={{marginTop: 8}}>
            <tbody>
              {data.sources.map((s) =>
                s.items.slice(0, 3).map((it, i) => (
                  <tr key={s.name + it.id}>
                    <td className="muted" style={{whiteSpace: 'nowrap'}}>
                      {i === 0 ? s.name : ''}
                    </td>
                    <td>
                      <a href={it.url} target="_blank" rel="noreferrer">
                        {it.title}
                      </a>
                    </td>
                    <td className="faint" style={{whiteSpace: 'nowrap'}}>
                      {fmt(it.views)}
                    </td>
                    <td>
                      <button
                        className="btn sm"
                        onClick={() => {
                          // 위 입력칸도 채운다 — 어떤 영상을 돌리는 중인지 화면에 남는다.
                          setSource(it.url);
                          run({preset: 'segments', source: it.url, date});
                        }}
                      >
                        구간 뽑기
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      {data?.benchmarks?.length ? (
        <div className="card">
          <strong>벤치마크 숏폼 채널</strong>
          <table className="tbl" style={{marginTop: 8}}>
            <thead>
              <tr>
                <th>채널</th>
                <th>중앙값</th>
                <th>최대</th>
                <th>최근</th>
              </tr>
            </thead>
            <tbody>
              {data.benchmarks.map((b) => (
                <tr key={b.name}>
                  <td>
                    <a href={b.url} target="_blank" rel="noreferrer">
                      {b.name}
                    </a>
                  </td>
                  <td>{fmt(b.views_median)}</td>
                  <td>{fmt(b.views_max)}</td>
                  <td className="faint">{b.items.slice(0, 2).map((i) => i.title).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
