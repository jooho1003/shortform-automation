import {spawn} from 'node:child_process';
import {PIPELINE, childEnv, pythonCommand} from './paths';

export class StudioError extends Error {
  constructor(message: string, public status = 400) {super(message);}
}

export function localRequest(request: Request) {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || url.host).split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || !['localhost', '127.0.0.1'].includes(host)) throw new StudioError('제작 스튜디오는 로컬 콘솔에서만 사용할 수 있습니다.', 403);
  const origin = request.headers.get('origin');
  if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new StudioError('다른 사이트의 요청은 허용하지 않습니다.', 403);
}

export async function studioCall<T>(action: string, projectId?: string, payload: Record<string, unknown> = {}): Promise<T> {
  const py = pythonCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(py.cmd, [...py.prefix, '-m', 'shortform', 'studio'], {cwd: PIPELINE, env: childEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let output = '';
    const timer = setTimeout(() => {child.kill(); reject(new StudioError('처리 시간이 초과되었습니다. 프로젝트 상태를 다시 확인하세요.', 504));}, 120000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      output += data;
      if (output.length > 16 * 1024 * 1024) {child.kill(); reject(new StudioError('프로젝트 데이터가 너무 큽니다.', 413));}
    });
    child.stderr.resume();
    child.on('error', () => {clearTimeout(timer); reject(new StudioError('Python 실행 환경을 확인하세요.', 500));});
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(output);
        if (value.error) reject(new StudioError(value.error, value.status || 400));
        else resolve(value.data as T);
      } catch {reject(new StudioError('스튜디오 응답을 읽지 못했습니다.', 500));}
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({action, projectId, payload}));
  });
}

export function studioFailure(error: unknown) {
  return Response.json({error: error instanceof Error ? error.message : '스튜디오 요청 실패'}, {status: error instanceof StudioError ? error.status : 500});
}

export async function studioJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new StudioError('JSON 요청이 필요합니다.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new StudioError('요청 내용이 없습니다.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1024 * 1024) {await reader.cancel(); throw new StudioError('요청이 너무 큽니다.', 413);}
    chunks.push(value);
  }
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    return payload;
  } catch {throw new StudioError('요청 형식이 올바르지 않습니다.');}
}
