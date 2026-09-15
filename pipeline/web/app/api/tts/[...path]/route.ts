import {checkTTSOrigin, startTTSService, ttsFetch} from '@/lib/tts';
import {startJob} from '@/lib/runner';
import type {VoiceEpisode} from '@/lib/ttsTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const routes: Record<string,string[]> = {
  capabilities:['GET'],presets:['GET','POST'],default:['PUT'],previews:['POST'],jobs:['GET'],
  references:['GET','POST'],'models/prepare':['POST'],episode:['GET','PUT'],
  'episode/generate':['POST'],'service/start':['POST'],
};

async function readBody(req: Request, maximum: number): Promise<Uint8Array> {
  const declared=Number(req.headers.get('content-length') || 0);
  if(declared>maximum) throw new Error('요청이 너무 큽니다.');
  const chunks: Uint8Array[]=[];
  let total=0;
  const reader=req.body?.getReader();
  if(reader) {
    while(true) {
      const {done,value}=await reader.read();if(done)break;
      total+=value.length;if(total>maximum){await reader.cancel();throw new Error('요청이 너무 큽니다.');}
      chunks.push(value);
    }
  }
  const output=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
  return output;
}

async function handler(req: Request, context: {params: Promise<{path:string[]}>}) {
  const endpoint=(await context.params).path.join('/');
  const allowed=routes[endpoint] ?? (/^jobs\/[a-f0-9]{32}$/.test(endpoint)?['GET']:
    /^jobs\/[a-f0-9]{32}\/cancel$/.test(endpoint)?['POST']:
    /^audio\/[a-f0-9]{64}$/.test(endpoint)||/^references\/[a-f0-9]{32}\/audio$/.test(endpoint)?['GET','HEAD']:[]);
  if(!allowed.includes(req.method))return Response.json({error:'지원하지 않는 음성 API입니다.'},{status:404});
  try {checkTTSOrigin(req);}catch(error){return Response.json({error:(error as Error).message},{status:403});}
  try {
    if(endpoint==='service/start') {await startTTSService();return Response.json({started:true});}
    let bytes:Uint8Array|undefined;
    if(!['GET','HEAD'].includes(req.method)) {
      try {bytes=await readBody(req,endpoint==='references'?21*1024*1024:64*1024);}
      catch(error){return Response.json({error:(error as Error).message},{status:413});}
    }
    if(endpoint==='episode/generate') {
      const body=JSON.parse(new TextDecoder().decode(bytes));
      const query=new URLSearchParams({track:String(body.track??''),date:String(body.date??''),num:String(body.num??'')});
      const response=await ttsFetch('episode?'+query);
      if(!response.ok)return new Response(await response.text(),{status:response.status,headers:{'Content-Type':'application/json'}});
      const episode=await response.json() as VoiceEpisode;
      if(!episode.usesTts)return Response.json({error:'이 회차는 클립 원음을 사용합니다.'},{status:422});
      const job=startJob({kind:'python',title:`${episode.track}-${episode.num} 음성·타임라인 갱신`,
        args:['tts-regenerate','--track',episode.track,'--date',episode.date,'--episode',episode.num]});
      return Response.json({job},{status:202});
    }
    const source=new URL(req.url);
    const query=new URLSearchParams();
    if(endpoint==='episode')for(const key of ['track','date','num'])if(source.searchParams.has(key))query.set(key,source.searchParams.get(key)!);
    const headers=new Headers();
    for(const key of ['content-type','range']) {const value=req.headers.get(key);if(value)headers.set(key,value);}
    const response=await ttsFetch(endpoint+(query.size?'?'+query:''),{method:req.method,headers,
      body:bytes ? Buffer.from(bytes) : undefined},endpoint==='references'?120000:15000);
    const resultHeaders=new Headers({'Cache-Control':'no-store'});
    for(const key of ['content-type','content-length','content-range','accept-ranges']) {const value=response.headers.get(key);if(value)resultHeaders.set(key,value);}
    return new Response(response.body,{status:response.status,headers:resultHeaders});
  } catch(error) {
    if(error instanceof SyntaxError)return Response.json({error:'올바른 JSON 본문이 필요합니다.'},{status:400});
    const message=endpoint==='service/start'?(error as Error).message:'음성 엔진에 연결할 수 없습니다. 엔진 시작을 눌러주세요.';
    return Response.json(endpoint==='capabilities'?{available:false,error:message}:{error:message},{status:endpoint==='capabilities'?200:503});
  }
}
export {handler as GET,handler as POST,handler as PUT,handler as HEAD};
