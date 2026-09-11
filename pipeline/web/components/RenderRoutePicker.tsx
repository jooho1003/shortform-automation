'use client';

import {useEffect, useState} from 'react';

import {api} from '@/lib/client';
import {type RenderRoute} from '@/lib/types';

const OPTIONS: {value: RenderRoute; label: string; hint: string}[] = [
  {
    value: 'remotion',
    label: 'Remotion (기본)',
    hint: 'render 단계가 mp4까지 자동으로 뽑는다. 사람은 승인만 한다.',
  },
  {
    value: 'capcut',
    label: 'CapCut',
    hint: 'CapCut 드래프트를 만들어 손으로 마무리한다. 내보내기는 사람이 CapCut에서 눌러야 한다.',
  },
];

export default function RenderRoutePicker({dir}: {dir: string}) {
  const [route, setRoute] = useState<RenderRoute | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{route: RenderRoute}>(`/api/render-route?dir=${encodeURIComponent(dir)}`)
      .then((d) => {
        if (alive) {
          setRoute(d.route);
        }
      })
      .catch((e: Error) => {
        if (alive) {
          setError(e.message);
        }
      });
    return () => {
      alive = false;
    };
  }, [dir]);

  async function pick(next: RenderRoute) {
    if (next === route || saving) {
      return;
    }
    const previous = route;
    setRoute(next); // 낙관적으로 먼저 칠한다. 실패하면 되돌린다.
    setSaving(true);
    setError(null);
    try {
      await api('/api/render-route', {method: 'POST', json: {dir, route: next}});
    } catch (e) {
      setRoute(previous);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <strong>렌더 경로</strong>
      {error ? <span className="badge danger" style={{marginLeft: 8}}>{error}</span> : null}
      <div style={{display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10}}>
        {OPTIONS.map((opt) => (
          <label key={opt.value} className="row" style={{alignItems: 'flex-start', gap: 10, cursor: 'pointer'}}>
            <input
              type="radio"
              name={`render-route-${dir}`}
              checked={route === opt.value}
              disabled={route === null || saving}
              onChange={() => pick(opt.value)}
              style={{marginTop: 3}}
            />
            <span>
              <span>{opt.label}</span>
              <div className="faint">{opt.hint}</div>
            </span>
          </label>
        ))}
      </div>
      <div className="faint" style={{marginTop: 8}}>
        <span className="mono">렌더설정.json</span>에 저장된다. CapCut을 고르면 <span className="mono">render</span> 단계가
        자동 렌더 대신 안내를 내고 멈춘다.
      </div>
    </div>
  );
}
