'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';

/**
 * /admin is a group index with no surface of its own — Users is its landing
 * page. Client-side replace on purpose: a server-component `redirect()` here
 * is emitted mid-stream inside the client dashboard shell and never completes
 * (the URL keeps rendering an empty content pane), so the redirect must run
 * through the app router.
 */
export default function AdminIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/users');
  }, [router]);
  return <LoadingSkeleton variant="card" count={3} />;
}
