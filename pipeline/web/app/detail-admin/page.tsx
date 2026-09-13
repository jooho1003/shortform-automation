import Link from 'next/link';
import {isDetailAdmin} from '@/lib/detailAdmin';
import {DetailAdminLogin, DetailAdminLogout} from '@/components/detail-pages/DetailAdminLogin';

export const dynamic = 'force-dynamic';

export default async function DetailAdminPage() {
  const authenticated = await isDetailAdmin();
  return <main className="detail-page">
    {authenticated ? <div className="card"><p>관리자로 로그인되어 있습니다</p><Link className="btn primary" href="/detail-pages">상세페이지 가기</Link> <DetailAdminLogout /></div> : <DetailAdminLogin />}
  </main>;
}
