import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT} from './paths';
import {readJson, writeJsonLikePython} from './jsonio';
import {DETAIL_STATUSES, DETAIL_VIDEO_SOURCES, DETAIL_VIDEO_MAX_SECONDS, DETAIL_VIDEO_MIN_SECONDS, type DetailProject, type DetailVideo} from './detailTypes';

const base = path.join(ROOT, '상세페이지');
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class DetailError extends Error { constructor(message: string, public status = 400) { super(message); } }
function location(id: string) {
  if (!idPattern.test(id)) throw new DetailError('프로젝트 ID가 올바르지 않습니다.');
  return path.join(base, id, '프로젝트.json');
}
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DetailError('객체 형식이 필요합니다.');
  return v as Record<string, unknown>;
}
function str(v: unknown, name: string, max = 8000): string {
  if (typeof v !== 'string' || v.length > max) throw new DetailError(`${name}: 문자열 길이를 확인해 주세요.`);
  return v.trim();
}
function url(v: string) {
  if (!v) return;
  try { const u = new URL(v); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error(); }
  catch { throw new DetailError('링크는 계정 정보 없는 http/https 주소여야 합니다.'); }
}
/**
 * 미디어 경로는 프로젝트 폴더 안으로만 제한한다. 이 값은 그대로 /api/media 와 내보내기 HTML에
 * 들어가므로, 절대 경로나 .. 를 허용하면 저장소 밖 파일을 가리키는 통로가 된다.
 */
