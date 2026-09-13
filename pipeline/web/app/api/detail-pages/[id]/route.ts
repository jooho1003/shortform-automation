import {getDetailProject, updateDetailProject, detailBody, detailFailure} from '@/lib/detailProjects';
import {requireDetailAdmin, sameOrigin} from '@/lib/detailAdmin';
export const dynamic = 'force-dynamic';
type Context = {params: Promise<{id: string}>};
export async function GET(_req: Request, ctx: Context) { try { await requireDetailAdmin(); const p = await getDetailProject((await ctx.params).id); return p ? Response.json(p) : Response.json({error:'프로젝트가 없습니다.'},{status:404}); } catch(e) { return detailFailure(e); } }
export async function PUT(req: Request, ctx: Context) { try { await requireDetailAdmin(); sameOrigin(req); return Response.json(await updateDetailProject((await ctx.params).id,await detailBody(req))); } catch(e) { return detailFailure(e); } }
