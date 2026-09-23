'use client';

import Link from 'next/link';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Player} from '@remotion/player';
import {ReactFlow, Background, Controls, MiniMap, Position, applyNodeChanges, type Node, type Connection} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {Studio, studioDimensions, studioFrames, type StudioClip} from '@composition/Studio';
import {StudioModal} from './StudioModal';
import type {Shot, StudioAsset, StudioProject, StudioQuote} from '@/lib/studioTypes';

const stages = ['브리프', '기획', '소재', '테이크', '편집', '검수·내보내기'];
const media = (path: string) => `/api/media?path=${encodeURIComponent(path)}`;
type Change = (payload: Record<string, unknown>) => Promise<void>;

function Media({asset, controls = false}: {asset?: StudioAsset; controls?: boolean}) {
  if (!asset) return <div className="studio-placeholder">테이크를 기다리는 중</div>;
  if (asset.kind === 'image') return <img src={media(asset.path)} alt={asset.name} loading="lazy" />;
  if (asset.kind === 'audio') return <audio controls src={media(asset.path)} />;
  return <video controls={controls} muted={!controls} preload="metadata" src={media(asset.path)} />;
}

function Canvas({project, selected, select, change, disabled}: {project: StudioProject; selected: string; select: (id: string) => void; change: Change; disabled: boolean}) {
  const derived = useMemo<Node[]>(() => [
    ...project.assets.filter(a => a.kind === 'image').map((a, i) => ({id: `asset-${a.id}`, type: 'input', position: project.layout[`asset-${a.id}`] || {x: 30, y: i * 210}, sourcePosition: Position.Right, data: {label: <div className="studio-node"><Media asset={a} /><small>참조 이미지</small><strong>{a.name}</strong></div>}})),
    ...project.shots.map((s, i) => ({id: `shot-${s.id}`, position: project.layout[`shot-${s.id}`] || {x: 380 + Math.floor(i / 3) * 280, y: (i % 3) * 245}, selected: s.id === selected, targetPosition: Position.Left, sourcePosition: Position.Right, data: {label: <div className="studio-node"><Media asset={project.assets.find(a => a.id === s.takes.find(t => t.id === s.selectedTakeId)?.assetId)} /><small>SHOT {String(i+1).padStart(2, '0')} · {s.duration}초</small><strong>{s.title}</strong><span>{s.takes.length} takes {s.selectedTakeId ? '· 선택됨' : '· 미선택'}</span></div>}})),
  ], [project, selected]);
  const [nodes, setNodes] = useState(derived);
  useEffect(() => setNodes(derived), [derived]);
  const edges = project.shots.flatMap(s => s.refs.map(id => ({id: `${id}-${s.id}`, source: `asset-${id}`, target: `shot-${s.id}`, animated: false, style: {stroke: '#cbf279', strokeWidth: 2}})));
  function connect(c: Connection) {
    if (disabled || !c.source?.startsWith('asset-') || !c.target?.startsWith('shot-')) return;
    const s = project.shots.find(s => s.id === c.target?.slice(5));
    if (s && !s.refs.includes(c.source.slice(6))) void change({op: 'shot', shotId: s.id, refs: [...s.refs, c.source.slice(6)]});
  }
  return <div className="studio-canvas"><ReactFlow nodes={nodes} edges={edges} onNodesChange={changes => setNodes(n => applyNodeChanges(changes, n))} onNodeClick={(_, n) => {if (n.id.startsWith('shot-')) select(n.id.slice(5));}} onNodeDragStop={(_, node) => {if (!disabled) void change({op: 'layout', layout: {...project.layout, [node.id]: node.position}});}} onConnect={connect} nodesDraggable={!disabled} nodesConnectable={!disabled} edgesReconnectable={false} deleteKeyCode={null} fitView minZoom={.15} maxZoom={2} colorMode="dark"><Background gap={24} color="#343b40" /><Controls showInteractive={false} /><MiniMap nodeColor="#708451" maskColor="#111315bb" /></ReactFlow><span className="studio-canvas-hint">이미지의 연결점을 컷에 연결해 참조를 추가하세요.</span></div>;
}

