'use client';

import {useEffect, useState} from 'react';

interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
  level: 'required' | 'optional';
}

export function Doctor() {
  const [data, setData] = useState<{root: string; node: string; checks: Check[]} | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setData(null);
    fetch('/api/doctor')
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [tick]);

  if (error) return <div className="badge danger">{error}</div>;
  if (!data) return <div className="muted">점검 중… (파이썬·CLI 버전을 물어봅니다)</div>;
  const required = data.checks.filter((c) => c.level === 'required');
  const optional = data.checks.filter((c) => c.level === 'optional');
  const allOk = required.every((c) => c.ok);

  const Row = ({c}: {c: Check}) => (
    <tr>
      <td>
        <span className={`badge ${c.ok ? 'ok' : c.level === 'required' ? 'danger' : 'warn'}`}>{c.ok ? 'OK' : c.level === 'required' ? '필수' : '선택'}</span>
      </td>
      <td>{c.label}</td>
      <td className="muted mono" style={{fontSize: 12}}>
        {c.detail}
      </td>
      <td className="faint mono" style={{fontSize: 12}}>
        {!c.ok && c.fix ? c.fix : ''}
      </td>
    </tr>
  );

  return (
    <div className="grid" style={{gap: 14}}>
      <div className="card row" style={{justifyContent: 'space-between'}}>
        <div>
          <span className={`badge ${allOk ? 'ok' : 'danger'}`}>{allOk ? '필수 항목 모두 통과' : '필수 항목 누락'}</span>
          <span className="faint" style={{marginLeft: 10}}>
            root {data.root} · node {data.node}
          </span>
        </div>
        <button className="btn sm" onClick={() => setTick((t) => t + 1)}>
          다시 점검
        </button>
      </div>
      <div className="card">
        <strong>필수</strong>
        <table className="tbl" style={{marginTop: 8}}>
          <tbody>
            {required.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <strong>선택 (기능별)</strong>
        <table className="tbl" style={{marginTop: 8}}>
          <tbody>
            {optional.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="card faint" style={{fontSize: 12}}>
        모델 분담(사용자 결정): 기획·대본·분석 = claude(주)/codex(대안) · 이미지 = codex · 영상 = fal.ai MiniMax H3 · PDF = 인쇄 페이지(결정적 렌더) · 업로드 = 파이프라인 upload 단계(YouTube). 인스타그램 업로드는 비즈니스 계정 + Graph API가 필요해 아직 손으로 올립니다.
      </div>
    </div>
  );
}
