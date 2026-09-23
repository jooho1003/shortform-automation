import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DATA, relFromRoot} from '@/lib/paths';
import {localRequest, StudioError, studioCall, studioFailure} from '@/lib/studioServer';
export const runtime = 'nodejs';
export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  let temp: string | undefined;
  try {
    localRequest(request);
    const {id} = await context.params;
    if (!/^[a-f0-9]{32}$/.test(id)) throw new StudioError('잘못된 프로젝트 ID입니다.');
    const type = request.headers.get('content-type') || '';
    if (!type.startsWith('multipart/form-data')) throw new StudioError('파일 업로드 요청이 필요합니다.', 415);
    const reader = request.body?.getReader();
    if (!reader) throw new StudioError('파일이 없습니다.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 101 * 1024 * 1024) {await reader.cancel(); throw new StudioError('업로드는 100MB까지 지원합니다.', 413);}
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {headers: {'content-type': type}}).formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 100 * 1024 * 1024) throw new StudioError('100MB 이하의 파일을 선택하세요.');
    const ext = path.extname(file.name).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.m4a'].includes(ext)) throw new StudioError('지원하지 않는 파일 형식입니다.');
    const folder = path.join(DATA, 'studio', 'incoming');
    await fs.mkdir(folder, {recursive: true});
    temp = path.join(folder, randomUUID() + ext);
    await fs.writeFile(temp, Buffer.from(await file.arrayBuffer()));
    return Response.json(await studioCall('mutate', id, {op: 'asset', revision: Number(form.get('revision')), path: relFromRoot(temp), name: file.name}));
  } catch (error) {return studioFailure(error);} finally {if (temp) await fs.unlink(temp).catch(() => {});}
}
