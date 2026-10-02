'use client';

import {Fragment, useMemo, useState} from 'react';
import {useRouter} from 'next/navigation';

import {media} from '@/lib/client';
import {affectedCuts, chainGroups, coverageGaps, endFrameName, fixRequestNote, speechWindows, startFrameName, type FrameRef} from '@/lib/storyboard';
import type {PlanA, PlanCut, Timeline} from '@/lib/types';
import ShotGuide from './ShotGuide';

const LOCK_LABELS: Record<string, string> = {CHARACTER: '캐릭터', COSTUME: '의상', 'GLOBAL STYLE': '전체 스타일', NEGATIVE: '피할 요소'};
const SPEAKER_COLORS: Record<string, string> = {사구: 'var(--ok)', 박대표: 'var(--info)'};

const findFile = (files: string[], name: string) => files.find((file) => file.endsWith(`/${name}`));
const clipFile = (files: string[], n: number) => files.find((file) => file.endsWith(`/클립/${String(n).padStart(2, '0')}.mp4`));
const sameFrame = (a: FrameRef, b: FrameRef) => a.cut === b.cut && a.which === b.which;

function Thumb({file, label, missing}: {file?: string; label: string; missing: string}) {
  return file ? (
    <a href={media(file)} target="_blank" rel="noreferrer" className="sb-thumb">
      <img src={media(file)} alt={label} loading="lazy" />
      <span>{label}</span>
    </a>
  ) : <div className="sb-thumb sb-thumb-missing"><span>{missing}</span></div>;
}

function DialogueBand({plan, timeline}: {plan: PlanA; timeline: Timeline | null}) {
  const total = Math.max(...plan.cuts.map((c) => c.end), 1);
  const {windows, estimated} = useMemo(() => speechWindows(plan.dialogues, timeline?.dialogues ?? null), [plan.dialogues, timeline]);
  const gaps = coverageGaps(windows, total);
  const pct = (t: number) => `${(t / total) * 100}%`;
  return (
    <section className="card sb-band">
      <div className="row" style={{justifyContent: 'space-between'}}>
        <strong>대사 띠 · {total}초</strong>
        <span className={`badge ${gaps.length ? 'danger' : 'ok'}`}>{gaps.length ? `대사 없는 구간 ${gaps.length}곳` : '모든 구간에 대사 있음'}{estimated ? ' · 글자 수 추정' : ' · 실측'}</span>
      </div>
      <div className="sb-ruler">
        {plan.cuts.map((c) => <span key={c.n} className="sb-cut-mark" style={{left: pct(c.start), width: pct(c.end - c.start)}}>{c.n}</span>)}
      </div>
      <div className="sb-track">
        {gaps.map((g, i) => <span key={`gap-${i}`} className="sb-gap" style={{left: pct(g.from), width: pct(g.to - g.from)}} title={`${g.from.toFixed(1)}–${g.to.toFixed(1)}초 대사 없음`} />)}
        {windows.map((w) => (
          <span key={w.index} className="sb-speech" style={{left: pct(w.start), width: pct(w.end - w.start), background: SPEAKER_COLORS[w.character] ?? 'var(--text-dim)'}} title={`${w.character} ${w.start.toFixed(1)}–${w.end.toFixed(1)}초: ${w.text}`}>
            {w.character}: {w.text}
          </span>
        ))}
      </div>
    </section>
  );
}

function FrameToggle({frame, label, selected, disabled, onToggle}: {frame: FrameRef; label: string; selected: boolean; disabled: boolean; onToggle: (f: FrameRef) => void}) {
  return (
    <label className="row" style={{gap: 4, fontSize: 12}}>
      <input type="checkbox" checked={selected} disabled={disabled} onChange={() => onToggle(frame)} />
      {label}
    </label>
  );
}

function CutCard({cuts, cut, images, clips, selected, disabled, onToggle}: {cuts: PlanCut[]; cut: PlanCut; images: string[]; clips: string[]; selected: FrameRef[]; disabled: boolean; onToggle: (f: FrameRef) => void}) {
  const chained = cut.start_mode === '이어서';
  const startName = startFrameName(cuts, cut);
  const endName = cut.end_action ? endFrameName(cut) : null;
  const clip = clipFile(clips, cut.n);
  const isSelected = (which: 'start' | 'end') => selected.some((f) => sameFrame(f, {cut: cut.n, which}));
  return (
    <article className={`cut-card sb-card ${chained ? 'sb-card-chained' : ''}`}>
      <div className="row" style={{justifyContent: 'space-between'}}>
        <strong>컷 {cut.n}</strong>
        <span className="row" style={{gap: 4}}>
          {cut.view ? <span className="badge">{cut.view}</span> : null}
          <span className="badge">{cut.start_mode ?? '새로'}</span>
          <span className="badge">{Math.max(0, cut.end - cut.start).toFixed(0)}초</span>
        </span>
      </div>
      <div className="sb-frames">
        {chained ? <div className="sb-thumb sb-thumb-shared"><span>← 앞 컷 끝 프레임이 시작</span></div> : <Thumb file={findFile(images, startName)} label="시작" missing={`${startName} 없음`} />}
        <span className="sb-arrow">→</span>
        {endName ? <Thumb file={findFile(images, endName)} label="끝" missing={`${endName} 없음`} /> : <div className="sb-thumb sb-thumb-missing"><span>끝 프레임 없는 기획안</span></div>}
      </div>
      <dl className="cut-details">
        <dt>시작</dt><dd>{cut.action}</dd>
        {cut.end_action ? <><dt>끝</dt><dd>{cut.end_action}</dd></> : null}
        {cut.motion ? <><dt>동작</dt><dd className="faint">{cut.motion}</dd></> : null}
        <dt>카메라</dt><dd>{cut.camera} · {cut.lens}</dd>
        <dt>사람</dt><dd>{cut.visible || '없음'}</dd>
      </dl>
      {clip ? <div className="cut-preview"><video src={media(clip)} controls preload="metadata" /></div> : <div className="cut-missing">컷 영상 없음</div>}
      <div className="row" style={{gap: 10}}>
        <FrameToggle frame={{cut: cut.n, which: 'start'}} label={chained ? '시작(=앞 컷 끝) 다시' : '시작 다시'} selected={isSelected('start')} disabled={disabled} onToggle={onToggle} />
        {endName ? <FrameToggle frame={{cut: cut.n, which: 'end'}} label="끝 다시" selected={isSelected('end')} disabled={disabled} onToggle={onToggle} /> : null}
      </div>
    </article>
  );
}

