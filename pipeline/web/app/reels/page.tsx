import {ReelsHome} from '@/components/reels/ReelsHome';
import {listClients} from '@/lib/clients';
import {listProjects, loadLibrary} from '@/lib/reels';

export const dynamic = 'force-dynamic';

export default async function ReelsPage() {
  const [library, projects, clients] = await Promise.all([loadLibrary(), listProjects(), listClients().catch(() => [])]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>릴스 기획</h1>
          <p>잘 된 릴스 찾기 → 분석 → 고객 정보 반영 대본·촬영 가이드·캡션 → 기획안 PDF. 파일은 릴스기획/ 폴더.</p>
        </div>
      </div>
      <ReelsHome library={library.items} projects={projects} clients={clients.map((c) => ({slug: c.slug, name: c.name}))} />
    </>
  );
}
