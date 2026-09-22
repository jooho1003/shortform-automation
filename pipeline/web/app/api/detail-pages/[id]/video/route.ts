/**
 * 상세페이지 섹션 영상 생성·검사.
 *
 * POST  fal.ai 과금이 발생하므로 dangerous 잡으로 올린다. UI가 확인을 받은 뒤 confirm=true 로 부른다.
 * GET   생성 없이 미디어 규격 검사만 돌린다(과금 없음).
 */
import {getDetailProject, detailBody, detailFailure, DetailError} from '@/lib/detailProjects';
import {requireDetailAdmin, sameOrigin} from '@/lib/detailAdmin';
import {startJob, waitJob, getBacklog, JobError} from '@/lib/runner';

export const dynamic = 'force-dynamic';
type Context = {params: Promise<{id: string}>};

async function ensureProject(id: string) {
  const project = await getDetailProject(id);
  if (!project) throw new DetailError('프로젝트가 없습니다.', 404);
  return project;
}

export async function GET(_req: Request, ctx: Context) {
  try {
    await requireDetailAdmin();
    const {id} = await ctx.params;
    await ensureProject(id);
    const job = startJob({kind: 'python', title: `상세페이지 미디어 검사 ${id}`, args: ['detail-video', 'check', '--project', id]});
    const done = await waitJob(job.id);
    // 검사 결과 JSON은 stdout 마지막 줄부터 역순으로 찾는다(진행 로그가 앞에 섞여 있다).
    const lines = getBacklog(job.id).filter(l => !l.startsWith('[stderr]'));
    const start = lines.findIndex(l => l.trim().startsWith('{'));
    let report: unknown = null;
    if (start >= 0) { try { report = JSON.parse(lines.slice(start).join('\n')); } catch { report = null; } }
    return Response.json({job: done, report});
  } catch (e) {
    if (e instanceof JobError) return Response.json({error: e.message}, {status: e.status});
    return detailFailure(e);
  }
}

export async function POST(req: Request, ctx: Context) {
  try {
    await requireDetailAdmin();
    sameOrigin(req);
    const {id} = await ctx.params;
    const project = await ensureProject(id);
    const pending = project.sections.filter(s => s.video);
    if (pending.length === 0) throw new DetailError('영상을 설정한 섹션이 없습니다.');
    const body = await detailBody(req) as {confirm?: unknown};
    if (body?.confirm !== true) throw new DetailError('영상 생성은 비용이 발생합니다. 확인 후 다시 요청해 주세요.', 400);
    const job = startJob({
      kind: 'python',
      title: `상세페이지 영상 생성 ${id}`,
      args: ['detail-video', 'generate', '--project', id],
      dangerous: true,
      confirmed: true,
    });
    return Response.json({job, sections: pending.map(s => s.id)}, {status: 202});
  } catch (e) {
    if (e instanceof JobError) return Response.json({error: e.message}, {status: e.status});
    return detailFailure(e);
  }
}
