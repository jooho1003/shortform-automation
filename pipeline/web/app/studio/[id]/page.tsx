import {StudioWorkspace} from '@/components/studio/StudioWorkspace';
import '../studio.css';
export default async function Page({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  return <StudioWorkspace key={id} id={id} />;
}
