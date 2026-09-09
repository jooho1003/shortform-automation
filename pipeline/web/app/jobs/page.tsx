import Link from 'next/link';

import {listJobs} from '@/lib/runner';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const jobs = listJobs(200);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>작업 로그</h1>
          <p>이 콘솔이 실행한 파이썬·claude·codex 프로세스. 로그 파일은 회차의 로그/ 또는 pipeline/data/logs/에 남습니다.</p>
        </div>
      </div>
      {jobs.length === 0 ? (
        <div className="empty">아직 실행한 작업이 없습니다.</div>
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th>상태</th>
                <th>제목</th>
                <th>종류</th>
                <th>시작</th>
                <th>종료</th>
                <th>코드</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <span className={`badge ${j.status === 'done' ? 'ok' : j.status === 'running' ? 'info' : j.status === 'cancelled' ? 'warn' : 'danger'}`}>{j.status}</span>
                  </td>
                  <td>
                    <Link href={`/jobs/${j.id}`} style={{color: 'var(--info)'}}>
                      {j.title}
                    </Link>
                  </td>
                  <td className="muted">{j.kind}</td>
                  <td className="faint">{new Date(j.startedAt).toLocaleString('ko-KR')}</td>
                  <td className="faint">{j.endedAt ? new Date(j.endedAt).toLocaleString('ko-KR') : ''}</td>
                  <td className="mono">{j.exitCode ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
