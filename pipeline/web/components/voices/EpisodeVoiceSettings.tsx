'use client';

import Link from 'next/link';
import {useCallback, useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import {JobLog} from '@/components/RunConsole';
import type {JobInfo} from '@/lib/types';
import {ttsApi, type VoiceEpisode, type VoiceEpisodeKey, type VoicePreset} from '@/lib/ttsTypes';
import './voices.css';

export function EpisodeVoiceSettings({episodeKey, selectedPreset, compact=false}: {episodeKey:VoiceEpisodeKey; selectedPreset?:VoicePreset|null; compact?:boolean}) {
  const [episode,setEpisode]=useState<VoiceEpisode|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [jobId,setJobId]=useState<string|null>(null);
  const router=useRouter();
  const {track,date,num}=episodeKey;
  const query=new URLSearchParams({track,date,num}).toString();
  const refresh=useCallback(async()=>{
    try {setEpisode(await ttsApi<VoiceEpisode>('episode?'+new URLSearchParams({track,date,num})));setError('');}
    catch(e){setError((e as Error).message);}
  },[track,date,num]);
  useEffect(()=>{void refresh();},[refresh]);
  const onEnd=useCallback(()=>{void refresh();router.refresh();setBusy(false);},[refresh,router]);
  async function apply() {
    if(!selectedPreset||!episode)return;
    setBusy(true);setError('');
    try {setEpisode(await ttsApi<VoiceEpisode>('episode',{method:'PUT',json:{track,date,num,
      presetId:selectedPreset.id,presetRevision:selectedPreset.revision,expectedRevision:episode.snapshot?.revision??0}}));router.refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function generate() {
    setBusy(true);setError('');
    try {const {job}=await ttsApi<{job:JobInfo}>('episode/generate',{json:{track,date,num}});setJobId(job.id);}
    catch(e){setError((e as Error).message);setBusy(false);}
  }
  return <section className={compact?'card':'voice-section'} aria-label="회차 내레이션 설정">
    <div className="row" style={{justifyContent:'space-between',gap:10}}><strong>회차 내레이션</strong><Link className="btn sm" href={'/voices?'+query}>음성 스튜디오에서 듣기</Link></div>
    {episode?<>
      <p className="muted">{episode.title} · {track}-{num}</p>
      {!episode.usesTts?<p>이 회차는 클립 원음을 사용합니다. TTS 설정을 적용하지 않습니다.</p>:<>
        <p>적용 설정: <strong>{episode.snapshot?.preset?.name??'기존 음성 설정'}</strong>{episode.snapshot?.preset?` · r${episode.snapshot.preset.revision}`:''}</p>
        {episode.stale?<p className="voice-warning">음성 설정·대본이 바뀌었습니다. 새 음성으로 타임라인을 갱신한 뒤 렌더하세요.</p>:null}
        <div className="row" style={{gap:8,flexWrap:'wrap'}}>
          {selectedPreset?<button className="btn" disabled={busy} onClick={apply}>“{selectedPreset.name}” 이 회차에 적용</button>:null}
          <button className="btn" disabled={busy||(track==='A'&&!episode.hasTimeline)} onClick={generate}>{busy?'작업 중…':'새 음성·타임라인 만들기'}</button>
        </div>
        {track==='A'?<p className="faint">기존 컷 영상을 재사용합니다. 컷 영상이 준비되어 있어야 합니다.</p>:<p className="faint">음성 길이에 맞춰 자막과 클립 길이를 다시 계산합니다.</p>}
      </>}
    </>:<p className="faint">음성 엔진이 실행되면 회차 설정을 확인할 수 있습니다.</p>}
    {error?<p role="alert" className="voice-error">{error} <button className="btn sm" onClick={refresh}>다시 확인</button></p>:null}
    {jobId?<JobLog jobId={jobId} onEnd={onEnd}/>:null}
  </section>;
}
