import {NextResponse} from 'next/server';
import {ADMIN_COOKIE, adminSessionSeconds, isDetailAdmin, makeAdminSession, sameOrigin, verifyAdminKey} from '@/lib/detailAdmin';
import {detailBody, detailFailure, DetailError} from '@/lib/detailProjects';

export const dynamic = 'force-dynamic';
// Local single-admin console: a bounded global throttle cannot be bypassed by spoofing proxy headers.
let attempts: number[] = [];
export async function GET() { return Response.json({admin: await isDetailAdmin()}, {headers:{'Cache-Control':'no-store'}}); }
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const now = Date.now(); attempts = attempts.filter(t => now - t < 60000);
    if (attempts.length >= 8) throw new DetailError('잠시 후 다시 로그인해 주세요.', 429);
    attempts.push(now);
    const body = await detailBody(req) as {key?:unknown};
    if (typeof body?.key !== 'string' || body.key.length > 256 || !await verifyAdminKey(body.key)) throw new DetailError('관리자 키를 확인해 주세요.', 401);
    const response = NextResponse.json({ok:true});
    response.cookies.set(ADMIN_COOKIE, await makeAdminSession(), {httpOnly:true, sameSite:'strict', secure:new URL(req.url).protocol === 'https:', path:'/', maxAge:adminSessionSeconds});
    response.headers.set('Cache-Control','no-store');
    return response;
  } catch(e) { return detailFailure(e); }
}
export async function DELETE(req: Request) {
  try { sameOrigin(req); const response = NextResponse.json({ok:true}); response.cookies.set(ADMIN_COOKIE, '', {httpOnly:true,sameSite:'strict',path:'/',maxAge:0}); return response; }
  catch(e) { return detailFailure(e); }
}
