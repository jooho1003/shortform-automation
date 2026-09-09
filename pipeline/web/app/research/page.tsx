import {ResearchPanel} from '@/components/ResearchPanel';
import {getResearch} from '@/lib/inspect';
import type {ResearchInfo} from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ResearchPage() {
  let info: ResearchInfo | null = null;
  let error: string | null = null;
  try {
    info = await getResearch();
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <>
      <div className="page-head">
        <div>
          <h1>조사 · 구간 후보</h1>
          <p>주간 조사 리포트가 7일 넘게 묵으면 plan 단계가 멈춥니다. 롱폼 1편에서 숏폼 구간 후보 20개를 뽑는 segments도 여기서.</p>
        </div>
      </div>
      {error ? <div className="badge danger">{error}</div> : null}
      <ResearchPanel info={info} />
    </>
  );
}
