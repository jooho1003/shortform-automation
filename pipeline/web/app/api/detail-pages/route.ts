import {createDetailProject, listDetailProjects, detailBody, detailFailure} from '@/lib/detailProjects';
import {requireDetailAdmin, sameOrigin} from '@/lib/detailAdmin';
export const dynamic = 'force-dynamic';
export async function GET() { try { await requireDetailAdmin(); return Response.json({projects:await listDetailProjects()}); } catch(e) { return detailFailure(e); } }
export async function POST(req: Request) { try { await requireDetailAdmin(); sameOrigin(req); return Response.json(await createDetailProject(await detailBody(req)),{status:201}); } catch(e) { return detailFailure(e); } }
