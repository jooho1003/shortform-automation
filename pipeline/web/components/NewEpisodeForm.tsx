'use client';

import {useRouter} from 'next/navigation';
import {useRef, useState} from 'react';

import {api} from '@/lib/client';

export function NewEpisodeForm() {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const [track, setTrack] = useState<'A' | 'B'>('B');
  const [date, setDate] = useState(today);
  const [num, setNum] = useState('01');
  const [slug, setSlug] = useState('');
  const [brief, setBrief] = useState('');
  const [autoPlan, setAutoPlan] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{dir: string}>('/api/episode', {method: 'POST', json: {track, date, num, slug, brief}});
      if (autoPlan) {
        await api('/api/episode/plan', {method: 'POST', json: {dir: created.dir, track, provider: 'claude'}});
      }
      ref.current?.close();
      router.push(`/ep/${track}/${date}/${num.padStart(2, '0')}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn primary" onClick={() => ref.current?.showModal()}>
        + 새 회차
      </button>
      <dialog className="modal" ref={ref}>
        <h3 style={{marginTop: 0}}>새 회차</h3>
        <div className="grid" style={{gridTemplateColumns: '1fr 1fr', gap: 10}}>
          <div>
            <label className="lbl">트랙</label>
            <select className="field" value={track} onChange={(e) => setTrack(e.target.value as 'A' | 'B')}>
              <option value="B">B안 — 클립 재편집</option>
              <option value="A">A안 — AI 생성</option>
            </select>
          </div>
          <div>
            <label className="lbl">번호</label>
            <input className="field" value={num} onChange={(e) => setNum(e.target.value)} />
          </div>
          <div>
            <label className="lbl">날짜</label>
            <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="lbl">제목(슬러그)</label>
            <input className="field" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="예: 시청률TOP3공통점" />
          </div>
        </div>
        <label className="lbl" style={{marginTop: 12}}>만들려는 유형·제작 의도</label>
        <textarea
          className="field"
          style={{minHeight: 110}}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="예: 리버의 아침식사. 작은 AI 캐릭터가 매일 다른 재료로 아침을 만들며 허둥대는 30초 코미디. 따뜻하고 반복 시청 가능한 시리즈 톤."
        />
        <label className="row muted" style={{marginTop: 10}}>
          <input type="checkbox" checked={autoPlan} onChange={(e) => setAutoPlan(e.target.checked)} />
          입력한 의도를 분석해 AI가 기획안 자동 생성
        </label>
        <p className="faint" style={{marginBottom: 0}}>
          폴더 <span className="mono">
            {date}/{track}-{num.padStart(2, '0')}-{slug || '…'}
          </span>
          가 만들어집니다.
        </p>
        {error ? <div className="badge danger">{error}</div> : null}
        <div className="row" style={{justifyContent: 'flex-end', marginTop: 14}}>
          <button className="btn" onClick={() => ref.current?.close()}>
            취소
          </button>
          <button className="btn primary" disabled={busy || !slug.trim() || (autoPlan && !brief.trim())} onClick={submit}>
            {busy ? (autoPlan ? 'AI 기획 생성 중…' : '만드는 중…') : '만들기'}
          </button>
        </div>
      </dialog>
    </>
  );
}
