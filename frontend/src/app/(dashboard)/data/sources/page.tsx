import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageLoader } from '@/components/common/page-loader';
import { DataSourcesClient } from './sources-client';

export const metadata: Metadata = {
  title: 'Data Sources',
};

/**
 * Data Sources — RSC shell.
 *
 * Server Component: exports static `metadata` and streams the interactive
 * `<DataSourcesClient />` (data-table, connection-test / sync / delete / toggle
 * handlers + wizard/dialog state) behind a `<Suspense>` boundary. The fallback
 * mirrors the resolved layout (header → toolbar → source table) with no KPI
 * row. All hooks/state remain in the client child.
 *
 * Pattern reference: docs/frontend/rsc-shell-pattern.md
 */
export default function DataSourcesPage() {
  return (
    <Suspense fallback={<PageLoader kpis={0} rows={8} />}>
      <DataSourcesClient />
    </Suspense>
  );
}
