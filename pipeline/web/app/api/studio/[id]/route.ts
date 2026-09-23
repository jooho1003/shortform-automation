import {startJob} from '@/lib/runner';
import {localRequest, studioCall, studioFailure, studioJson} from '@/lib/studioServer';
type Context = {params: Promise<{id: string}>};
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: Context) {
  try {localRequest(request); return Response.json(await studioCall('read', (await context.params).id));} catch (error) {return studioFailure(error);}
}
export async function PATCH(request: Request, context: Context) {
  try {localRequest(request); return Response.json(await studioCall('mutate', (await context.params).id, await studioJson(request)));} catch (error) {return studioFailure(error);}
}
export async function POST(request: Request, context: Context) {
  try {
    localRequest(request);
    const {id} = await context.params;
    const payload = await studioJson(request);
    if (payload.op === 'quote') return Response.json(await studioCall('quote', id, payload));
    const action = payload.op === 'resume' || payload.op === 'resolveRun' ? 'resume' : 'run';
    const result = await studioCall<{run: {id: string; kind: string}; launch: boolean}>(action, id, payload);
    if (result.launch) startJob({kind: 'python', args: ['studio', 'execute', id, result.run.id], title: `Take Studio · ${result.run.kind}`, dangerous: result.run.kind !== 'export', confirmed: true});
    return Response.json(await studioCall('read', id));
  } catch (error) {return studioFailure(error);}
}
