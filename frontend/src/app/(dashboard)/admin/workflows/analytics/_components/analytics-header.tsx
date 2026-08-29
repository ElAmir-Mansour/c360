'use client';

import { PageHeader } from '@/components/common/page-header';
import { useT } from '@/components/providers/locale-provider';

/**
 * Client header for the (server) Workflow Analytics page so the visible
 * title/description resolve through `useT('admin')` (the page itself stays a
 * server component to keep its `metadata` export).
 */
export function AnalyticsHeader() {
  const t = useT('admin');
  return <PageHeader title={t('wa.title')} description={t('wa.desc')} />;
}
