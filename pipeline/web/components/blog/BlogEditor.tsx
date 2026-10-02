'use client';

import Image from 'next/image';
import Link from 'next/link';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {blogDocument} from '@/lib/blogRender';
import {BLOG_CATEGORIES, SELF_PAID_CATEGORY} from '@/lib/blogTypes';
import type {BlogBundle, BlogFact, BlogImage, BlogOutline, BlogProject} from '@/lib/blogTypes';
import styles from './blog.module.css';

type Tab = 'outline' | 'facts' | 'body' | 'images' | 'publish';
const STEPS = ['키워드', '개요', '근거', '본문', '윤문', '이미지', '점검', '게시'];
const STATUS_INDEX: Record<BlogProject['status'], number> = {keyword: 0, outline: 1, facts: 2, draft: 4, images: 5, review: 6, ready: 7, drafted: 7, published: 8};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? '요청 실패');
  return value as T;
}

export function BlogEditor({initial}: {initial: BlogBundle}) {
  const [bundle, setBundle] = useState(initial);
  const [project, setProject] = useState(initial.project);
  const [body, setBody] = useState(initial.body);
  const [outlineText, setOutlineText] = useState(JSON.stringify(initial.outline, null, 2));
  const [facts, setFacts] = useState<BlogFact[]>(initial.facts);
  const [images, setImages] = useState<BlogImage[]>(initial.images);
  const [tab, setTab] = useState<Tab>(initial.outline ? 'body' : 'outline');
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(initial.state.status === 'running');
  const [message, setMessage] = useState<string | null>(null);
  const [factsDirty, setFactsDirty] = useState(false);
  const api = `/api/blog/${project.id}`;

  const adopt = useCallback((next: BlogBundle) => {
    setBundle(next); setProject(next.project); setBody(next.body); setOutlineText(JSON.stringify(next.outline, null, 2)); setFacts(next.facts); setImages(next.images);
  }, []);

  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => {
      request<BlogBundle>(api).then((next) => {
        adopt(next);
        if (next.state.status !== 'running') {
          setPolling(false);
          setMessage(next.state.status === 'failed' ? next.state.error : '자동 생성 단계가 완료됐습니다.');
        }
      }).catch((error) => { setPolling(false); setMessage(error.message); });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [adopt, api, polling]);

  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      let outline: BlogOutline | null = null;
      if (outlineText.trim() && outlineText.trim() !== 'null') outline = JSON.parse(outlineText) as BlogOutline;
      const next = await request<BlogBundle>(api, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: project.revision, project, body, outline, facts, images})});
      adopt(next); setFactsDirty(false); setMessage('저장했습니다.');
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  const outline = async () => {
    setBusy(true); setMessage('상위 검색 결과를 확인하고 개요를 생성합니다…');
    try { const next = await request<BlogBundle>(`${api}/outline`, {method: 'POST'}); adopt(next); setTab('outline'); setMessage('개요를 만들었습니다. 확인 후 승인하세요.'); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  const gate = async (gateName: 'outline' | 'body', action: 'ok' | 'fix') => {
    let note = '';
    if (action === 'fix') {
      note = window.prompt('수정 요청을 입력하세요.')?.trim() ?? '';
      if (!note) return;
    }
    setBusy(true); setMessage(null);
    try {
      const result = await request<{bundle: BlogBundle; job: {id: string} | null}>(`${api}/gate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({gate: gateName, action, note, ...(gateName === 'body' ? {category: project.category} : {})})});
      adopt(result.bundle);
      if (result.job) { setPolling(true); setMessage(`근거→본문→이미지→점검 작업을 시작했습니다: ${result.job.id}`); }
      else setMessage(action === 'ok' ? '승인했습니다.' : '수정 요청을 저장했습니다.');
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  const runFrom = async (from: 'facts' | 'draft' | 'polish' | 'images' | 'lint') => {
    setBusy(true); setMessage(null);
    try { const {job} = await request<{job: {id: string}}>(`${api}/run`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({from})}); setPolling(true); setMessage(`이어하기 작업을 시작했습니다: ${job.id}`); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  const makePackage = async () => {
    setBusy(true); setMessage(null);
    try {
      const pack = await request<{dir: string; html: string; text: string; tags: string}>(`${api}/package`, {method: 'POST'});
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([pack.html], {type: 'text/html'}), 'text/plain': new Blob([`${pack.text}\n\n${pack.tags}`], {type: 'text/plain'})})]);
        setMessage(`복사 패키지를 만들고 서식 있는 본문을 클립보드에 복사했습니다: ${pack.dir}`);
      } else {
        await navigator.clipboard.writeText(`${pack.text}\n\n${pack.tags}`);
        setMessage(`복사 패키지를 만들고 일반 텍스트를 복사했습니다: ${pack.dir}`);
      }
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  const draftToNaver = async () => {
    if (!window.confirm('브라우저 자동화는 네이버 약관상 위험이 있을 수 있습니다. 발행하지 않고 임시저장까지만 진행할까요?')) return;
    setBusy(true); setMessage(null);
    try { const {job} = await request<{job: {id: string}}>('/api/jobs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({preset: 'blog-publish', id: project.id, mode: 'draft', confirmed: true})}); setMessage(`임시저장 작업을 시작했습니다. 작업 로그: ${job.id}`); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  const removeFact = (index: number) => { setFacts((current) => current.filter((_, i) => i !== index)); setFactsDirty(true); };
  const completed = STATUS_INDEX[project.status];
  const tabs: {id: Tab; label: string}[] = [{id: 'outline', label: '개요'}, {id: 'facts', label: '근거'}, {id: 'body', label: '본문'}, {id: 'images', label: '이미지'}, {id: 'publish', label: '게시'}];
  const lintCount = (bundle.lint?.errors.length ?? 0) + (bundle.lint?.warnings.length ?? 0);
  const imageBase = `블로그/${project.id}/`;
  const approvalChanged = bundle.gates.body && !bundle.gates.bodyValid;
  const previewHtml = useMemo(() => blogDocument(project.title || project.keyword.main, body).replace(/src="이미지\/([^"/]+)"/g, (_match, file: string) => `src="/api/media?path=${encodeURIComponent(`${imageBase}이미지/${file}`)}"`), [body, imageBase, project.keyword.main, project.title]);

  return <>
    <div className="page-head"><div><h1><Link href="/blog">블로그</Link> › {project.title || project.keyword.main}</h1><p>{project.keyword.main} · revision {project.revision} · {project.status}</p></div><div className="row"><button className="btn" disabled={busy} onClick={save}>저장</button>{!bundle.outline ? <button className="btn primary" disabled={busy} onClick={outline}>개요 생성</button> : null}</div></div>
    {message ? <div className="card" style={{marginBottom: 14}}><span className={`badge ${message.includes('오류') || message.includes('실패') ? 'danger' : 'info'}`}>{polling ? '진행 중' : '안내'}</span> <span className="muted">{message}</span></div> : null}
    {approvalChanged ? <div className={styles.gateNotice} style={{marginBottom: 14}}>승인 이후 본문 또는 이미지가 변경되었습니다. 게시 전에 원고를 다시 승인하세요.</div> : null}
    <div className={styles.workspace}>
      <aside className={`card ${styles.stepper}`}>{STEPS.map((step, index) => <div key={step} className={`${styles.step} ${index < completed ? styles.done : ''} ${index === completed ? styles.current : ''}`}>{index < completed ? '✓' : index === completed ? '●' : '○'} {step}</div>)}</aside>
      <main className={styles.editor}>
        <div className="tabs">{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}{item.id === 'publish' && lintCount ? ` (${lintCount})` : ''}</button>)}</div>
        {tab === 'outline' ? <div className="card grid"><textarea className="editor" aria-label="개요 JSON" value={outlineText} onChange={(event) => setOutlineText(event.target.value)} /><div className={styles.toolbar}>{bundle.outline ? <><button className="btn primary" disabled={busy || bundle.gates.outline} onClick={() => gate('outline', 'ok')}>개요 승인·자동 생성</button><button className="btn" disabled={busy} onClick={() => gate('outline', 'fix')}>수정 요청</button></> : <button className="btn primary" disabled={busy} onClick={outline}>개요 생성</button>}</div></div> : null}
        {tab === 'facts' ? <div className="card"><div className={styles.toolbar}><strong>주장–출처</strong>{factsDirty ? <span className="badge warn">본문 재생성 필요</span> : null}<button className="btn sm" disabled={busy} onClick={() => runFrom('facts')}>근거부터 다시 생성</button></div>{facts.length ? facts.map((fact, index) => <div className={styles.factRow} key={`${fact.id}-${index}`}><input className="field" value={fact.id} onChange={(event) => setFacts((current) => current.map((item, i) => i === index ? {...item, id: event.target.value} : item))} /><textarea className="field" value={fact.claim} onChange={(event) => setFacts((current) => current.map((item, i) => i === index ? {...item, claim: event.target.value} : item))} /><div><input className="field" value={fact.source_url} onChange={(event) => setFacts((current) => current.map((item, i) => i === index ? {...item, source_url: event.target.value} : item))} /><div className="faint" style={{marginTop: 4}}>{body.includes(fact.claim.slice(0, 20)) ? '본문에서 사용됨' : '본문 사용 여부 확인 필요'}</div></div><button className="btn sm danger" onClick={() => removeFact(index)}>삭제</button></div>) : <div className="empty">근거가 없습니다.</div>}</div> : null}
        {tab === 'body' ? <div className="card grid"><div className={styles.toolbar}><input className="field" style={{flex: 1}} aria-label="제목" value={project.title} onChange={(event) => setProject({...project, title: event.target.value})} /><select className="field" style={{width: 150}} value={project.disclosure} onChange={(event) => setProject({...project, disclosure: event.target.value as BlogProject['disclosure']})}><option value="none">광고 아님</option><option value="ad">광고</option><option value="sponsored">협찬</option><option value="affiliate">제휴</option></select></div><textarea className="editor" aria-label="블로그 본문" value={body} onChange={(event) => setBody(event.target.value)} /><div className={styles.toolbar}><button className="btn" disabled={busy} onClick={() => runFrom('draft')}>본문부터 재생성</button><button className="btn" disabled={busy} onClick={() => runFrom('polish')}>윤문부터 재실행</button><button className="btn" disabled={busy} onClick={() => runFrom('lint')}>점검</button></div></div> : null}
        {tab === 'images' ? <div className="card grid"><div className={styles.toolbar}><strong>대표·본문 이미지</strong><button className="btn sm" disabled={busy} onClick={() => runFrom('images')}>이미지부터 다시 실행</button></div><div className={styles.imageGrid}>{images.map((image, index) => <div className={styles.imageCard} key={image.file}><Image src={`/api/media?path=${encodeURIComponent(imageBase + image.file)}`} alt={image.alt || '블로그 이미지'} width={320} height={240} unoptimized /><div className="faint">{image.file} · {image.kind}</div><input className="field" aria-label={`${image.file} 대체 텍스트`} value={image.alt} onChange={(event) => setImages((current) => current.map((item, i) => i === index ? {...item, alt: event.target.value} : item))} /></div>)}</div>{!images.length ? <div className="empty">이미지가 아직 없습니다.</div> : null}</div> : null}
        {tab === 'publish' ? <div className={`card ${styles.publishPanel}`}><label><span className="lbl">게시 준비 모드</span><select className="field" value={project.publish.mode} onChange={(event) => setProject({...project, publish: {...project.publish, mode: event.target.value as 'copy' | 'draft'}})}><option value="copy">copy · 사람이 붙여넣기</option><option value="draft">draft · 네이버 임시저장(옵트인)</option></select></label><div className={styles.toolbar}><button className="btn primary" disabled={busy || !bundle.gates.bodyValid} onClick={makePackage}>복사 패키지 만들기·복사</button><button className="btn" disabled={busy || !bundle.gates.bodyValid || project.publish.mode !== 'draft'} onClick={draftToNaver}>네이버에 임시저장</button></div><div className="faint">자동 발행·예약 발행은 구현하지 않습니다. draft도 발행 버튼을 누르지 않습니다.</div></div> : null}
        <div className="card"><div className={styles.toolbar}><strong>승인</strong><span className={`badge ${bundle.gates.bodyValid ? 'ok' : 'warn'}`}>{bundle.gates.bodyValid ? '현재 원고 승인됨' : '원고 승인 필요'}</span><select className="field" style={{width: 130}} aria-label="카테고리" value={project.category} onChange={(event) => setProject({...project, category: event.target.value})}>{[...new Set([...BLOG_CATEGORIES, project.category])].filter(Boolean).map((name) => <option key={name} value={name} disabled={name === SELF_PAID_CATEGORY && project.disclosure !== 'none'}>{name}</option>)}{project.category ? null : <option value="">카테고리 없음</option>}</select><button className="btn primary" disabled={busy || !bundle.lint || Boolean(bundle.lint.errors.length)} onClick={() => gate('body', 'ok')}>원고 승인</button><button className="btn" disabled={busy} onClick={() => gate('body', 'fix')}>수정 요청</button></div></div>
      </main>
      <aside className={styles.preview}>
        <div className="card"><strong>모바일 미리보기</strong><iframe className={styles.frame} title="블로그 본문 미리보기" sandbox="" srcDoc={previewHtml} /></div>
        <div className="card"><div className={styles.toolbar}><strong>점검</strong><span className={`badge ${bundle.lint?.errors.length ? 'danger' : 'ok'}`}>error {bundle.lint?.errors.length ?? 0}</span><span className="badge warn">warn {bundle.lint?.warnings.length ?? 0}</span></div><ul className={styles.lintList}>{bundle.lint?.errors.map((item) => <li key={item.code}><span className="badge danger">오류</span> {item.message}</li>)}{bundle.lint?.warnings.map((item) => <li key={item.code}><span className="badge warn">주의</span> {item.message}</li>)}</ul>{!bundle.lint ? <div className="faint" style={{marginTop: 8}}>아직 점검하지 않았습니다.</div> : null}</div>
      </aside>
    </div>
  </>;
}
