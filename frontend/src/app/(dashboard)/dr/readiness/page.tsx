'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Lock } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { showWarning } from '@/lib/toast';
import { resolveDRGroupId, useDRSelection } from '../_lib/dr-selection';
import {
  useDRAttestationLedger,
  useDRBCMPacks,
  useDRBYOKCustodyLog,
  useDRBYOKKeys,
  useDRCleanRoomScan,
  useDRCyberVaultAssessments,
  useDRCyberVaults,
  useDRFailoverRuns,
  useDRGroupRecoveryPoints,
  useDRGroupSummary,
  useDRIaCSnapshots,
  useDRPosture,
  useDRPredictions,
  useDRRansomwareSignals,
  useDRRecoveryTiers,
  useDRRegistryRunbook,
  useDRRegistryRunbookVersions,
  useDRReplicationSummary,
  useDRSites,
  useDRSelfDRArtifacts,
  useDRSelfDRComponents,
  useDRSelfDRLatest,
  useDRStorageVolumes,
  useDRStreamForecast,
  useDRStreamRansomwareSignals,
  useDRWorkloadCaptures,
  useDRWorkloadEpochs,
} from '../_hooks/use-dr-queries';
import { useEvidenceActions, useReadinessActions } from '../_hooks/use-dr-actions';
import { DRSovereignActionsPanel } from '../_components/dr-sovereign-actions';
import { DRSetupEmptyState } from '../_components/empty/dr-setup-empty-state';
import { DRActionGateNotice } from '../_components/empty/dr-action-gate-notice';
import { SovereignReadinessPanel } from '../_components/readiness/sovereign-readiness';
import { RecoveryTierCatalog } from '../_components/advisor';
import { useReadinessPageLabels } from './_lib/readiness-labels';

/**
 * Code-splitting (#20b): the Coverage & Self-DR and Intelligence tab panels are
 * the readiness route's heaviest modules and only render once their (non-default)
 * inner tab is opened. Loading them with `next/dynamic` keeps their bundles out
 * of the initial readiness payload — the Sovereign tab (the default) ships lean
 * and the others stream in on demand with a skeleton placeholder. SSR is left ON
 * (default) because these are interactive form/table panels, not client-only viz.
 */
const PANEL_SKELETON = <LoadingSkeleton variant="card" count={2} />;

const DRCoverageSelfDRPanel = dynamic(
  () => import('../_components/dr-coverage-selfdr').then((m) => m.DRCoverageSelfDRPanel),
  { loading: () => PANEL_SKELETON },
);
const DRCoverageActionsPanel = dynamic(
  () => import('../_components/dr-coverage-actions').then((m) => m.DRCoverageActionsPanel),
  { loading: () => PANEL_SKELETON },
);
const DRIntelligencePlane = dynamic(
  () => import('../_components/dr-intelligence-plane').then((m) => m.DRIntelligencePlane),
  { loading: () => PANEL_SKELETON },
);
const DRCopilotCommandPanel = dynamic(
  () => import('../_components/dr-copilot-commands').then((m) => m.DRCopilotCommandPanel),
  { loading: () => PANEL_SKELETON },
);

/**
 * Readiness route (`/dr/readiness`) — merges the monolith's "sovereign
 * readiness", "coverage & self-DR", and "intelligence" tabs into one scannable
 * console page organized as three inner tabs:
 *
 *  - Sovereign — readiness score, residency/encryption/air-gap controls, BCM
 *    assessment, BYOK rotation, cyber-vault evaluation.
 *  - Coverage & Self-DR — IaC ingest/diff/plan, storage snapshot request/replicate,
 *    workload capture, Self-DR assess/capture/generate-bundle.
 *  - Intelligence — predictions/ransomware signals, registry runbook regenerate,
 *    DR copilot ask/transcript.
 *
 * The posture banner, command bar, and console nav are rendered by the shared
 * `dr/layout.tsx`; this page renders only its own content. Group/stream selection
 * is URL-param-driven via `useDRSelection`. Every write action is reached through
 * the shared `useReadinessActions` hook (which owns the exact monolith
 * `mutationFn` + `onSuccess` invalidations + toast behaviour) and is gated by
 * `hasPermission('dr:write')`.
 */

