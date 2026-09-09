'use client';

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useCallback, useState} from 'react';

import {JobLog} from '@/components/RunConsole';
import {api, fmtSec, media} from '@/lib/client';
import type {ClientSurvey} from '@/lib/clientTypes';
import type {ReelAnalysis, ReelPlan, ReelProject} from '@/lib/reelsTypes';
import type {JobInfo} from '@/lib/types';

const SURVEY_LABELS: [keyof ClientSurvey, string][] = [
  ['industry', '업종/서비스 분야'],
  ['main_product', '대표 상품 또는 핵심 서비스'],
  ['instagram_url', '인스타그램 계정 URL'],
  ['external_channels', '운영 중인 외부 채널'],
  ['key_message', '핵심 메시지 및 강점'],
  ['target', '타깃 고객층 (성별/연령대/니즈)'],
  ['purpose', '계정 운영 목적'],
  ['tone', '콘텐츠 방향 · 톤앤매너'],
];
const EMPTY_SURVEY: ClientSurvey = {industry: '', main_product: '', instagram_url: '', external_channels: '', key_message: '', target: '', purpose: '', tone: ''};

type Props = {
  project: ReelProject;
  analysis: ReelAnalysis | null;
  plan: ReelPlan | null;
  planMd: string | null;
  clients: {slug: string; name: string; survey: ClientSurvey}[];
};

