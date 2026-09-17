import Link from 'next/link';

export default function BlogNotFound() {
  return <div className="empty">블로그 프로젝트가 없습니다. <Link href="/blog">목록으로 돌아가기</Link></div>;
}
