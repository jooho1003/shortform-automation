'use client';

import {useId, useMemo, useState} from 'react';
import Link from 'next/link';

import {DETAIL_STATUS_LABELS, DETAIL_VIDEO_SOURCE_LABELS, DETAIL_VIDEO_MAX_SECONDS, DETAIL_VIDEO_MIN_SECONDS, defaultDetailVideo, detailMarkdown, sectionPrompt, type DetailProject, type DetailSection, type DetailStatus, type DetailVideo} from '@/lib/detailTypes';

const CHECK_LABELS = {facts: '제품 정보와 수치 확인', labels: '표기·주의 문구 확인', mobile: '375px 화면 확인', rights: '이미지·사용 권한 확인'};
const VISUAL_PRESETS = [
  ['제품 대표컷', '제품 실루엣을 보존하고 카피가 들어갈 여백을 확보한다.'],
  ['사용 디테일', '제품의 접촉점과 실제 사용 상황을 보여 준다.'],
  ['개념 CGI', '추상적인 층과 재질로 표현하고 개념 연출임을 표시한다. 효능 증거로 보이지 않게 한다.'],
] as const;

function downloadMarkdown(project: DetailProject) {
  const blob = new Blob([detailMarkdown(project)], {type: 'text/markdown;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const filename = (project.title || '상세페이지-의뢰서').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-').trim() || '상세페이지-의뢰서';
  anchor.download = `${filename}.md`;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DetailProjectEditor({project: initialProject}: {project: DetailProject}) {
  const [project, setProject] = useState(initialProject);
  const [savedProject, setSavedProject] = useState(initialProject);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(project) !== JSON.stringify(savedProject), [project, savedProject]);
  const update = <K extends keyof DetailProject>(key: K, value: DetailProject[K]) => setProject((current) => ({...current, [key]: value}));

  function updateSection(index: number, key: keyof DetailSection, value: string) {
    setProject((current) => ({...current, sections: current.sections.map((section, i) => i === index ? {...section, [key]: value} : section)}));
  }

  function appendVisualPreset(index: number, text: string) {
    setProject((current) => ({...current, sections: current.sections.map((section, i) => i === index ? {...section, visual: section.visual ? `${section.visual}\n${text}` : text} : section)}));
  }

  function toggleVideo(index: number, on: boolean) {
    setProject((current) => ({...current, sections: current.sections.map((section, i) => {
      if (i !== index) return section;
      if (!on) { const {video: _drop, ...rest} = section; return rest; }
      return {...section, video: section.video ?? defaultDetailVideo(section.id)};
    })}));
  }

  function updateVideo<K extends keyof DetailVideo>(index: number, key: K, value: DetailVideo[K]) {
    setProject((current) => ({...current, sections: current.sections.map((section, i) =>
      i === index && section.video ? {...section, video: {...section.video, [key]: value}} : section)}));
  }

  async function generateVideos() {
    const count = project.sections.filter((s) => s.video).length;
    if (!count || pending) return;
    if (dirty) { setMessage('먼저 저장한 뒤 영상을 생성하세요.'); return; }
    if (!confirm(`섹션 ${count}개의 영상을 생성합니다. fal.ai 비용이 발생합니다. 진행할까요?`)) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/detail-pages/${project.id}/video`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({confirm: true})});
      const result = await response.json() as {job?: {id: string}; error?: string};
      setMessage(response.ok ? `영상 생성을 시작했습니다. 작업 ${result.job?.id ?? ''} — 진행 상황은 작업 로그에서 봅니다.` : result.error ?? '영상 생성을 시작하지 못했습니다.');
    } catch {
      setMessage('영상 생성 요청이 실패했습니다.');
    } finally {
      setPending(false);
    }
  }

  async function copyPrompt(section: DetailSection) {
    try {
      await navigator.clipboard.writeText(sectionPrompt(project, section));
      setMessage(`${section.title} 제작 지시문을 복사했습니다.`);
    } catch {
      setMessage('복사하지 못했습니다. 브라우저 권한을 확인하세요.');
    }
  }

  async function save() {
    if (!dirty || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/detail-pages/${project.id}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(project)});
      const result = await response.json() as DetailProject | {error?: string};
      if (response.status === 409) {
        setMessage('다른 화면에서 먼저 저장되었습니다. 입력 내용을 Markdown으로 내려받아 보존한 뒤 새로고침하고 다시 반영하세요.');
        return;
      }
      if (!response.ok || !('revision' in result)) {
        setMessage(('error' in result && result.error) || '저장하지 못했습니다.');
        return;
      }
      setProject(result);
      setSavedProject(result);
      setMessage('저장했습니다.');
    } catch {
      setMessage('요청 중 오류가 발생했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="detail-page">
      <div className="dp-toolbar">
        <div>
          <Link href="/detail-pages" className="faint">← 상세페이지 의뢰서</Link>
          <h1 style={{margin: '5px 0 0'}}>{project.title || '새 상세페이지 의뢰서'}</h1>
          <p className="faint" style={{margin: '4px 0 0'}}>{dirty ? '저장하지 않은 변경사항이 있습니다. 결과 화면에는 저장 후 반영됩니다.' : '저장된 내용입니다. 결과 화면에 반영됩니다.'}</p>
        </div>
        <div className="dp-actions">
          <Link href={`/detail-pages/${project.id}/preview`} className="btn">상세페이지 결과 보기</Link>
          <button className="btn" onClick={() => downloadMarkdown(project)}>Markdown 다운로드</button>
          <button className="btn primary" disabled={!dirty || pending} onClick={save}>{pending ? '저장 중…' : '저장'}</button>
        </div>
      </div>
      {message ? <p className="badge info dp-notice" aria-live="polite">{message}</p> : null}

      <div className="dp-side-by-side">
        <fieldset className="dp-editor-fields" disabled={pending}>
          <section className="card">
            <strong>의뢰서</strong>
            <div className="dp-form-grid" style={{marginTop: 12}}>
              <Field label="프로젝트 이름" value={project.title} onChange={(v) => update('title', v)} />
              <Field label="고객" value={project.client} onChange={(v) => update('client', v)} />
              <Field label="제품" value={project.product} onChange={(v) => update('product', v)} />
              <Field label="대상" value={project.target} onChange={(v) => update('target', v)} />
              <Field label="목적" value={project.objective} onChange={(v) => update('objective', v)} />
              <Field label="핵심 메시지" value={project.keyMessage} onChange={(v) => update('keyMessage', v)} />
              <Field label="브랜드·스타일" value={project.brand} onChange={(v) => update('brand', v)} />
              <Field multiline label="참고 링크" placeholder="한 줄에 URL 하나씩 입력하세요" value={project.referenceUrls} onChange={(v) => update('referenceUrls', v)} />
              <Field wide multiline label="확인된 제품 정보" value={project.facts} onChange={(v) => update('facts', v)} />
              <Field wide multiline label="근거 자료" value={project.evidence} onChange={(v) => update('evidence', v)} />
              <Field wide multiline label="제공 자산·사용 조건" value={project.assetNotes} onChange={(v) => update('assetNotes', v)} />
            </div>
          </section>

          <section className="card">
            <strong>섹션 구성 ({project.sections.length}개)</strong>
            {project.sections.some((s) => s.video) ? <button className="btn sm" disabled={pending || dirty} onClick={generateVideos}>섹션 영상 생성 (유료)</button> : null}
            <p className="faint" style={{margin: '4px 0 12px'}}>카피, 이미지 연출, 검수 상태를 각 섹션마다 정리합니다.</p>
            <div className="dp-section-list">
              {project.sections.map((section, index) => <div className="dp-section" key={section.id}>
                <div className="dp-section-title"><strong>{index + 1}.</strong><input className="field" aria-label={`${index + 1}번 섹션 제목`} value={section.title} onChange={(e) => updateSection(index, 'title', e.target.value)} /></div>
                <Field multiline label="카피" value={section.copy} onChange={(v) => updateSection(index, 'copy', v)} />
                <Field multiline label="이미지 연출" value={section.visual} onChange={(v) => updateSection(index, 'visual', v)} />
                <div className="dp-section-controls dp-status-row">
                  <label className="lbl" htmlFor={`review-${section.id}`} style={{margin: 0}}>검수</label>
                  <select id={`review-${section.id}`} className="field" style={{width: 'auto'}} value={section.review} onChange={(e) => updateSection(index, 'review', e.target.value)}>
                    <option value="todo">확인 전</option><option value="ready">확인됨</option><option value="changes">수정 필요</option>
                  </select>
                  <button className="btn sm" onClick={() => copyPrompt(section)}>제작 지시문 복사</button>
                  {VISUAL_PRESETS.map(([label, text]) => <button type="button" className="btn sm" key={label} onClick={() => appendVisualPreset(index, text)}>{label}</button>)}
                </div>
                <div className="dp-section-controls dp-status-row">
                  <label className="lbl" htmlFor={`video-${section.id}`} style={{margin: 0}}>짧은 영상</label>
                  <input id={`video-${section.id}`} type="checkbox" checked={!!section.video} onChange={(e) => toggleVideo(index, e.target.checked)} />
                  {section.video ? <span className="dp-hint">{section.video.file}</span> : null}
                </div>
                {section.video ? <div className="dp-video-fields">
                  <label className="lbl" htmlFor={`video-source-${section.id}`}>소재</label>
                  <select id={`video-source-${section.id}`} className="field" value={section.video.source} onChange={(e) => updateVideo(index, 'source', e.target.value as DetailVideo['source'])}>
                    {Object.entries(DETAIL_VIDEO_SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {section.video.source === 'image' ? <Field label="시드 이미지 (프로젝트 폴더 기준)" value={section.video.seed} onChange={(v) => updateVideo(index, 'seed', v)} /> : null}
                  <Field multiline label="움직임 지시" value={section.video.motion} onChange={(v) => updateVideo(index, 'motion', v)} />
                  <div className="dp-status-row">
                    <label className="lbl" htmlFor={`video-seconds-${section.id}`} style={{margin: 0}}>길이(초)</label>
                    <input id={`video-seconds-${section.id}`} className="field" style={{width: '6rem'}} type="number" min={DETAIL_VIDEO_MIN_SECONDS} max={DETAIL_VIDEO_MAX_SECONDS} step={1} value={section.video.seconds} onChange={(e) => updateVideo(index, 'seconds', Number(e.target.value))} />
                    <label className="lbl" htmlFor={`video-loop-${section.id}`} style={{margin: 0}}>반복 재생</label>
                    <input id={`video-loop-${section.id}`} type="checkbox" checked={section.video.loop} onChange={(e) => updateVideo(index, 'loop', e.target.checked)} />
                  </div>
                </div> : null}
                <details className="dp-prompt"><summary>제작 지시문 미리보기</summary><pre>{sectionPrompt(project, section)}</pre></details>
              </div>)}
            </div>
          </section>

          <section className="card">
            <strong>납품·최종 검수</strong>
            <p className="faint" style={{margin: '5px 0 0'}}>납품 완료로 바꾸려면 모든 최종 검수, 모든 섹션 확인, 납품 URL이 필요합니다.</p>
            <div className="dp-status-row" style={{marginTop: 12}}>
              <label className="lbl" htmlFor="detail-status" style={{margin: 0}}>상태</label>
              <select id="detail-status" className="field" style={{width: 'auto'}} value={project.status} onChange={(e) => update('status', e.target.value as DetailStatus)}>
                {Object.entries(DETAIL_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
              </select>
              <label className="lbl" htmlFor="detail-deadline" style={{margin: 0}}>납기</label>
              <input id="detail-deadline" type="date" className="field" style={{width: 'auto'}} value={project.deadline} onChange={(e) => update('deadline', e.target.value)} />
            </div>
            <div className="dp-checks" style={{marginTop: 14}}>{Object.entries(CHECK_LABELS).map(([key, label]) => <label key={key} className="row" style={{gap: 6}}><input type="checkbox" checked={project.checks[key as keyof typeof project.checks]} onChange={(e) => update('checks', {...project.checks, [key]: e.target.checked})} />{label}</label>)}</div>
            <div className="dp-form-grid" style={{marginTop: 14}}>
              <Field wide multiline label="수정 메모" value={project.revisionNote} onChange={(v) => update('revisionNote', v)} />
              <Field wide label="납품 URL" value={project.deliveryUrl} onChange={(v) => update('deliveryUrl', v)} />
            </div>
          </section>
        </fieldset>
        <aside className="dp-phone-wrap">
          <div className="card"><strong>모바일 텍스트 레이아웃</strong><p className="faint" style={{margin: '4px 0 0'}}>최대 375px 폭의 텍스트 배치 미리보기입니다. 실제 이미지는 표시하지 않습니다.</p></div>
          <div className="dp-phone">
            <div className="dp-phone-header"><span>{project.brand || '브랜드'}</span><h2>{project.product || project.title || '제품 이름'}</h2><p>{project.keyMessage || '핵심 메시지를 입력하세요.'}</p></div>
            {project.sections.map((section) => <section className="dp-phone-section" key={section.id}><h3>{section.title}</h3><p>{section.copy || '카피를 입력하세요.'}</p><div className="dp-phone-visual">이미지 연출: {section.visual || '연출 내용을 입력하세요.'}</div></section>)}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({label, value, onChange, multiline = false, wide = false, placeholder}: {label: string; value: string; onChange: (value: string) => void; multiline?: boolean; wide?: boolean; placeholder?: string}) {
  const id = useId();
  return <label className={`dp-field ${wide ? 'wide' : ''}`} htmlFor={id}><span className="lbl">{label}</span>{multiline ? <textarea id={id} className="field" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <input id={id} className="field" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}</label>;
}
