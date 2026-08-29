'use client';

import { PageHeader } from '@/components/common/page-header';
import { CloudDRDashboard } from './_components/cloud-dr-dashboard';
import { useRecoverT } from '../_lib/recover-i18n';

/**
 * Cloud Disaster Recovery sub-solution workspace dashboard (Prompt 5).
 *
 * Composes the EXISTING cloud-recovery capabilities into one coherent product
 * surface: IaC-driven DR and VM capture (protected workloads), the boot-graph
 * dependency sequencing (region/AZ failover view — the REAL bootgraph plan
 * visualised before execution), application verification, and failover/failback
 * — all from the real `GET /api/recover/cloud-dr/overview` aggregation. The
 * server-side entitlement guard (`recover.cloud_dr`) and the DR console chrome
 * live in this route's layout; the data itself is gated again server-side by the
 * overview endpoint.
 *
 * The "rehearse failover" entry ties into the SHARED rehearsal flow (the same
 * component IT DR uses, re-exported — never forked). Failover EXECUTION remains
 * the existing dr:failover-gated boot-run / failover FSM surfaces this workspace
 * links into; it is not duplicated here.
 */
export default function RecoverCloudDRPage() {
  const t = useRecoverT();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clario Recover"
        title={t('clouddr.pageTitle')}
        description={t('clouddr.pageDesc')}
      />
      <CloudDRDashboard />
    </div>
  );
}
