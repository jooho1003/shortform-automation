import Link from 'next/link';

import {NewEpisodeForm} from '@/components/NewEpisodeForm';
import {listEpisodes} from '@/lib/inspect';
import type {EpisodeSummary} from '@/lib/types';
import {STEPS_BY_TRACK, STEP_LABEL} from '@/lib/types';

export const dynamic = 'force-dynamic';

function EpisodeCard({ep}: {ep: EpisodeSummary}) {
  const href = `/ep/${ep.track}/${ep.date}/${ep.num}`;
  const doneCount = STEPS_BY_TRACK[ep.track].filter((s) => ep.steps[s]?.done).length;
  const errored = new Set(ep.errors.map((e) => e.step));
  const nextStep = STEPS_BY_TRACK[ep.track].find((s) => !ep.steps[s]?.done);
  const thumb = ep.files.thumb ? `/api/media?path=${encodeURIComponent(ep.files.thumb)}` : ep.files.contact_sheet ? `/api/media?path=${encodeURIComponent(ep.files.contact_sheet)}` : null;
  return (
    <Link href={href} className="card" style={{display: 'flex', gap: 14, alignItems: 'stretch'}}>
      <div style={{width: 84, height: 150, borderRadius: 8, background: '#0a0c12', overflow: 'hidden', flexShrink: 0}}>
        {thumb ? <img src={thumb} alt="" style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
      </div>
      <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8}}>
        <div className="row" style={{gap: 6}}>
          <span className={`badge track-${ep.track}`}>{ep.track}안</span>
          <span className="faint mono">
            {ep.track}-{ep.num}
          </span>
          {ep.template_name ? <span className="badge">{ep.template_name}</span> : null}
        </div>
        <div style={{fontWeight: 700, fontSize: 15, lineHeight: 1.3}}>{ep.title}</div>
        <div className="steps" title={STEPS_BY_TRACK[ep.track].map((s) => `${STEP_LABEL[s]}: ${ep.steps[s]?.done ? '완료' : '대기'}`).join('\n')}>
          {STEPS_BY_TRACK[ep.track].map((s) => (
            <div key={s} className={`step ${ep.steps[s]?.done ? 'done' : errored.has(s) ? 'error' : ''}`} />
          ))}
        </div>
        <div className="row" style={{gap: 6, marginTop: 'auto'}}>
          <span className="muted" style={{fontSize: 12}}>
            {doneCount}/{STEPS_BY_TRACK[ep.track].length} · 다음 {nextStep ? STEP_LABEL[nextStep] : '완료'}
          </span>
          {ep.gates.plan_fix || ep.gates.clips_fix ? <span className="badge warn">수정요청</span> : null}
          {!ep.gates.plan_ok ? <span className="badge">기획 승인 대기</span> : null}
          {ep.gates.plan_ok && !ep.gates.clips_ok ? <span className="badge">소재 승인 대기</span> : null}
          {ep.files.final_mp4 && !ep.gates.upload_ok ? <span className="badge info">업로드 승인 대기</span> : null}
          {ep.errors.length ? <span className="badge danger">오류 {ep.errors.length}</span> : null}
        </div>
      </div>
    </Link>
  );
}

export default async function Home() {
  let episodes: EpisodeSummary[] = [];
  let error: string | null = null;
  try {
    episodes = (await listEpisodes()).episodes;
  } catch (e) {
    error = (e as Error).message;
  }
  const byDate = new Map<string, EpisodeSummary[]>();
  for (const ep of episodes) byDate.set(ep.date, [...(byDate.get(ep.date) ?? []), ep]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>회차</h1>
          <p>날짜 폴더 아래 회차를 그대로 읽습니다. A안은 AI 생성, B안은 클립 재편집.</p>
        </div>
        <NewEpisodeForm />
      </div>
      {error ? (
        <div className="card">
          <div className="badge danger">inspect 실패</div>
          <pre className="log" style={{marginTop: 10}}>{error}</pre>
          <p className="muted">
            Python 브리지가 돌지 않습니다. <Link href="/settings">환경 점검</Link>에서 venv·의존성을 확인하세요.
          </p>
        </div>
      ) : null}
      {!error && episodes.length === 0 ? <div className="empty">회차가 없습니다. 오른쪽 위에서 새 회차를 만드세요.</div> : null}
      {[...byDate.entries()].map(([date, eps]) => (
        <section key={date} style={{marginBottom: 26}}>
          <h2 style={{fontSize: 14, color: 'var(--text-dim)', margin: '0 0 10px'}}>{date}</h2>
          <div className="grid cols-3">
            {eps.map((ep) => (
              <EpisodeCard key={ep.dir} ep={ep} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
