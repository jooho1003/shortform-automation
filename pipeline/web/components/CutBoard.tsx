'use client';

import {Fragment, useMemo, useState} from 'react';
import {useRouter} from 'next/navigation';

import {media} from '@/lib/client';
import type {PlanA, PlanCut} from '@/lib/types';
import ShotGuide from './ShotGuide';

const LOCK_LABELS: Record<string, string> = {
  CHARACTER: '캐릭터',
  COSTUME: '의상',
  'GLOBAL STYLE': '전체 스타일',
  NEGATIVE: '피할 요소',
};

function numberedFile(files: string[], folder: string, n: number, extension: string) {
  const number = String(n).padStart(2, '0');
  return files.find((file) => file.endsWith(`/${folder}/${number}.${extension}`));
}

function keyframeFile(files: string[], n: number) {
  return files.find((file) => file.endsWith(`/키프레임-${String(n).padStart(2, '0')}.png`));
}

function duration(cut: PlanCut) {
  return Math.max(0, cut.end - cut.start).toFixed(1);
}

export function formatFixRequest(note: string) {
  try {
    const value = JSON.parse(note) as {cuts?: unknown; instruction?: unknown};
    if (Array.isArray(value.cuts) && typeof value.instruction === 'string') {
      return `컷 ${value.cuts.join(', ')}: ${value.instruction}`;
    }
  } catch {
    // 기존 일반 텍스트 요청도 그대로 보여준다.
  }
  return note;
}

function CutCard({
  cut,
  image,
  clip,
  selected,
  disabled,
  onSelect,
}: {
  cut: PlanCut;
  image?: string;
  clip?: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (n: number) => void;
}) {
  return (
    <article className="cut-card">
      <div className="row" style={{justifyContent: 'space-between'}}>
        <label className="row" style={{gap: 6}}>
          <input type="checkbox" checked={selected} disabled={disabled} onChange={() => onSelect(cut.n)} />
          <strong>컷 {cut.n}</strong>
        </label>
        <span className={`badge ${cut.required ? 'warn' : ''}`}>{cut.required ? '필수' : '선택'}</span>
      </div>
      <dl className="cut-details">
        <dt>장면</dt><dd>{cut.action}</dd>
        <dt>카메라</dt><dd>{cut.camera}</dd>
        <dt>렌즈</dt><dd>{cut.lens}</dd>
        <dt>길이</dt><dd>{duration(cut)}초</dd>
      </dl>
      <div className="cut-media">
        {image ? (
          <a href={media(image)} target="_blank" rel="noreferrer" className="cut-preview">
            <img src={media(image)} alt={`컷 ${cut.n} 키프레임`} />
            <span>키프레임 열기</span>
          </a>
        ) : <div className="cut-missing">키프레임 파일 없음</div>}
        {clip ? (
          <div className="cut-preview">
            <video src={media(clip)} controls preload="metadata" />
            <a href={media(clip)} target="_blank" rel="noreferrer">컷 영상 열기</a>
          </div>
        ) : <div className="cut-missing">컷 영상 파일 없음</div>}
      </div>
      <div className="row" style={{gap: 5}}>
        <span className={`badge ${image ? 'ok' : 'danger'}`}>키프레임 {image ? '파일 있음' : '파일 없음'}</span>
        <span className={`badge ${clip ? 'ok' : 'danger'}`}>컷 영상 {clip ? '파일 있음' : '파일 없음'}</span>
      </div>
    </article>
  );
}

