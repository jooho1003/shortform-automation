'use client';

import Link from 'next/link';
import {useEffect, useRef, useState} from 'react';
import {blankDraft, draftOf, type HansulCard, type HansulDraft, type HansulStudio, type HansulTarget} from '@/lib/hansulCore';
import {fmtDate} from '@/lib/client';

const emptyCard = (): HansulCard => ({scene: '', dialogue: '', emotion: ''});
const stages = ['주제 정하기', '콘티 만들기', '검토·수정'] as const;

export function HansulStudioEditor({initial}: {initial: HansulStudio}) {
  const initialEpisode = initial.episodes.find(e => e.status === 'draft') ?? initial.episodes.at(-1);
  const [studio, setStudio] = useState(initial);
  const [selectedId, setSelectedId] = useState(initialEpisode?.id ?? '');
  const selected = studio.episodes.find(e => e.id === selectedId);
  const [draft, setDraft] = useState<HansulDraft>(() => selected ? draftOf(selected) : blankDraft());
  const [stage, setStage] = useState(selected?.cards.length ? 1 : 0);
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude');
  const [target, setTarget] = useState<HansulTarget>('storyboard');
  const [busy, setBusy] = useState('');
  const inflight = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<number | null>(null);
  const historical = selected?.history.find(v => v.version === preview);
  const view = historical?.draft ?? draft;
  const dirty = !!selected && JSON.stringify(draft) !== JSON.stringify(draftOf(selected));

  useEffect(() => {
    if (!dirty && !busy) return;
    const leave = (event: BeforeUnloadEvent) => {event.preventDefault();};
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, busy]);

  const patch = (next: Partial<HansulDraft>) => {setDraft(d => ({...d, ...next})); setNotice('');};
  const cardPatch = (i: number, next: Partial<HansulCard>) => patch({cards: draft.cards.map((c, n) => n === i ? {...c, ...next} : c)});
  const mode = (field: 'topicMode' | 'storyboardMode') => (
    <div className="hs-modes" role="group" aria-label={field === 'topicMode' ? '주제 작성 방식' : '콘티 작성 방식'}>
      <button type="button" aria-pressed={view[field] === 'auto'} onClick={() => patch({[field]: 'auto'})}>자동 생성</button>
      <button type="button" aria-pressed={view[field] === 'manual'} onClick={() => patch({[field]: 'manual'})}>직접 작성</button>
    </div>
  );

  async function act(action: string, label: string, extras: Record<string, unknown> = {}) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(label); setError(''); setNotice('');
    try {
      const response = await fetch('/api/instatoon/hansul', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, revision: studio.revision, episodeId: selectedId, draft, provider, target, ...extras})});
      const result = await response.json();
      if (!response.ok) {
        // Generation failures return the saved pre-generation document, preserving the local editor.
        if (result.studio) setStudio(result.studio);
        throw new Error(result.error || '작업을 완료하지 못했습니다.');
      }
      const next = result.studio as HansulStudio;
      const nextEpisode = next.episodes.find(e => e.id === result.selectedId)!;
      setStudio(next); setSelectedId(nextEpisode.id); setDraft(draftOf(nextEpisode)); setPreview(null);
      if (action === 'create' || action === 'topic') setStage(0);
      if (action === 'storyboard') setStage(1);
      if (action === 'approve') setStage(2);
      setNotice(action === 'approve' ? '콘티를 승인했습니다. 컷 편집기에서 이어서 작업할 수 있어요.' : action === 'create' ? '새 회차를 만들었습니다. 주제부터 확인해 주세요.' : action === 'restore' ? '선택한 버전을 새 버전으로 복원했습니다.' : action === 'topic' ? '주제를 생성했습니다. 기존 콘티가 있다면 새 주제에 맞게 검토해 주세요.' : '저장했습니다. 결과를 확인하고 필요한 부분을 고쳐 주세요.');
    } catch (e) {setError((e as Error).message);}
    finally {setBusy(''); inflight.current = false;}
  }

  function select(id: string) {
    if (dirty) {setError('편집 중인 내용을 먼저 저장한 뒤 회차를 이동해 주세요.'); return;}
    const episode = studio.episodes.find(e => e.id === id)!;
    setSelectedId(id); setDraft(draftOf(episode)); setPreview(null); setError(''); setNotice('');
    setStage(episode.cards.length ? 1 : 0);
  }

  function downloadDraft() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], {type: 'application/json'}));
    link.download = `한술툰-${selected?.number ?? 1}화-편집본.json`;
    link.click(); URL.revokeObjectURL(link.href);
  }

  return <div className="hs-studio">
    <header className="hs-header">
      <div><Link className="hs-back" href="/instatoon" onClick={e => {if (dirty || busy) {e.preventDefault(); setError('저장하거나 진행 중인 작업이 끝난 뒤 이동해 주세요.');}}}>‹ 인스타툰</Link><h1>한술툰 작업실</h1><p>한 사연을 세 편으로. 주제를 잡고, 콘티를 고치고, 다음 화로 이어가세요.</p></div>
      <button className="btn primary" disabled={!!busy || dirty || !!preview} onClick={() => act('create', '다음 화 준비 중')}>＋ 다음 화 생성</button>
    </header>
    <div className="hs-rules"><span>남자 라쿤 · 여자 친칠라</span><span>담백한 손그림과 표정</span><span>갈등 → 고구마 → 사이다</span></div>
    <div className="hs-layout">
      <aside className="hs-episodes" aria-label="회차 목록">
        <h2>작업 중인 회차 <span>{studio.episodes.length}</span></h2>
        {studio.episodes.length === 0 && <p className="muted">다음 화 생성으로 첫 이야기를 시작하세요.</p>}
        {studio.episodes.map(e => <button key={e.id} className={`hs-episode ${selectedId === e.id ? 'active' : ''}`} aria-current={selectedId === e.id ? 'page' : undefined} disabled={!!busy} onClick={() => select(e.id)}>
          <span className="hs-episode-meta">{e.number}화 <span>{e.status === 'approved' ? '승인 완료' : e.cards.length ? '콘티 검토' : '주제 작성'}</span></span>
          <strong>{e.topic.title || '새로운 이야기'}</strong>
          <small>사연 {e.arc} · {e.part}/3부 · v{e.version}</small>
        </button>)}
        <p className="hs-sidebar-note">같은 사연은 3화까지 이어집니다. 다음 회차를 생성할 때 앞선 주제와 콘티를 함께 참고합니다.</p>
      </aside>

      <section className="hs-work" aria-label="회차 편집">
        <div className="hs-feedback" aria-live="polite" aria-atomic="true">
          {busy && <p className="hs-status">{busy}… 생성은 몇 분 걸릴 수 있어요. 이 화면에서 기다려 주세요.</p>}
          {notice && <p className="hs-success">{notice}</p>}
        </div>
        {error && <div className="hs-error" role="alert"><p>{error}</p><div className="row"><button className="btn small" onClick={downloadDraft}>현재 편집본 내려받기</button><button className="btn small" disabled={!!busy} onClick={() => {if (!dirty || window.confirm('저장하지 않은 편집을 버리고 최신 내용을 불러올까요? 필요하면 먼저 편집본을 내려받으세요.')) window.location.reload();}}>최신 내용 불러오기</button></div></div>}
        {!selected ? <section className="hs-empty"><h2>첫 이야기를 시작할 준비가 됐어요</h2><p>주제를 직접 적거나 자동 생성으로 제안받을 수 있습니다.</p><button className="btn primary" disabled={!!busy} onClick={() => act('create', '첫 화 준비 중')}>첫 화 만들기</button></section> : <>
          <div className="hs-work-heading"><div><span className="muted">사연 {selected.arc} · {selected.part}/3부</span><h2>{selected.number}화 콘티</h2></div><span className={`badge ${dirty ? 'warn' : selected.status === 'approved' ? 'ok' : ''}`}>{dirty ? '저장하지 않은 수정' : selected.status === 'approved' ? '승인 완료' : `저장됨 · v${selected.version}`}</span></div>
          <nav className="hs-steps" aria-label="제작 단계">{stages.map((s, i) => <button key={s} aria-current={stage === i ? 'step' : undefined} className={stage === i ? 'active' : ''} onClick={() => setStage(i)}><span>{i + 1}</span>{s}</button>)}</nav>
          {historical && <div className="hs-history-banner"><span>v{historical.version} 미리보기 · {historical.label}</span><button className="btn small" onClick={() => setPreview(null)}>현재 편집본으로</button></div>}
          <fieldset disabled={!!busy || !!historical} className="hs-fields">
            {stage === 0 && <section className="hs-section">
              <div className="hs-section-heading"><h3>이번 사연의 주제</h3>{mode('topicMode')}</div>
              {view.topicMode === 'auto' && <div className="hs-generation"><label>생성 방향<textarea className="field" rows={3} maxLength={6000} value={view.brief} placeholder="예: 연애에서 작은 배려가 당연한 일이 된 순간. 현실적인 대사로 써 줘." onChange={e => patch({brief: e.target.value})} /></label><div className="row"><Provider value={provider} onChange={setProvider} /><button className="btn primary" onClick={() => act('topic', '주제 생성 중')}>주제 자동 생성</button></div><p className="muted">현재 입력과 이전 회차를 참고합니다. 생성 후 아래에서 직접 고칠 수 있어요.</p></div>}
              <label>사연 제목<input className="field" maxLength={160} value={view.topic.title} placeholder="한눈에 갈등이 보이는 제목" onChange={e => patch({topic: {...draft.topic, title: e.target.value}})} /></label>
              <label>핵심 갈등<textarea className="field" rows={3} maxLength={4000} value={view.topic.premise} placeholder="누가 무엇을 원하고, 어떤 부당한 일을 겪나요?" onChange={e => patch({topic: {...draft.topic, premise: e.target.value}})} /></label>
              <div className="hs-arc">{['1화 · 갈등 시작', '2화 · 고구마 심화', '3화 · 사이다 해결'].map((label, i) => <label key={label}>{label}<textarea className="field" rows={4} maxLength={2000} value={view.topic.outline[i]} onChange={e => patch({topic: {...draft.topic, outline: draft.topic.outline.map((v, n) => n === i ? e.target.value : v)}})} /></label>)}</div>
              <button className="btn" onClick={() => setStage(1)}>콘티 만들기로</button>
            </section>}

            {stage === 1 && <section className="hs-section">
              <div className="hs-section-heading"><div><h3>장별 콘티</h3><p className="muted">{view.cards.length}장 · 구도와 대사를 바로 수정하세요.</p></div>{mode('storyboardMode')}</div>
              {view.storyboardMode === 'auto' && <div className="hs-generation"><label>콘티 생성 방향<textarea className="field" rows={2} maxLength={6000} value={view.brief} placeholder="꼭 넣을 사건, 대사 톤, 마지막 장의 끊는 지점" onChange={e => patch({brief: e.target.value})} /></label><div className="row"><Provider value={provider} onChange={setProvider} /><button className="btn primary" disabled={!view.topic.title.trim() || !view.topic.premise.trim() || view.topic.outline.some(x => !x.trim())} onClick={() => act('storyboard', '콘티 생성 중')}>콘티 자동 생성</button></div><p className="muted">주제와 3화 흐름을 채운 뒤 생성할 수 있어요. 기존 콘티는 이전 버전에 남습니다.</p></div>}
              {!view.cards.length && <div className="hs-empty"><p>아직 장별 콘티가 없습니다.</p><button className="btn" onClick={() => patch({cards: Array.from({length: 8}, emptyCard), storyboardMode: 'manual'})}>8장 빈 콘티로 직접 시작</button></div>}
              <div className="hs-cards">{view.cards.map((card, i) => <article className="hs-card" key={i}>
                <div className="hs-card-number"><strong>{String(i + 1).padStart(2, '0')}</strong><span>{i === 0 ? '표지' : i === view.cards.length - 1 ? '마지막 장' : '본문'}</span><button className="hs-remove" aria-label={`${i + 1}장 삭제`} onClick={() => patch({cards: draft.cards.filter((_, n) => n !== i)})}>삭제</button></div>
                <div className="hs-card-content"><label>{i + 1}장 장면·구도<textarea className="field" rows={3} maxLength={2000} value={card.scene} onChange={e => cardPatch(i, {scene: e.target.value})} /></label><label>{i + 1}장 대사·문구<textarea className="field hs-dialogue" rows={4} maxLength={1600} placeholder={'보리: 내일은 안 싸.\n내레이션: 다음 날.'} value={card.dialogue} onChange={e => cardPatch(i, {dialogue: e.target.value})} /></label><label>{i + 1}장 표정·호흡<input className="field" maxLength={800} value={card.emotion} placeholder="점눈, 짧은 입. 고개만 멈춘다." onChange={e => cardPatch(i, {emotion: e.target.value})} /></label></div>
              </article>)}</div>
              <button className="btn hs-add" disabled={view.cards.length >= 12} onClick={() => patch({cards: [...draft.cards, emptyCard()]})}>＋ 장 추가</button>
              <label>게시 캡션<textarea className="field" rows={5} maxLength={2200} value={view.caption} onChange={e => patch({caption: e.target.value})} /></label>
              <button className="btn" onClick={() => setStage(2)}>검토·수정으로</button>
            </section>}

            {stage === 2 && <section className="hs-section">
              <h3>읽어 보고, 필요한 부분만 고치세요</h3>
              <div className="hs-review"><h4>{view.topic.title || '제목 없음'}</h4><p>{view.topic.premise}</p>{view.cards.map((c, i) => <article key={i}><span>{i + 1}장</span><div><p className="muted">{c.scene}</p><p className="hs-review-dialogue">{c.dialogue || '(대사 없음)'}</p><small className="muted">{c.emotion}</small></div><button className="btn small" onClick={() => setStage(1)}>직접 수정</button></article>)}</div>
              {!view.cards.length && <p className="muted">콘티를 먼저 작성하면 여기서 한 번에 읽을 수 있어요.</p>}
              <div className="hs-revision"><h3>수정 요청 반영</h3><p className="muted">화면에서 직접 고친 원고와 아래 요청을 함께 반영해 새 버전을 만듭니다.</p><label>수정할 내용<textarea className="field" rows={4} maxLength={6000} value={view.feedback} placeholder="예: 8장의 남친 대사를 더 일상적으로. 보리는 화내지 말고 잠깐 멈추는 표정으로." onChange={e => patch({feedback: e.target.value})} /></label><div className="row"><label>수정 대상<select className="field" value={target} onChange={e => setTarget(e.target.value as HansulTarget)}><option value="storyboard">콘티</option><option value="topic">주제·3화 흐름</option></select></label><Provider value={provider} onChange={setProvider} /><button className="btn primary" disabled={!view.feedback.trim() || (target === 'storyboard' && !view.cards.length)} onClick={() => act('revise', '수정 반영 중')}>수정 반영 재생성</button></div></div>
              <div className="hs-approval"><div><h3>이 콘티로 작업하기</h3><p>승인하면 컷 편집기로 보냅니다. 이후 콘티를 수정하면 다시 검토할 수 있어요.</p></div><button className="btn primary" disabled={!view.cards.length || view.cards.some(c => !c.scene.trim()) || !view.topic.title.trim()} onClick={() => act('approve', '콘티 승인 중')}>콘티 승인</button></div>
            </section>}
          </fieldset>

          <footer className="hs-savebar"><span>{historical ? `v${historical.version} 읽기 전용` : dirty ? '수정한 내용을 저장해 주세요.' : `마지막 저장 ${fmtDate(selected.updatedAt)}`}</span><div className="row">{selected.editorId && !dirty && !historical && <Link className="btn" href={`/instatoon/${selected.editorId}`}>컷 편집기 열기</Link>}{historical ? <button className="btn primary" disabled={!!busy || dirty} onClick={() => act('restore', '버전 복원 중', {version: historical.version})}>이 버전으로 복원</button> : <button className="btn primary" disabled={!!busy || !dirty} onClick={() => act('save', '저장 중')}>수정 내용 저장</button>}</div></footer>

          <details className="hs-history"><summary>버전 기록 <span>{selected.history.length}개</span></summary>{dirty && <p className="muted">현재 편집을 먼저 저장하면 이전 버전을 열 수 있어요.</p>}<div>{[...selected.history].reverse().map(v => <button key={v.version} disabled={!!busy || dirty} onClick={() => {setPreview(v.version); setStage(1);}}><strong>v{v.version}</strong><span>{v.label}</span><small>{fmtDate(v.at)}</small></button>)}</div></details>
        </>}
      </section>
    </div>
  </div>;
}

function Provider({value, onChange}: {value: 'claude' | 'codex'; onChange: (value: 'claude' | 'codex') => void}) {
  return <label>생성 도구<select className="field" value={value} onChange={e => onChange(e.target.value as 'claude' | 'codex')}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>;
}
