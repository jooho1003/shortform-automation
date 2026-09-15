import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

import {PIPELINE, DATA, childEnv, pythonCommand} from './paths';

export async function initializeEpisodeVoice(track: string, date: string, num: string, directory: string): Promise<void> {
  const py = pythonCommand();
  await promisify(execFile)(py.cmd, [...py.prefix,'-m','shortform','tts-initialize','--track',track,'--date',date,'--episode',num,'--directory',directory],
    {cwd:PIPELINE,env:childEnv(),windowsHide:true,timeout:15000,maxBuffer:1024*1024});
}

export const TTS_SERVICE = 'http://127.0.0.1:8765';

export async function ttsFetch(endpoint: string, init: RequestInit = {}, timeout = 15000): Promise<Response> {
  return fetch(TTS_SERVICE + '/' + endpoint, {...init,cache:'no-store',signal:AbortSignal.timeout(timeout)});
}

const runtime = globalThis as unknown as {__ttsStart?: Promise<void>};

export async function startTTSService(): Promise<void> {
  if (runtime.__ttsStart) return runtime.__ttsStart;
  const task = (async () => {
    try {if ((await ttsFetch('capabilities',{},1500)).ok) return;} catch { /* start below */ }
    const python = path.join(PIPELINE,'.venv-tts',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    if (!fs.existsSync(python)) throw new Error('Qwen 전용 환경이 없습니다. pipeline/tts-service/README.md의 설치 순서를 실행하세요.');
    fs.mkdirSync(path.join(DATA,'tts'),{recursive:true});
    const log = fs.openSync(path.join(DATA,'tts','service.log'),'a');
    let launchError: Error | null = null;
    try {
      const child = spawn(python,['-m','shortform.tts.service'],{cwd:PIPELINE,env:childEnv(),
        windowsHide:true,detached:true,stdio:['ignore',log,log]});
      child.on('error',error=>{launchError=error;});
      child.unref();
    } finally {fs.closeSync(log);}
    for (let attempt=0;attempt<40;attempt++) {
      if (launchError) throw launchError;
      await new Promise(resolve=>setTimeout(resolve,500));
      try {if ((await ttsFetch('capabilities',{},1500)).ok) return;} catch { /* warming */ }
    }
    throw new Error('음성 엔진이 시작되지 않았습니다. pipeline/data/tts/service.log를 확인하세요.');
  })();
  runtime.__ttsStart=task;
  try {await task;} finally {if(runtime.__ttsStart===task)runtime.__ttsStart=undefined;}
}

export function checkTTSOrigin(req: Request): void {
  const url = new URL(req.url);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('음성 스튜디오는 로컬 콘솔에서 사용하세요.');
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) throw new Error('다른 사이트에서 보낸 변경 요청을 허용하지 않습니다.');
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw new Error('다른 사이트의 요청입니다.');
}
