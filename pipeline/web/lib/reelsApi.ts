/** 릴스 API 라우트 공통 응답 처리. */
import {LlmError} from './llm';
import {ReelsError, idOk} from './reels';
import {JobError} from './runner';
import {PathDenied} from './safePath';

export function reelsErrorResponse(err: unknown): Response {
  if (err instanceof ReelsError || err instanceof JobError) return Response.json({error: err.message}, {status: err.status});
  if (err instanceof PathDenied) return Response.json({error: err.message}, {status: 403});
  if (err instanceof LlmError) return Response.json({error: err.message, jobId: err.jobId}, {status: 502});
  return Response.json({error: (err as Error).message ?? '알 수 없는 오류'}, {status: 500});
}

export async function idParam(params: Promise<{id: string}>): Promise<string> {
  const {id} = await params;
  if (!idOk(id)) throw new ReelsError('잘못된 프로젝트 id');
  return id;
}

export async function jsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ReelsError('JSON 본문이 필요합니다.');
  }
}