export default function CutBoard({
  dir,
  plan,
  images,
  clips,
  pendingFix,
  onGoToRun,
}: {
  dir: string;
  plan: PlanA | null;
  images: string[];
  clips: string[];
  pendingFix: string | null;
  onGoToRun: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [instruction, setInstruction] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const sheet = useMemo(() => images.find((file) => file.endsWith('/시트.png')), [images]);
  const keyframeCount = plan?.cuts.filter((cut) => Boolean(keyframeFile(images, cut.n))).length ?? 0;
  const clipCount = plan?.cuts.filter((cut) => Boolean(numberedFile(clips, '클립', cut.n, 'mp4'))).length ?? 0;

  const toggle = (n: number) => {
    setSelected((current) => current.includes(n) ? current.filter((value) => value !== n) : [...current, n]);
  };

  async function saveFix() {
    if (selected.length === 0 || !instruction.trim() || pendingFix) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          dir,
          gate: 'clips',
          action: 'fix',
          note: JSON.stringify({version: 1, cuts: selected, instruction: instruction.trim()}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '수정 요청을 저장하지 못했습니다.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError('요청 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  if (!plan) {
    return <div className="empty">기획안의 컷표가 아직 없습니다. 먼저 기획 탭에서 기획안을 저장하세요.</div>;
  }

  return (
    <div className="grid" style={{gap: 14}}>
      <section className="card sheet-panel">
        <div>
          <strong>캐릭터 시트</strong>
          <p className="faint" style={{margin: '4px 0 0'}}>모든 컷을 볼 때 기준으로 쓰는 시트입니다.</p>
        </div>
        {sheet ? (
          <a href={media(sheet)} target="_blank" rel="noreferrer" className="sheet-link">
            <img src={media(sheet)} alt="캐릭터 시트" />
            <span>시트 크게 보기</span>
          </a>
        ) : <div className="cut-missing">시트.png 파일 없음</div>}
      </section>

      <details className="card locks-panel">
        <summary>고정 설정 보기</summary>
        <dl className="cut-details">
          {Object.entries(plan.locks).map(([label, value]) => <Fragment key={label}><dt>{LOCK_LABELS[label] ?? label}</dt><dd>{value}</dd></Fragment>)}
        </dl>
      </details>

      <div className="card row" style={{justifyContent: 'space-between'}}>
        <div className="row">
          <span className="badge">컷 {plan.cuts.length}개</span>
          <span className={`badge ${keyframeCount === plan.cuts.length ? 'ok' : 'warn'}`}>키프레임 파일 {keyframeCount}/{plan.cuts.length}</span>
          <span className={`badge ${clipCount === plan.cuts.length ? 'ok' : 'warn'}`}>컷 영상 파일 {clipCount}/{plan.cuts.length}</span>
        </div>
        {selected.length ? <a href="#image-revision" className="btn">선택한 컷 수정하기</a> : null}
      </div>

      <div className="cut-grid">
        {plan.cuts.map((cut) => <CutCard key={cut.n} cut={cut} image={keyframeFile(images, cut.n)} clip={numberedFile(clips, '클립', cut.n, 'mp4')} selected={selected.includes(cut.n)} disabled={Boolean(pendingFix) || saved} onSelect={toggle} />)}
      </div>

      <ShotGuide plan={plan} />

      <section id="image-revision" className="card">
        <strong>이미지 수정 요청</strong>
        <p className="faint" style={{margin: '6px 0 10px'}}>선택한 컷의 키프레임 수정 내용을 저장합니다. 생성은 실행·로그에서 따로 진행합니다.</p>
        {pendingFix ? (
          <div className="pending-fix">
            <strong>처리 대기 중인 수정 요청이 있습니다.</strong>
            <p>{formatFixRequest(pendingFix)}</p>
            <p className="faint">아래 요청은 기존 요청을 바꾸지 않도록 비활성화되어 있습니다. 위 승인 게이트에서 처리한 뒤 새 요청을 저장하세요. 완료된 단계도 다시 실행하려면 실행·로그에서 이미지 단계를 선택하세요.</p>
            <button className="btn" onClick={onGoToRun}>실행·로그로 이동</button>
          </div>
        ) : null}
        {saved ? (
          <div className="pending-fix">
            <strong>수정 요청을 저장했습니다.</strong>
            <p>기존 컷 영상·완성본에는 자동 반영되지 않습니다. 이미지 단계가 끝난 상태라면 실행·로그에서 이미지 단계를 다시 실행하세요.</p>
            <button className="btn" onClick={onGoToRun}>실행·로그로 이동</button>
          </div>
        ) : null}
        {error ? <p className="badge danger">{error}</p> : null}
        <label className="lbl" htmlFor="cut-revision">선택한 컷에 적용할 수정 내용</label>
        <textarea id="cut-revision" className="field" style={{minHeight: 92}} value={instruction} onChange={(event) => setInstruction(event.target.value)} disabled={Boolean(pendingFix) || saved} placeholder="예: 3번 컷의 표정을 더 차분하게 바꿔 주세요." />
        <div className="row" style={{marginTop: 10, justifyContent: 'space-between'}}>
          <span className="faint">선택한 컷: {selected.length ? selected.join(', ') : '없음'}</span>
          <button className="btn primary" disabled={Boolean(pendingFix) || saved || saving || selected.length === 0 || instruction.trim().length === 0} onClick={saveFix}>수정 요청 저장</button>
        </div>
      </section>
    </div>
  );
}
