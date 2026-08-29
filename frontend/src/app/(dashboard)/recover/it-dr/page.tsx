'use client';

import { PageHeader } from '@/components/common/page-header';
import { ITDRDashboard } from './_components/it-dr-dashboard';
import { useRecoverT } from '../_lib/recover-i18n';

/**
 * IT Disaster Recovery sub-solution workspace dashboard (Prompt 4).
 *
 * Composes the EXISTING IT DR capabilities into one coherent product surface:
 * runbook inventory, a readiness score computed from real persisted state, the
 * upcoming/last rehearsal, and the open approval-gate backlog — all from the real
 * `GET /api/recover/it-dr/overview` aggregation. The server-side entitlement
 * guard (`recover.it_dr`) and the DR console chrome live in this route's layout;
 * the data itself is gated again server-side by the overview endpoint.
 *
 * Dynamic runbooks remain editable mid-rehearsal and mid-recovery — that live
 * behavior is owned by the composed Runbook Studio / Live Recovery surfaces this
 * dashboard links into; it is not halted or duplicated here.
 */
export default function RecoverITDRPage() {
  const t = useRecoverT();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clario Recover"
        title={t('itdr.pageTitle')}
        description={t('itdr.pageDesc')}
      />
      <ITDRDashboard />
    </div>
  );
}
