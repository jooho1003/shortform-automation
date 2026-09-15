'use client';

import Link from 'next/link';
import {useCallback, useEffect, useRef, useState} from 'react';
import {EpisodeVoiceSettings} from './EpisodeVoiceSettings';
import {START_VOICE, TERMINAL_TTS, TTS_STATUS, VOICE_MODE_LABEL, ttsApi, voiceFingerprint,
  type TTSConfig,type TTSCapabilities,type TTSJob,type VoicePreset,type VoiceReference,type VoiceMode,type VoiceEpisodeKey,type VoiceEpisode} from '@/lib/ttsTypes';
import './voices.css';

const SAMPLE='안녕하세요. AI가 알려주는 오늘의 이야기. 가장 가까운 이웃까지 일주일이 걸리는 섬이 있습니다.';
const languages:Record<string,string>={Korean:'한국어',English:'영어',Chinese:'중국어',Japanese:'일본어',German:'독일어',French:'프랑스어',Russian:'러시아어',Portuguese:'포르투갈어',Spanish:'스페인어',Italian:'이탈리아어'};
const speakerLabels:Record<string,string>={Sohee:'Sohee · 한국어 여성',Ryan:'Ryan · 영어 남성',Aiden:'Aiden · 영어 남성',Serena:'Serena · 중국어 여성',Uncle_Fu:'Uncle_Fu · 중국어 남성',Ono_Anna:'Ono_Anna · 일본어 여성',Vivian:'Vivian · 중국어 여성',Dylan:'Dylan · 중국어 남성',Eric:'Eric · 중국어 남성'};

