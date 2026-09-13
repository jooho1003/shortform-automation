'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';

export function DetailAdminLogin() {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true); setError(null);
    try {
      const response = await fetch('/api/detail-admin', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key})});
      const data = await response.json() as {error?: string};
      if (!response.ok) { setError(data.error || '로그인하지 못했습니다.'); setPending(false); return; }
      router.push('/detail-pages'); router.refresh();
    } catch { setError('요청 중 오류가 발생했습니다.'); setPending(false); }
  }
  return <form onSubmit={submit} className="card">
    <label className="lbl" htmlFor="detail-admin-key">관리자 키</label>
    <input id="detail-admin-key" className="field" type="password" autoComplete="current-password" value={key} onChange={e => setKey(e.target.value)} disabled={pending} />
    <p>이 PC의 관리자 키 파일을 열어 입력하세요.<br />%USERPROFILE%\AppData\Local\ShortformAutomation\detail-admin-key.txt</p>
    {error ? <p role="alert" className="badge danger">{error}</p> : null}
    <button className="btn primary" type="submit" disabled={pending}>{pending ? '로그인 중…' : '로그인'}</button>
  </form>;
}

export function DetailAdminLogout() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      const response = await fetch('/api/detail-admin', {method: 'DELETE'});
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setPending(false);
      window.alert('로그아웃하지 못했습니다.');
    }
  }
  return <button className="btn" type="button" onClick={logout} disabled={pending}>{pending ? '로그아웃 중…' : '로그아웃'}</button>;
}
