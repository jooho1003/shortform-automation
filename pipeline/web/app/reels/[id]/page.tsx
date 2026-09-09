import Link from 'next/link';

import {ReelProjectView} from '@/components/reels/ReelProjectView';
import {listClients} from '@/lib/clients';
import {getProject, idOk} from '@/lib/reels';

export const dynamic = 'force-dynamic';

export default async function ReelProjectPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!idOk(id)) return <div className="empty">잘못된 주소입니다.</div>;
  try {
    const data = await getProject(id);
    const clients = await listClients().catch(() => []);
    return <ReelProjectView {...data} clients={clients.map((c) => ({slug: c.slug, name: c.name, survey: c.survey}))} />;
  } catch (e) {
    return (
      <div className="card">
        <div className="badge danger">{(e as Error).message}</div>
        <div style={{marginTop: 10}}>
          <Link href="/reels" className="btn">
            ← 릴스 기획
          </Link>
        </div>
      </div>
    );
  }
}
