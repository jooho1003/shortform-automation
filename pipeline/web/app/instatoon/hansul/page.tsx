import Link from 'next/link';
import {HansulStudioEditor} from '@/components/carousel/HansulStudioEditor';
import {getHansul} from '@/lib/hansul';
import '@/components/carousel/hansul.css';

export const dynamic = 'force-dynamic';

export default async function HansulPage() {
  try {
    return <HansulStudioEditor initial={await getHansul()} />;
  } catch (e) {
    return <div className="card"><Link href="/instatoon">인스타툰으로 돌아가기</Link><h1>작업실을 불러오지 못했습니다</h1><p role="alert">{(e as Error).message}</p><p>파일 상태를 확인한 뒤 새로고침해 주세요.</p></div>;
  }
}
