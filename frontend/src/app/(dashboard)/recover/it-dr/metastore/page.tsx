'use client';

import { PageHeader } from '@/components/common/page-header';
import { MetastorePanel } from './_components/metastore-panel';
import { useRecoverT } from '../../_lib/recover-i18n';

/**
 * Application Metastore surface (Prompt 7 frontend seam).
 *
 * The CMDB-like source of truth for the recovery metadata runbooks are built
 * from. This page lists the tenant's registered applications and exposes the two
 * seam actions — "Populate from Metastore" (materialize a Runbook Studio runbook
 * from an application's metadata) and "Sync" (diff a linked runbook against
 * current metadata and flag drift) — against the real
 * `/api/recover/metastore/*` endpoints. The server-side entitlement guard
 * (`recover.it_dr`) and the DR console chrome live in this route's layout; the
 * data and actions are gated again server-side (dr:read / dr:write / dr:admin).
 */
export default function RecoverMetastorePage() {
  const t = useRecoverT();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clario Recover"
        title={t('metastore.pageTitle')}
        description={t('metastore.pageDesc')}
      />
      <MetastorePanel />
    </div>
  );
}
