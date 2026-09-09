'use client';

import {useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Gates} from '@/lib/types';

export default function GateButtons({
  dir,
  gate,
  gates,
  fixNote,
}: {
  dir: string;
  gate: 'plan' | 'clips' | 'upload';
  gates: Gates;
  fixNote: string | null;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<Gates>(gates);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFixForm, setShowFixForm] = useState(false);
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const ok =
    gate === 'plan' ? current.plan_ok : gate === 'clips' ? current.clips_ok : current.upload_ok;
  const hasFix = gate === 'plan' ? current.plan_fix : gate === 'clips' ? current.clips_fix : false;

  async function sendAction(action: 'approve' | 'revoke' | 'fix', extra?: {note?: string; confirmed?: boolean}) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({dir, gate, action, ...extra}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '게이트 처리에 실패했습니다.');
        return;
      }
      setCurrent(data.gates);
      setShowFixForm(false);
      setNote('');
      setConfirmed(false);
      dialogRef.current?.close();
      router.refresh();
    } catch {
      setError('요청 중 오류가 발생했습니다.');
    } finally {
      setPending(false);
    }
  }

  function openApprove() {
    if (gate === 'upload') {
      dialogRef.current?.showModal();
    } else {
      sendAction('approve');
    }
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
      {error && <div className="badge danger">{error}</div>}

      <div className="row">
        {ok ? (
          <span className="badge ok">승인됨</span>
        ) : hasFix ? (
          <span className="badge warn">수정요청 있음</span>
        ) : (
          <span className="badge">대기</span>
        )}

        {ok ? (
          <button className="btn" disabled={pending} onClick={() => sendAction('revoke')}>
            승인 취소
          </button>
        ) : (
          <button className="btn primary" disabled={pending} onClick={openApprove}>
            승인
          </button>
        )}

        {(gate === 'plan' || gate === 'clips') && (
          <button className="btn" disabled={pending} onClick={() => setShowFixForm((v) => !v)}>
            수정 요청
          </button>
        )}
      </div>

      {showFixForm && (
        <div className="row" style={{alignItems: 'flex-start'}}>
          <textarea
            className="field"
            style={{minHeight: 80}}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="수정 요청 내용을 입력하세요"
          />
          <button
            className="btn primary"
            disabled={pending || note.trim().length === 0}
            onClick={() => sendAction('fix', {note})}
          >
            보내기
          </button>
        </div>
      )}

      {fixNote && (
        <div className="card">
          <div className="muted" style={{marginBottom: 4}}>
            수정요청 내용
          </div>
          <div>{fixNote}</div>
        </div>
      )}

      <dialog ref={dialogRef} className="modal">
        <h3 style={{marginTop: 0}}>YouTube에 업로드를 허용합니다</h3>
        <p className="muted">
          이 작업은 외부(YouTube)로 실제 발행되는 동작이며, 콘솔에서 되돌릴 수 없습니다. 신중히 확인하세요.
        </p>
        <label className="row" style={{marginBottom: 14}}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          확인했습니다
        </label>
        <div className="row">
          <button
            className="btn primary"
            disabled={!confirmed || pending}
            onClick={() => sendAction('approve', {confirmed: true})}
          >
            승인
          </button>
          <button className="btn" onClick={() => dialogRef.current?.close()}>
            취소
          </button>
        </div>
      </dialog>
    </div>
  );
}