export function VoiceStudio({episodeKey}: {episodeKey?:VoiceEpisodeKey}) {
  const [caps,setCaps]=useState<TTSCapabilities>({available:false});
  const [checkingConnection,setCheckingConnection]=useState(true);
  const [config,setConfig]=useState<TTSConfig>(START_VOICE);
  const [text,setText]=useState(SAMPLE);
  const [jobs,setJobs]=useState<TTSJob[]>([]);
  const [presets,setPresets]=useState<VoicePreset[]>([]);
  const [defaultPreset,setDefaultPreset]=useState<VoicePreset|null>(null);
  const [references,setReferences]=useState<VoiceReference[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [presetId,setPresetId]=useState('');
  const [editPreset,setEditPreset]=useState<VoicePreset|null>(null);
  const [name,setName]=useState('한국어 브리핑');
  const [source,setSource]=useState<'draft'|'sample'>('draft');
  const [pinned,setPinned]=useState<string[]>([]);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [pronunciation,setPronunciation]=useState(Object.entries(START_VOICE.pronunciations).map(([a,b])=>a+' = '+b).join('\n'));
  const [refText,setRefText]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [connectionVersion,setConnectionVersion]=useState(0);
  const audioRefs=useRef(new Map<string,HTMLAudioElement>());
  const submitted=useRef(false);
  const formDrafts=useRef<Partial<Record<VoiceMode,TTSConfig>>>({});
  const latestTerminal=useRef('');

  const refresh=useCallback(async()=>{
    const nextCaps=await ttsApi<TTSCapabilities>('capabilities');setCaps(nextCaps);
    if(!nextCaps.available)return;
    const [saved,refs,history]=await Promise.all([
      ttsApi<{presets:VoicePreset[];defaultPreset:VoicePreset|null}>('presets'),
      ttsApi<{references:VoiceReference[]}>('references'),ttsApi<{jobs:TTSJob[]}>('jobs')]);
    setPresets(saved.presets);setDefaultPreset(saved.defaultPreset);setReferences(refs.references);setJobs(history.jobs);
  },[]);
  useEffect(()=>{void refresh().catch(e=>setError(e.message)).finally(()=>setCheckingConnection(false));},[refresh]);
  useEffect(()=>{
    if(!caps.available)return;
    let stop=false;let timer:ReturnType<typeof setTimeout>;
    const controller=new AbortController();
    async function poll(){
      try {
        const history=await ttsApi<{jobs:TTSJob[]}>('jobs',{signal:controller.signal});
        if(stop)return;setJobs(history.jobs);
        const ended=history.jobs.find(j=>TERMINAL_TTS.has(j.status))?.id??'';
        if(ended!==latestTerminal.current){latestTerminal.current=ended;setCaps(await ttsApi<TTSCapabilities>('capabilities',{signal:controller.signal}));}
      }catch(e){if(!stop){setError((e as Error).message);setCaps(c=>({...c,available:false,error:(e as Error).message}));}}
      finally{if(!stop)timer=setTimeout(poll,document.hidden?5000:1500);}
    }
    timer=setTimeout(poll,1000);return()=>{stop=true;clearTimeout(timer);controller.abort();};
  },[caps.available]);

  const model=caps.models?.find(m=>m.id===config.modelId);
  const completed=jobs.filter(j=>j.kind==='preview'&&j.status==='done'&&j.result);
  const candidateKeys=new Set<string>();
  const candidates=[...completed.filter(j=>pinned.includes(j.id)),...completed.filter(j=>!pinned.includes(j.id))].filter(job=>{
    const key=job.result!.audioKey+job.result!.configHash;
    if(candidateKeys.has(key))return false;candidateKeys.add(key);return true;
  }).slice(0,3);
  const active=jobs.filter(j=>!TERMINAL_TTS.has(j.status));
  const selected=completed.find(j=>j.id===selectedId);
  const selectedFailure=jobs.find(j=>j.id===selectedId&&(j.status==='failed'||j.status==='interrupted'));
  const chosenPreset=presets.find(p=>p.id===presetId)??null;
  const spoken=Object.keys(config.pronunciations).length?text.replace(new RegExp(Object.keys(config.pronunciations).sort((a,b)=>b.length-a.length).map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g'),s=>config.pronunciations[s]):text;

  function update(patch:Partial<TTSConfig>){setConfig(c=>({...c,...patch}));}
  function loadConfig(c:TTSConfig){setConfig(structuredClone(c));setPronunciation(Object.entries(c.pronunciations).map(([a,b])=>a+' = '+b).join('\n'));}
  function changeMode(mode:VoiceMode){
    formDrafts.current[config.mode]=config;
    const saved=formDrafts.current[mode];
    if(saved){loadConfig(saved);return;}
    const next:TTSConfig={...config,mode,modelId:caps.models?.find(m=>m.mode===mode)?.id??config.modelId};
    delete next.speaker;delete next.instruct;delete next.referenceId;delete next.referenceHash;
    if(mode==='custom_voice')next.speaker='Sohee';
    if(mode==='voice_design')next.instruct='따뜻한 중저음의 성인 남성. 또렷하고 담백하게 한국어를 읽는 다큐멘터리 해설자.';
    loadConfig(next);setError('');
  }
  function withPronunciations():TTSConfig {
    const map:Record<string,string>={};
    for(const line of pronunciation.split('\n').filter(s=>s.trim())){
      const at=line.indexOf('=');if(at<1||!line.slice(at+1).trim())throw new Error('발음 사전은 원문 = 읽을 발음 형식으로 입력하세요.');
      map[line.slice(0,at).trim()]=line.slice(at+1).trim();
    }
    return {...config,pronunciations:map};
  }
  async function action(label:string, fn:()=>Promise<void>){setBusy(label);setError('');setNotice('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  async function generate(take:'reuse'|'new'){
    if(submitted.current)return;submitted.current=true;
    await action('generate',async()=>{
      if(!text.trim()||Array.from(text.trim()).length>500)throw new Error('미리듣기 대본은 1–500자로 입력하세요.');
      const c=withPronunciations();setConfig(c);
      const job=await ttsApi<TTSJob>('previews',{json:{text:text.trim(),config:c,take,idempotencyKey:crypto.randomUUID()}});
      setJobs(old=>[job,...old.filter(j=>j.id!==job.id)]);setSelectedId(job.id);setSource('sample');
      setNotice('샘플 생성을 요청했습니다. 완료된 결과는 아래에서 재생할 수 있습니다.');
    });submitted.current=false;
  }
  async function save(updateExisting=false){await action('save',async()=>{
    if(!name.trim())throw new Error('프리셋 이름을 입력하세요.');
    if(source==='sample'&&!selected)throw new Error('완료된 샘플을 선택하세요.');
    const c=source==='sample'&&selected?.result?selected.result.config:withPronunciations();
    const saved=await ttsApi<VoicePreset>('presets',{json:{name,config:c,...(source==='sample'?{sampleId:selectedId}:{}),
      ...(updateExisting&&editPreset?{id:editPreset.id,expectedRevision:editPreset.revision}:{})}});
    await refresh();setPresetId(saved.id);setEditPreset(saved);setNotice('“'+saved.name+'” r'+saved.revision+' 저장 완료. 기본값과 회차는 별도로 적용합니다.');
  });}
  function playOne(id:string){for(const [key,audio] of audioRefs.current)if(key!==id)audio.pause();}
  function playSample(id:string){
    const audio=audioRefs.current.get(id);
    if(audio){audio.currentTime=0;void audio.play().catch(()=>setError('음성을 재생하지 못했습니다. 파일을 다시 생성하거나 WAV로 저장해 확인하세요.'));}
  }
  function pin(id:string){setPinned(old=>old.includes(id)?old.filter(x=>x!==id):old.length<3?[...old,id]:old);}

  return <div className="voice-studio">
    <div className="page-head"><div><h1>음성 스튜디오</h1><p>읽는 목소리를 고르고, 들어보고, 내 영상에 적용하세요.</p></div>
      <span className={'badge '+(caps.available?'ok':'warn')}>{caps.available?'로컬 엔진 연결됨':'엔진 연결 필요'}</span></div>
    {!caps.available?<div className="card voice-connect"><div><strong>{checkingConnection?'음성 엔진 연결 확인 중':'Qwen 음성 엔진을 시작하세요'}</strong><p className="muted">{caps.error??'목소리를 생성할 로컬 엔진에 연결합니다.'}</p></div><button className="btn primary" disabled={!!busy||checkingConnection} onClick={()=>action('start',async()=>{await ttsApi('service/start',{json:{}});await refresh();setConnectionVersion(v=>v+1);})}>{busy==='start'?'엔진 시작 중…':'엔진 시작'}</button></div>:null}
    <div className="tabs voice-modes" role="group" aria-label="목소리 만드는 방법">{(Object.keys(VOICE_MODE_LABEL) as VoiceMode[]).map(mode=><button key={mode} className={config.mode===mode?'active':''} aria-pressed={config.mode===mode} onClick={()=>changeMode(mode)}>{VOICE_MODE_LABEL[mode]}</button>)}</div>
    {error?<div className="voice-error card" role="alert">{error}</div>:null}
    {selectedFailure?<div className="voice-error card" role="alert">{selectedFailure.error?.message??'샘플 생성이 중단됐습니다.'}</div>:null}
    {notice?<div className="voice-notice" role="status">{notice}</div>:null}
    <div className="voice-layout">
      <section className="card voice-editor" aria-label="대본과 음성 설정">
        <div className="row" style={{justifyContent:'space-between'}}><h2>어떤 문장을 읽을까요?</h2><span className="faint">{Array.from(text).length} / 500자</span></div>
        {episodeKey?<button className="btn sm" disabled={!caps.available||!!busy} onClick={()=>action('import',async()=>{const ep=await ttsApi<VoiceEpisode>('episode?'+new URLSearchParams({...episodeKey}));setText(ep.text);setNotice(ep.text.length>500?'전체 대본을 가져왔습니다. 미리듣기는 500자 이내로 줄여주세요.':'회차 대본을 가져왔습니다.');})}>회차 대본 가져오기</button>:null}
        <label htmlFor="voice-text">미리듣기 대본</label><textarea id="voice-text" value={text} onChange={e=>setText(e.target.value)} rows={4}/>
        <details><summary>실제 읽을 문장 · 발음 사전</summary><p className="voice-spoken">{spoken}</p><label htmlFor="voice-pronunciation">발음 사전 · 원문 = 읽을 발음</label><textarea id="voice-pronunciation" value={pronunciation} onChange={e=>setPronunciation(e.target.value)} rows={4}/><button className="btn sm" onClick={()=>{try{setConfig(withPronunciations());setError('');}catch(e){setError((e as Error).message);}}}>발음 적용해 보기</button></details>
        <div className="voice-fields"><div><label htmlFor="voice-model">모델</label><select id="voice-model" value={config.modelId} onChange={e=>{const next={...config,modelId:e.target.value};if(!caps.models?.find(m=>m.id===next.modelId)?.instruct)delete next.instruct;setConfig(next);}}>{caps.models?.filter(m=>m.mode===config.mode).map(m=><option key={m.id} value={m.id}>{m.size}{m.instruct?' · 표현 조절':''}{m.loaded?' · 준비됨':''}</option>)??<option value={config.modelId}>엔진 연결 후 선택</option>}</select></div>
          <div><label htmlFor="voice-language">읽을 언어</label><select id="voice-language" value={config.language} onChange={e=>update({language:e.target.value})}>{(caps.languages??['Korean']).map(lang=><option key={lang} value={lang}>{languages[lang]??lang}</option>)}</select></div></div>
        {config.mode==='custom_voice'?<><label htmlFor="voice-speaker">목소리</label><select id="voice-speaker" value={config.speaker??'Sohee'} onChange={e=>update({speaker:e.target.value})}>{(caps.speakers??['Sohee']).map(s=><option key={s} value={s}>{speakerLabels[s]??s}</option>)}</select>{!model?.instruct?<p className="faint">읽는 방식 지시는 1.7B 모델에서 사용할 수 있습니다.</p>:null}</>:null}
        {model?.instruct?<><label htmlFor="voice-instruct">{config.mode==='voice_design'?'만들고 싶은 목소리':'읽는 방식'}</label><textarea id="voice-instruct" rows={3} value={config.instruct??''} onChange={e=>update({instruct:e.target.value})} placeholder="예: 담백한 해설처럼 중요한 단어를 또렷하게 읽어주세요."/>{config.mode==='voice_design'?<p className="faint">3–30초 길이의 후보를 선택해 저장하면 다음 대본에도 같은 참조 음성을 사용합니다.</p>:null}</>:null}
        {config.mode==='voice_clone'?<div className="voice-reference"><label htmlFor="voice-reference">저장된 참조 음성</label><select id="voice-reference" value={config.referenceId??''} onChange={e=>{const ref=references.find(r=>r.id===e.target.value);update({referenceId:ref?.id,referenceHash:ref?.hash});}}><option value="">참조 음성 선택</option>{references.map(ref=><option key={ref.id} value={ref.id}>{ref.name} · {(ref.durationMs/1000).toFixed(1)}초</option>)}</select>
          {config.referenceId?<audio controls preload="none" src={'/api/tts/references/'+config.referenceId+'/audio'} ref={el=>{if(el)audioRefs.current.set('reference',el);else audioRefs.current.delete('reference');}} onPlay={()=>playOne('reference')}/>:null}
          <details><summary>새 참조 음성 추가</summary><label htmlFor="voice-file">WAV·MP3·M4A · 3–30초 · 최대 20MB</label><input id="voice-file" type="file" accept=".wav,.mp3,.m4a" onChange={e=>setFile(e.target.files?.[0]??null)}/><label htmlFor="voice-ref-text">이 녹음에서 말한 문장</label><textarea id="voice-ref-text" rows={3} value={refText} onChange={e=>setRefText(e.target.value)}/><button className="btn" disabled={!caps.available||!!busy||!file||!refText.trim()} onClick={()=>action('upload',async()=>{if(!file)return;if(file.size>20*1024*1024)throw new Error('파일은 20MB 이하여야 합니다.');const form=new FormData();form.append('file',file);form.append('text',refText);const ref=await ttsApi<VoiceReference>('references',{form});await refresh();update({referenceId:ref.id,referenceHash:ref.hash});setNotice('참조 음성을 저장했습니다.');})}>{busy==='upload'?'음성 확인 중…':'참조 음성 저장'}</button></details></div>:null}
        <div className="row" style={{justifyContent:'space-between'}}><label htmlFor="voice-speed">생성 음성 속도</label><strong>{config.postprocess.speed.toFixed(2)}×</strong></div><input id="voice-speed" type="range" min="0.8" max="1.2" step="0.05" value={config.postprocess.speed} onChange={e=>update({postprocess:{...config.postprocess,speed:Number(e.target.value)}})}/><p className="faint">저장되는 음성에 적용됩니다. 음성의 높이는 유지합니다.</p>
        <div className="row" style={{justifyContent:'space-between'}}><label htmlFor="voice-gap">문장 사이 간격</label><span>{config.postprocess.sentenceGapMs}ms</span></div><input id="voice-gap" type="range" min="0" max="800" step="20" value={config.postprocess.sentenceGapMs} onChange={e=>update({postprocess:{...config.postprocess,sentenceGapMs:Number(e.target.value)}})}/><p className="faint">회차의 여러 문장을 이어 붙일 때 적용합니다. A안은 대사 시작 시각을 유지합니다.</p>
        <details><summary>고급 생성 설정</summary><label htmlFor="voice-seed">테이크 번호 · 비워두면 자동</label><input id="voice-seed" type="number" min="0" max="2147483647" value={config.generation.seed??''} onChange={e=>update({generation:{...config.generation,seed:e.target.value===''?null:Number(e.target.value)}})}/></details>
        <div className="voice-actions"><button className="btn primary" disabled={!caps.available||!!busy} onClick={()=>generate('reuse')}>{busy==='generate'?'요청 중…':'샘플 만들기'}</button><button className="btn" disabled={!caps.available||!!busy} onClick={()=>generate('new')}>다른 테이크 만들기</button></div>
        <details><summary>연결·모델</summary><p className="faint">{caps.device??'첫 모델 준비 시 GPU를 확인합니다.'}</p><p className="faint">모델은 최초 사용 시 다운로드됩니다. 한 번에 하나의 GPU 작업을 실행합니다.</p><button className="btn sm" disabled={!caps.available||!!busy} onClick={()=>action('prepare',async()=>{const job=await ttsApi<TTSJob>('models/prepare',{json:{modelId:config.modelId,idempotencyKey:crypto.randomUUID()}});setJobs(j=>[job,...j]);})}>선택 모델 준비</button> <Link href="/settings" className="btn sm">환경 점검</Link></details>
      </section>
      <div className="voice-results">
        <section className="card" aria-label="음성 샘플 비교"><div className="row" style={{justifyContent:'space-between'}}><h2>들어보고 비교하기</h2><span className="faint">{candidates.length} / 3</span></div>
          {active.map(job=><div className="voice-job" key={job.id} role="status"><strong>{job.kind==='prepare'?'모델 준비':job.request.text?.slice(0,45)}</strong><div className="row"><span className="badge info">{TTS_STATUS[job.status]}</span><button className="btn sm" disabled={job.cancelRequested} onClick={()=>action('cancel',async()=>{await ttsApi('jobs/'+job.id+'/cancel',{json:{}});await refresh();})}>{job.cancelRequested?'안전한 중단 대기 중':'취소'}</button></div></div>)}
          {!candidates.length?<div className="voice-empty"><strong>아직 만든 샘플이 없어요</strong><p>같은 문장으로 목소리와 읽는 방식을 비교하세요.</p></div>:null}
          {candidates.map(job=>{const r=job.result!;const old=voiceFingerprint(r.config)!==voiceFingerprint(config)||job.request.text!==text.trim();return <article className={'voice-sample '+(job.id===selectedId?'selected':'')} key={job.id}>
            <div className="row" style={{justifyContent:'space-between'}}><strong>{r.config.speaker??VOICE_MODE_LABEL[r.config.mode]} · {(r.durationMs/1000).toFixed(1)}초</strong><button className="btn sm" aria-pressed={pinned.includes(job.id)} disabled={!pinned.includes(job.id)&&pinned.length>=3} onClick={()=>pin(job.id)}>{pinned.includes(job.id)?'고정 해제':'비교 고정'}</button></div>
            <p className="voice-sample-text">{job.request.text}</p><p className="faint">{r.config.modelId.split('-12Hz-')[1]} · {r.config.postprocess.speed.toFixed(2)}× · {r.cacheHit?'저장된 음성 재사용':`생성 ${r.elapsedSeconds.toFixed(1)}초`}</p>
            {r.config.instruct?<p className="faint">{r.config.instruct}</p>:null}<audio controls preload="metadata" src={r.audioUrl} ref={el=>{if(el)audioRefs.current.set(job.id,el);else audioRefs.current.delete(job.id);}} onPlay={()=>playOne(job.id)}/>
            <div className="voice-sample-actions"><button className="btn sm" onClick={()=>playSample(job.id)}>재생</button><button className="btn sm" onClick={()=>{setSelectedId(job.id);setSource('sample');}} aria-pressed={selectedId===job.id}>{selectedId===job.id?'선택됨':'이 설정 선택'}</button><button className="btn sm" onClick={()=>{loadConfig(r.config);setText(job.request.text??'');}}>설정 불러오기</button><a className="btn sm" href={r.audioUrl} download={'qwen-'+job.id.slice(0,8)+'.wav'}>WAV 저장</a></div>
            <p className={old?'voice-warning':'faint'}>{old?'현재 초안과 다른 설정으로 만든 샘플':'현재 초안과 같은 설정'}</p>
          </article>;})}
          {jobs.some(j=>j.status==='failed'||j.status==='interrupted')?<details><summary>최근 실패·중단 내역</summary>{jobs.filter(j=>j.status==='failed'||j.status==='interrupted').slice(0,2).map(job=><div className="voice-error" key={job.id}><strong>{TTS_STATUS[job.status]}</strong> · {job.error?.message}</div>)}</details>:null}
        </section>
        <section className="card"><h2>마음에 드는 설정 보관하기</h2><div className="voice-fields"><div><label htmlFor="voice-save-source">저장할 설정</label><select id="voice-save-source" value={source} onChange={e=>setSource(e.target.value as 'draft'|'sample')}><option value="draft">현재 초안 · 청취 전</option><option value="sample" disabled={!selected}>선택한 샘플</option></select></div><div><label htmlFor="voice-name">프리셋 이름</label><input id="voice-name" value={name} onChange={e=>setName(e.target.value)} maxLength={60}/></div></div>
          <div className="voice-actions"><button className="btn" disabled={!caps.available||!!busy} onClick={()=>save()}>새 프리셋 저장</button>{editPreset?<button className="btn" disabled={!caps.available||!!busy} onClick={()=>save(true)}>r{editPreset.revision+1}로 수정 저장</button>:null}</div>
          <label htmlFor="voice-preset">저장된 프리셋</label><select id="voice-preset" value={presetId} onChange={e=>setPresetId(e.target.value)}><option value="">프리셋 선택</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name} · r{p.revision}</option>)}</select>
          <div className="voice-actions"><button className="btn sm" disabled={!chosenPreset} onClick={()=>{if(chosenPreset){loadConfig(chosenPreset.config);setName(chosenPreset.name);setEditPreset(chosenPreset);setSource('draft');}}}>설정 불러오기</button><button className="btn sm" disabled={!chosenPreset||!!busy} onClick={()=>action('default',async()=>{if(chosenPreset){await ttsApi('default',{method:'PUT',json:{id:chosenPreset.id,revision:chosenPreset.revision}});await refresh();setNotice('새 회차 기본값을 변경했습니다. 기존 회차 설정은 유지됩니다.');}})}>새 회차 기본값으로</button></div>
          <p className="faint">새 회차 기본값: {defaultPreset?defaultPreset.name+' · r'+defaultPreset.revision:'기존 Edge 설정'}</p>
          {defaultPreset?<button className="btn sm" disabled={!!busy} onClick={()=>action('default',async()=>{await ttsApi('default',{method:'PUT',json:{id:null}});await refresh();setNotice('새 회차는 기존 Edge 설정을 사용합니다.');})}>기존 Edge 기본값 복원</button>:null}
        </section>
        {episodeKey?<EpisodeVoiceSettings key={connectionVersion} episodeKey={episodeKey} selectedPreset={chosenPreset}/>:<div className="card"><strong>회차에 적용하기</strong><p className="muted">회차의 ‘내레이션 설정’에서 들어오면 여기서 바로 적용할 수 있습니다.</p><Link href="/" className="btn sm">회차 선택</Link></div>}
      </div>
    </div>
  </div>;
}
