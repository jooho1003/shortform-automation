'use client';

import {useRouter} from 'next/navigation';
import {useState} from 'react';

import {api} from '@/lib/client';
import type {Timeline} from '@/lib/types';

/**
 * 타임라인.json의 라인별 start/end/clip/mediaLayout을 손본다.
 * assets 단계를 다시 돌리면 이 파일이 다시 만들어지므로, 여기서 고친 값은 그 전에 render로 굳혀야 한다.
 */
export function TimelineEditor({dir, timeline, onChange}: {dir: string; timeline: Timeline; onChange?: (t: Timeline) => void}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Timeline>(timeline);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<Timeline['lines'][number]>) => {
    const lines = draft.lines.map((l, j) => (j === i ? {...l, ...patch} : l));
    const next = {...draft, lines, durationSec: Math.max(...lines.map((l) => l.end), 0)};
    setDraft(next);
    setDirty(true);
    onChange?.(next);
  };

  const shift = (i: number, delta: number) => {
    // i번째 이후 라인을 delta초만큼 밀거나 당긴다(문장 길이 조정 시 뒤가 겹치지 않게)
    const lines = draft.lines.map((l, j) => (j >= i ? {...l, start: +(l.start + delta).toFixed(3), end: +(l.end + delta).toFixed(3), words: l.words.map((w) => ({...w, start: +(w.start + delta).toFixed(3), end: +(w.end + delta).toFixed(3)}))} : l));
    const next = {...draft, lines, durationSec: Math.max(...lines.map((l) => l.end), 0)};
    setDraft(next);
    setDirty(true);
    onChange?.(next);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('/api/timeline', {method: 'PUT', json: {dir, timeline: draft}});
      setDirty(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="row" style={{justifyContent: 'space-between', marginBottom: 10}}>
        <div>
          <strong>타임라인</strong> <span className="muted">총 {draft.durationSec.toFixed(1)}초</span>
          {dirty ? <span className="badge warn" style={{marginLeft: 8}}>저장 안 됨</span> : null}
        </div>
        <div className="row">
          {error ? <span className="badge danger">{error}</span> : null}
          <button className="btn primary" disabled={!dirty || saving} onClick={save}>
            타임라인 저장
          </button>
        </div>
      </div>
      <div className="badge warn" style={{marginBottom: 10}}>
        assets 단계를 다시 실행하면 타임라인.json이 재생성되어 여기서 고친 값이 사라집니다. 고친 뒤에는 render만 다시 돌리세요.
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>문장</th>
            <th style={{width: 90}}>시작</th>
            <th style={{width: 90}}>끝</th>
            <th style={{width: 70}}>길이</th>
            <th style={{width: 150}}>클립</th>
            <th style={{width: 110}}>레이아웃</th>
            <th style={{width: 120}}>뒤로 밀기</th>
          </tr>
        </thead>
        <tbody>
          {draft.lines.map((l, i) => (
            <tr key={l.n}>
              <td className="faint">{l.n}</td>
              <td>{l.text}</td>
              <td>
                <input className="field" type="number" step="0.1" value={l.start} onChange={(e) => update(i, {start: parseFloat(e.target.value) || 0})} />
              </td>
              <td>
                <input className="field" type="number" step="0.1" value={l.end} onChange={(e) => update(i, {end: parseFloat(e.target.value) || 0})} />
              </td>
              <td className="muted">{(l.end - l.start).toFixed(1)}s</td>
              <td>
                <input className="field mono" value={l.clip} onChange={(e) => update(i, {clip: e.target.value})} />
              </td>
              <td>
                <select className="field" value={l.mediaLayout ?? 'landscape'} onChange={(e) => update(i, {mediaLayout: e.target.value as 'landscape' | 'portrait'})}>
                  <option value="landscape">가로</option>
                  <option value="portrait">세로</option>
                </select>
              </td>
              <td>
                <div className="row" style={{gap: 4}}>
                  <button className="btn sm" onClick={() => shift(i, -0.5)}>
                    −0.5
                  </button>
                  <button className="btn sm" onClick={() => shift(i, 0.5)}>
                    +0.5
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
