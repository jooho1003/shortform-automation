'use client';

import {useRouter} from 'next/navigation';
import {useState} from 'react';

import {api} from '@/lib/client';
import type {ClientMonth, ClientPackage, Deliverable, DeliverableStatus} from '@/lib/clientTypes';

function newDeliverableId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

const STATUS_ORDER: DeliverableStatus[] = ['planned', 'scripted', 'shot', 'edited', 'uploaded'];

const STATUS_LABEL: Record<DeliverableStatus, string> = {
  planned: '기획',
  scripted: '대본',
  shot: '촬영',
  edited: '편집',
  uploaded: '업로드',
};

function episodeHref(episode: string): string | null {
  // "YYYY-MM-DD/T-NN-slug" -> /ep/<track>/<date>/<num>
  const parts = episode.split('/');
  if (parts.length < 2) return null;
  const date = parts[0];
  const rest = parts.slice(1).join('/');
  const m = rest.match(/^([A-Za-z])-(\d+)/);
  if (!m) return null;
  const track = m[1];
  const num = m[2].padStart(2, '0');
  return `/ep/${track}/${date}/${num}`;
}

function reelsHref(reelsProject: string): string {
  const parts = reelsProject.split('/').filter(Boolean);
  const id = parts[parts.length - 1] ?? reelsProject;
  return '/reels/' + id;
}

function DeliverableCard({item, onMove, onDelete}: {item: Deliverable; onMove: (dir: -1 | 1) => void; onDelete: () => void}) {
  const idx = STATUS_ORDER.indexOf(item.status);
  const epHref = item.episode ? episodeHref(item.episode) : null;
  return (
    <div className="card" style={{padding: 10, display: 'flex', flexDirection: 'column', gap: 6}}>
      <div className="row" style={{gap: 4}}>
        <span className="badge">{item.type}</span>
        {item.due ? <span className="faint" style={{fontSize: 11}}>{item.due}</span> : null}
      </div>
      <div style={{fontWeight: 600, fontSize: 12.5}}>{item.title}</div>
      <div className="row" style={{gap: 6}}>
        {item.reels_project ? (
          <a className="badge info" href={reelsHref(item.reels_project)} target="_blank" rel="noreferrer">
            기획안
          </a>
        ) : null}
        {epHref ? (
          <a className="badge info" href={epHref} target="_blank" rel="noreferrer">
            회차
          </a>
        ) : null}
        {item.uploaded_url ? (
          <a className="badge ok" href={item.uploaded_url} target="_blank" rel="noreferrer">
            업로드됨
          </a>
        ) : null}
      </div>
      <div className="row" style={{gap: 4, marginTop: 'auto'}}>
        <button className="btn sm" disabled={idx <= 0} onClick={() => onMove(-1)}>
          ◀
        </button>
        <button className="btn sm" disabled={idx >= STATUS_ORDER.length - 1} onClick={() => onMove(1)}>
          ▶
        </button>
        <button className="btn sm danger" onClick={onDelete}>
          삭제
        </button>
      </div>
    </div>
  );
}

function NewDeliverableForm({onAdd}: {onAdd: (item: Deliverable) => void}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'reel' | 'story' | 'other'>('reel');
  const [due, setDue] = useState('');

  const add = () => {
    if (!title.trim()) return;
    onAdd({
      id: newDeliverableId(),
      title: title.trim(),
      type,
      reels_project: null,
      episode: null,
      status: 'planned',
      due: due || null,
      uploaded_url: null,
      notes: '',
    });
    setTitle('');
    setDue('');
  };

  return (
    <div className="card" style={{padding: 10, display: 'flex', flexDirection: 'column', gap: 6}}>
      <input className="field" placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
      <select className="field" value={type} onChange={(e) => setType(e.target.value as 'reel' | 'story' | 'other')}>
        <option value="reel">reel</option>
        <option value="story">story</option>
        <option value="other">other</option>
      </select>
      <input className="field" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      <button className="btn sm primary" onClick={add} disabled={!title.trim()}>
        + 항목 추가
      </button>
    </div>
  );
}