export default function Storyboard({dir, plan, images, clips, timeline, pendingFix, onGoToRun}: {dir: string; plan: PlanA | null; images: string[]; clips: string[]; timeline: Timeline | null; pendingFix: string | null; onGoToRun: () => void}) {
  const router = useRouter();
  const [selected, setSelected] = useState<FrameRef[]>([]);
  const [instruction, setInstruction] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const disabled = Boolean(pendingFix) || saved;

  if (!plan) return <div className="empty">기획안의 컷표가 아직 없습니다. 먼저 기획 탭에서 기획안을 저장하세요.</div>;

  const sheets = [['시트.png', '사구 시트'], ['시트-인물.png', '인물 시트'], ['시트-세트.png', '세트 시트']] as const;
  const groups = chainGroups(plan.cuts);
  const affected = affectedCuts(plan.cuts, selected);
  const toggle = (f: FrameRef) => setSelected((cur) => cur.some((s) => sameFrame(s, f)) ? cur.filter((s) => !sameFrame(s, f)) : [...cur, f]);

  async function saveFix() {
    if (!selected.length || !instruction.trim() || disabled) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/gate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({dir, gate: 'clips', action: 'fix', note: fixRequestNote(selected, instruction)})});
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? '수정 요청을 저장하지 못했습니다.'); return; }
      setSaved(true);
      router.refresh();
    } catch {
      setError('요청 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid" style={{gap: 14}}>
      <section className="card sb-sheets">
        {sheets.map(([name, label]) => <Thumb key={name} file={findFile(images, name)} label={label} missing={`${name} 없음`} />)}
      </section>

      <details className="card locks-panel">
        <summary>고정 설정 보기</summary>
        <dl className="cut-details">{Object.entries(plan.locks).map(([label, value]) => <Fragment key={label}><dt>{LOCK_LABELS[label] ?? label}</dt><dd>{value}</dd></Fragment>)}</dl>
      </details>

      <DialogueBand plan={plan} timeline={timeline} />

      <div className="sb-groups">
        {groups.map((group) => (
          <div key={group[0].n} className="sb-group">
            {group.map((cut) => <CutCard key={cut.n} cuts={plan.cuts} cut={cut} images={images} clips={clips} selected={selected} disabled={disabled} onToggle={toggle} />)}
          </div>
        ))}
      </div>

      <ShotGuide plan={plan} />

      <section id="image-revision" className="card">
        <strong>프레임 다시 만들기 요청</strong>
        <p className="faint" style={{margin: '6px 0 10px'}}>고른 프레임의 수정 내용을 저장합니다. 생성은 실행·로그에서 이미지 단계를 다시 돌릴 때 됩니다. 시작을 바꾸면 그 컷의 끝도 다시 만들고, 체인으로 이어진 다음 컷의 끝까지 다시 만듭니다.</p>
        {affected.length ? <p className="badge warn">영상이 무효가 되는 컷: {affected.join(', ')}</p> : null}
        {pendingFix ? <div className="pending-fix"><strong>처리 대기 중인 수정 요청이 있습니다.</strong><button className="btn" onClick={onGoToRun}>실행·로그로 이동</button></div> : null}
        {saved ? <div className="pending-fix"><strong>수정 요청을 저장했습니다.</strong><button className="btn" onClick={onGoToRun}>실행·로그로 이동</button></div> : null}
        {error ? <p className="badge danger">{error}</p> : null}
        <textarea className="field" style={{minHeight: 92}} value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={disabled} placeholder="예: 귀를 더 세우고 입을 다물게" />
        <div className="row" style={{marginTop: 10, justifyContent: 'space-between'}}>
          <span className="faint">고른 프레임: {selected.length ? selected.map((f) => `${f.cut}${f.which === 'start' ? '시작' : '끝'}`).join(', ') : '없음'}</span>
          <button className="btn primary" disabled={disabled || saving || !selected.length || !instruction.trim()} onClick={saveFix}>수정 요청 저장</button>
        </div>
      </section>
    </div>
  );
}
