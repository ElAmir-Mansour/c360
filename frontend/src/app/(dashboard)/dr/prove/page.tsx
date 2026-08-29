'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Fingerprint, ListChecks, Scale, Search } from 'lucide-react';
import { AuditTrailTable } from '@/components/product';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { resolveDRGroupId, useDRSelection } from '../_lib/dr-selection';
import { useDRLabels } from '../_lib/dr-i18n';
import { useProvePageLabels } from './_components/prove-labels';
import {
  useDRAttestationLedger,
  useDRBCMPacks,
  useDRFailoverRuns,
  useDRGroupSummary,
  useDRLedgerVerify,
  useDRPosture,
} from '../_hooks/use-dr-queries';
import { useEvidenceActions } from '../_hooks/use-dr-actions';
import { DRAttestationActionsPanel } from '../_components/dr-attestation-actions';
import { BCMAssessmentPanel } from './_components/bcm-assessment-panel';
import { DRWriteGate } from '../_components/console/dr-write-gate';
import { EvidenceOperations, buildEvidenceSummary } from './_components/evidence-operations';
import { PIRReview } from './_components/pir-review';

const WRITE_PERMISSION = 'dr:write';

/**
 * Code-splitting (#20b): the evidence-pack exporter is a client-only viz module —
 * it opens a print window and builds JSON/HTML blobs via `window`/`document`/`Blob`
 * APIs that have no server equivalent. Loading it with `next/dynamic` (`ssr:false`)
 * keeps its print-rendering bundle out of the initial Prove payload until the
 * operator actually exports a pack.
 */
const ExportEvidencePack = dynamic(
  () => import('./_components/evidence/export-evidence-pack').then((m) => m.ExportEvidencePack),
  {
    ssr: false,
    loading: () => <LoadingSkeleton variant="card" count={1} />,
  },
);

/**
 * Prove (`/dr/prove`) — the evidence + attestation surface of the Recovery
 * Operations Console (replaces the legacy "evidence" tab).
 *
 * The screen leads with the immutable attestation ledger (the design-system
 * `AuditTrailTable`, hash-chained entries + chain-verify verdict), then surfaces
 * the operational evidence posture and the attestation actions panel (per-entry
 * inclusion proof + ledger anchor) wired to `useEvidenceActions`. Below that, a
 * BCM compliance assessment runs `assessDRBCMPack` against the active group, and
 * a post-implementation review renders the four-gate outcome for any selected
 * terminal failover run.
 *
 * Selection (`?group=`) is shared with the rest of the console via
 * `useDRSelection`; every query key/refetch interval and every mutation comes
 * from the shared `_hooks` so cross-route cache and invalidations stay coherent.
 * Write actions (anchor / BCM assess) are gated by `dr:write`.
 */