export function MonthBoard({
  slug,
  month,
  data,
  stages,
  packageInfo,
}: {
  slug: string;
  month: string;
  data: ClientMonth | null;
  stages: {id: number; name: string}[];
  packageInfo: ClientPackage | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ClientMonth | null>(data);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createBoard = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/clients/' + slug + '/months/' + month, {method: 'PUT', json: {stage: 1, items: []}});
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!form) {
    return (
      <div className="empty">
        <p>이 달 보드가 없습니다.</p>
        <button className="btn primary" disabled={busy} onClick={createBoard}>
          이 달 보드 만들기
        </button>
        {error ? <div className="badge danger">{error}</div> : null}
      </div>
    );
  }

  const patch = (updater: (prev: ClientMonth) => ClientMonth) => {
    setForm((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/clients/' + slug + '/months/' + month, {method: 'PUT', json: form});
      setDirty(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setStage = async (stage: 1 | 2 | 3 | 4) => {
    patch((prev) => ({...prev, stage}));
    setBusy(true);
    setError(null);
    try {
      await api('/api/clients/' + slug + '/months/' + month, {method: 'PUT', json: {stage}});
      setDirty(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const moveItem = (id: string, dir: -1 | 1) => {
    patch((prev) => ({
      ...prev,
      items: prev.items.map((it) => {
        if (it.id !== id) return it;
        const idx = STATUS_ORDER.indexOf(it.status);
        const next = STATUS_ORDER[Math.min(Math.max(idx + dir, 0), STATUS_ORDER.length - 1)];
        return {...it, status: next};
      }),
    }));
  };

  const deleteItem = (id: string) => {
    patch((prev) => ({...prev, items: prev.items.filter((it) => it.id !== id)}));
  };

  const addItem = (item: Deliverable) => {
    patch((prev) => ({...prev, items: [...prev.items, item]}));
  };

  const uploadedCount = form.items.filter((it) => it.status === 'uploaded').length;
  const total = packageInfo?.monthly_reels ?? form.items.length;

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: 18}}>
      <div className="row" style={{justifyContent: 'space-between'}}>
        <div className="tabs" style={{border: 'none', marginBottom: 0}}>
          {stages.map((s) => (
            <button key={s.id} className={form.stage === s.id ? 'active' : ''} onClick={() => setStage(s.id as 1 | 2 | 3 | 4)}>
              {s.id}. {s.name}
            </button>
          ))}
        </div>
        <span className="badge info">
          업로드 {uploadedCount}/{total}
        </span>
      </div>

      <div className="grid" style={{gridTemplateColumns: 'repeat(5, 1fr)', gap: 10}}>
        {STATUS_ORDER.map((status) => (
          <div key={status} style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            <div className="muted" style={{fontSize: 12, fontWeight: 700}}>
              {STATUS_LABEL[status]}
            </div>
            {form.items
              .filter((it) => it.status === status)
              .map((it) => (
                <DeliverableCard key={it.id} item={it} onMove={(dir) => moveItem(it.id, dir)} onDelete={() => deleteItem(it.id)} />
              ))}
            {status === 'planned' ? <NewDeliverableForm onAdd={addItem} /> : null}
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{marginTop: 0}}>월간 리포트</h3>
        <div className="row" style={{alignItems: 'center'}}>
          <input
            type="checkbox"
            id="report-done"
            checked={form.report.done}
            onChange={(e) => patch((prev) => ({...prev, report: {...prev.report, done: e.target.checked}}))}
          />
          <label htmlFor="report-done" style={{fontSize: 13}}>
            완료
          </label>
        </div>
        <label className="lbl" style={{marginTop: 10}}>
          리포트 메모
        </label>
        <textarea
          className="field"
          rows={2}
          value={form.report.notes}
          onChange={(e) => patch((prev) => ({...prev, report: {...prev.report, notes: e.target.value}}))}
        />
        <label className="lbl" style={{marginTop: 10}}>
          메모
        </label>
        <textarea className="field" rows={2} value={form.memo} onChange={(e) => patch((prev) => ({...prev, memo: e.target.value}))} />
      </div>

      <div className="row">
        <button className="btn primary" disabled={busy} onClick={save}>
          저장
        </button>
        {dirty ? <span className="badge warn">저장 안 됨</span> : null}
        {error ? <span className="badge danger">{error}</span> : null}
      </div>
    </div>
  );
}
