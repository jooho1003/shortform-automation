'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useState} from 'react';

import {api, fmtDate} from '@/lib/client';
import type {CarouselKind, CarouselProject, CarouselStatus} from '@/lib/carousel';

export const STATUS: Record<CarouselStatus, {label: string; cls: string}> = {
  draft: {label: '초안', cls: ''},
  scripted: {label: '원고 확정', cls: 'info'},
  illustrated: {label: '이미지 확정', cls: 'info'},
  rendered: {label: '출력 완료', cls: 'ok'},
  published: {label: '게시됨', cls: 'done'},
};

const COPY: Record<CarouselKind, {placeholder: string; hint: string}> = {
  cardnews: {
    placeholder: '주제 — 예: 여름철 자외선 차단제 고르는 법 5가지',
    hint: '주제 → 원고(표지·본문·CTA) → 배경 이미지 → 1080×1350 렌더 → 캡션·게시.',
  },
  instatoon: {
    placeholder: '한 줄 줄거리 — 예: 첫 출근날 엘리베이터에서 사장님을 만났다',
    hint: '캐릭터 락 블록·시트 → 콘티(장·패널·대사) → 컷 이미지(시트 참조) → 말풍선 합성 → 게시.',
  },
};

export function CarouselHome({kind, projects}: {kind: CarouselKind; projects: CarouselProject[]}) {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [brand, setBrand] = useState('');
  const [sponsored, setSponsored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const {project} = await api<{project: CarouselProject}>(`/api/carousel/${kind}`, {method: 'POST', json: {topic: topic.trim(), brand_name: brand.trim(), sponsored}});
      router.push(`/${kind}/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid" style={{gap: 18}}>
      <div className="card">
        <div className="row">
          <input className="field" style={{flex: 1}} placeholder={COPY[kind].placeholder} value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && topic.trim() && create()} />
          <input className="field" style={{width: 180}} placeholder="브랜드·계정명" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <label className="row" style={{gap: 6, fontSize: 13}}>
            <input type="checkbox" checked={sponsored} onChange={(e) => setSponsored(e.target.checked)} /> 광고·협찬
          </label>
          <button className="btn primary" disabled={busy || !topic.trim()} onClick={create}>
            새 프로젝트
          </button>
        </div>
        {error ? <div className="badge danger" style={{marginTop: 8}}>{error}</div> : null}
        <div className="faint" style={{marginTop: 6}}>{COPY[kind].hint}</div>
      </div>

      {projects.length === 0 ? (
        <div className="empty">프로젝트가 없습니다.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>제목</th>
              <th>상태</th>
              <th>장수</th>
              <th>브랜드</th>
              <th>수정</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/${kind}/${p.id}`}>{p.title}</Link> {p.sponsored ? <span className="badge warn">광고</span> : null}
                </td>
                <td>
                  <span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>
                </td>
                <td>{p.slides.length}</td>
                <td className="muted">{p.brand_name || '—'}</td>
                <td className="faint">{fmtDate(p.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
