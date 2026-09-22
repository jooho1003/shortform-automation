'use client';

import {API_MAX_SLIDES} from '@composition/carousel/types';
import type {CarouselProject} from '@/lib/carousel';

import type {Lint} from './useCarouselDoc';

export function SaveBar({dirty, saving, error, onSave, count}: {dirty: boolean; saving: boolean; error: string | null; onSave: () => void; count: number}) {
  return (
    <div className="row" style={{justifyContent: 'space-between'}}>
      <div className="row">
        <span className={`badge ${count > API_MAX_SLIDES ? 'warn' : 'info'}`}>
          {count}장 · 1080×1350
        </span>
        {error ? <span className="badge danger">{error}</span> : null}
      </div>
      <button className="btn primary" disabled={!dirty || saving} onClick={onSave}>
        {saving ? '저장 중…' : dirty ? '저장' : '저장됨'}
      </button>
    </div>
  );
}

export function LintBox({lint, dirty}: {lint: Lint; dirty: boolean}) {
  return (
    <div className="card">
      <strong style={{fontSize: 13}}>게시 전 점검</strong> {dirty ? <span className="faint">(저장하면 갱신)</span> : null}
      {lint.length === 0 ? (
        <div className="badge ok" style={{marginTop: 8}}>
          문제 없음
        </div>
      ) : (
        <ul className="lint-list" style={{marginTop: 8}}>
          {lint.map((l, i) => (
            <li key={i}>
              <span className={`badge ${l.level === 'error' ? 'danger' : 'warn'}`}>{l.level === 'error' ? '막음' : '주의'}</span> {l.msg}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 제목·브랜드·광고 여부·캡션·해시태그 — 두 종류 공통. */
export function CarouselMeta<P extends CarouselProject>({doc, patch}: {doc: P; patch: (fn: (d: P) => P) => void}) {
  return (
    <div className="card carousel-form">
      <strong>게시 정보</strong>
      <div className="row">
        <label style={{flex: 1}}>
          제목
          <input className="field" value={doc.title} onChange={(e) => patch((d) => ({...d, title: e.target.value}))} />
        </label>
        <label style={{flex: 1}}>
          브랜드·계정명
          <input className="field" value={doc.brand_name} onChange={(e) => patch((d) => ({...d, brand_name: e.target.value}))} />
        </label>
      </div>
      <label style={{gridAutoFlow: 'column', justifyContent: 'start', alignItems: 'center', gap: 6}}>
        <input type="checkbox" checked={doc.sponsored} onChange={(e) => patch((d) => ({...d, sponsored: e.target.checked}))} />
        광고·협찬 (표지 &apos;광고&apos; 표기 자동 + 캡션 첫 줄 표기 필수)
      </label>
      <label>
        캡션 <span className="faint">{doc.caption.length} / 2,200</span>
        <textarea className="field" style={{minHeight: 110}} value={doc.caption} onChange={(e) => patch((d) => ({...d, caption: e.target.value}))} />
      </label>
      <label>
        해시태그 (쉼표 구분, 30개 이하)
        <input
          className="field"
          defaultValue={doc.hashtags.join(', ')}
          onBlur={(e) => {
            const tags = e.target.value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
            patch((d) => ({...d, hashtags: tags}));
          }}
        />
      </label>
    </div>
  );
}
