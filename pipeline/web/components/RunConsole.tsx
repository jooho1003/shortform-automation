'use client';

import {useRouter} from 'next/navigation';
import {useCallback, useEffect, useRef, useState} from 'react';

import {api} from '@/lib/client';
import type {JobEvent, JobInfo, StepName} from '@/lib/types';
import {STEPS_BY_TRACK, STEP_LABEL} from '@/lib/types';

interface EpisodeKey {
  track: 'A' | 'B';
  date: string;
  num: string;
  dir: string;
}

/** 잡 하나의 로그를 SSE로 받아 보여준다. */
export function JobLog({jobId, onEnd}: {jobId: string | null; onEnd?: (job: JobInfo) => void}) {
  const [lines, setLines] = useState<string>('');
  const [job, setJob] = useState<JobInfo | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!jobId) return;
    setLines('');
    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as JobEvent;
      if (ev.type === 'status') setJob(ev.job);
      if (ev.type === 'log') setLines((prev) => (prev + ev.text).slice(-200_000));
      if (ev.type === 'end') {
        setJob(ev.job);
        es.close();
        onEnd?.(ev.job);
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [jobId, onEnd]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!jobId) return null;
  const status = job?.status ?? 'running';
  const badge = status === 'done' ? 'ok' : status === 'running' ? 'info' : status === 'cancelled' ? 'warn' : 'danger';
  return (
    <div>
      <div className="row" style={{marginBottom: 8}}>
        <span className={`badge ${badge}`}>{status}</span>
        <span className="muted">{job?.title}</span>
        <span className="faint mono">{jobId}</span>
        {status === 'running' ? (
          <button className="btn sm danger" onClick={() => api(`/api/jobs/${jobId}/cancel`, {method: 'POST'}).catch(() => {})}>
            취소
          </button>
        ) : null}
      </div>
      <div className="log" ref={boxRef}>
        {lines.split('\n').map((l, i) => (
          <div key={i} className={l.startsWith('[stderr]') || l.startsWith('■') ? 'err' : undefined}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 회차의 단계 실행 버튼 + 로그. */
export function RunConsole({ep, steps, running}: {ep: EpisodeKey; steps: Record<string, {done?: boolean; at?: string}>; running?: boolean}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<StepName>('upload');

  const run = useCallback(
    async (step: StepName, confirmedNow = false) => {
      setError(null);
      setBusy(true);
      try {
        const {job} = await api<{job: JobInfo}>('/api/jobs', {method: 'POST', json: {preset: 'step', ...ep, step, force, confirmed: confirmedNow}});
        setJobId(job.id);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [ep, force]
  );

  const onEnd = useCallback(() => router.refresh(), [router]);

  return (
    <div className="card">
      <div className="row" style={{justifyContent: 'space-between', marginBottom: 12}}>
        <div className="row">
          {STEPS_BY_TRACK[ep.track].map((s) => {
            const done = steps[s]?.done;
            const dangerous = s === 'upload' || s === 'video';
            return (
              <button
                key={s}
                className={`btn ${done ? '' : 'primary'} ${dangerous ? 'danger' : ''}`}
                disabled={busy || running}
                title={done ? `완료 ${steps[s]?.at ?? ''}` : ''}
                onClick={() => {
                  if (dangerous) {
                    setPending(s);
                    setConfirmed(false);
                    dialogRef.current?.showModal();
                  } else {
                    void run(s);
                  }
                }}
              >
                {done ? '✓ ' : '▶ '}
                {STEP_LABEL[s]}
              </button>
            );
          })}
        </div>
        <label className="row muted" style={{fontSize: 12}}>
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> 완료된 단계도 다시 실행(--force)
        </label>
      </div>
      {error ? (
        <div className="badge danger" style={{marginBottom: 10}}>
          {error}
        </div>
      ) : null}
      <JobLog jobId={jobId} onEnd={onEnd} />
      {!jobId ? <div className="faint">단계를 누르면 `python -m shortform run --only &lt;단계&gt;`가 실행되고 로그가 여기에 흐릅니다. 게이트에서 막히면 종료 코드 2로 멈춥니다.</div> : null}

      <dialog className="modal" ref={dialogRef}>
        {pending === 'upload' ? (
          <>
            <h3 style={{marginTop: 0}}>YouTube에 업로드합니다</h3>
            <p className="muted">
              업로드는 되돌리기 어려운 외부 공개 동작입니다. `04-업로드-승인.txt`가 있어야 하고, 실패해도 재시도하지 않습니다. 공개 범위는 기획안 메타데이터의 `공개:` 값을 따릅니다.
            </p>
          </>
        ) : (
          <>
            <h3 style={{marginTop: 0}}>fal.ai로 컷 영상을 생성합니다 (과금)</h3>
            <p className="muted">
              컷마다 fal.ai 크레딧이 듭니다. 편당 상한과 컷당 추정 비용은 `config/fal.yaml`에 있고, 상한을 넘기면 시작하지 않습니다. 이미 있는 컷(03-소재/원본/NN.mp4)은 다시 만들지 않습니다. FAL_KEY가 pipeline/.env에 있어야 합니다.
            </p>
          </>
        )}
        <label className="row">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> {pending === 'upload' ? '완성본을 확인했고 업로드에 동의합니다' : '비용을 확인했고 생성에 동의합니다'}
        </label>
        <div className="row" style={{justifyContent: 'flex-end', marginTop: 16}}>
          <button className="btn" onClick={() => dialogRef.current?.close()}>
            취소
          </button>
          <button
            className="btn danger"
            disabled={!confirmed}
            onClick={() => {
              dialogRef.current?.close();
              void run(pending, true);
            }}
          >
            {pending === 'upload' ? '업로드 실행' : '생성 실행'}
          </button>
        </div>
      </dialog>
    </div>
  );
}
