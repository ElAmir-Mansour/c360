import { ProvePageHeader } from './_components/prove-page-header';
import { EvidenceEventsList } from './_components/evidence-events-list';

export const metadata = {
  title: 'Prove — Clario Recover',
  description:
    'Immutable, regulator-ready audit trail and one-click compliance export across all Recover sub-solutions.',
};

/**
 * Clario Recover — Prove surface (Prompt 10).
 *
 * The cross-sub-solution "Prove" page: an immutable, append-only audit trail of
 * every recovery and rehearsal action (IT DR, Cloud DR, Cyber Recovery) with a
 * one-click compliance export per event. Each event expands to a regulator-ready
 * report — the runbook executed (RTO vs RTA), approvals, integrity-check results
 * (for cyber recovery), and the full timeline — and exports to CSV or a real PDF.
 *
 * Every value is composed server-side from real persisted data: the append-only
 * audit log, the existing runbookstudio / cyber-recovery execution records, and
 * the Metastore RTO seam. The backend gates the surface on `dr:read` and a
 * Recover entitlement; the export downloads through the authenticated pipeline.
 */
export default function RecoverProvePage() {
  return (
    <div className="space-y-6">
      <ProvePageHeader />
      <EvidenceEventsList />
    </div>
  );
}
