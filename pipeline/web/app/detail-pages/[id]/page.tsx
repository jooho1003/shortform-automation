import '@/app/detail-pages/detail-pages.css';

import {notFound, redirect} from 'next/navigation';
import {isDetailAdmin} from '@/lib/detailAdmin';

import {DetailProjectEditor} from '@/components/detail-pages/DetailProjectEditor';
import {DetailError, getDetailProject} from '@/lib/detailProjects';

export const dynamic = 'force-dynamic';

export default async function DetailProjectPage({params}: {params: Promise<{id: string}>}) {
  if (!await isDetailAdmin()) redirect('/detail-admin');
  const {id} = await params;
  const project = await getDetailProject(id).catch((error) => {
    if (error instanceof DetailError && error.status === 400) notFound();
    throw error;
  });
  if (!project) notFound();
  return <DetailProjectEditor project={project} />;
}
