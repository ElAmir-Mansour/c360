'use client';

import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { useRecoverT } from '../../_lib/recover-i18n';

/**
 * Localized header for the Recover "Prove" surface. Split into a client
 * component so the parent `page.tsx` can keep its static `metadata` export while
 * the visible chrome resolves through the 'recover' i18n namespace.
 */
export function ProvePageHeader() {
  const t = useRecoverT();
  return (
    <PageHeader
      eyebrow="Clario Recover"
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          {t('prove.pageTitle')}
        </span>
      }
      description={t('prove.pageDesc')}
    />
  );
}
