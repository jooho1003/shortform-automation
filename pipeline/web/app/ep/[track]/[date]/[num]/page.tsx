import Link from 'next/link';

import {EpisodeView} from '@/components/EpisodeView';
import {getEpisode} from '@/lib/inspect';
import type {Track} from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EpisodePage({params, searchParams}: {params: Promise<{track: string; date: string; num: string}>; searchParams: Promise<{tab?: string}>}) {
  const {track, date, num} = await params;
  const {tab} = await searchParams;
  if ((track !== 'A' && track !== 'B') || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,3}$/.test(num)) {
    return <div className="empty">잘못된 회차 주소입니다.</div>;
  }
  try {
    const detail = await getEpisode(track as Track, date, num);
    return <EpisodeView detail={detail} tab={tab ?? 'plan'} />;
  } catch (e) {
    return (
      <div className="card">
        <div className="badge danger">회차를 읽지 못했습니다</div>
        <pre className="log" style={{marginTop: 10}}>{(e as Error).message}</pre>
        <Link href="/" className="btn">
          ← 회차 목록
        </Link>
      </div>
    );
  }
}
