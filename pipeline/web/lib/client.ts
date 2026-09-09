/** 브라우저 쪽 공통 헬퍼. */
export const media = (rel: string) => '/api/media?path=' + encodeURIComponent(rel);

export async function api<T = unknown>(url: string, init?: RequestInit & {json?: unknown}): Promise<T> {
  const {json, ...rest} = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: {...(json !== undefined ? {'Content-Type': 'application/json'} : {}), ...(rest.headers ?? {})},
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = {error: text};
  }
  if (!res.ok) {
    const msg = (data as {error?: string} | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data as T;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}

export function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