function ShotEditor({shot, project, save, dirty, busy, generate}: {shot: Shot; project: StudioProject; save: Change; dirty: (value: boolean) => void; busy: boolean; generate: (kind: string) => void}) {
  const [draft, setDraft] = useState(shot);
  const [changed, setChanged] = useState(false);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  useEffect(() => {if (!changed) setDraft(shot);}, [shot, changed]);
  function field(key: string, value: unknown) {if (busy) return; if (baseRevision === null) setBaseRevision(project.revision); setDraft(s => ({...s, [key]: value})); setChanged(true); dirty(true);}
  async function commit() {
    await save({op: 'shot', revision: baseRevision ?? project.revision, shotId: shot.id, title: draft.title, prompt: draft.prompt, caption: draft.caption, camera: draft.camera, style: draft.style, duration: draft.duration, trimStart: draft.trimStart, refs: draft.refs});
    setChanged(false); setBaseRevision(null); dirty(false);
  }
  return <aside className="studio-inspector"><div className="studio-row"><h3>컷 설정</h3><span className="studio-tag">{shot.takes.length} takes</span></div>
    <label>컷 이름<input disabled={busy} value={draft.title} onChange={e => field('title', e.target.value)} maxLength={1000} /></label>
    <label>프롬프트<textarea rows={5} disabled={busy} value={draft.prompt} onChange={e => field('prompt', e.target.value)} placeholder="주인공, 행동, 배경과 분위기를 설명하세요." maxLength={6000} /></label>
    <div className="studio-pair"><label>카메라<input disabled={busy} value={draft.camera} onChange={e => field('camera', e.target.value)} placeholder="예: 느린 돌리 인" /></label><label>스타일<input disabled={busy} value={draft.style} onChange={e => field('style', e.target.value)} placeholder="예: 시네마틱" /></label></div>
    <label>참조 이미지 <small>이미지 생성 최대 8개 · 현재 영상 모델 1개</small><select aria-label="참조 이미지 추가" disabled={busy} value="" onChange={e => {if (e.target.value) field('refs', [...draft.refs, e.target.value]);}}><option value="">이미지 연결…</option>{project.assets.filter(a => a.kind === 'image' && !draft.refs.includes(a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <div className="studio-chips">{draft.refs.map(id => <button key={id} onClick={() => field('refs', draft.refs.filter(i => i !== id))}>{project.assets.find(a => a.id === id)?.name} ×</button>)}</div>
    <div className="studio-pair"><label>컷 길이(초)<input type="number" min={.2} max={60} step={.1} disabled={busy} value={draft.duration} onChange={e => field('duration', Number(e.target.value))} /></label><label>원본 시작(초)<input type="number" min={0} step={.1} disabled={busy} value={draft.trimStart} onChange={e => field('trimStart', Number(e.target.value))} /></label></div>
    <label>자막<textarea rows={2} disabled={busy} value={draft.caption} maxLength={1000} onChange={e => field('caption', e.target.value)} /></label>
    <button className={changed ? 'studio-primary' : ''} disabled={busy || !changed} onClick={() => void commit().catch(() => {})}>{changed ? '컷 변경 저장' : '저장됨'}</button>{changed && <button disabled={busy} onClick={() => {setDraft(shot); setChanged(false); setBaseRevision(null); dirty(false);}}>변경 취소 · 최신 내용 불러오기</button>}
    <div className="studio-divider" /><h3>새 테이크 만들기</h3><div className="studio-pair"><button disabled={busy || changed} onClick={() => generate('image')}>이미지 생성</button><button className="studio-primary" disabled={busy || changed} onClick={() => generate('video')}>영상 생성 ↗</button></div>
    <p className="studio-muted">생성 전 모델과 비용을 확인합니다. 결과는 새 테이크로 추가됩니다.</p>
    <label>기존 소재를 테이크로 추가<select value="" disabled={busy || changed} onChange={e => {if (e.target.value) void save({op: 'attachTake', shotId: shot.id, assetId: e.target.value}).catch(() => {});}}><option value="">소재 선택…</option>{project.assets.filter(a => a.kind !== 'audio').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
  </aside>;
}

function Brief({project, save, busy, dirty}: {project: StudioProject; save: Change; busy: boolean; dirty: (v: boolean) => void}) {
  const [title, setTitle] = useState(project.title);
  const [brief, setBrief] = useState(project.brief);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  useEffect(() => {if (baseRevision === null) {setTitle(project.title); setBrief(project.brief);}}, [project.title, project.brief, baseRevision]);
  return <section className="studio-brief"><div className="studio-eyebrow">START WITH A STORY</div><h2>어떤 장면을 만들까요?</h2><p>목적, 대상, 핵심 메시지를 정리하고 컷별 프롬프트로 이어 가세요.</p><label>프로젝트 이름<input disabled={busy} value={title} maxLength={120} onChange={e => {if (baseRevision === null) setBaseRevision(project.revision); setTitle(e.target.value); dirty(true);}} /></label><label>제작 브리프<textarea disabled={busy} rows={10} value={brief} maxLength={6000} onChange={e => {if (baseRevision === null) setBaseRevision(project.revision); setBrief(e.target.value); dirty(true);}} placeholder="누구를 위한 영상인가요? 어떤 감정과 메시지를 남길까요?" /></label><button className="studio-primary" disabled={busy} onClick={() => void save({op: 'project', revision: baseRevision ?? project.revision, title, brief}).then(() => {setBaseRevision(null); dirty(false);}).catch(() => {})}>브리프 저장</button>{baseRevision !== null && <button disabled={busy} onClick={() => {setBaseRevision(null); dirty(false);}}>변경 취소 · 최신 내용 불러오기</button>}</section>;
}

function Narration({project, save, busy, generate, dirty}: {project: StudioProject; save: Change; busy: boolean; generate: () => void; dirty: (value: boolean) => void}) {
  const [text, setText] = useState(project.narrationText || '');
  const changed = text !== (project.narrationText || '');
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  useEffect(() => {if (baseRevision === null) setText(project.narrationText || '');}, [project.narrationText, baseRevision]);
  function edit(value: string) {setText(value); const changed = value !== (project.narrationText || ''); setBaseRevision(changed ? baseRevision ?? project.revision : null); dirty(changed);}
  return <section className="studio-narration"><label>나레이션 대본<textarea disabled={busy} rows={3} value={text} maxLength={6000} onChange={e => edit(e.target.value)} placeholder="영상과 함께 읽을 대본을 입력하세요." /></label><div className="studio-actions"><button disabled={busy} onClick={() => edit(project.shots.map(s => s.caption).filter(Boolean).join('\n'))}>자막에서 대본 가져오기</button><button disabled={busy || !changed} onClick={() => void save({op: 'project', revision: baseRevision ?? project.revision, narrationText: text}).then(() => {setBaseRevision(null); dirty(false);}).catch(() => {})}>대본 저장</button>{changed && <button disabled={busy} onClick={() => edit(project.narrationText || '')}>변경 취소</button>}<button className="studio-primary" disabled={busy || changed || !text.trim()} onClick={generate}>나레이션 생성</button></div><small>Qwen 로컬 음성 · 한국어 Sohee. 생성 후 전체 오디오에서 선택하세요. 대본을 바꾸면 새 음성을 생성하고 길이를 확인하세요.</small></section>;
}

export function StudioWorkspace({id}: {id: string}) {
  const [project, setProject] = useState<StudioProject | null>(null);
  const [selected, setSelected] = useState('');
  const [view, setView] = useState<'canvas' | 'board'>('canvas');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shotDirty, setDirty] = useState(false);
  const [narrationDirty, setNarrationDirty] = useState(false);
  const dirty = shotDirty || narrationDirty;
  const [quote, setQuote] = useState<(StudioQuote & {key: string; revision: number}) | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const latest = useRef<StudioProject | null>(null);
  const pending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const accept = useCallback((p: StudioProject) => {if (!latest.current || p.revision > latest.current.revision) {latest.current = p; setProject(p);}}, []);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/studio/${id}`, {cache: 'no-store'});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    accept(value);
  }, [id, accept]);
  useEffect(() => {void refresh().catch(e => setError(e.message)); const timer = setInterval(() => {if (!pending.current) void refresh().catch(e => setError(e.message));}, 5000); return () => clearInterval(timer);}, [refresh]);
  useEffect(() => {const listener = (e: BeforeUnloadEvent) => {if (dirty) e.preventDefault();}; window.addEventListener('beforeunload', listener); return () => window.removeEventListener('beforeunload', listener);}, [dirty]);
  async function request(payload: Record<string, unknown>, method = 'PATCH') {
    if (pending.current) throw new Error('처리 중입니다.');
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/studio/${id}`, {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: latest.current?.revision, ...payload})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if ('revision' in result) accept(result);
      return result;
    } catch (e) {setError(e instanceof Error ? e.message : '요청 실패'); throw e;} finally {pending.current = false; setBusy(false);}
  }
  const change: Change = async p => {await request(p);};
  const safeChange: Change = async p => {try {await change(p);} catch { /* Error is visible in the workspace. */ }};
  function choose(id: string) {if (dirty) {setError('변경한 내용을 먼저 저장하세요.'); return;} setSelected(id); setCompare([]);}
  function step(index: number) {if (dirty) {setError('변경한 내용을 먼저 저장하세요.'); return;} void safeChange({op: 'project', stage: index});}
  async function getQuote(kind: string) {
    if (dirty) {setError('변경한 내용을 먼저 저장하세요.'); return;}
    try {const q = await request({op: 'quote', kind, shotId: shot?.id}, 'POST'); setQuote({...q, key: crypto.randomUUID(), revision: latest.current!.revision});} catch { /* visible */ }
  }
  async function upload(file?: File) {
    if (!file || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const form = new FormData(); form.set('file', file); form.set('revision', String(latest.current?.revision));
      const response = await fetch(`/api/studio/${id}/assets`, {method: 'POST', body: form});
      const result = await response.json(); if (!response.ok) throw new Error(result.error); accept(result);
    } catch (e) {setError(e instanceof Error ? e.message : '업로드 실패');} finally {pending.current = false; setBusy(false); if (input.current) input.current.value = '';}
  }
  if (!project) return <div className="take-studio studio-empty">{error || '스튜디오를 여는 중…'}{error && <button onClick={() => void refresh().catch(e => setError(e.message))}>다시 시도</button>}</div>;
  const shot = project.shots.find(s => s.id === selected) || project.shots[0];
  const asset = (id?: string) => project.assets.find(a => a.id === id);
  const clips: StudioClip[] = project.shots.flatMap(s => {const a = asset(s.takes.find(t => t.id === s.selectedTakeId)?.assetId); return a && a.kind !== 'audio' ? [{path: a.path, kind: a.kind, duration: s.duration, trimStart: s.trimStart, caption: s.caption}] : [];});
  const running = project.runs.some(r => ['queued', 'running', 'unknown'].includes(r.status));
  const selectedTake = shot?.takes.find(t => t.id === shot.selectedTakeId);
  return <div className="take-studio studio-workspace" aria-busy={busy}>
    <header className="studio-header"><div><Link href="/studio">◈ TAKE STUDIO</Link><span className="studio-separator">/</span><strong>{project.title}</strong><span className="studio-tag">{project.ratio}</span></div><div className="studio-actions"><span className="studio-muted" aria-live="polite">{busy ? '처리 중…' : dirty ? '저장하지 않은 변경' : '저장됨'}</span><button onClick={() => step(4)}>미리보기</button><button className="studio-primary" onClick={() => step(5)}>내보내기 ↗</button></div></header>
    <nav className="studio-steps" aria-label="제작 단계">{stages.map((label, i) => <button key={label} className={project.stage === i ? 'active' : ''} disabled={busy} onClick={() => step(i)}><span>{i+1}</span>{label}</button>)}</nav>
    {error && <div className="studio-error" role="alert">{error}<button onClick={() => setError('')} aria-label="오류 메시지 닫기">×</button></div>}
    <div className="studio-workarea">
      <aside className="studio-library"><div className="studio-row"><h3>프로젝트</h3><span>{project.shots.length}컷</span></div><button disabled={busy || dirty} onClick={() => void safeChange({op: 'addShot'})}>＋ 컷 추가</button>
        <div className="studio-shot-list">{project.shots.map((s, i) => <button key={s.id} className={s.id === shot?.id ? 'active' : ''} onClick={() => choose(s.id)}><span>{String(i+1).padStart(2, '0')}</span><div><strong>{s.title}</strong><small>{s.duration}초 · {s.takes.length} takes</small></div><span className={s.selectedTakeId ? 'studio-dot filled' : 'studio-dot'} /></button>)}</div>
        <div className="studio-divider" /><div className="studio-row"><h3>소재함</h3><span>{project.assets.length}</span></div><button disabled={busy} onClick={() => input.current?.click()}>＋ 이미지·영상·오디오</button><input ref={input} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.wav,.mp3,.m4a" onChange={e => void upload(e.target.files?.[0])} /><small className="studio-muted">업로드 최대 100MB</small><div className="studio-assets">{project.assets.map(a => <div key={a.id}><Media asset={a} /><span title={a.name}>{a.name}</span></div>)}</div>
        {project.source && <p className="studio-muted">가져온 회차<br/>{project.source.date} {project.source.track}-{project.source.num}<br/>원본과 별도 저장</p>}
      </aside>
      <main className="studio-center">
        {project.stage === 0 ? <Brief key={project.id} project={project} save={change} busy={busy} dirty={setDirty} /> : project.stage >= 4 ? <div className="studio-edit"><div className="studio-preview">{clips.length ? <Player component={Studio} inputProps={{clips, audio: asset(project.audioId || '')?.path || null, ratio: project.ratio, preview: true}} durationInFrames={studioFrames(clips)} fps={30} compositionWidth={studioDimensions(project.ratio).width} compositionHeight={studioDimensions(project.ratio).height} controls style={{height: '100%', maxWidth: '100%', aspectRatio: project.ratio.replace(':', '/')}} /> : <div className="studio-empty">각 컷에서 사용할 테이크를 선택하세요.</div>}</div>
          <div className="studio-timeline">{project.shots.map((s, i) => <button className={s.id === shot?.id ? 'active' : ''} key={s.id} onClick={() => choose(s.id)}><span>{i+1} · {s.title}</span><strong>{s.duration}초</strong><small>{s.selectedTakeId ? '선택됨' : '미선택'}</small></button>)}</div>
          <div className="studio-edit-options"><label>화면 비율<select value={project.ratio} disabled={busy} onChange={e => void safeChange({op: 'project', ratio: e.target.value})}><option>9:16</option><option>16:9</option><option>1:1</option></select></label><label>전체 오디오<select value={project.audioId || ''} disabled={busy} onChange={e => void safeChange({op: 'audio', assetId: e.target.value})}><option value="">원본 영상 소리 사용</option>{project.assets.filter(a => a.kind === 'audio').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><Link href="/voices">음성 스튜디오 ↗</Link></div>
          <Narration project={project} dirty={setNarrationDirty} save={change} busy={busy || running} generate={() => void getQuote('voice')} />
          {project.audioNeedsReview && <div className="studio-review">대본이 변경되었습니다. 새 음성을 생성하거나 현재 음성을 다시 확인하세요.<button disabled={busy || dirty} onClick={() => void safeChange({op: 'audio', assetId: project.audioId})}>현재 음성 검수 완료</button></div>}
          {project.stage === 5 && <section className="studio-export"><h3>선택한 테이크로 완성하기</h3><p>{clips.length}/{project.shots.length}컷 선택 · 총 {project.shots.reduce((n, s) => n+s.duration, 0).toFixed(1)}초 · {project.ratio}</p><button className="studio-primary" disabled={busy || running || dirty} onClick={() => void getQuote('export')}>검수 후 MP4 출력</button><div className="studio-export-list">{project.exports.slice().reverse().map(e => <div key={e.id}><span>{e.createdAt.replace('T', ' ').slice(0, 19)}</span><a href={media(asset(e.assetId)!.path)} download={`${project.title}.mp4`}>MP4 다운로드 ↓</a><button disabled={busy} onClick={() => void safeChange({op: 'archive', exportId: e.id, enabled: !e.archive})}>{e.archive ? '아카이브 포함됨 ✓' : '아카이브에 포함'}</button></div>)}</div><small className="studio-muted">아카이브 포함을 선택한 출력본만 다음 아카이브 업로드에 반영됩니다.</small></section>}
        </div> : <><div className="studio-toolbar"><div><button className={view === 'canvas' ? 'active' : ''} onClick={() => setView('canvas')}>캔버스</button><button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>스토리보드</button></div><div><span className="studio-muted">{project.planApproved ? '기획 승인됨 ✓' : '기획 검토 필요'}</span><button disabled={busy || dirty || project.planApproved} onClick={() => void safeChange({op: 'approvePlan'})}>기획 승인</button></div></div>
          {view === 'canvas' ? <Canvas project={project} selected={shot?.id || ''} select={choose} change={safeChange} disabled={busy || dirty} /> : <div className="studio-board">{project.shots.map((s, i) => <button key={s.id} className={s.id === shot?.id ? 'active' : ''} onClick={() => choose(s.id)}><Media asset={asset(s.takes.find(t => t.id === s.selectedTakeId)?.assetId)} /><div><small>SHOT {i+1} · {s.duration}초</small><h3>{s.title}</h3><p>{s.prompt || '프롬프트를 입력하세요.'}</p></div></button>)}</div>}</>}
        {shot && project.stage !== 0 && <section className="studio-takes"><div className="studio-row"><div><strong>{shot.title}</strong> <span className="studio-muted">테이크 {shot.takes.length}</span></div><div className="studio-actions"><button disabled={compare.length !== 2} onClick={() => setCompareOpen(true)}>2개 비교</button><button disabled={busy || dirty} onClick={() => void safeChange({op: 'move', shotId: shot.id, delta: -1})}>앞으로</button><button disabled={busy || dirty} onClick={() => void safeChange({op: 'move', shotId: shot.id, delta: 1})}>뒤로</button></div></div><div className="studio-take-strip">{shot.takes.map((t, i) => <div className={`studio-take ${t.id === shot.selectedTakeId ? 'active' : ''}`} key={t.id}><Media asset={asset(t.assetId)} controls /><div className="studio-row"><label><input type="checkbox" checked={compare.includes(t.id)} onChange={e => setCompare(c => e.target.checked ? [...c.slice(-1), t.id] : c.filter(id => id !== t.id))} /> Take {i+1}</label><span>{t.stale ? '재검수 필요' : ''}</span></div><button disabled={busy || dirty || t.id === shot.selectedTakeId} onClick={() => void safeChange({op: 'select', shotId: shot.id, takeId: t.id})}>{t.id === shot.selectedTakeId ? '선택한 테이크 ✓' : '이 테이크 선택'}</button></div>)}</div>{!shot.takes.length && <p className="studio-muted">오른쪽에서 새 테이크를 생성하거나 업로드한 소재를 추가하세요.</p>}{selectedTake?.stale && <div className="studio-review">입력이 변경되었습니다. 선택한 테이크를 확인해 주세요.<button disabled={busy || dirty} onClick={() => void safeChange({op: 'reviewTake', shotId: shot.id})}>확인한 테이크 계속 사용</button></div>}</section>}
      </main>
      {shot && project.stage !== 0 && <ShotEditor key={shot.id} shot={shot} project={project} save={change} dirty={setDirty} busy={busy || running} generate={kind => void getQuote(kind)} />}
    </div>
    {project.runs.length > 0 && <footer className="studio-runs"><Link href="/jobs">작업 로그 ↗</Link>{project.runs.slice(-3).reverse().map(r => <div key={r.id}><span className={`studio-status ${r.status}`}>{r.status}</span><strong>{r.kind === 'image' ? '이미지' : r.kind === 'video' ? '영상' : r.kind === 'voice' ? '음성' : '출력'}</strong><span>{r.message}</span>{['queued', 'unknown'].includes(r.status) && <><button disabled={busy} onClick={() => void request({op: 'resume', runId: r.id}, 'POST').catch(() => {})}>상태 확인·이어가기</button><button disabled={busy} onClick={() => {if (window.confirm('외부 서비스의 실행·과금 내역을 확인했나요? 이 작업을 종료 처리합니다. 외부 요청을 취소하거나 환불하지 않습니다.')) void request({op: 'resolveRun', runId: r.id, confirmed: true}, 'POST').catch(() => {});}}>확인 후 종료</button></>}</div>)}</footer>}
    {quote && <StudioModal onClose={() => {if (!busy) setQuote(null);}}><section className="studio-modal" role="dialog" aria-modal="true" aria-labelledby="studio-confirm-title"><h2 id="studio-confirm-title">{quote.kind === 'export' ? '선택한 컷을 출력할까요?' : quote.kind === 'voice' ? '나레이션을 생성할까요?' : '새 테이크를 만들까요?'}</h2><p>{quote.kind === 'export' ? '현재 선택한 테이크·자막·오디오로 새 MP4를 만듭니다.' : quote.kind === 'voice' ? '저장한 나레이션 대본으로 새 음성 파일을 만듭니다.' : `${shot?.title} · 새 결과 1개`}</p><dl><dt>실행 엔진</dt><dd>{quote.provider}</dd><dt>설정 기준 예상 비용</dt><dd>{quote.estimatedUsd === null ? '미확인 · 이용 플랜/서비스 내역 확인 필요' : quote.estimatedUsd === 0 ? '로컬 실행 · 외부 생성 요금 없음' : `약 $${quote.estimatedUsd.toFixed(2)} (실제 청구액과 다를 수 있음)`}</dd></dl>{error && <p role="alert" className="studio-error">{error}</p>}{quote.kind === 'video' && <p>연결한 시작 이미지와 프롬프트를 fal.ai로 전송합니다.</p>}<div className="studio-actions"><button disabled={busy} onClick={() => setQuote(null)}>돌아가기</button><button autoFocus className="studio-primary" disabled={busy} onClick={() => void request({op: 'run', ...quote, idempotencyKey: quote.key, confirmed: true}, 'POST').then(() => setQuote(null)).catch(() => {})}>{busy ? '시작 중…' : '확인하고 실행'}</button></div></section></StudioModal>}
    {compareOpen && <StudioModal onClose={() => {if (!busy) setCompareOpen(false);}}><section className="studio-modal studio-compare" role="dialog" aria-modal="true" aria-label="테이크 비교"><div className="studio-row"><h2>테이크 비교</h2><button autoFocus onClick={() => setCompareOpen(false)}>닫기 ×</button></div><div className="studio-pair">{compare.map(id => {const t = shot?.takes.find(t => t.id === id); return t ? <div key={id}><Media asset={asset(t.assetId)} controls /><p>{t.stale ? '변경된 입력 · 재검수 필요' : '현재 입력의 테이크'}</p><button className="studio-primary" disabled={busy || dirty} onClick={() => void change({op: 'select', shotId: shot.id, takeId: id}).then(() => setCompareOpen(false)).catch(() => {})}>이 테이크 선택</button></div> : null;})}</div></section></StudioModal>}
  </div>;
}
