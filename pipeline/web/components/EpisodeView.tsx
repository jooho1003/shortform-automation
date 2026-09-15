'use client';

import Link from 'next/link';
import {useEffect, useState} from 'react';

import ClipPicker from '@/components/ClipPicker';
import CutBoard, {formatFixRequest} from '@/components/CutBoard';
import GateButtons from '@/components/GateButtons';
import PlanEditor from '@/components/PlanEditor';
import {PlayerPane} from '@/components/PlayerPane';
import RenderRoutePicker from '@/components/RenderRoutePicker';
import {RunConsole} from '@/components/RunConsole';
import {TimelineEditor} from '@/components/TimelineEditor';
import {EpisodeVoiceSettings} from '@/components/voices/EpisodeVoiceSettings';
import {fmtDate, media} from '@/lib/client';
import type {EpisodeDetail, PlanA, Timeline} from '@/lib/types';
import {STEPS_BY_TRACK, STEP_LABEL} from '@/lib/types';

const TABS_B = [
  {id: 'plan', label: '① 기획'},
  {id: 'clips', label: '② 소재 후보'},
  {id: 'preview', label: '③ 미리보기·타임라인'},
  {id: 'video', label: '④ 완성본·업로드'},
  {id: 'run', label: '실행·로그'},
];
const TABS_A = [
  {id: 'plan', label: '① 기획'},
  {id: 'images', label: '② 시트·키프레임'},
  {id: 'cuts', label: '③ 컷 영상'},
  {id: 'video', label: '④ 완성본·업로드'},
  {id: 'run', label: '실행·로그'},
];

function getNextAction(detail: EpisodeDetail, planA: PlanA | null) {
  const {episode, assets, plan, clip_list: clipList, timeline} = detail;
  const gates = episode.gates;
  if (!plan) {
    return {tab: 'plan', label: '기획 열기', description: '기획안 파일이 아직 없습니다.'};
  }
  if (episode.track === 'A' && !planA) {
    return {tab: 'plan', label: '기획 열기', description: '기획안의 컷표가 아직 없습니다.'};
  }
  if (detail.fix_requests.plan) {
    return {tab: 'plan', label: '기획 요청 확인', description: '기획 수정 요청 파일이 있어 처리 대기 중입니다.'};
  }
  if (detail.fix_requests.clips) {
    return {
      tab: episode.track === 'A' ? 'images' : 'clips',
      label: '수정 요청 확인',
      description: '수정 요청 파일이 있어 처리 대기 중입니다.',
    };
  }
  if (!gates.plan_ok) {
    return {tab: 'plan', label: '기획 확인', description: '기획 승인 파일이 아직 없습니다.'};
  }
  if (episode.track === 'A') {
    const plannedCuts = planA?.cuts ?? [];
    const hasSheet = assets.images.some((file) => file.endsWith('/시트.png'));
    const hasEveryKeyframe = plannedCuts.every((cut) => assets.images.some((file) => file.endsWith(`/키프레임-${String(cut.n).padStart(2, '0')}.png`)));
    if (!hasSheet || !hasEveryKeyframe) {
      return {tab: 'images', label: '이미지 확인', description: '캐릭터 시트 또는 기획된 컷의 키프레임 파일이 아직 없습니다.'};
    }
    if (!gates.clips_ok) {
      return {tab: 'images', label: '이미지 확인', description: '이미지 파일은 있으며, 이미지 승인 파일이 아직 없습니다.'};
    }
    const hasEveryClip = plannedCuts.every((cut) => assets.clips.some((file) => file.endsWith(`/클립/${String(cut.n).padStart(2, '0')}.mp4`)));
    if (!hasEveryClip) {
      return {tab: 'cuts', label: '컷 영상 확인', description: '기획된 컷의 영상 파일이 아직 모두 없습니다.'};
    }
  } else {
    if (!clipList?.length) {
      return {tab: 'clips', label: '소재 후보 확인', description: '소재 후보 파일이 아직 없습니다.'};
    }
    if (!gates.clips_ok) {
      return {tab: 'clips', label: '소재 후보 확인', description: '소재 후보 파일은 있으며, 소재 승인 파일이 아직 없습니다.'};
    }
    if (!timeline) {
      return {tab: 'preview', label: '미리보기 열기', description: '타임라인 파일이 아직 없습니다.'};
    }
  }
  if (!episode.files.final_mp4) {
    return {tab: 'video', label: '완성본 확인', description: '완성 영상 파일이 아직 없습니다.'};
  }
  return {tab: 'video', label: '완성본 열기', description: '완성 영상 파일이 있습니다. YouTube 업로드는 별도 승인 후 실행합니다.'};
}

