import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageLoader } from '@/components/common/page-loader';
import { PlatformSuitesClient } from './suites-client';

export const metadata: Metadata = {
  title: 'Platform Suites',
};

/**
 * Platform Suites hub — RSC shell.
 *
 * Server Component: exports static `metadata` and streams the interactive
 * `<PlatformSuitesClient />` (gateway/fleet/tenant queries + tab state) behind
 * a `<Suspense>` boundary whose fallback mirrors the resolved layout
 * (header → 4-KPI row → catalog table) so there is no layout shift.
 *
 * Pattern reference: docs/frontend/rsc-shell-pattern.md
 */
export default function PlatformSuitesPage() {
  return (
    <Suspense fallback={<PageLoader kpis={4} rows={6} />}>
      <PlatformSuitesClient />
    </Suspense>
  );
}
