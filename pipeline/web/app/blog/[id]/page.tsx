import {notFound} from 'next/navigation';

import {BlogEditor} from '@/components/blog/BlogEditor';
import {BlogError, getBlogBundle, resolveBlogId} from '@/lib/blog';

export const dynamic = 'force-dynamic';
type Props = {params: Promise<{id: string}>};

export default async function BlogProjectPage({params}: Props) {
  const id = resolveBlogId((await params).id);
  try {
    return <BlogEditor initial={await getBlogBundle(id)} />;
  } catch (error) {
    if (error instanceof BlogError && error.status === 404) notFound();
    throw error;
  }
}
