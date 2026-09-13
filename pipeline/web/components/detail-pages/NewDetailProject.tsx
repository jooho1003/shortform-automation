'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';

import type {DetailProject} from '@/lib/detailTypes';

export function NewDetailProject() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [product, setProduct] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!title.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/detail-pages', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title: title.trim(), client: client.trim(), product: product.trim()}),
      });
      const project = await response.json() as DetailProject | {error?: string};
      if (!response.ok || !('id' in project)) {
        setError(('error' in project && project.error) || '새 의뢰서를 만들지 못했습니다.');
        setPending(false);
        return;
      }
      router.push(`/detail-pages/${project.id}`);
    } catch {
      setError('요청 중 오류가 발생했습니다.');
      setPending(false);
    }
  }

  if (!open) return <button className="btn primary" onClick={() => setOpen(true)}>새 의뢰서</button>;
  return (
    <div className="card" style={{minWidth: 280}}>
      <label className="lbl" htmlFor="new-detail-title">프로젝트 이름</label>
      <input id="new-detail-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 봄 신제품 상세페이지" autoFocus disabled={pending} />
      <label className="lbl" htmlFor="new-detail-client" style={{marginTop: 8}}>고객</label>
      <input id="new-detail-client" className="field" value={client} onChange={(e) => setClient(e.target.value)} placeholder="선택 입력" disabled={pending} />
      <label className="lbl" htmlFor="new-detail-product" style={{marginTop: 8}}>제품</label>
      <input id="new-detail-product" className="field" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="선택 입력" disabled={pending} />
      {error ? <p className="badge danger" aria-live="polite">{error}</p> : null}
      <div className="row" style={{justifyContent: 'flex-end', marginTop: 10}}>
        <button className="btn" disabled={pending} onClick={() => setOpen(false)}>취소</button>
        <button className="btn primary" disabled={!title.trim() || pending} onClick={create}>{pending ? '만드는 중…' : '만들기'}</button>
      </div>
    </div>
  );
}
