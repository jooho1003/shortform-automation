import {localRequest, studioCall, studioFailure, studioJson} from '@/lib/studioServer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {localRequest(request); return Response.json(await studioCall('list'));} catch (error) {return studioFailure(error);}
}
export async function POST(request: Request) {
  try {localRequest(request); return Response.json(await studioCall('create', undefined, await studioJson(request)), {status: 201});} catch (error) {return studioFailure(error);}
}
