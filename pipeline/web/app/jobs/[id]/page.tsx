import Link from 'next/link';

import {JobLog} from '@/components/RunConsole';
import {getJob} from '@/lib/runner';

export const dynamic = 'force-dynamic';

export default async function JobPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const job = /^[\w-]+$/.test(id) ? getJob(id) : null;
  if (!job) return <div className="empty">잡이 없습니다.</div>;
  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/jobs" className="faint">
            ← 작업 로그
          </Link>
          <h1>{job.title}</h1>
          <p className="mono">{job.id}</p>
        </div>
      </div>
      <div className="card">
        <JobLog jobId={job.id} />
      </div>
    </>
  );
}
