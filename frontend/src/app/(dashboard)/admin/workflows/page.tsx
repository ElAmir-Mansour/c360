'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';

/**
 * /admin/workflows has no surface of its own — the admin console lives in its
 * children (tasks, instances, definitions, templates, forms, operations,
 * analytics). Breadcrumbs and hand-typed URLs still resolve the bare group
 * path, so route it to the shared workflow hub (also where the sidebar's
 * Workflows group entry points).
 *
 * Client-side replace on purpose: a server-component `redirect()` here is
 * emitted mid-stream inside the client dashboard shell and never completes
 * (the URL keeps rendering an empty content pane — same failure as the
 * historical /admin index), so the redirect must run through the app router.
 */
export default function AdminWorkflowsIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/workflows');
  }, [router]);
  return <LoadingSkeleton variant="card" count={3} />;
}
