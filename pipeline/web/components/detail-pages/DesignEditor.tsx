'use client';

import {useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent} from 'react';
import Link from 'next/link';

import {BeautyPreview} from '@/components/detail-pages/BeautyPreview';
import {DESIGN_FONTS, type DetailDesign} from '@/lib/detailDesignTypes';
import type {DetailProject} from '@/lib/detailTypes';

import './editor.css';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clone = (value: DetailDesign) => JSON.parse(JSON.stringify(value)) as DetailDesign;

function ColorControl({label, value, onChange}: {label: string; value: string; onChange: (color: string) => void}) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return <div className="design-color-control"><label>{label}<input aria-label={label} type="color" value={value} onInput={e => onChange(e.currentTarget.value)} onChange={e => onChange(e.target.value)} /></label><input aria-label={`${label} HEX`} type="text" maxLength={7} value={hex} spellCheck={false} onChange={e => { const v=e.target.value; setHex(v); if(/^#[a-fA-F0-9]{6}$/.test(v)) onChange(v); }} onBlur={() => setHex(value)} /></div>;
}

export function DesignEditor({project, initialDesign}: {project: DetailProject; initialDesign: DetailDesign}) {
  const [draft, setDraft] = useState(() => clone(initialDesign));
  const [saved, setSaved] = useState(() => clone(initialDesign));
  const [open, setOpen] = useState(false);
  const [textId, setTextId] = useState<string | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [textKeys, setTextKeys] = useState<string[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{id: string; x: number; y: number; startX: number; startY: number; width: number; height: number; scale: number} | null>(null);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    addEventListener('beforeunload', warn); return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => { if (!open) return; const nodes = Array.from(canvas.current?.querySelectorAll<HTMLElement>('[data-design-text]') ?? []); const found: Record<string, string> = {}; nodes.forEach((node) => { const id = node.dataset.designText; if (id) found[id] = node.dataset.designOriginal ?? node.textContent ?? ''; }); setOriginals(found); setTextKeys(Object.keys(found)); }, [open]);
  useEffect(() => { canvas.current?.querySelectorAll<HTMLElement>('[data-design-text]').forEach((node) => { node.dataset.designSelected = node.dataset.designText === textId ? 'true' : ''; }); }, [textId, draft]);

  function changeText(id: string, value: string) { setDraft((current) => ({...current, texts: {...current.texts, [id]: value}})); }
  function changeTextStyle(id: string, patch: Partial<NonNullable<DetailDesign['textStyles']>[string]>) { setDraft((current) => ({...current, textStyles: {...current.textStyles, [id]: {...current.textStyles?.[id], ...patch}}})); }
  function changeImage(id: string, patch: Partial<DetailDesign['images'][string]>) { setDraft((current) => ({...current, images: {...current.images, [id]: {...(current.images[id] ?? {x: 0, y: 0, scale: 1}), ...patch}}})); }
  function select(event: ReactPointerEvent<HTMLDivElement>) {
    if (!open || pending || (event.target as HTMLElement).closest('[data-admin-ui]')) return;
    const target = event.target as HTMLElement;
    const text = target.closest<HTMLElement>('[data-design-text]');
    if (text) { setTextId(text.dataset.designText ?? null); setImageId(null); }
    else { const image = target.closest<HTMLElement>('[data-design-image]'); if (image) { setImageId(image.dataset.designImage ?? null); setTextId(null); } }
  }
  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!open || pending || (event.target as HTMLElement).closest('[data-design-text]')) return;
    const image = (event.target as HTMLElement).closest<HTMLElement>('[data-design-image]');
    const id = image?.dataset.designImage;
    if (!id) return;
    const value = draft.images[id] ?? {x: 0, y: 0, scale: 1};
    const img = image.querySelector('img'); const rect = img?.getBoundingClientRect();
    if (!rect) return;
    drag.current = {id, x: value.x, y: value.y, startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height, scale: value.scale};
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const item = drag.current;
    changeImage(item.id, {x: clamp(item.x + ((event.clientX - item.startX) / item.width) * 100 * item.scale, -50, 50), y: clamp(item.y + ((event.clientY - item.startY) / item.height) * 100 * item.scale, -50, 50)});
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>) { if (drag.current) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }
  async function save() {
    if (!dirty || pending) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/detail-pages/${project.id}/design`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(draft)});
      const result = await response.json() as DetailDesign | {error?: string};
      if (response.status === 401) { setMessage('로그인 후 저장할 수 있습니다.'); return; }
      if (response.status === 409) { setMessage('다른 변경이 먼저 저장되었습니다. 현재 편집 내용은 유지됩니다.'); return; }
      if (!response.ok || !('revision' in result)) { setMessage(('error' in result && result.error) || '저장하지 못했습니다.'); return; }
      setDraft(result); setSaved(clone(result)); setMessage('저장했습니다.');
    } catch { setMessage('저장 요청 중 오류가 발생했습니다.'); } finally { setPending(false); }
  }
  function downloadDraft() { const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], {type: 'application/json'})); const link = document.createElement('a'); link.href = url; link.download = 'detail-design-draft.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function guardNavigation(event: ReactMouseEvent<HTMLDivElement>) { const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a'); if (dirty && anchor && anchor.target !== '_blank' && !anchor.getAttribute('href')?.startsWith('#')) { event.preventDefault(); setOpen(true); setMessage('먼저 저장하거나 되돌려 주세요.'); } }
  const image = imageId ? draft.images[imageId] ?? {x: 0, y: 0, scale: 1} : null;
  return <div className={`design-editor ${open ? 'editing' : ''}`} onClickCapture={guardNavigation}>
    <div className="design-editor-top" data-admin-ui=""><Link href={`/detail-pages/${project.id}`}>← 의뢰서</Link><span>{dirty ? '저장 안됨' : '저장됨'}</span><a href={`/detail-pages/${project.id}/preview?output=1`} target="_blank" rel="noopener noreferrer">출력 화면 (마지막 저장본)</a><button className="btn" onClick={() => setOpen((value) => !value)}>설정</button></div>
    <div ref={canvas} className="design-editor-canvas" data-selected-text={textId ?? ''} onPointerDown={select} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDownCapture={startDrag}>
      <BeautyPreview project={project} design={draft} admin />
    </div>
    {open ? <aside className="design-drawer" data-admin-ui=""><div className="design-drawer-head"><strong>디자인 설정</strong><button className="btn sm" onClick={() => setOpen(false)}>닫기</button></div><fieldset disabled={pending}>
      <label>전체 폰트<select value={draft.font} onChange={(e) => setDraft((v) => ({...v, font: e.target.value as DetailDesign['font']}))}>{(['sans', 'serif', 'mono'] as const).map((font) => <option key={font} value={font}>{({sans: '고딕', serif: '명조', mono: '고정폭'} as const)[font]}</option>)}</select></label>
      <label>제목 폰트<select value={draft.headingFont} onChange={(e) => setDraft((v) => ({...v, headingFont: e.target.value as DetailDesign['headingFont']}))}>{(['sans', 'serif', 'mono'] as const).map((font) => <option key={font} value={font}>{({sans: '고딕', serif: '명조', mono: '고정폭'} as const)[font]}</option>)}</select></label>
      <label>수정할 문구<select value={textId ?? ''} onChange={(e) => { setTextId(e.target.value || null); setImageId(null); }}><option value="">선택하세요</option>{textKeys.map((id) => <option key={id} value={id}>{originals[id]}</option>)}</select></label>
      <label>수정할 이미지<select value={imageId ?? ''} onChange={e => {setImageId(e.target.value || null); setTextId(null);}}><option value="">선택하세요</option>{Object.entries({hero:'제품 대표컷',texture:'제형 확대',cgi:'3D 레이어',ritual:'사용 장면',pack:'패키지'}).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <div className="design-colors">{(['background', 'text', 'accent', 'muted'] as const).map((key) => <ColorControl key={key} label={({background: '배경', text: '본문', accent: '강조', muted: '보조'} as const)[key]} value={draft.colors[key]} onChange={color => setDraft(v => ({...v, colors: {...v.colors, [key]: color}}))} />)}</div>
      {textId ? (
        <div className="design-text-controls">
          <label>문구 <textarea value={draft.texts[textId] ?? originals[textId] ?? ''} onChange={(e) => changeText(textId, e.target.value)} /></label>
          <button className="btn sm" onClick={() => setDraft((v) => { const texts = {...v.texts}; delete texts[textId]; return {...v, texts}; })}>원문 복원</button>
          <label>글꼴
            <select value={draft.textStyles?.[textId]?.font ?? ''} onChange={(e) => changeTextStyle(textId, {font: (e.target.value || undefined) as DetailDesign['font'] | undefined})}>
              <option value="">기본값</option>
              {(['sans', 'serif', 'mono'] as const).map((font) => <option key={font} value={font}>{({sans: '고딕', serif: '명조', mono: '고정폭'} as const)[font]}</option>)}
            </select>
          </label>
          <ColorControl key={textId} label="색상" value={draft.textStyles?.[textId]?.color ?? '#16332b'} onChange={color => changeTextStyle(textId, {color})} />
          <label>글자 크기 <input type="range" min="10" max="120" value={draft.textStyles?.[textId]?.size ?? 16} onChange={(e) => changeTextStyle(textId, {size: Number(e.target.value)})} /></label>
          <button className="btn sm" onClick={() => setDraft((v) => { const textStyles = {...v.textStyles}; delete textStyles[textId]; return {...v, textStyles}; })}>스타일 초기화</button>
        </div>
      ) : null}
      {imageId && image ? <div className="design-image-controls"><strong>이미지 위치</strong>{(['x', 'y', 'scale'] as const).map((key) => <label key={key}>{({x: '가로', y: '세로', scale: '확대'} as const)[key]}<input type="range" min={key === 'scale' ? 1 : -50} max={key === 'scale' ? 2.5 : 50} step={key === 'scale' ? .05 : 1} value={image[key]} onChange={(e) => changeImage(imageId, {[key]: Number(e.target.value)})} /><output>{image[key].toFixed(key === 'scale' ? 2 : 0)}</output></label>)}<button className="btn sm" onClick={() => changeImage(imageId, {x: 0, y: 0, scale: 1})}>초기화</button></div> : null}
    </fieldset><div className="design-save"><button className="btn" disabled={!dirty || pending} onClick={() => { setDraft(clone(saved)); setTextId(null); setImageId(null); }}>되돌리기</button><button className="btn primary" disabled={!dirty || pending} onClick={save}>{pending ? '저장 중…' : '저장'}</button></div>{message ? <p role={message === '저장했습니다.' ? 'status' : 'alert'}>{message}</p> : null}{message?.startsWith('로그인') ? <a href="/detail-admin" target="_blank" rel="noopener noreferrer">로그인 열기</a> : null}{message?.startsWith('다른 변경') ? <button className="btn sm" onClick={downloadDraft}>초안 JSON 다운로드</button> : null}</aside> : null}
  </div>;
}
