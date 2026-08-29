'use client';

import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  Boxes,
  CheckCircle2,
  DatabaseBackup,
  FileArchive,
  GitBranch,
  GitCompareArrows,
  HardDrive,
  Layers3,
  ListChecks,
  Loader2,
  PackageCheck,
  PlayCircle,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
import type {
  DRIaCDiff,
  DRIaCPlanStep,
  DRIaCReconstitutionPlan,
  DRIaCSnapshot,
  DRIaCSnapshotList,
  DRSelfDRAssessmentReport,
  DRSelfDRFinding,
  DRSelfDROfflineRestoreBundle,
  DRSelfDRStoredArtifact,
  DRStorageSnapshot,
  DRStorageVolume,
  DRWorkloadCaptureEpoch,
  DRWorkloadCaptureSource,
} from '@/types/clario-dr';
import {
  type CoverageActionsLabels,
  useCoverageActionsLabels,
} from './dr-coverage-actions-labels';

export type DRCoverageActionsPanelProps = {
  activeGroupId?: string | null;
  activeStreamId?: string | null;
  iacSnapshots: DRIaCSnapshotList | null;
  storageVolumes: DRStorageVolume[];
  workloadCaptures: DRWorkloadCaptureSource[];
  selfDRLatest?: DRSelfDRAssessmentReport | null;
  selfDRArtifacts: DRSelfDRStoredArtifact[];
  latestIacDiff?: DRIaCDiff | null;
  latestIacPlan?: DRIaCReconstitutionPlan | null;
  latestStorageSnapshot?: DRStorageSnapshot | null;
  latestWorkloadEpoch?: DRWorkloadCaptureEpoch | null;
  latestSelfDRArtifact?: DRSelfDRStoredArtifact | null;
  loading: boolean;
  ingestingIac: boolean;
  loadingIacDiff: boolean;
  loadingIacPlan: boolean;
  requestingSnapshot: boolean;
  replicatingSnapshot: boolean;
  runningCapture: boolean;
  assessingSelfDR: boolean;
  capturingBackup: boolean;
  generatingBundle: boolean;
  error: unknown;
  onIngestIac: () => void;
  onLoadIacDiff: (snapshotID: string, againstSnapshotID: string) => void;
  onLoadIacPlan: (snapshotID: string) => void;
  onRequestStorageSnapshot: (volumeID: string) => void;
  onReplicateStorageSnapshot: (snapshotID: string) => void;
  onRunWorkloadCapture: (sourceID: string) => void;
  onAssessSelfDR: () => void;
  onCaptureSelfDRBackup: () => void;
  onGenerateOfflineBundle: () => void;
  onRetry: () => void;
};

type Tone = 'success' | 'warning' | 'critical' | 'info' | 'neutral';

type StorageVolumeSnapshotHints = {
  snapshots?: DRStorageSnapshot[];
  latest_snapshot?: DRStorageSnapshot | null;
  snapshot_count?: number | null;
  replicated_snapshot_count?: number | null;
  failed_snapshot_count?: number | null;
};

type ActionButtonVariant = 'default' | 'outline' | 'secondary' | 'destructive';