export function ReelProjectView({project, analysis, plan, clients}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'ref' | 'analysis' | 'plan'>(plan ? 'plan' : analysis ? 'analysis' : 'ref');
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [survey, setSurvey] = useState<ClientSurvey>(project.survey ?? EMPTY_SURVEY);
  const [brand, setBrand] = useState(project.brand_name);
  const [client, setClient] = useState(project.client ?? '');
  const [target, setTarget] = useState<15 | 30 | 50>(plan?.target_seconds ?? 30);
  const [style, setStyle] = useState(plan?.thumbnail_style ?? '숫자·대비 강조');
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude');
  const [revise, setRevise] = useState({instructions: '', must_include: '', must_exclude: ''});
  const [manual, setManual] = useState('');

  const onJobEnd = useCallback(() => {
    setJobId(null);
    router.refresh();
  }, [router]);

  const call = async (label: string, url: string, json?: unknown) => {
    setBusy(label);
    setError(null);
    try {
      const res = await api<{job?: JobInfo}>(url, {method: 'POST', json: json ?? {}});
      if (res.job) setJobId(res.job.id);
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveSurvey = async () => {
    setBusy('survey');
    setError(null);
    try {
      await api(`/api/reels/${project.id}`, {method: 'PUT', json: {survey, brand_name: brand, client: client || null}});
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ref = project.reference;
  const hasVideo = !!project.local_video;
  const hasTranscript = !!analysis?.transcript?.length;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/reels" className="faint">
            ← 릴스 기획
          </Link>
          <h1>{project.title}</h1>
          <p className="row" style={{gap: 6}}>
            <span className="badge">{ref.provider}</span>
            <a href={ref.url} target="_blank" rel="noreferrer" className="muted">
              {ref.author} · {ref.title}
            </a>
          </p>
        </div>
        <div className="row">
          {plan ? (
            <Link href={`/reels/${project.id}/print`} className="btn primary">
              기획안 PDF
            </Link>
          ) : null}
          {hasTranscript ? (
            <a href={`/api/reels/${project.id}/srt`} className="btn">
              SRT 다운로드
            </a>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="badge danger" style={{marginBottom: 12}}>
          {error}
        </div>
      ) : null}

      <div className="tabs">
        <button className={tab === 'ref' ? 'active' : ''} onClick={() => setTab('ref')}>
          ① 레퍼런스·고객 정보
        </button>
        <button className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}>
          ② 릴스 분석
        </button>
        <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>
          ③ 기획안
        </button>
      </div>

      {jobId ? (
        <div className="card" style={{marginBottom: 14}}>
          <JobLog jobId={jobId} onEnd={onJobEnd} />
        </div>
      ) : null}

      {tab === 'ref' ? (
        <div className="grid" style={{gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'start'}}>
          <div className="card">
            {hasVideo ? <video src={media(project.local_video!)} controls style={{width: '100%', aspectRatio: '9/16', background: '#000', borderRadius: 8}} /> : ref.thumb ? <img src={ref.thumb} alt="" referrerPolicy="no-referrer" style={{width: '100%', borderRadius: 8}} /> : null}
            <dl className="kv" style={{marginTop: 10}}>
              <dt>조회수</dt>
              <dd>{ref.views?.toLocaleString() ?? '-'}</dd>
              <dt>좋아요</dt>
              <dd>{ref.likes?.toLocaleString() ?? '-'}</dd>
              <dt>길이</dt>
              <dd>{ref.duration != null ? fmtSec(ref.duration) : '-'}</dd>
              <dt>게시</dt>
              <dd>{ref.upload_date ?? '-'}</dd>
            </dl>
            <div className="row" style={{marginTop: 10}}>
              <button className="btn" disabled={!!busy || !!jobId} onClick={() => call('fetch', `/api/reels/${project.id}/fetch`)}>
                {hasVideo ? '원본 다시 받기' : '원본 영상 받기'}
              </button>
            </div>
          </div>
          <div className="card">
            <div className="row" style={{justifyContent: 'space-between', marginBottom: 10}}>
              <strong>고객 정보 (사전설문)</strong>
              <div className="row">
                <select
                  className="field"
                  style={{width: 200}}
                  value={client}
                  onChange={(e) => {
                    const slug = e.target.value;
                    setClient(slug);
                    const c = clients.find((x) => x.slug === slug);
                    if (c) {
                      setSurvey(c.survey);
                      if (!brand) setBrand(c.name);
                    }
                  }}
                >
                  <option value="">고객 없이 직접 입력</option>
                  {clients.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button className="btn primary" disabled={busy === 'survey'} onClick={saveSurvey}>
                  저장
                </button>
              </div>
            </div>
            <label className="lbl">브랜드/계정 이름</label>
            <input className="field" value={brand} onChange={(e) => setBrand(e.target.value)} style={{marginBottom: 10}} />
            <div className="grid" style={{gridTemplateColumns: '1fr 1fr', gap: 10}}>
              {SURVEY_LABELS.map(([k, label]) => (
                <div key={k}>
                  <label className="lbl">{label}</label>
                  <textarea className="field" rows={2} value={survey[k]} onChange={(e) => setSurvey({...survey, [k]: e.target.value})} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'analysis' ? (
        <div className="grid" style={{gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start'}}>
          <div className="card">
            <div className="row" style={{justifyContent: 'space-between', marginBottom: 10}}>
              <strong>타임스탬프 대본</strong>
              <div className="row">
                <button className="btn" disabled={!!busy || !!jobId || !hasVideo} onClick={() => call('transcribe', `/api/reels/${project.id}/transcribe`)} title={hasVideo ? '' : '원본을 먼저 받으세요'}>
                  {hasTranscript ? '대본 다시 추출' : '대본 추출'}
                </button>
              </div>
            </div>
            {hasTranscript ? (
              <>
                <div className="faint" style={{marginBottom: 6}}>
                  출처 {analysis!.source} · {analysis!.language} · {analysis!.transcript.length}큐
                </div>
                <div className="log" style={{maxHeight: 520}}>
                  {analysis!.transcript.map((c, i) => (
                    <div key={i}>
                      <span className="faint">{fmtSec(c.start)}</span> {c.text}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="empty" style={{padding: 20}}>
                  대본이 없습니다. 유튜브면 자동 자막, 아니면 faster-whisper(설치 필요)로 뽑습니다. 아래에 직접 붙여 넣어도 됩니다.
                </div>
                <textarea className="field" rows={8} placeholder={'0:00 첫 문장\n0:03 다음 문장 …'} value={manual} onChange={(e) => setManual(e.target.value)} style={{marginTop: 8}} />
                <button className="btn sm" style={{marginTop: 6}} disabled={!manual.trim()} onClick={() => api(`/api/reels/${project.id}/transcript`, {method: 'PUT', json: {text: manual}}).then(() => router.refresh()).catch((e) => setError(e.message))}>
                  직접 입력 저장
                </button>
              </>
            )}
          </div>
          <div className="card">
            <div className="row" style={{justifyContent: 'space-between', marginBottom: 10}}>
              <strong>구조 분석 — 왜 먹혔나</strong>
              <div className="row">
                <select className="field" style={{width: 110}} value={provider} onChange={(e) => setProvider(e.target.value as 'claude' | 'codex')}>
                  <option value="claude">claude</option>
                  <option value="codex">codex</option>
                </select>
                <button className="btn primary" disabled={!!busy || !hasTranscript} onClick={() => call('analyze', `/api/reels/${project.id}/analyze`, {provider})}>
                  {busy === 'analyze' ? '분석 중…' : analysis?.structure ? '다시 분석' : '분석하기'}
                </button>
              </div>
            </div>
            {analysis?.structure ? (
              <>
                <div className="badge info" style={{marginBottom: 8}}>
                  훅
                </div>
                <p style={{marginTop: 0}}>{analysis.structure.hook}</p>
                <table className="tbl">
                  <tbody>
                    {analysis.structure.flow.map((f, i) => (
                      <tr key={i}>
                        <td className="faint" style={{whiteSpace: 'nowrap'}}>
                          {f.tc}
                        </td>
                        <td>
                          <span className="badge">{f.role}</span>
                        </td>
                        <td>{f.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="badge info" style={{margin: '12px 0 6px'}}>
                  먹힌 이유
                </div>
                <ul style={{marginTop: 0}}>
                  {analysis.structure.why_it_works.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <dl className="kv">
                  <dt>톤</dt>
                  <dd>{analysis.structure.tone}</dd>
                  <dt>CTA</dt>
                  <dd>{analysis.structure.cta}</dd>
                </dl>
              </>
            ) : (
              <div className="faint">대본이 준비되면 claude/codex가 훅·구간 역할·먹힌 이유를 뽑습니다. 이 결과가 기획안 생성의 뼈대가 됩니다.</div>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'plan' ? (
        <div className="grid" style={{gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start'}}>
          <div className="grid" style={{gap: 14}}>
            {plan ? (
              <>
                <div className="card">
                  <div className="row" style={{justifyContent: 'space-between'}}>
                    <strong>
                      기획안 v{plan.version} <span className="faint">· {plan.target_seconds}초 · {plan.provider}</span>
                    </strong>
                    <button className="btn sm" disabled={!!busy || !hasVideo} onClick={() => call('frames', `/api/reels/${project.id}/frames`)} title={hasVideo ? '' : '원본이 있어야 프레임을 뽑습니다'}>
                      스토리보드 프레임 추출
                    </button>
                  </div>
                </div>
                <div className="card">
                  <strong>썸네일 제목</strong>
                  <ol style={{marginBottom: 0}}>
                    {plan.thumbnail_titles.map((t, i) => (
                      <li key={i} style={{whiteSpace: 'pre-line'}}>
                        {t}
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="card">
                  <strong>스토리보드</strong>
                  <div className="thumb-grid" style={{marginTop: 10}}>
                    {plan.storyboard.map((f) => (
                      <div key={f.n} className="cand" style={{cursor: 'default'}}>
                        {f.frame ? <img src={media(f.frame)} alt="" style={{aspectRatio: '9/16', objectFit: 'cover'}} /> : <div style={{aspectRatio: '9/16', background: '#0a0c12', display: 'flex', alignItems: 'center', justifyContent: 'center'}} className="faint">{fmtSec(f.tc)}</div>}
                        <div className="meta">
                          <div style={{fontWeight: 700}}>
                            <span className="faint">{f.n} · {fmtSec(f.tc)}</span> {f.caption}
                          </div>
                          <div className="muted">{f.direction}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <strong>대본</strong>
                  <div style={{whiteSpace: 'pre-line', marginTop: 8}}>{plan.script}</div>
                </div>
                <div className="card">
                  <strong>촬영 가이드</strong>
                  <div style={{whiteSpace: 'pre-line', marginTop: 8}}>{plan.shooting_guide}</div>
                </div>
                <div className="card">
                  <strong>캡션</strong>
                  <div style={{whiteSpace: 'pre-line', marginTop: 8}}>{plan.caption}</div>
                  <div className="muted" style={{marginTop: 8}}>{plan.hashtags.map((h) => `#${h}`).join(' ')}</div>
                </div>
                {plan.notes ? (
                  <div className="card">
                    <strong>기획 노트</strong>
                    <div className="muted" style={{whiteSpace: 'pre-line', marginTop: 8}}>{plan.notes}</div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty">기획안이 없습니다. 오른쪽에서 길이·스타일을 정하고 생성하세요. 대본과 구조 분석이 있어야 합니다.</div>
            )}
          </div>

          <div className="grid" style={{gap: 14}}>
            <div className="card">
              <strong>{plan ? '다시 생성' : '기획안 생성'}</strong>
              <label className="lbl" style={{marginTop: 10}}>
                대본 길이
              </label>
              <div className="row">
                {([15, 30, 50] as const).map((s) => (
                  <button key={s} className={`btn sm ${target === s ? 'primary' : ''}`} onClick={() => setTarget(s)}>
                    {s}초
                  </button>
                ))}
              </div>
              <label className="lbl" style={{marginTop: 10}}>
                썸네일 제목 스타일
              </label>
              <div className="row">
                {['숫자·대비 강조', '질문형', '더 자극적으로', '더 간결하게', '감성형', '정보형'].map((s) => (
                  <button key={s} className={`btn sm ${style === s ? 'primary' : ''}`} onClick={() => setStyle(s)}>
                    {s}
                  </button>
                ))}
              </div>
              <label className="lbl" style={{marginTop: 10}}>
                모델
              </label>
              <select className="field" value={provider} onChange={(e) => setProvider(e.target.value as 'claude' | 'codex')}>
                <option value="claude">claude (기획·대본 주력)</option>
                <option value="codex">codex (대안 초안)</option>
              </select>
              <button className="btn primary" style={{marginTop: 12, width: '100%'}} disabled={!!busy || !hasTranscript} onClick={() => call('plan', `/api/reels/${project.id}/plan`, {target_seconds: target, thumbnail_style: style, provider})}>
                {busy === 'plan' ? '생성 중… (30초~2분)' : '기획안 생성'}
              </button>
              {!hasTranscript ? <div className="faint" style={{marginTop: 6}}>② 릴스 분석에서 대본을 먼저 추출하세요.</div> : null}
            </div>
            {plan ? (
              <div className="card">
                <strong>기획 수정하기</strong>
                <label className="lbl" style={{marginTop: 10}}>
                  수정 방향
                </label>
                <textarea className="field" rows={3} placeholder="예: 월급 250만원으로 내집마련 하는 법" value={revise.instructions} onChange={(e) => setRevise({...revise, instructions: e.target.value})} />
                <label className="lbl" style={{marginTop: 8}}>
                  꼭 넣고 싶은 내용
                </label>
                <input className="field" placeholder="예: 상품명, 핵심 키워드" value={revise.must_include} onChange={(e) => setRevise({...revise, must_include: e.target.value})} />
                <label className="lbl" style={{marginTop: 8}}>
                  빼고 싶은 표현
                </label>
                <input className="field" placeholder="예: 금지어, 과한 표현 등" value={revise.must_exclude} onChange={(e) => setRevise({...revise, must_exclude: e.target.value})} />
                <button className="btn primary" style={{marginTop: 12, width: '100%'}} disabled={!!busy} onClick={() => call('revise', `/api/reels/${project.id}/revise`, {...revise, target_seconds: target, thumbnail_style: style, provider})}>
                  {busy === 'revise' ? '수정 중…' : '수정 반영하기'}
                </button>
                {plan.revisions.length ? (
                  <div className="faint" style={{marginTop: 8}}>
                    이력 {plan.revisions.length}건 · 마지막: {plan.revisions.at(-1)!.instructions.slice(0, 40)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
