import {VoiceStudio} from '@/components/voices/VoiceStudio';
import type {VoiceEpisodeKey} from '@/lib/ttsTypes';

export const dynamic = 'force-dynamic';

export default async function VoicesPage({searchParams}: {searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  let episodeKey:VoiceEpisodeKey|undefined;
  if((params.track==='A'||params.track==='B')&&typeof params.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(params.date)&&typeof params.num==='string'&&/^\d{1,3}$/.test(params.num)) {
    episodeKey={track:params.track,date:params.date,num:params.num};
  }
  return <VoiceStudio episodeKey={episodeKey}/>;
}
