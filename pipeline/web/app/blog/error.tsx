'use client';

export default function BlogErrorView({error, reset}: {error: Error & {digest?: string}; reset: () => void}) {
  return <div className="card"><span className="badge danger">블로그 화면 오류</span><p>{error.message}</p><button className="btn" onClick={reset}>다시 시도</button></div>;
}
