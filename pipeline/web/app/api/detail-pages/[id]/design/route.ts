import {getDetailDesign, saveDetailDesign} from '@/lib/detailDesign';
import {requireDetailAdmin, sameOrigin} from '@/lib/detailAdmin';
import {detailBody, detailFailure} from '@/lib/detailProjects';
export const dynamic = 'force-dynamic';
type Context = {params:Promise<{id:string}>};
export async function GET(_req: Request, ctx: Context) {
  try { await requireDetailAdmin(); return Response.json(await getDetailDesign((await ctx.params).id),{headers:{'Cache-Control':'no-store'}}); } catch(e) { return detailFailure(e); }
}
export async function PUT(req: Request, ctx: Context) {
  try { await requireDetailAdmin(); sameOrigin(req); return Response.json(await saveDetailDesign((await ctx.params).id,await detailBody(req))); } catch(e) { return detailFailure(e); }
}