export function DRCoverageActionsPanel({
  activeGroupId,
  activeStreamId,
  iacSnapshots,
  storageVolumes,
  workloadCaptures,
  selfDRLatest,
  selfDRArtifacts,
  latestIacDiff,
  latestIacPlan,
  latestStorageSnapshot,
  latestWorkloadEpoch,
  latestSelfDRArtifact,
  loading,
  ingestingIac,
  loadingIacDiff,
  loadingIacPlan,
  requestingSnapshot,
  replicatingSnapshot,
  runningCapture,
  assessingSelfDR,
  capturingBackup,
  generatingBundle,
  error,
  onIngestIac,
  onLoadIacDiff,
  onLoadIacPlan,
  onRequestStorageSnapshot,
  onReplicateStorageSnapshot,
  onRunWorkloadCapture,
  onAssessSelfDR,
  onCaptureSelfDRBackup,
  onGenerateOfflineBundle,
  onRetry,
}: DRCoverageActionsPanelProps) {
  const L = useCoverageActionsLabels();
  const scopedSnapshots = sortByTime(
    (iacSnapshots?.snapshots ?? []).filter((snapshot) => !activeGroupId || snapshot.group_id === activeGroupId),
    'created_at',
  );
  const latestSnapshot = scopedSnapshots[0] ?? null;
  const previousSnapshot = scopedSnapshots[1] ?? null;
  const iacDiffCount = diffChangeCount(latestIacDiff);
  const iacPlanSteps = latestIacPlan?.steps ?? [];
  const iacPlanWaves = latestIacPlan?.waves ?? [];

  const volumeSnapshots = mergeStorageSnapshots(
    storageVolumes.flatMap((volume) => volumeKnownSnapshots(volume)),
    latestStorageSnapshot ? [latestStorageSnapshot] : [],
  );
  const newestStorageSnapshot = latestStorageSnapshot ?? sortByTime(volumeSnapshots, 'created_at')[0] ?? null;
  const replicatedSnapshotCount = volumeSnapshots.filter((snapshot) => isReplicatedSnapshot(snapshot)).length;
  const failedSnapshotCount = volumeSnapshots.filter((snapshot) => normalizeStatus(snapshot.state) === 'failed').length;
  const readySnapshotCount = volumeSnapshots.filter((snapshot) => normalizeStatus(snapshot.state) === 'ready').length;

  const streamSources = workloadCaptures.filter((source) => !activeStreamId || source.stream_id === activeStreamId);
  const enabledSources = streamSources.filter((source) => source.enabled);
  const newestEpoch = latestWorkloadEpoch && (!activeStreamId || latestWorkloadEpoch.stream_id === activeStreamId)
    ? latestWorkloadEpoch
    : null;
  const changedUnitCoverage = newestEpoch ? percent(newestEpoch.changed_units, newestEpoch.total_units) : 0;

  const selfDRAssessment = selfDRLatest?.assessment ?? null;
  const selfDRFindings = selfDRAssessment?.findings ?? [];
  const allArtifacts = mergeArtifacts(selfDRArtifacts, selfDRLatest?.artifacts ?? []);
  const newestArtifact = latestSelfDRArtifact ?? sortByTime(allArtifacts, 'captured_at')[0] ?? null;
  const latestBackupArtifact = latestArtifactByKind(allArtifacts, 'control_plane_backup');
  const latestBundleArtifact = latestArtifactByKind(allArtifacts, 'offline_restore_bundle');
  const latestBundleReady = offlineBundleReady(latestBundleArtifact);
  const selfDRScore = selfDRReadinessScore(selfDRLatest, latestBundleArtifact);

  const hasData = Boolean(
    scopedSnapshots.length ||
      storageVolumes.length ||
      volumeSnapshots.length ||
      streamSources.length ||
      newestEpoch ||
      selfDRLatest ||
      allArtifacts.length ||
      latestIacDiff ||
      latestIacPlan,
  );

  if (loading && !hasData) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && !hasData) {
    return <ErrorState message={L.loadError} onRetry={onRetry} />;
  }

  const canIngestIac = Boolean(activeGroupId) && !loading && !ingestingIac;
  const canLoadDiff = Boolean(latestSnapshot && previousSnapshot) && !loading && !loadingIacDiff;
  const canLoadPlan = Boolean(latestSnapshot) && !loading && !loadingIacPlan;
  const canReplicateLatestSnapshot = Boolean(newestStorageSnapshot && canReplicateSnapshot(newestStorageSnapshot)) && !loading && !replicatingSnapshot;
  const canRunAnyCapture = enabledSources.length > 0 && !loading && !runningCapture;
  const canAssessSelfDR = !loading && !assessingSelfDR;
  const canCaptureSelfDRBackup = Boolean(selfDRLatest) && !loading && !capturingBackup;
  const canGenerateBundle = Boolean(selfDRLatest || latestBackupArtifact) && !loading && !generatingBundle;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{formatError(error, L)}</span>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            {L.retry}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ActionMetric
          title={L.metricIacBaseline}
          value={latestSnapshot ? `v${latestSnapshot.version}` : L.none}
          detail={latestSnapshot ? L.resourcesDetail(latestSnapshot.resource_count, shortID(latestSnapshot.id)) : L.ingestPrompt}
          icon={GitCompareArrows}
          tone={latestSnapshot && previousSnapshot ? 'success' : latestSnapshot ? 'warning' : 'neutral'}
        />
        <ActionMetric
          title={L.metricStorageSnapshots}
          value={volumeSnapshots.length || storageVolumes.length}
          detail={volumeSnapshots.length > 0 ? L.replicatedDetail(replicatedSnapshotCount, volumeSnapshots.length) : L.volumesRegistered(storageVolumes.length)}
          icon={HardDrive}
          tone={failedSnapshotCount > 0 ? 'critical' : volumeSnapshots.length > 0 || storageVolumes.length > 0 ? 'success' : 'neutral'}
        />
        <ActionMetric
          title={L.metricWorkloadCaptures}
          value={`${enabledSources.length}/${streamSources.length}`}
          detail={newestEpoch ? L.epochDetail(newestEpoch.frame_count, formatBytes(newestEpoch.payload_bytes)) : activeStreamId ? L.noEpochForStream : L.noStreamSelected}
          icon={ServerCog}
          tone={enabledSources.length > 0 && newestEpoch ? 'success' : streamSources.length > 0 ? 'warning' : 'neutral'}
        />
        <ActionMetric
          title={L.metricSelfDr}
          value={selfDRAssessment ? labelFor(selfDRAssessment.verdict) : L.unassessed}
          detail={selfDRAssessment ? L.criticalWarnings(selfDRAssessment.critical, selfDRAssessment.warning) : L.artifactsRetained(allArtifacts.length)}
          icon={ShieldCheck}
          tone={selfDRTone(selfDRAssessment?.verdict, selfDRFindings)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.iacTitle}</CardTitle>
              <CardDescription>{L.iacDescription}</CardDescription>
            </div>
            <StatusBadge status={latestSnapshot ? (previousSnapshot ? 'ready' : 'baseline_needed') : 'pending'} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ActionButton
                label={L.actIngest}
                loadingText={L.ingestLoading}
                description={canIngestIac ? L.groupScoped(shortID(activeGroupId)) : iacIngestDisabledReason(activeGroupId, L)}
                icon={Archive}
                loading={ingestingIac}
                disabled={!canIngestIac}
                onClick={onIngestIac}
              />
              <ActionButton
                label={L.actLoadDiff}
                loadingText={L.loadLoading}
                description={latestSnapshot && previousSnapshot ? L.diffPair(shortID(latestSnapshot.id), shortID(previousSnapshot.id)) : L.twoSnapshotsRequired}
                icon={GitCompareArrows}
                loading={loadingIacDiff}
                disabled={!canLoadDiff}
                onClick={() => {
                  if (latestSnapshot && previousSnapshot) onLoadIacDiff(latestSnapshot.id, previousSnapshot.id);
                }}
              />
              <ActionButton
                label={L.actBuildPlan}
                loadingText={L.buildLoading}
                description={latestSnapshot ? L.resourcesFrom(latestSnapshot.resource_count, shortID(latestSnapshot.id)) : L.snapshotRequired}
                icon={ListChecks}
                loading={loadingIacPlan}
                disabled={!canLoadPlan}
                onClick={() => {
                  if (latestSnapshot) onLoadIacPlan(latestSnapshot.id);
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={L.miniActiveGroup} value={activeGroupId ? shortID(activeGroupId) : L.na} tone="slate" />
              <MiniDatum label={L.miniSnapshots} value={scopedSnapshots.length} tone="sky" />
              <MiniDatum label={L.miniLatest} value={formatDateTime(latestSnapshot?.created_at)} tone="gold" />
              <MiniDatum label={L.miniPrevious} value={formatDateTime(previousSnapshot?.created_at)} tone="gold" />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <OutputPanel
                title={L.outputLatestDiff}
                icon={GitCompareArrows}
                status={latestIacDiff ? 'ready' : canLoadDiff ? 'available' : 'pending'}
                emptyText={canLoadDiff ? L.diffNotLoaded : L.captureSecondSnapshot}
              >
                {latestIacDiff ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <MiniDatum label={L.diffAdded} value={latestIacDiff.added.length} tone="sky" />
                      <MiniDatum label={L.diffRemoved} value={latestIacDiff.removed.length} tone="sky" />
                      <MiniDatum label={L.diffModified} value={latestIacDiff.modified.length} tone="sky" />
                    </div>
                    <div className="mt-3 space-y-2">
                      {diffPreview(latestIacDiff).length > 0 ? (
                        diffPreview(latestIacDiff).map((change) => (
                          <ChangeLine
                            key={`${change.change}-${change.address}`}
                            label={change.address}
                            detail={`${change.key.provider} / ${change.key.type}`}
                            status={change.change}
                          />
                        ))
                      ) : (
                        <EmptyLine icon={CheckCircle2} text={L.noResourceDrift} />
                      )}
                    </div>
                    {iacDiffCount > 5 ? (
                      <div className="mt-2 text-xs text-muted-foreground">{L.additionalChangesHidden(iacDiffCount - 5)}</div>
                    ) : null}
                  </>
                ) : null}
              </OutputPanel>

              <OutputPanel
                title={L.outputReconstitution}
                icon={GitBranch}
                status={latestIacPlan ? 'ready' : canLoadPlan ? 'available' : 'pending'}
                emptyText={canLoadPlan ? L.planNotGenerated : L.loadSnapshotFirst}
              >
                {latestIacPlan ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <MiniDatum label={L.planSteps} value={iacPlanSteps.length} tone="sky" />
                      <MiniDatum label={L.planWaves} value={iacPlanWaves.length} tone="sky" />
                      <MiniDatum label={L.planSnapshot} value={latestIacPlan.snapshot_id ? shortID(latestIacPlan.snapshot_id) : L.na} tone="slate" />
                    </div>
                    <div className="mt-3 space-y-2">
                      {planWavePreview(latestIacPlan, L).map((wave) => (
                        <PlanWaveLine
                          key={wave.key}
                          label={wave.label}
                          detail={wave.detail}
                          order={wave.order}
                        />
                      ))}
                      {iacPlanSteps.length === 0 ? <EmptyLine icon={Layers3} text={L.noPlanSteps} /> : null}
                    </div>
                  </>
                ) : null}
              </OutputPanel>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.storageTitle}</CardTitle>
              <CardDescription>{L.storageDescription}</CardDescription>
            </div>
            <StatusBadge status={readySnapshotCount > 0 || enabledSources.length > 0 ? 'ready' : 'pending'} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ActionButton
                label={L.actReplicate}
                loadingText={L.replicateLoading}
                description={newestStorageSnapshot ? L.replicateDetail(labelFor(newestStorageSnapshot.state), shortID(newestStorageSnapshot.id)) : L.noSnapshotAvailable}
                icon={DatabaseBackup}
                loading={replicatingSnapshot}
                disabled={!canReplicateLatestSnapshot}
                onClick={() => {
                  if (newestStorageSnapshot) onReplicateStorageSnapshot(newestStorageSnapshot.id);
                }}
              />
              <ActionButton
                label={L.actRunCapture}
                loadingText={L.runLoading}
                description={canRunAnyCapture ? L.enabledSources(enabledSources.length) : workloadCaptureDisabledReason(activeStreamId, streamSources, L)}
                icon={PlayCircle}
                loading={runningCapture}
                disabled={!canRunAnyCapture}
                onClick={() => {
                  const firstSource = enabledSources[0];
                  if (firstSource) onRunWorkloadCapture(firstSource.id);
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={L.miniVolumes} value={storageVolumes.length} tone="sky" />
              <MiniDatum label={L.miniSnapshots2} value={volumeSnapshots.length} tone="sky" />
              <MiniDatum label={L.miniReady} value={readySnapshotCount} tone="emerald" />
              <MiniDatum label={L.miniFailed} value={failedSnapshotCount} tone={failedSnapshotCount > 0 ? 'rose' : 'emerald'} />
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{L.colVolume}</TableHead>
                    <TableHead>{L.colProvider}</TableHead>
                    <TableHead>{L.colRetention}</TableHead>
                    <TableHead>{L.colLatest}</TableHead>
                    <TableHead className="text-end">{L.colAction}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {storageVolumes.length > 0 ? (
                    storageVolumes.slice(0, 5).map((volume) => {
                      const snapshot = latestSnapshotForVolume(volume, latestStorageSnapshot);
                      const requestDisabled = loading || requestingSnapshot;
                      return (
                        <TableRow key={volume.id}>
                          <TableCell className="max-w-[180px]">
                            <div className="truncate font-medium">{volume.name}</div>
                            <div className="truncate text-xs text-muted-foreground">{volume.source_location}</div>
                          </TableCell>
                          <TableCell>{labelFor(volume.provider)}</TableCell>
                          <TableCell>{L.snapsSuffix(volume.retention_max_snapshots)}</TableCell>
                          <TableCell>
                            {snapshot ? (
                              <StatusBadge status={snapshot.state} label={`${labelFor(snapshot.state)} ${shortID(snapshot.id)}`} />
                            ) : (
                              <span className="text-sm text-muted-foreground">{L.none}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={requestDisabled}
                              onClick={() => onRequestStorageSnapshot(volume.id)}
                              aria-label={L.requestSnapshotAria(volume.name)}
                            >
                              {requestingSnapshot ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <HardDrive className="me-1.5 h-3.5 w-3.5" />}
                              {L.snapshotBtn}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        {L.noStorageVolumes}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <SummaryBox
                title={L.summaryLatestSnapshot}
                icon={DatabaseBackup}
                status={newestStorageSnapshot?.state ?? 'empty'}
                rows={[
                  [L.rowSnapshot, newestStorageSnapshot ? shortID(newestStorageSnapshot.id) : L.na],
                  [L.rowSize, newestStorageSnapshot ? formatBytes(newestStorageSnapshot.size_bytes) : L.na],
                  [L.rowChanged, newestStorageSnapshot ? formatBytes(newestStorageSnapshot.changed_bytes) : L.na],
                  [L.rowTarget, newestStorageSnapshot?.replicated_target ?? L.na],
                ]}
              />
              <SummaryBox
                title={L.summaryLatestEpoch}
                icon={ServerCog}
                status={newestEpoch ? 'ready' : 'empty'}
                rows={[
                  [L.rowStream, activeStreamId ? shortID(activeStreamId) : newestEpoch ? shortID(newestEpoch.stream_id) : L.na],
                  [L.rowSource, newestEpoch ? sourceName(newestEpoch.source_id, streamSources) : L.na],
                  [L.rowEpoch, newestEpoch ? newestEpoch.epoch : L.na],
                  [L.rowPayload, newestEpoch ? formatBytes(newestEpoch.payload_bytes) : L.na],
                ]}
              >
                {newestEpoch ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-muted-foreground">{L.changedUnitCoverage}</span>
                      <span className="font-semibold">{changedUnitCoverage}%</span>
                    </div>
                    <Progress value={changedUnitCoverage} className="h-2" />
                  </div>
                ) : null}
              </SummaryBox>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.workloadTitle}</CardTitle>
              <CardDescription>{L.workloadDescription}</CardDescription>
            </div>
            <Badge variant="outline" className="normal-case tracking-normal">
              {activeStreamId ? shortID(activeStreamId) : L.allStreams}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {streamSources.length > 0 ? (
              streamSources.slice(0, 6).map((source) => {
                const sourceDisabled = loading || runningCapture || !source.enabled;
                return (
                  <div key={source.id} className="flex flex-col gap-3 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={cn('rounded-lg p-2', source.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                        <ServerCog className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{source.name}</div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {L.sourceMeta(labelFor(source.source_kind), labelFor(source.binding_kind), source.last_seq)}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={source.enabled ? 'ready' : 'disabled'} label={source.enabled ? L.enabledLabel : L.disabledLabel} />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={sourceDisabled}
                        onClick={() => onRunWorkloadCapture(source.id)}
                        aria-label={L.runCaptureAria(source.name)}
                      >
                        {runningCapture ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="me-1.5 h-3.5 w-3.5" />}
                        {L.captureBtn}
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyLine icon={ServerCog} text={activeStreamId ? L.noSourcesForStream : L.noSourcesReturned} />
            )}
            {streamSources.length > 6 ? (
              <div className="text-xs text-muted-foreground">{L.additionalSourcesHidden(streamSources.length - 6)}</div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.selfDrTitle}</CardTitle>
              <CardDescription>{L.selfDrDescription()}</CardDescription>
            </div>
            <StatusBadge status={selfDRAssessment?.verdict ?? 'pending'} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ActionButton
                label={L.actAssess}
                loadingText={L.assessLoading}
                description={selfDRAssessment ? L.lastVerdict(labelFor(selfDRAssessment.verdict)) : L.runAssessment}
                icon={ShieldCheck}
                loading={assessingSelfDR}
                disabled={!canAssessSelfDR}
                onClick={onAssessSelfDR}
              />
              <ActionButton
                label={L.actCapture()}
                loadingText={L.captureLoading}
                description={canCaptureSelfDRBackup ? L.restoreWaves(selfDRAssessment?.restore_plan.waves.length ?? 0) : L.assessmentRequired}
                icon={PackageCheck}
                loading={capturingBackup}
                disabled={!canCaptureSelfDRBackup}
                onClick={onCaptureSelfDRBackup}
              />
              <ActionButton
                label={L.actGenerate}
                loadingText={L.generateLoading}
                description={canGenerateBundle ? latestBundleReady ? L.latestBundleReady : L.createBundle : L.assessmentOrBackupRequired()}
                icon={FileArchive}
                loading={generatingBundle}
                disabled={!canGenerateBundle}
                onClick={onGenerateOfflineBundle}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={L.miniScore} value={`${selfDRScore}%`} tone={selfDRScore < 70 ? 'rose' : 'emerald'} />
              <MiniDatum label={L.miniFindings} value={selfDRFindings.length} tone={selfDRFindings.length > 0 ? 'rose' : 'emerald'} />
              <MiniDatum label={L.miniArtifacts} value={allArtifacts.length} tone="sky" />
              <MiniDatum label={L.miniLatest2} value={formatDateTime(newestArtifact?.captured_at)} tone="gold" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-muted-foreground">{L.selfDrReadiness}</span>
                <span className="font-semibold">{selfDRScore}%</span>
              </div>
              <Progress
                value={selfDRScore}
                className="h-2"
                indicatorClassName={selfDRScore < 70 ? 'bg-amber-500' : undefined}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <OutputPanel
                title={L.outputFindings}
                icon={Activity}
                status={selfDRAssessment?.verdict ?? 'pending'}
                emptyText={L.noSelfDrFindings}
              >
                {selfDRFindings.length > 0 ? (
                  <div className="space-y-2">
                    {selfDRFindings.slice(0, 4).map((finding) => (
                      <FindingLine key={`${finding.code}-${finding.component_id ?? finding.component_kind ?? 'global'}`} finding={finding} />
                    ))}
                    {selfDRFindings.length > 4 ? (
                      <div className="text-xs text-muted-foreground">{L.additionalFindingsHidden(selfDRFindings.length - 4)}</div>
                    ) : null}
                  </div>
                ) : null}
              </OutputPanel>

              <OutputPanel
                title={L.outputArtifacts}
                icon={FileArchive}
                status={latestBundleReady ? 'ready' : latestBundleArtifact ? 'warning' : newestArtifact ? 'available' : 'pending'}
                emptyText={L.noSelfDrArtifacts}
              >
                {allArtifacts.length > 0 ? (
                  <div className="space-y-2">
                    {allArtifacts.slice(0, 4).map((artifact) => (
                      <ArtifactLine key={artifact.id} artifact={artifact} L={L} />
                    ))}
                    {allArtifacts.length > 4 ? (
                      <div className="text-xs text-muted-foreground">{L.additionalArtifactsHidden(allArtifacts.length - 4)}</div>
                    ) : null}
                  </div>
                ) : null}
              </OutputPanel>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActionMetric({
  title,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-overline font-semibold uppercase text-muted-foreground">{title}</div>
            <div className="mt-3 truncate text-2xl font-semibold tracking-tight">{value}</div>
          </div>
          <div className={cn('rounded-lg p-2.5', toneClass(tone, 'soft'))}>
            <Icon className={cn('h-5 w-5', toneClass(tone, 'text'))} />
          </div>
        </div>
        <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
      </CardContent>
    </Card>
  );
}

function ActionButton({
  label,
  loadingText,
  description,
  icon: Icon,
  loading,
  disabled,
  onClick,
  variant = 'outline',
  className,
}: {
  label: string;
  loadingText: string;
  description: string;
  icon: LucideIcon;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: ActionButtonVariant;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={disabled ? 'secondary' : variant}
      className={cn(
        'h-auto min-h-[82px] justify-start gap-3 whitespace-normal px-3 py-3 text-start',
        disabled && 'opacity-70',
        className,
      )}
      disabled={disabled || loading}
      onClick={onClick}
      title={description}
      aria-label={`${loading ? loadingText : label}: ${description}`}
    >
      <span className={cn('rounded-lg p-2', disabled ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-5">{loading ? loadingText : label}</span>
        <span className="mt-1 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

function OutputPanel({
  title,
  icon: Icon,
  status,
  emptyText,
  children,
}: {
  title: string;
  icon: LucideIcon;
  status?: string | null;
  emptyText: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="truncate text-sm font-medium">{title}</div>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-3">
        {children ? children : <EmptyLine icon={Boxes} text={emptyText} />}
      </div>
    </div>
  );
}

function SummaryBox({
  title,
  icon: Icon,
  status,
  rows,
  children,
}: {
  title: string;
  icon: LucideIcon;
  status?: string | null;
  rows: Array<[string, string | number]>;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="truncate text-sm font-medium">{title}</div>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {rows.map(([label, value]) => (
          <MiniDatum key={label} label={label} value={value} />
        ))}
      </div>
      {children}
    </div>
  );
}

/**
 * Compact DR-local stat tile. `tone` is a *decorative accent only*, wired onto
 * the shared `StatTone` vocabulary via `TONE_THEME_CLASS` (faded gradient bg +
 * themed border + accented label) with the value text staying neutral
 * (`text-foreground`). `"neutral"` (default) keeps the original flat treatment.
 */
function MiniDatum({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: StatTone;
}) {
  if (tone === 'neutral') {
    return (
      <div className="min-w-0">
        <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
        <div className="mt-1 truncate font-medium">{value}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        TONE_THEME_CLASS[tone],
        'min-w-0 rounded-lg border bg-[var(--kpi-bg)] border-[var(--kpi-border)] px-2.5 py-2',
      )}
    >
      <div className="text-overline font-semibold uppercase text-[color:var(--kpi-accent)]">
        {label}
      </div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}

function ChangeLine({
  label,
  detail,
  status,
}: {
  label: string;
  detail: string;
  status?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <div className="min-w-0">
        <div className="truncate font-mono text-xs font-medium">{label}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

function PlanWaveLine({
  label,
  detail,
  order,
}: {
  label: string;
  detail: string;
  order: number;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-background px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
        {order}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function FindingLine({ finding }: { finding: DRSelfDRFinding }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{finding.code}</div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{finding.message}</div>
      </div>
      <StatusBadge status={finding.severity} />
    </div>
  );
}

function ArtifactLine({ artifact, L }: { artifact: DRSelfDRStoredArtifact; L: CoverageActionsLabels }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-background px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{labelFor(artifact.kind)}</div>
        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{shortID(artifact.sha256)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {artifact.immutable ? <StatusBadge status="ready" label={L.wormLabel} /> : null}
        {artifact.encrypted ? <StatusBadge status="ready" label={L.sealedLabel} /> : <StatusBadge status="warning" label={L.plainLabel} />}
      </div>
    </div>
  );
}

function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' ||
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'not_ready' ||
    normalized === 'expired'
      ? 'destructive'
      : normalized === 'warning' ||
          normalized === 'pending' ||
          normalized === 'creating' ||
          normalized === 'replicating' ||
          normalized === 'baseline_needed' ||
          normalized === 'disabled' ||
          normalized === 'degraded'
        ? 'warning'
        : normalized === 'healthy' ||
            normalized === 'ready' ||
            normalized === 'available' ||
            normalized === 'replicated' ||
            normalized === 'success' ||
            normalized === 'completed'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case tracking-normal">
      <span className="truncate">{label ?? labelFor(normalized)}</span>
    </Badge>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function iacIngestDisabledReason(activeGroupId: string | null | undefined, L: CoverageActionsLabels) {
  if (!activeGroupId) return L.reasonSelectGroup;
  return L.reasonRefreshInProgress;
}

function workloadCaptureDisabledReason(
  activeStreamId: string | null | undefined,
  sources: DRWorkloadCaptureSource[],
  L: CoverageActionsLabels,
) {
  if (!activeStreamId) return L.reasonSelectStream;
  if (sources.length === 0) return L.reasonNoCaptureSource;
  if (!sources.some((source) => source.enabled)) return L.reasonNoEnabledSources;
  return L.reasonCaptureInProgress;
}

function diffChangeCount(diff?: DRIaCDiff | null) {
  if (!diff) return 0;
  return diff.added.length + diff.removed.length + diff.modified.length;
}

function diffPreview(diff: DRIaCDiff) {
  return [
    ...diff.added.map((item) => ({ ...item, change: item.change || 'added' })),
    ...diff.removed.map((item) => ({ ...item, change: item.change || 'removed' })),
    ...diff.modified.map((item) => ({ ...item, change: item.change || 'modified' })),
  ].slice(0, 5);
}

function planWavePreview(plan: DRIaCReconstitutionPlan, L: CoverageActionsLabels) {
  if (plan.waves.length > 0) {
    return plan.waves.slice(0, 5).map((steps, index) => ({
      key: `wave-${index}`,
      order: index + 1,
      label: L.waveLabel(index + 1),
      detail: planStepSummary(steps, L),
    }));
  }

  return plan.steps.slice(0, 5).map((step) => ({
    key: `${step.order}-${step.address}`,
    order: step.order,
    label: step.address,
    detail: planStepDetail(step, L),
  }));
}

function planStepSummary(steps: DRIaCPlanStep[], L: CoverageActionsLabels) {
  if (steps.length === 0) return L.noResourcesInWave;
  const providers = [...new Set(steps.map((step) => step.provider))].slice(0, 3).join(', ');
  return L.resourcesProviders(steps.length, providers);
}

function planStepDetail(step: DRIaCPlanStep, L: CoverageActionsLabels) {
  const dependencyCount = step.depends_on?.length ?? 0;
  return L.stepDetail(step.provider, step.type, dependencyCount);
}

function latestSnapshotForVolume(volume: DRStorageVolume, fallback?: DRStorageSnapshot | null) {
  const snapshots = volumeKnownSnapshots(volume);
  const latest = sortByTime(snapshots, 'created_at')[0] ?? null;
  if (latest) return latest;
  return fallback?.volume_id === volume.id ? fallback : null;
}

function volumeKnownSnapshots(volume: DRStorageVolume) {
  const hints = volume as DRStorageVolume & StorageVolumeSnapshotHints;
  const snapshots = hints.snapshots ?? [];
  if (!hints.latest_snapshot || snapshots.some((snapshot) => snapshot.id === hints.latest_snapshot?.id)) return snapshots;
  return [hints.latest_snapshot, ...snapshots];
}

function mergeStorageSnapshots(primary: DRStorageSnapshot[], secondary: DRStorageSnapshot[]) {
  const snapshots = new Map<string, DRStorageSnapshot>();
  for (const snapshot of [...primary, ...secondary]) {
    snapshots.set(snapshot.id, snapshot);
  }
  return sortByTime([...snapshots.values()], 'created_at');
}

function isReplicatedSnapshot(snapshot: DRStorageSnapshot) {
  return normalizeStatus(snapshot.state) === 'replicated' || Boolean(snapshot.replicated_at);
}

function canReplicateSnapshot(snapshot: DRStorageSnapshot) {
  return normalizeStatus(snapshot.state) === 'ready' && !isReplicatedSnapshot(snapshot);
}

function sourceName(sourceID: string, sources: DRWorkloadCaptureSource[]) {
  return sources.find((source) => source.id === sourceID)?.name ?? shortID(sourceID);
}

function mergeArtifacts(primary: DRSelfDRStoredArtifact[], secondary: DRSelfDRStoredArtifact[]) {
  const artifacts = new Map<string, DRSelfDRStoredArtifact>();
  for (const artifact of [...primary, ...secondary]) {
    artifacts.set(artifact.id, artifact);
  }
  return sortByTime([...artifacts.values()], 'captured_at');
}

function latestArtifactByKind(artifacts: DRSelfDRStoredArtifact[], kind: string) {
  return artifacts.find((artifact) => normalizeStatus(artifact.kind) === normalizeStatus(kind)) ?? null;
}

function offlineBundleReady(artifact?: DRSelfDRStoredArtifact | null) {
  if (!artifact) return false;
  const evidence = artifact.evidence;
  if (isOfflineBundleEvidence(evidence)) {
    return evidence.available && evidence.complete && artifact.immutable && artifact.encrypted;
  }
  return artifact.immutable && artifact.encrypted;
}

function isOfflineBundleEvidence(value: unknown): value is DRSelfDROfflineRestoreBundle {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'available' in value &&
      'complete' in value,
  );
}

function selfDRReadinessScore(report?: DRSelfDRAssessmentReport | null, bundle?: DRSelfDRStoredArtifact | null) {
  const assessment = report?.assessment;
  if (!assessment) return bundle ? 25 : 0;

  let score = 25;
  const verdict = normalizeStatus(assessment.verdict);
  if (verdict === 'ready') score += 35;
  else if (verdict === 'degraded') score += 20;
  if (assessment.critical === 0) score += 15;
  if (assessment.restore_plan.waves.length > 0) score += 10;
  if ((report?.artifacts.length ?? 0) > 0) score += 10;
  if (offlineBundleReady(bundle)) score += 5;
  return Math.max(0, Math.min(100, score));
}

function selfDRTone(verdict?: string | null, findings: DRSelfDRFinding[] = []): Tone {
  const normalized = normalizeStatus(verdict);
  if (normalized === 'not_ready' || findings.some((finding) => normalizeStatus(finding.severity) === 'critical')) return 'critical';
  if (normalized === 'degraded' || findings.some((finding) => normalizeStatus(finding.severity) === 'warning')) return 'warning';
  if (normalized === 'ready') return 'success';
  return 'neutral';
}

function sortByTime<T>(items: T[], key: keyof T) {
  return [...items].sort((left, right) => timestampMs(right[key]) - timestampMs(left[key]));
}

function percent(part?: number | null, total?: number | null) {
  if (!part || !total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

function formatBytes(bytes?: number | null) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
}

function shortID(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(value?: string | null) {
  const normalized = normalizeStatus(value);
  if (normalized === 'iac') return 'IaC';
  if (normalized === 'k8s_workload') return 'K8s workload';
  if (normalized === 'vm_disk') return 'VM disk';
  if (normalized === 'nfs') return 'NFS';
  return normalized.replace(/_/g, ' ');
}

function toneClass(tone: Tone, part: 'soft' | 'text') {
  const styles = {
    success: { soft: 'bg-primary/10', text: 'text-primary' },
    warning: { soft: 'bg-amber-50 dark:bg-amber-950/25', text: 'text-warning-700 dark:text-warning-300' },
    critical: { soft: 'bg-error-50 dark:bg-error-700/25', text: 'text-error-700 dark:text-error-300' },
    info: { soft: 'bg-sky-50 dark:bg-sky-950/25', text: 'text-sky-700 dark:text-sky-300' },
    neutral: { soft: 'bg-muted', text: 'text-muted-foreground' },
  } as const;
  return styles[tone][part];
}

function timestampMs(value: unknown) {
  if (!value) return 0;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatError(error: unknown, L: CoverageActionsLabels) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return L.refreshError;
}
