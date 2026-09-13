import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT} from './paths';
import {DetailError, getDetailProject} from './detailProjects';
import {defaultDetailDesign, type DetailDesign} from './detailDesignTypes';

async function location(id: string) {
  if (!await getDetailProject(id)) throw new DetailError('프로젝트가 없습니다.',404);
  return path.join(ROOT, '상세페이지', id, '디자인.json');
}
export async function getDetailDesign(id: string): Promise<DetailDesign> {
  const file = await location(id);
  try { return JSON.parse(await fs.readFile(file,'utf8')) as DetailDesign; }
  catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaultDetailDesign(); throw e; }
}
function object(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DetailError('설정 형식이 올바르지 않습니다.');
  return value as Record<string,unknown>;
}
function validate(input: unknown): DetailDesign {
  const b = object(input);
  if (!Number.isSafeInteger(b.revision) || (b.revision as number)<0) throw new DetailError('저장 버전이 필요합니다.');
  if (!['sans','serif','mono'].includes(b.font as string) || !['sans','serif','mono'].includes(b.headingFont as string)) throw new DetailError('지원되는 폰트를 선택해 주세요.');
  const c=object(b.colors); const colors = {} as DetailDesign['colors'];
  for (const name of ['background','text','accent','muted'] as const) {
    if (typeof c[name] !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(c[name] as string)) throw new DetailError('색상은 6자리 HEX 형식이어야 합니다.');
    colors[name] = c[name] as string;
  }
  const entries=Object.entries(object(b.texts));
  if(entries.length>250) throw new DetailError('문구가 너무 많습니다.');
  const texts: Record<string,string> = Object.create(null);
  for(const [name,value] of entries) {
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(name) || ['constructor','prototype','__proto__'].includes(name) || typeof value !== 'string' || value.length>8000) throw new DetailError('문구 형식이나 길이를 확인해 주세요.');
    texts[name]=value;
  }
  const images: DetailDesign['images'] = {};
  for(const [name,value] of Object.entries(object(b.images))) {
    if(!['hero','texture','cgi','ritual','pack'].includes(name)) throw new DetailError('이미지 항목이 올바르지 않습니다.');
    const item=object(value);
    for(const k of ['x','y','scale']) if(typeof item[k] !== 'number' || !Number.isFinite(item[k])) throw new DetailError('이미지 위치는 유효한 숫자여야 합니다.');
    if(Math.abs(item.x as number)>50 || Math.abs(item.y as number)>50 || (item.scale as number)<1 || (item.scale as number)>2.5) throw new DetailError('이미지 위치 또는 확대 범위를 확인해 주세요.');
    images[name]={x:item.x as number,y:item.y as number,scale:item.scale as number};
  }
  const textStyles: NonNullable<DetailDesign['textStyles']> = Object.create(null);
  const styleEntries = Object.entries(object(b.textStyles ?? {}));
  if(styleEntries.length>250) throw new DetailError('문구 스타일이 너무 많습니다.');
  for(const [name,value] of styleEntries) {
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(name) || ['constructor','prototype','__proto__'].includes(name)) throw new DetailError('문구 스타일 ID가 올바르지 않습니다.');
    const item=object(value); const style: NonNullable<DetailDesign['textStyles']>[string] = {};
    if(item.font!==undefined) { if(!['sans','serif','mono'].includes(item.font as string)) throw new DetailError('문구 폰트를 확인해 주세요.'); style.font=item.font as DetailDesign['font']; }
    if(item.color!==undefined) { if(typeof item.color!=='string'||!/^#[a-fA-F0-9]{6}$/.test(item.color)) throw new DetailError('문구 색상을 확인해 주세요.'); style.color=item.color; }
    if(item.size!==undefined) { if(typeof item.size!=='number'||!Number.isFinite(item.size)||item.size<10||item.size>120) throw new DetailError('글자 크기는 10~120px여야 합니다.'); style.size=item.size; }
    textStyles[name]=style;
  }
  return {revision:b.revision as number,font:b.font as DetailDesign['font'],headingFont:b.headingFont as DetailDesign['headingFont'],colors,texts,images,textStyles};
}
export async function saveDetailDesign(id: string, input: unknown) {
  const next = validate(input); const file = await location(id);
  let lock;
  try { lock=await fs.open(`${file}.lock`,'wx'); }
  catch(e) { if((e as NodeJS.ErrnoException).code==='EEXIST') throw new DetailError('다른 저장이 진행 중입니다. 다시 시도해 주세요.',409); throw e; }
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const previous=await getDetailDesign(id);
    if(previous.revision!==next.revision) throw new DetailError('다른 창에서 설정이 바뀌었습니다. 현재 변경 내용을 보관한 뒤 새로고침해 주세요.',409);
    const saved={...next,revision:previous.revision+1};
    await fs.writeFile(temp,JSON.stringify(saved,null,2),'utf8'); await fs.rename(temp,file);
    return saved;
  } finally { await fs.unlink(temp).catch(()=>{}); await lock.close(); await fs.unlink(`${file}.lock`); }
}
