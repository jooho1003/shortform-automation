import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cookies} from 'next/headers';
import {DetailError} from './detailProjects';

export const ADMIN_COOKIE = 'detail_admin';
const lifetime = 8 * 60 * 60;
export const adminKeyPath = path.join(os.homedir(), 'AppData', 'Local', 'ShortformAutomation', 'detail-admin-key.txt');
async function key(): Promise<string> {
  if (process.env.DETAIL_ADMIN_KEY) return process.env.DETAIL_ADMIN_KEY;
  try { return (await fs.readFile(adminKeyPath, 'utf8')).trim(); }
  catch { throw new DetailError('관리자 키가 준비되지 않았습니다. 관리자 설정 스크립트를 실행해 주세요.', 503); }
}
function equal(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function verifyAdminKey(candidate: string) { return equal(candidate, await key()); }
export async function makeAdminSession() {
  const payload = `${Math.floor(Date.now()/1000) + lifetime}.${randomBytes(18).toString('hex')}`;
  return `${payload}.${createHmac('sha256', await key()).update(payload).digest('hex')}`;
}
export async function isDetailAdmin() {
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!value || !/^\d{10}\.[a-f0-9]{36}\.[a-f0-9]{64}$/.test(value)) return false;
  const [expiry, nonce, signature] = value.split('.');
  const now = Math.floor(Date.now()/1000);
  if (+expiry <= now || +expiry > now + lifetime) return false;
  try { return equal(signature, createHmac('sha256', await key()).update(`${expiry}.${nonce}`).digest('hex')); }
  catch { return false; }
}
export async function requireDetailAdmin() {
  if (!await isDetailAdmin()) throw new DetailError('관리자 로그인이 필요합니다.', 401);
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) throw new DetailError('같은 사이트에서 요청해 주세요.', 403);
}
export const adminSessionSeconds = lifetime;