export default function DRProvePage() {
  const { hasPermission, user } = useAuth();
  const canWrite = hasPermission(WRITE_PERMISSION);
  const generatedBy = user?.email ?? null;
  const { auditTrailLabels } = useDRLabels();
  const L = useProvePageLabels();

  const postureQuery = useDRPosture();
  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);

  const { activeGroupId } = useDRSelection({ groups });

  const selectedGroup = useMemo(
    () => groups.find((group) => resolveDRGroupId(group) === activeGroupId) ?? groups[0] ?? null,
    [groups, activeGroupId],
  );

  // Evidence queries (tenant-wide ledger + verify, BCM packs, runs).
  const attestationLedgerQuery = useDRAttestationLedger();
  const ledgerVerificationQuery = useDRLedgerVerify();
  const bcmPacksQuery = useDRBCMPacks();
  const failoverRunsQuery = useDRFailoverRuns();
  const groupSummaryQuery = useDRGroupSummary(activeGroupId);

  // Evidence-domain mutations (ledger proof, ledger anchor, BCM assess).
  const evidence = useEvidenceActions(activeGroupId);

  const ledgerEntries = useMemo(
    () => attestationLedgerQuery.data ?? [],
    [attestationLedgerQuery.data],
  );
  const failoverRuns = useMemo(() => failoverRunsQuery.data ?? [], [failoverRunsQuery.data]);

  // Derived evidence summary (monolith logic), built from real ledger + runs.
  const evidenceSummary = useMemo(
    () => buildEvidenceSummary(ledgerEntries, failoverRuns),
    [ledgerEntries, failoverRuns],
  );

  const selectedGroupName = groupSummaryQuery.data?.name ?? selectedGroup?.name ?? null;

  const ledgerLoading = attestationLedgerQuery.isLoading || ledgerVerificationQuery.isLoading;
  const ledgerError =
    attestationLedgerQuery.error ?? ledgerVerificationQuery.error ?? failoverRunsQuery.error;

  const refetchLedger = () => {
    void attestationLedgerQuery.refetch();
    void ledgerVerificationQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={L.title}
        description={L.description}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/dr/prove/ledger">
                <ListChecks className="me-1.5 h-4 w-4" aria-hidden />
                {L.ledgerExplorerCta}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dr/prove/compliance">
                <Scale className="me-1.5 h-4 w-4" aria-hidden />
                {L.complianceBoardCta}
              </Link>
            </Button>
          </>
        }
      />

      {/* Lead: immutable attestation ledger (design-system AuditTrailTable). */}
      <section aria-labelledby="prove-ledger-heading" className="space-y-3">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <CardTitle id="prove-ledger-heading" className="text-base">
              {L.attestationLedgerHeading}
            </CardTitle>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/dr/prove/ledger">
                <Search className="me-1.5 h-4 w-4" aria-hidden />
                {L.openLedgerExplorerCta}
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {ledgerLoading && ledgerEntries.length === 0 ? (
              <LoadingSkeleton variant="table-row" count={6} />
            ) : (attestationLedgerQuery.error ?? ledgerVerificationQuery.error) &&
              ledgerEntries.length === 0 ? (
              <ErrorState
                message={L.ledgerLoadError}
                onRetry={refetchLedger}
              />
            ) : (
              <AuditTrailTable
                entries={ledgerEntries}
                verification={ledgerVerificationQuery.data}
                labels={auditTrailLabels}
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Operational evidence posture (extracted monolith helper). */}
      <EvidenceOperations
        evidence={evidenceSummary}
        runs={failoverRuns}
        loading={attestationLedgerQuery.isLoading}
        error={attestationLedgerQuery.error}
        onRetry={() => void attestationLedgerQuery.refetch()}
      />

      {/* Attestation actions: inclusion proof + ledger anchor. */}
      <DRWriteGate
        canWrite={canWrite}
        description={L.anchorWriteGateDescription}
      >
        <DRAttestationActionsPanel
          entries={ledgerEntries}
          verification={ledgerVerificationQuery.data ?? null}
          proof={evidence.proof}
          checkpoint={evidence.checkpoint}
          selectedSeq={evidence.selectedSeq}
          loading={ledgerLoading}
          proofLoading={evidence.proofLoading}
          anchorLoading={evidence.anchorLoading}
          error={
            attestationLedgerQuery.error ??
            ledgerVerificationQuery.error ??
            evidence.ledgerProofError ??
            evidence.anchorLedgerError
          }
          onSelectSeq={(seq) => {
            evidence.setSelectedSeq(seq);
            evidence.setProof((proof) => (proof?.seq === seq ? proof : null));
          }}
          onFetchProof={(seq) => evidence.ledgerProof(seq)}
          onAnchor={() => evidence.anchorLedger()}
          onRetry={refetchLedger}
        />
      </DRWriteGate>

      {/* BCM compliance assessment for the active group. */}
      <DRWriteGate
        canWrite={canWrite}
        description={L.bcmWriteGateDescription}
      >
        <BCMAssessmentPanel
          packs={bcmPacksQuery.data ?? []}
          selectedGroupId={activeGroupId}
          selectedGroupName={selectedGroupName}
          latestAssessment={evidence.latestBcmAssessment}
          loading={bcmPacksQuery.isLoading}
          assessing={evidence.assessingBcm}
          canWrite={canWrite}
          error={bcmPacksQuery.error ?? evidence.assessBcmError}
          onAssess={(packKey) => evidence.assessBcm(packKey)}
          onRetry={() => void bcmPacksQuery.refetch()}
        />
      </DRWriteGate>

      {/* Post-implementation review for a selected terminal run. */}
      {failoverRunsQuery.isLoading && failoverRuns.length === 0 ? (
        <LoadingSkeleton variant="card" count={1} />
      ) : failoverRunsQuery.error && failoverRuns.length === 0 ? (
        <ErrorState
          message={L.runsLoadError}
          onRetry={() => void failoverRunsQuery.refetch()}
        />
      ) : (
        <PIRReview runs={failoverRuns} />
      )}

      {/* One-click evidence pack: client-side JSON + print-to-PDF export. */}
      <ExportEvidencePack
        runs={failoverRuns}
        ledgerEntries={ledgerEntries}
        verification={ledgerVerificationQuery.data ?? null}
        groupName={selectedGroupName}
        generatedBy={generatedBy}
      />

      {ledgerError && ledgerEntries.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
          <Fingerprint className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0">{L.unavailableNotice}</span>
        </div>
      ) : null}
    </div>
  );
}