function mediaPath(v: unknown, name: string, ext: RegExp): string {
  const s = str(v, name, 200);
  if (!s) throw new DetailError(`${name}: 경로가 필요합니다.`);
  if (s.includes('\\') || s.includes('\0')) throw new DetailError(`${name}: 슬래시(/)로 구분한 상대 경로여야 합니다.`);
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) throw new DetailError(`${name}: 절대 경로는 받지 않습니다.`);
  if (s.split('/').some(part => part === '' || part === '.' || part === '..')) throw new DetailError(`${name}: 프로젝트 폴더 안의 경로여야 합니다.`);
  if (!ext.test(s)) throw new DetailError(`${name}: 허용하지 않는 파일 형식입니다.`);
  return s;
}
function video(v: unknown): DetailVideo {
  const b = obj(v);
  if (!DETAIL_VIDEO_SOURCES.includes(b.source as DetailVideo['source'])) throw new DetailError('영상 소재 방식을 확인해 주세요.');
  const seconds = b.seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < DETAIL_VIDEO_MIN_SECONDS || seconds > DETAIL_VIDEO_MAX_SECONDS) {
    throw new DetailError(`영상 길이는 ${DETAIL_VIDEO_MIN_SECONDS}~${DETAIL_VIDEO_MAX_SECONDS}초여야 합니다.`);
  }
  if (typeof b.loop !== 'boolean') throw new DetailError('반복 재생은 체크 값이어야 합니다.');
  const source = b.source as DetailVideo['source'];
  return {
    source,
    // 제품 시트 경로는 파이프라인이 정하므로 시드는 이미지 방식일 때만 받는다.
    seed: source === 'image' ? mediaPath(b.seed, '시드 이미지', /\.(png|jpg|jpeg|webp)$/i) : '',
    motion: str(b.motion, '움직임 지시', 2000),
    seconds,
    loop: b.loop,
    file: mediaPath(b.file, '영상 파일', /\.(mp4|webm)$/i),
    poster: mediaPath(b.poster, '포스터', /\.(png|jpg|jpeg|webp)$/i),
  };
}
function validate(input: unknown): Omit<DetailProject, 'id' | 'createdAt' | 'updatedAt' | 'revision'> {
  const b = obj(input);
  const text = Object.fromEntries(['title','client','product','target','objective','keyMessage','facts','evidence','brand','referenceUrls','assetNotes','deliveryUrl','deadline','revisionNote'].map(k => [k, str(b[k], k, ['title','client','product'].includes(k) ? 200 : 8000)])) as Pick<DetailProject, 'title'|'client'|'product'|'target'|'objective'|'keyMessage'|'facts'|'evidence'|'brand'|'referenceUrls'|'assetNotes'|'deliveryUrl'|'deadline'|'revisionNote'>;
  if (!text.title) throw new DetailError('프로젝트 제목을 입력해 주세요.');
  url(text.deliveryUrl);
  text.referenceUrls.split(/\r?\n/).filter(s => s.trim()).forEach(s => url(s.trim()));
  if (text.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(text.deadline) || !Number.isFinite(Date.parse(text.deadline)) || new Date(text.deadline).toISOString().slice(0,10) !== text.deadline)) throw new DetailError('납기 날짜를 확인해 주세요.');
  if (!DETAIL_STATUSES.includes(b.status as DetailProject['status'])) throw new DetailError('상태가 올바르지 않습니다.');
  if (!Array.isArray(b.sections) || b.sections.length < 1 || b.sections.length > 20) throw new DetailError('섹션은 1~20개여야 합니다.');
  const seen = new Set<string>();
  const sections = b.sections.map(v => {
    const s = obj(v); const id = str(s.id, '섹션 ID', 80);
    if (!/^[a-zA-Z0-9-]+$/.test(id) || seen.has(id)) throw new DetailError('섹션 ID가 중복되거나 올바르지 않습니다.');
    seen.add(id);
    if (!['todo','ready','changes'].includes(s.review as string)) throw new DetailError('섹션 검수 상태를 확인해 주세요.');
    const base = {id, title: str(s.title,'섹션 제목',200), copy: str(s.copy,'카피'), visual: str(s.visual,'이미지 연출'), review: s.review as DetailProject['sections'][number]['review']};
    return s.video === undefined || s.video === null ? base : {...base, video: video(s.video)};
  });
  const c = obj(b.checks);
  for (const k of ['facts','labels','mobile','rights']) if (typeof c[k] !== 'boolean') throw new DetailError('검수 항목은 체크 값이어야 합니다.');
  const checks = {facts: c.facts as boolean, labels: c.labels as boolean, mobile: c.mobile as boolean, rights: c.rights as boolean};
  if (b.status === 'delivered' && (!Object.values(checks).every(Boolean) || sections.some(s => s.review !== 'ready') || !text.deliveryUrl)) throw new DetailError('납품 완료 전 모든 검수 항목·섹션 확인과 납품 링크가 필요합니다.');
  return {...text, status: b.status as DetailProject['status'], sections, checks};
}
export async function getDetailProject(id: string): Promise<DetailProject | null> { return readJson<DetailProject>(location(id)); }
export async function listDetailProjects(): Promise<DetailProject[]> {
  let entries;
  try { entries = await fs.readdir(base, {withFileTypes:true}); }
  catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  const data = await Promise.all(entries.filter(e => e.isDirectory() && idPattern.test(e.name)).map(e => getDetailProject(e.name)));
  return data.filter((p): p is DetailProject => p !== null).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
async function atomicWrite(p: DetailProject) {
  const dest = location(p.id); const tmp = `${dest}.${randomUUID()}.tmp`;
  try { await writeJsonLikePython(tmp, p); await fs.rename(tmp,dest); }
  finally { await fs.unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
export async function createDetailProject(input: unknown): Promise<DetailProject> {
  const b = obj(input); const now = new Date().toISOString();
  const p: DetailProject = {id:randomUUID(),title:str(b.title,'제목',200),client:str(b.client ?? '','고객',200),product:str(b.product ?? '','제품',200),target:'',objective:'',keyMessage:'',facts:'',evidence:'',brand:'',referenceUrls:'',assetNotes:'',deliveryUrl:'',deadline:'',status:'brief',sections:['첫 화면 · 핵심 제안','고객의 고민 · 제품의 역할','제품 특징 · 근거','사용 방법 · 디테일','구매 안내 · 다음 행동'].map((title,i) => ({id:`section-${i+1}`,title,copy:'',visual:'',review:'todo'})),checks:{facts:false,labels:false,mobile:false,rights:false},revisionNote:'',createdAt:now,updatedAt:now,revision:1};
  validate(p); await atomicWrite(p); return p;
}
export async function updateDetailProject(id: string, input: unknown): Promise<DetailProject> {
  const filename = location(id); const b = obj(input); const fields = validate(b);
  if (!Number.isSafeInteger(b.revision) || (b.revision as number) < 1) throw new DetailError('저장 버전이 필요합니다.');
  // Exclusive lock also protects concurrent requests from separate server workers.
  let lock;
  try { lock = await fs.open(`${filename}.lock`, 'wx'); }
  catch(e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new DetailError('다른 저장이 진행 중입니다. 잠시 후 다시 저장해 주세요.',409); if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new DetailError('프로젝트가 없습니다.',404); throw e; }
  try {
    const old = await getDetailProject(id);
    if (!old) throw new DetailError('프로젝트가 없습니다.',404);
    if (old.revision !== b.revision) throw new DetailError('다른 창에서 수정되었습니다. 입력을 복사한 뒤 새로고침해서 다시 반영해 주세요.',409);
    const p: DetailProject = {...fields,id,createdAt:old.createdAt,updatedAt:new Date().toISOString(),revision:old.revision+1};
    await atomicWrite(p); return p;
  } finally { await lock.close(); await fs.unlink(`${filename}.lock`); }
}
export async function detailBody(req: Request): Promise<unknown> {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) throw new DetailError('다른 사이트의 저장 요청은 허용하지 않습니다.',403);
  if (!req.headers.get('content-type')?.includes('application/json')) throw new DetailError('JSON 요청이 필요합니다.',415);
  const reader = req.body?.getReader(); if (!reader) throw new DetailError('본문이 없습니다.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > 512000) { await reader.cancel(); throw new DetailError('요청은 500KB 이하여야 합니다.',413); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new DetailError('JSON 형식을 확인해 주세요.'); }
}
export function detailFailure(e: unknown) { return Response.json({error: e instanceof DetailError ? e.message : '저장소 처리 중 오류가 발생했습니다.'}, {status:e instanceof DetailError ? e.status : 500}); }