/** A안 02-이미지/검사.json (check_frames 결과) 요약. */
function FrameCheck({dir}: {dir: string}) {
  const [report, setReport] = useState<{sheet: boolean; missing_required: number[]; problems: string[]; ok: boolean; files: {name: string; width: number; height: number}[]} | null>(null);
  useEffect(() => {
    fetch(`/api/text?path=${encodeURIComponent(`${dir}/02-이미지/검사.json`)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: {text?: string} | null) => setReport(d?.text ? JSON.parse(d.text) : null))
      .catch(() => setReport(null));
  }, [dir]);
  if (!report) return null;
  return (
    <div className="card row" style={{gap: 8}}>
      <span className={`badge ${report.ok ? 'ok' : 'warn'}`}>{report.ok ? '검사 통과' : '검사 경고'}</span>
      <span className={`badge ${report.sheet ? 'ok' : 'danger'}`}>시트 {report.sheet ? '있음' : '없음'}</span>
      {report.missing_required.length ? <span className="badge danger">필수 컷 누락 {report.missing_required.join(', ')}</span> : null}
      {report.problems.length ? <span className="badge warn">비율·크기·워터마크 의심: {report.problems.join(', ')}</span> : null}
      <span className="faint">파일 {report.files.length}개 · 9:16 · 세로 1280px 이상 기준</span>
    </div>
  );
}

export function EpisodeView({detail, tab: initialTab}: {detail: EpisodeDetail; tab: string}) {
  const ep = detail.episode;
  const tabs = ep.track === 'A' ? TABS_A : TABS_B;
  const [tab, setTab] = useState(tabs.some((t) => t.id === initialTab) ? initialTab : 'plan');
  const [liveTimeline, setLiveTimeline] = useState<Timeline | null>(null);
  const key = {track: ep.track, date: ep.date, num: ep.num, dir: ep.dir};
  const timeline = liveTimeline ?? detail.timeline;
  const planA = ep.track === 'A' && detail.plan && 'cuts' in detail.plan ? detail.plan as PlanA : null;
  const nextAction = getNextAction(detail, planA);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{gap: 6, marginBottom: 4}}>
            <Link href="/" className="faint">
              ← 회차
            </Link>
            <span className={`badge track-${ep.track}`}>{ep.track}안</span>
            <span className="faint mono">{ep.dir}</span>
          </div>
          <h1>{ep.title}</h1>
          <p>
            {STEPS_BY_TRACK[ep.track].map((s) => (
              <span key={s} className={`badge ${ep.steps[s]?.done ? 'ok' : ''}`} style={{marginRight: 4}}>
                {STEP_LABEL[s]}
                {ep.steps[s]?.done ? ` ✓ ${fmtDate(ep.steps[s]?.at)}` : ''}
              </span>
            ))}
          </p>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="next-action card">
        <div>
          <strong>다음 작업</strong>
          <p className="faint">{nextAction.description}</p>
        </div>
        <button className="btn primary" onClick={() => setTab(nextAction.tab)}>{nextAction.label}</button>
      </div>

      {tab === 'plan' ? (
        <div className="grid" style={{gap: 14}}>
          <div className="card">
            <div className="row" style={{justifyContent: 'space-between'}}>
              <strong>기획 승인 게이트</strong>
              <GateButtons key={`plan-${ep.gates.plan_ok}-${ep.gates.plan_fix}-${detail.fix_requests.plan ?? ''}`} dir={ep.dir} gate="plan" gates={ep.gates} fixNote={detail.fix_requests.plan} />
            </div>
            <p className="faint" style={{margin: '8px 0 0'}}>
              승인하면 <span className="mono">01-기획-승인.txt</span>가 만들어지고 plan 단계가 통과합니다. 수정 요청은 <span className="mono">01-기획-수정요청.txt</span>에 적힙니다.
            </p>
          </div>
          <PlanEditor dir={ep.dir} markdown={detail.plan_md} plan={detail.plan} planError={detail.plan_error} track={ep.track} />
          {detail.plan ? <EpisodeVoiceSettings episodeKey={{track:ep.track,date:ep.date,num:ep.num}} compact /> : null}
        </div>
      ) : null}

      {tab === 'clips' ? (
        <div className="grid" style={{gap: 14}}>
          <div className="card">
            <div className="row" style={{justifyContent: 'space-between'}}>
              <strong>소재 승인 게이트</strong>
              <GateButtons key={`clips-${ep.gates.clips_ok}-${ep.gates.clips_fix}-${detail.fix_requests.clips ?? ''}`} dir={ep.dir} gate="clips" gates={ep.gates} fixNote={detail.fix_requests.clips} />
            </div>
            <p className="faint" style={{margin: '8px 0 0'}}>
              후보를 클릭하면 <span className="mono">클립목록.json</span>의 chosen이 바뀝니다. 비공식 채널(빨간 표시)이 남아 있으면 승인 전에 확인하세요.
            </p>
          </div>
          <ClipPicker dir={ep.dir} entries={detail.clip_list ?? []} contactSheet={ep.files.contact_sheet} />
        </div>
      ) : null}

      {tab === 'preview' ? (
        timeline ? (
          <div className="grid" style={{gap: 14}}>
            <PlayerPane timeline={timeline} episodeDir={ep.dir} />
            <TimelineEditor dir={ep.dir} timeline={detail.timeline!} onChange={setLiveTimeline} />
          </div>
        ) : (
          <div className="empty">
            타임라인이 없습니다. <b>③ 소재 준비(assets)</b> 단계를 실행하면 <span className="mono">03-소재/타임라인.json</span>이 만들어지고 여기서 렌더 없이 재생됩니다.
          </div>
        )
      ) : null}

      {tab === 'images' ? (
        <div className="grid" style={{gap: 14}}>
          <div className="card">
            <div className="row" style={{justifyContent: 'space-between'}}>
              <strong>이미지 승인 게이트 (시트 + 키프레임)</strong>
              <GateButtons key={`images-${ep.gates.clips_ok}-${ep.gates.clips_fix}-${detail.fix_requests.clips ?? ''}`} dir={ep.dir} gate="clips" gates={ep.gates} fixNote={detail.fix_requests.clips ? formatFixRequest(detail.fix_requests.clips) : null} />
            </div>
          </div>
          <FrameCheck dir={ep.dir} />
          <CutBoard key={`images-board-${detail.fix_requests.clips ?? 'none'}`} dir={ep.dir} plan={planA} images={detail.assets.images} clips={detail.assets.clips} pendingFix={detail.fix_requests.clips} onGoToRun={() => setTab('run')} />
        </div>
      ) : null}

      {tab === 'cuts' ? (
        <CutBoard key={`cuts-board-${detail.fix_requests.clips ?? 'none'}`} dir={ep.dir} plan={planA} images={detail.assets.images} clips={detail.assets.clips} pendingFix={detail.fix_requests.clips} onGoToRun={() => setTab('run')} />
      ) : null}

      {tab === 'video' ? (
        <div className="grid" style={{gap: 14}}>
          {ep.files.final_mp4 ? (
            <div className="row" style={{alignItems: 'flex-start', gap: 16}}>
              <video src={media(ep.files.final_mp4)} controls style={{width: 'min(100%, 360px)', aspectRatio: '9/16', background: '#000', borderRadius: 12}} />
              <div className="card" style={{flex: 1}}>
                <div className="row" style={{justifyContent: 'space-between'}}>
                  <strong>업로드 승인 게이트</strong>
                  <GateButtons key={`upload-${ep.gates.upload_ok}`} dir={ep.dir} gate="upload" gates={ep.gates} fixNote={null} />
                </div>
                <p className="faint">YouTube 업로드는 실행·로그 탭에서 한 번 더 확인을 거칩니다.</p>
                {detail.result ? (
                  <dl className="kv" style={{marginTop: 10}}>
                    {detail.result.url ? (
                      <>
                        <dt>URL</dt>
                        <dd>
                          <a href={detail.result.url} target="_blank" rel="noreferrer" style={{color: 'var(--info)'}}>
                            {detail.result.url}
                          </a>
                        </dd>
                        <dt>공개</dt>
                        <dd>{detail.result.privacy}</dd>
                      </>
                    ) : null}
                    {detail.result.error ? (
                      <>
                        <dt>오류</dt>
                        <dd className="mono" style={{color: 'var(--danger)'}}>
                          {detail.result.error}
                        </dd>
                      </>
                    ) : null}
                    <dt>시각</dt>
                    <dd>{fmtDate(detail.result.at)}</dd>
                  </dl>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="empty">완성본이 없습니다. render 단계를 실행하면 <span className="mono">04-영상/final.mp4</span>가 생깁니다.</div>
          )}
        </div>
      ) : null}

      {tab === 'run' ? (
        <div className="grid" style={{gap: 14}}>
          <RenderRoutePicker dir={ep.dir} />
          <RunConsole ep={key} steps={ep.steps} />
          {ep.errors.length ? (
            <div className="card">
              <strong>기록된 오류</strong>
              <table className="tbl" style={{marginTop: 8}}>
                <tbody>
                  {ep.errors.slice(-10).map((e, i) => (
                    <tr key={i}>
                      <td className="faint" style={{whiteSpace: 'nowrap'}}>
                        {fmtDate(e.at)}
                      </td>
                      <td>{e.step}</td>
                      <td className="mono">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
