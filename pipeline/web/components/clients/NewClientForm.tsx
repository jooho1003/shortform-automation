'use client';

import {useRouter} from 'next/navigation';
import {useRef, useState} from 'react';

import {api} from '@/lib/client';
import type {ClientPackage, ClientStatus, PackageCatalog} from '@/lib/clientTypes';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .split('')
    .filter((ch) => /[a-z0-9가-힣-]/.test(ch))
    .join('');
}

const STATUS_OPTIONS: {value: ClientStatus; label: string}[] = [
  {value: 'lead', label: '리드'},
  {value: 'contracted', label: '계약'},
  {value: 'active', label: '진행중'},
  {value: 'paused', label: '일시중지'},
  {value: 'ended', label: '종료'},
];

export function NewClientForm() {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<ClientStatus>('lead');
  const [catalog, setCatalog] = useState<PackageCatalog | null>(null);
  const [packageId, setPackageId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    ref.current?.showModal();
    if (!catalog) {
      try {
        const data = await api<PackageCatalog>('/api/packages');
        setCatalog(data);
      } catch {
        // 카탈로그 로드 실패는 무시 — 패키지 없이 생성 가능
      }
    }
  };

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const pkg: ClientPackage | null = catalog?.packages.find((p) => p.id === packageId) ?? null;
      const today = new Date().toISOString().slice(0, 10);
      await api('/api/clients', {
        method: 'POST',
        json: {
          slug,
          name,
          contact: {person, phone, email: '', kakao: ''},
          package: pkg,
          contract: {start: today, end: '', status, event_price_applied: false, notes: ''},
        },
      });
      ref.current?.close();
      router.push('/clients/' + slug);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn primary" onClick={open}>
        + 새 고객
      </button>
      <dialog className="modal" ref={ref}>
        <h3 style={{marginTop: 0}}>새 고객</h3>
        <div className="grid" style={{gridTemplateColumns: '1fr 1fr', gap: 10}}>
          <div>
            <label className="lbl">업체명</label>
            <input className="field" value={name} onChange={(e) => onNameChange(e.target.value)} />
          </div>
          <div>
            <label className="lbl">슬러그</label>
            <input
              className="field"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
          </div>
          <div>
            <label className="lbl">담당자</label>
            <input className="field" value={person} onChange={(e) => setPerson(e.target.value)} />
          </div>
          <div>
            <label className="lbl">연락처</label>
            <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="lbl">패키지</label>
            <select className="field" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">선택 안 함</option>
              {(catalog?.packages ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="lbl">상태</label>
            <select className="field" value={status} onChange={(e) => setStatus(e.target.value as ClientStatus)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error ? <div className="badge danger">{error}</div> : null}
        <div className="row" style={{justifyContent: 'flex-end', marginTop: 14}}>
          <button className="btn" onClick={() => ref.current?.close()}>
            취소
          </button>
          <button className="btn primary" disabled={busy || !name.trim() || !slug.trim()} onClick={submit}>
            만들기
          </button>
        </div>
      </dialog>
    </>
  );
}
