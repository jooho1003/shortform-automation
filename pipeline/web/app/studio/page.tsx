import {listEpisodes} from '@/lib/inspect';
import {studioCall} from '@/lib/studioServer';
import type {StudioSummary} from '@/lib/studioTypes';
import {StudioHome} from '@/components/studio/StudioHome';
import './studio.css';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const [projects, episodes] = await Promise.all([studioCall<StudioSummary[]>('list'), listEpisodes()]);
  return <StudioHome projects={projects} episodes={episodes.episodes} />;
}