export default function DRReadinessPage() {
  const L = useReadinessPageLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('dr:write');

  // --- Shared selection (URL-param driven) ---------------------------------
  const postureQuery = useDRPosture();
  const replicationQuery = useDRReplicationSummary();
  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);

  const baseSelection = useDRSelection({ groups });
  const groupSummaryQuery = useDRGroupSummary(baseSelection.activeGroupId);

  const selection = useDRSelection({
    groups,
    groupSummary: groupSummaryQuery.data ?? null,
    replication: replicationQuery.data ?? null,
  });
  const { activeGroupId, activeStreamId } = selection;

  const selectedGroup = useMemo(
    () => groups.find((group) => resolveDRGroupId(group) === activeGroupId) ?? groups[0] ?? null,
    [groups, activeGroupId],
  );
  const selectedGroupName = groupSummaryQuery.data?.name ?? selectedGroup?.name ?? null;

  // --- Sovereign-readiness data --------------------------------------------
  const bcmPacksQuery = useDRBCMPacks();
  const byokKeysQuery = useDRBYOKKeys();
  const byokCustodyQuery = useDRBYOKCustodyLog();
  const cyberVaultsQuery = useDRCyberVaults(activeGroupId);
  const cyberVaultAssessmentsQuery = useDRCyberVaultAssessments(activeGroupId);
  const attestationLedgerQuery = useDRAttestationLedger();
  const failoverRunsQuery = useDRFailoverRuns();

  // --- Coverage / Self-DR data ---------------------------------------------
  const iacSnapshotsQuery = useDRIaCSnapshots();
  const storageVolumesQuery = useDRStorageVolumes();
  const workloadCapturesQuery = useDRWorkloadCaptures();
  const activeCaptureSourceId = workloadCapturesQuery.data?.[0]?.id ?? null;
  const workloadEpochsQuery = useDRWorkloadEpochs(activeCaptureSourceId);
  const selfDRComponentsQuery = useDRSelfDRComponents();
  const selfDRLatestQuery = useDRSelfDRLatest();
  const selfDRArtifactsQuery = useDRSelfDRArtifacts();

  // --- Intelligence data ----------------------------------------------------
  const recoveryPointsQuery = useDRGroupRecoveryPoints(activeGroupId);
  const activeRecoveryPointId = useMemo(() => {
    const points = recoveryPointsQuery.data ?? [];
    const latest = [...points].sort(
      (left, right) => new Date(right.sealed_at).getTime() - new Date(left.sealed_at).getTime(),
    )[0];
    return latest?.id ?? groupSummaryQuery.data?.latest_recovery_point?.id ?? null;
  }, [recoveryPointsQuery.data, groupSummaryQuery.data?.latest_recovery_point?.id]);

  const predictionsQuery = useDRPredictions();
  const ransomwareSignalsQuery = useDRRansomwareSignals();
  const streamForecastQuery = useDRStreamForecast(activeStreamId);
  const streamRansomwareSignalsQuery = useDRStreamRansomwareSignals(activeStreamId);
  const cleanRoomScanQuery = useDRCleanRoomScan(activeRecoveryPointId);
  const registryRunbookQuery = useDRRegistryRunbook(activeGroupId);
  const registryVersionsQuery = useDRRegistryRunbookVersions(activeGroupId);

  // --- Recovery-tier catalog (intelligence plane) --------------------------
  // The catalog is tenant-wide; the highlighted tier is derived from the active
  // group's protected sites (first site that carries a tier recommendation).
  const recoveryTiersQuery = useDRRecoveryTiers();
  const sitesQuery = useDRSites();
  const highlightedTier = useMemo(() => {
    const memberSiteIds = new Set(
      (groupSummaryQuery.data?.members ?? [])
        .map((member) => member.site_id)
        .filter((siteId): siteId is string => Boolean(siteId)),
    );
    const sites = sitesQuery.data ?? [];
    const groupSite = sites.find(
      (site) => memberSiteIds.has(site.id) && site.recovery_tier_recommendation?.tier,
    );
    const anySite = sites.find((site) => site.recovery_tier_recommendation?.tier);
    return (groupSite ?? anySite)?.recovery_tier_recommendation?.tier ?? null;
  }, [groupSummaryQuery.data?.members, sitesQuery.data]);

  // --- Actions (all readiness/coverage/intelligence mutations) -------------
  const actions = useReadinessActions({
    activeGroupId,
    activeStreamId,
    selfDRRestoreWaves: selfDRLatestQuery.data?.assessment.restore_plan.waves,
  });

  // BCM-pack assessment lives on the evidence action hook (shared with the Prove
  // route); the sovereign-actions panel needs it for its "Assess BCM pack" button.
  const evidenceActions = useEvidenceActions(activeGroupId);

  // Permission-guarded action wrappers: when the operator lacks `dr:write`, the
  // mutation never fires — a warning toast explains the missing permission.
  const guard =
    <Args extends unknown[]>(fn: (...args: Args) => void) =>
    (...args: Args) => {
      if (!canWrite) {
        showWarning(L.writeBlockedTitle, L.noWriteTooltip);
        return;
      }
      fn(...args);
    };

  // Cold-start on-ramp: with zero protection groups the readiness, coverage and
  // intelligence surfaces have nothing to score and every action is gated, so we
  // show the create-a-group path instead of empty tabs full of disabled controls.
  const postureLoaded = !postureQuery.isPending;
  const hasNoGroups = postureLoaded && groups.length === 0;

  if (hasNoGroups) {
    return (
      <div className="space-y-6">
        <PageHeader title={L.pageTitle} description={L.pageDescription} />
        <DRSetupEmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={L.pageTitle} description={L.pageDescription} />

      {/* Inline reason when a group-scoped action is gated by no selection. */}
      {canWrite && !activeGroupId ? (
        <DRActionGateNotice reason={L.noGroupReason} />
      ) : null}

      {!canWrite && (
        <Alert variant="warning">
          <Lock className="h-4 w-4" aria-hidden />
          <AlertTitle>{L.readOnlyTitle}</AlertTitle>
          <AlertDescription>{L.readOnlyDescription}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="sovereign" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sovereign">{L.tabSovereign}</TabsTrigger>
          <TabsTrigger value="coverage">{L.tabCoverage}</TabsTrigger>
          <TabsTrigger value="intelligence">{L.tabIntelligence}</TabsTrigger>
        </TabsList>

        {/* Sovereign readiness ------------------------------------------------ */}
        <TabsContent value="sovereign" className="space-y-4">
          <SovereignReadinessPanel
            bcmPacks={bcmPacksQuery.data ?? []}
            byokKeys={byokKeysQuery.data ?? []}
            posture={postureQuery.data ?? null}
            attestationLedger={attestationLedgerQuery.data ?? []}
            failoverRuns={failoverRunsQuery.data ?? []}
            loading={bcmPacksQuery.isLoading || byokKeysQuery.isLoading}
            error={bcmPacksQuery.error ?? byokKeysQuery.error}
            onRetry={() => {
              void bcmPacksQuery.refetch();
              void byokKeysQuery.refetch();
            }}
          />
          <DRSovereignActionsPanel
            selectedGroupId={activeGroupId}
            selectedGroupName={selectedGroupName}
            bcmPacks={bcmPacksQuery.data ?? []}
            byokKeys={byokKeysQuery.data ?? []}
            byokCustodyLog={byokCustodyQuery.data ?? null}
            cyberVaults={cyberVaultsQuery.data?.vaults ?? []}
            cyberVaultAssessments={cyberVaultAssessmentsQuery.data?.assessments ?? []}
            latestBcmAssessment={evidenceActions.latestBcmAssessment}
            latestByokKey={actions.latestByokKey}
            latestVaultAssessment={actions.latestVaultAssessment}
            loading={
              bcmPacksQuery.isLoading ||
              byokKeysQuery.isLoading ||
              byokCustodyQuery.isLoading ||
              cyberVaultsQuery.isLoading ||
              cyberVaultAssessmentsQuery.isLoading
            }
            assessingBcm={evidenceActions.assessingBcm}
            rotatingByok={actions.rotatingByok}
            evaluatingVault={actions.evaluatingVault}
            error={
              bcmPacksQuery.error ??
              byokKeysQuery.error ??
              byokCustodyQuery.error ??
              cyberVaultsQuery.error ??
              cyberVaultAssessmentsQuery.error ??
              evidenceActions.assessBcmError ??
              actions.rotateByokError ??
              actions.evaluateVaultError
            }
            onAssessBcm={guard(evidenceActions.assessBcm)}
            onRotateByok={guard(actions.rotateByok)}
            onEvaluateVault={guard(actions.evaluateVault)}
            onRetry={() => {
              void bcmPacksQuery.refetch();
              void byokKeysQuery.refetch();
              void byokCustodyQuery.refetch();
              void cyberVaultsQuery.refetch();
              void cyberVaultAssessmentsQuery.refetch();
            }}
          />
        </TabsContent>

        {/* Coverage & Self-DR ------------------------------------------------- */}
        <TabsContent value="coverage" className="space-y-4">
          <DRCoverageSelfDRPanel
            iacSnapshots={iacSnapshotsQuery.data ?? null}
            storageVolumes={storageVolumesQuery.data ?? []}
            workloadCaptures={workloadCapturesQuery.data ?? []}
            workloadEpochs={workloadEpochsQuery.data ?? []}
            selfDRComponents={selfDRComponentsQuery.data ?? null}
            selfDRLatest={selfDRLatestQuery.data ?? null}
            selfDRArtifacts={selfDRArtifactsQuery.data ?? []}
            loading={
              iacSnapshotsQuery.isLoading ||
              storageVolumesQuery.isLoading ||
              workloadCapturesQuery.isLoading ||
              workloadEpochsQuery.isLoading ||
              selfDRComponentsQuery.isLoading ||
              selfDRLatestQuery.isLoading ||
              selfDRArtifactsQuery.isLoading
            }
            error={
              iacSnapshotsQuery.error ??
              storageVolumesQuery.error ??
              workloadCapturesQuery.error ??
              workloadEpochsQuery.error ??
              selfDRComponentsQuery.error ??
              selfDRLatestQuery.error ??
              selfDRArtifactsQuery.error
            }
            onRetry={() => {
              void iacSnapshotsQuery.refetch();
              void storageVolumesQuery.refetch();
              void workloadCapturesQuery.refetch();
              void workloadEpochsQuery.refetch();
              void selfDRComponentsQuery.refetch();
              void selfDRLatestQuery.refetch();
              void selfDRArtifactsQuery.refetch();
            }}
          />
          <DRCoverageActionsPanel
            activeGroupId={activeGroupId}
            activeStreamId={activeStreamId}
            iacSnapshots={iacSnapshotsQuery.data ?? null}
            storageVolumes={storageVolumesQuery.data ?? []}
            workloadCaptures={workloadCapturesQuery.data ?? []}
            selfDRLatest={selfDRLatestQuery.data ?? null}
            selfDRArtifacts={selfDRArtifactsQuery.data ?? []}
            latestIacDiff={actions.latestIacDiff}
            latestIacPlan={actions.latestIacPlan}
            latestStorageSnapshot={actions.latestStorageSnapshot}
            latestWorkloadEpoch={actions.latestWorkloadEpoch}
            latestSelfDRArtifact={actions.latestSelfDRArtifact}
            loading={
              iacSnapshotsQuery.isLoading ||
              storageVolumesQuery.isLoading ||
              workloadCapturesQuery.isLoading ||
              selfDRLatestQuery.isLoading ||
              selfDRArtifactsQuery.isLoading
            }
            ingestingIac={actions.ingestingIac}
            loadingIacDiff={actions.loadingIacDiff}
            loadingIacPlan={actions.loadingIacPlan}
            requestingSnapshot={actions.requestingSnapshot}
            replicatingSnapshot={actions.replicatingSnapshot}
            runningCapture={actions.runningCapture}
            assessingSelfDR={actions.assessingSelfDR}
            capturingBackup={actions.capturingBackup}
            generatingBundle={actions.generatingBundle}
            error={
              iacSnapshotsQuery.error ??
              storageVolumesQuery.error ??
              workloadCapturesQuery.error ??
              selfDRLatestQuery.error ??
              selfDRArtifactsQuery.error ??
              actions.ingestIacError ??
              actions.loadIacDiffError ??
              actions.loadIacPlanError ??
              actions.requestStorageSnapshotError ??
              actions.replicateStorageSnapshotError ??
              actions.runWorkloadCaptureError ??
              actions.assessSelfDRError ??
              actions.captureBackupError ??
              actions.generateBundleError
            }
            onIngestIac={guard(actions.ingestIac)}
            onLoadIacDiff={actions.loadIacDiff}
            onLoadIacPlan={actions.loadIacPlan}
            onRequestStorageSnapshot={guard(actions.requestStorageSnapshot)}
            onReplicateStorageSnapshot={guard(actions.replicateStorageSnapshot)}
            onRunWorkloadCapture={guard(actions.runWorkloadCapture)}
            onAssessSelfDR={guard(actions.assessSelfDR)}
            onCaptureSelfDRBackup={guard(actions.captureBackup)}
            onGenerateOfflineBundle={guard(actions.generateBundle)}
            onRetry={() => {
              void iacSnapshotsQuery.refetch();
              void storageVolumesQuery.refetch();
              void workloadCapturesQuery.refetch();
              void selfDRLatestQuery.refetch();
              void selfDRArtifactsQuery.refetch();
            }}
          />
        </TabsContent>

        {/* Intelligence ------------------------------------------------------ */}
        <TabsContent value="intelligence" className="space-y-4">
          <DRIntelligencePlane
            activeStreamId={activeStreamId}
            cleanRoomScan={cleanRoomScanQuery.data ?? null}
            forecast={streamForecastQuery.data ?? null}
            latestRecoveryPointId={activeRecoveryPointId}
            predictions={predictionsQuery.data ?? []}
            ransomwareSignals={ransomwareSignalsQuery.data ?? []}
            registryRunbook={registryRunbookQuery.data ?? null}
            registryVersions={registryVersionsQuery.data ?? []}
            selectedGroupName={selectedGroupName}
            streamSignals={streamRansomwareSignalsQuery.data ?? []}
            loading={
              predictionsQuery.isLoading ||
              streamForecastQuery.isLoading ||
              ransomwareSignalsQuery.isLoading ||
              streamRansomwareSignalsQuery.isLoading ||
              cleanRoomScanQuery.isLoading ||
              registryRunbookQuery.isLoading ||
              registryVersionsQuery.isLoading
            }
            error={
              predictionsQuery.error ??
              streamForecastQuery.error ??
              ransomwareSignalsQuery.error ??
              streamRansomwareSignalsQuery.error ??
              cleanRoomScanQuery.error ??
              registryRunbookQuery.error ??
              registryVersionsQuery.error
            }
            onRetry={() => {
              void predictionsQuery.refetch();
              void streamForecastQuery.refetch();
              void ransomwareSignalsQuery.refetch();
              void streamRansomwareSignalsQuery.refetch();
              void cleanRoomScanQuery.refetch();
              void registryRunbookQuery.refetch();
              void registryVersionsQuery.refetch();
            }}
          />
          <DRCopilotCommandPanel
            activeStreamId={activeStreamId}
            selectedGroupId={activeGroupId}
            selectedGroupName={selectedGroupName}
            latestRecoveryPointId={activeRecoveryPointId}
            registryRunbook={registryRunbookQuery.data ?? null}
            registryVersions={registryVersionsQuery.data ?? []}
            copilotResult={actions.copilotResult}
            transcript={actions.copilotTranscript}
            regeneratingRunbook={actions.regeneratingRunbook}
            askingCopilot={actions.askingCopilot}
            transcriptLoading={actions.transcriptLoading}
            error={
              registryRunbookQuery.error ??
              registryVersionsQuery.error ??
              actions.regenerateRunbookError ??
              actions.askCopilotError ??
              actions.loadTranscriptError
            }
            onAskCopilot={guard(actions.askCopilot)}
            onRegenerateRunbook={guard(actions.regenerateRunbook)}
            onLoadTranscript={actions.loadTranscript}
            onRetry={() => {
              void registryRunbookQuery.refetch();
              void registryVersionsQuery.refetch();
            }}
          />
          <RecoveryTierCatalog
            recoveryTiers={recoveryTiersQuery.data ?? []}
            highlightedTier={highlightedTier}
            loading={recoveryTiersQuery.isLoading}
            error={recoveryTiersQuery.error ?? sitesQuery.error}
            onRetry={() => {
              void recoveryTiersQuery.refetch();
              void sitesQuery.refetch();
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
