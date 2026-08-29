'use client';

import {
  Archive,
  Boxes,
  CheckCircle2,
  DatabaseBackup,
  FileArchive,
  GitCompareArrows,
  HardDrive,
  Layers3,
  ListChecks,
  PackageCheck,
  ServerCog,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
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
import type {
  DRIaCSnapshot,
  DRIaCSnapshotList,
  DRSelfDRComponent,
  DRSelfDRAssessmentReport,
  DRSelfDRComponentsResponse,
  DRSelfDRFinding,
  DRSelfDROfflineRestoreBundle,
  DRSelfDRStoredArtifact,
  DRStorageSnapshot,
  DRStorageVolume,
  DRWorkloadCaptureEpoch,
  DRWorkloadCaptureSource,
} from '@/types/clario-dr';
import {
  type CoverageSelfDrLabels,
  useCoverageSelfDrLabels,
} from './dr-coverage-selfdr-labels';

type DRCoverageSelfDRPanelProps = {
  iacSnapshots: DRIaCSnapshotList | null;
  storageVolumes: DRStorageVolume[];
  workloadCaptures: DRWorkloadCaptureSource[];
  workloadEpochs: DRWorkloadCaptureEpoch[];
  selfDRComponents: DRSelfDRComponentsResponse | null;
  selfDRLatest: DRSelfDRAssessmentReport | null;
  selfDRArtifacts: DRSelfDRStoredArtifact[];
  loading: boolean;
  error: unknown;
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

type IacDiffEstimate = {
  ready: boolean;
  inline: boolean;
  added: number | null;
  removed: number | null;
  modified: number | null;
};

export function DRCoverageSelfDRPanel({
  iacSnapshots,
  storageVolumes,
  workloadCaptures,
  workloadEpochs,
  selfDRComponents,
  selfDRLatest,
  selfDRArtifacts,
  loading,
  error,
  onRetry,
}: DRCoverageSelfDRPanelProps) {
  const L = useCoverageSelfDrLabels();
  const snapshots = sortByTime(iacSnapshots?.snapshots ?? [], 'created_at');
  const latestSnapshot = snapshots[0] ?? null;
  const previousSnapshot = snapshots[1] ?? null;
  const iacDiff = estimateIacDiff(previousSnapshot, latestSnapshot);

  const enabledCaptures = workloadCaptures.filter((source) => source.enabled);
  const vmCaptureCount = workloadCaptures.filter((source) => normalizeStatus(source.source_kind) === 'vm_disk').length;
  const k8sCaptureCount = workloadCaptures.filter((source) => normalizeStatus(source.source_kind) === 'k8s_workload').length;
  const latestEpoch = sortByTime(workloadEpochs, 'captured_at')[0] ?? null;
  const epochPayloadBytes = workloadEpochs.reduce((sum, epoch) => sum + finiteNumber(epoch.payload_bytes), 0);

  const knownStorageSnapshots = storageVolumes.flatMap((volume) => volumeKnownSnapshots(volume));
  const knownSnapshotCount = storageVolumes.reduce((sum, volume) => sum + snapshotCount(volume), 0);
  const replicatedSnapshotCount = storageVolumes.reduce((sum, volume) => sum + replicatedSnapshots(volume), 0);
  const failedSnapshotCount = storageVolumes.reduce((sum, volume) => sum + failedSnapshots(volume), 0);
  const latestStorageSnapshot = sortByTime(knownStorageSnapshots, 'created_at')[0] ?? null;

  const artifacts = mergeArtifacts(selfDRArtifacts, selfDRLatest?.artifacts ?? []);
  const latestAssessment = selfDRLatest?.assessment ?? null;
  const findings = latestAssessment?.findings ?? [];
  const assessedComponents = componentsFromAssessment(selfDRLatest);
  const requiredKinds = selfDRComponents?.required_components ?? [];
  const backupReadyCount = assessedComponents.filter((component) => component.backup.available).length;
  const restoreReadyCount = assessedComponents.filter((component) => component.restore.passed).length;
  const offlineBundle = latestOfflineBundle(artifacts);
  const selfDRScore = selfDRReadinessScore({
    requiredCount: requiredKinds.length,
    assessedCount: assessedComponents.length,
    sealingEnabled: selfDRComponents?.sealing_enabled ?? false,
    verdict: latestAssessment?.verdict,
    findings,
    offlineBundle,
  });

  const hasCoverageData = Boolean(
    snapshots.length ||
    storageVolumes.length ||
    workloadCaptures.length ||
    workloadEpochs.length ||
    selfDRComponents ||
    selfDRLatest ||
    artifacts.length,
  );

  if (loading && !hasCoverageData) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && !hasCoverageData) {
    return <ErrorState message={L.loadError} onRetry={onRetry} />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CoverageMetric
          title={L.metricIacSnapshots}
          value={snapshots.length}
          detail={latestSnapshot ? L.resourcesVersion(latestSnapshot.resource_count, latestSnapshot.version) : L.noInfraSnapshots}
          icon={GitCompareArrows}
          tone={iacDiff?.ready ? 'success' : snapshots.length > 0 ? 'warning' : 'neutral'}
        />
        <CoverageMetric
          title={L.metricVmK8s}
          value={`${enabledCaptures.length}/${workloadCaptures.length}`}
          detail={L.epochsCaptured(workloadEpochs.length, formatBytes(epochPayloadBytes))}
          icon={ServerCog}
          tone={enabledCaptures.length > 0 && workloadEpochs.length > 0 ? 'success' : workloadCaptures.length > 0 ? 'warning' : 'neutral'}
        />
        <CoverageMetric
          title={L.metricStorageOffload}
          value={storageVolumes.length}
          detail={knownSnapshotCount > 0 ? L.snapshotsReplicated(replicatedSnapshotCount, knownSnapshotCount) : L.volumePolicies}
          icon={HardDrive}
          tone={failedSnapshotCount > 0 ? 'critical' : storageVolumes.length > 0 ? 'success' : 'neutral'}
        />
        <CoverageMetric
          title={L.metricSelfDr}
          value={latestAssessment?.verdict ? labelFor(latestAssessment.verdict) : L.unscored}
          detail={L.findingsArtifacts(findings.length, artifacts.length)}
          icon={ShieldCheck}
          tone={selfDRTone(latestAssessment?.verdict, findings)}
        />
      </div>

      {error ? (
        <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <div className="text-warning-700 dark:text-warning-300">{L.partialBanner}</div>
            <Badge variant="warning">{L.partialBadge}</Badge>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.iacTitle}</CardTitle>
              <CardDescription>{L.iacDescription()}</CardDescription>
            </div>
            <StatusBadge status={iacDiff?.ready ? 'ready' : snapshots.length > 0 ? 'baseline_needed' : 'empty'} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={L.miniSnapshots} value={iacSnapshots?.count ?? snapshots.length} />
              <MiniDatum label={L.miniLatest} value={formatDateTime(latestSnapshot?.created_at)} />
              <MiniDatum label={L.miniResources} value={latestSnapshot?.resource_count ?? 0} />
              <MiniDatum label={L.miniSource} value={latestSnapshot ? labelFor(latestSnapshot.source_kind) : L.na} />
            </div>

            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{L.diffBaseline}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {latestSnapshot && previousSnapshot
                      ? L.diffAgainst(latestSnapshot.name, previousSnapshot.name)
                      : latestSnapshot
                        ? L.captureOneMore
                        : L.noIacSnapshot}
                  </div>
                </div>
                <StatusBadge
                  status={iacDiff?.ready ? (iacDiff.inline ? 'ready' : 'available') : 'warning'}
                  label={iacDiff?.ready ? (iacDiff.inline ? L.inlineDiff : L.apiDiffReady) : L.notReady}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <MiniDatum label={L.miniAdded} value={formatNullableCount(iacDiff?.added, L)} />
                <MiniDatum label={L.miniRemoved} value={formatNullableCount(iacDiff?.removed, L)} />
                <MiniDatum label={L.miniModified} value={formatNullableCount(iacDiff?.modified, L)} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{L.colSnapshot}</TableHead>
                    <TableHead>{L.colKind}</TableHead>
                    <TableHead>{L.colResources}</TableHead>
                    <TableHead>{L.colHash}</TableHead>
                    <TableHead>{L.colCaptured}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        {L.noIacSnapshots}
                      </TableCell>
                    </TableRow>
                  ) : (
                    snapshots.slice(0, 6).map((snapshot) => (
                      <TableRow key={snapshot.id}>
                        <TableCell>
                          <div className="font-medium">{snapshot.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{snapshot.id}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="normal-case">{labelFor(snapshot.source_kind)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div>{snapshot.resource_count}</div>
                          <div className="text-xs text-muted-foreground">{providerSummary(snapshot, L)}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{shortHash(snapshot.content_hash)}</TableCell>
                        <TableCell>{formatDateTime(snapshot.created_at)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.vmK8sTitle}</CardTitle>
              <CardDescription>{L.vmK8sDescription}</CardDescription>
            </div>
            <Badge variant="outline">{L.vmK8sBadge(vmCaptureCount, k8sCaptureCount)}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={L.miniSources} value={workloadCaptures.length} />
              <MiniDatum label={L.miniEnabled} value={enabledCaptures.length} />
              <MiniDatum label={L.miniEpochs} value={workloadEpochs.length} />
              <MiniDatum label={L.miniLatest2} value={formatDateTime(latestEpoch?.captured_at)} />
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{L.colSource}</TableHead>
                    <TableHead>{L.colBinding}</TableHead>
                    <TableHead>{L.colLastEpoch}</TableHead>
                    <TableHead>{L.colSeq}</TableHead>
                    <TableHead>{L.colStatus}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workloadCaptures.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        {L.noCaptureSources}
                      </TableCell>
                    </TableRow>
                  ) : (
                    workloadCaptures.slice(0, 7).map((source) => {
                      const sourceEpoch = latestEpochForSource(source.id, workloadEpochs);
                      return (
                        <TableRow key={source.id}>
                          <TableCell>
                            <div className="font-medium">{source.name}</div>
                            <div className="font-mono text-xs text-muted-foreground">{source.stream_id}</div>
                          </TableCell>
                          <TableCell>
                            <div>{labelFor(source.source_kind)}</div>
                            <div className="text-xs text-muted-foreground">{labelFor(source.binding_kind)} / {formatBytes(source.block_size_bytes)}</div>
                          </TableCell>
                          <TableCell>
                            <div>{sourceEpoch ? `#${sourceEpoch.epoch}` : L.none}</div>
                            <div className="text-xs text-muted-foreground">{formatDateTime(sourceEpoch?.captured_at ?? source.last_run_at)}</div>
                          </TableCell>
                          <TableCell>
                            <div>{sourceEpoch ? `${sourceEpoch.from_seq}-${sourceEpoch.to_seq}` : source.last_seq}</div>
                            <div className="text-xs text-muted-foreground">{L.totalEpochs(source.epoch_count)}</div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={source.enabled ? 'enabled' : 'paused'} />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2">
              {sortByTime(workloadEpochs, 'captured_at').slice(0, 4).map((epoch) => (
                <div key={epoch.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{sourceName(epoch.source_id, workloadCaptures)}</div>
                    <div className="text-xs text-muted-foreground">
                      {L.epochMeta(labelFor(epoch.epoch_kind), epoch.frame_count, formatBytes(epoch.payload_bytes))}
                    </div>
                  </div>
                  <div className="text-end text-xs text-muted-foreground">
                    <div className="font-mono text-foreground">{shortHash(epoch.content_hash)}</div>
                    <div>{L.changedUnits(epoch.changed_units, epoch.total_units)}</div>
                  </div>
                </div>
              ))}
              {workloadEpochs.length === 0 ? <EmptyLine icon={Boxes} text={L.noCaptureEpochs} /> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.storageTitle}</CardTitle>
              <CardDescription>{L.storageDescription}</CardDescription>
            </div>
            <StatusBadge
              status={failedSnapshotCount > 0 ? 'failed' : storageVolumes.length > 0 ? 'ready' : 'empty'}
              label={knownSnapshotCount > 0 ? L.snapshotsBadge(knownSnapshotCount) : L.volumesBadge(storageVolumes.length)}
            />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={L.miniVolumes} value={storageVolumes.length} />
              <MiniDatum label={L.miniSnapshots2} value={knownSnapshotCount > 0 ? knownSnapshotCount : L.na} />
              <MiniDatum label={L.miniReplicated} value={knownSnapshotCount > 0 ? replicatedSnapshotCount : L.na} />
              <MiniDatum label={L.miniLatest3} value={formatDateTime(latestStorageSnapshot?.created_at)} />
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{L.colVolume}</TableHead>
                    <TableHead>{L.colProvider}</TableHead>
                    <TableHead>{L.colRetention}</TableHead>
                    <TableHead>{L.colLatestSnapshot}</TableHead>
                    <TableHead>{L.colOffload}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {storageVolumes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        {L.noStorageVolumes}
                      </TableCell>
                    </TableRow>
                  ) : (
                    storageVolumes.slice(0, 7).map((volume) => {
                      const snapshot = latestSnapshotForVolume(volume);
                      return (
                        <TableRow key={volume.id}>
                          <TableCell>
                            <div className="font-medium">{volume.name}</div>
                            <div className="font-mono text-xs text-muted-foreground">{volume.source_location}</div>
                          </TableCell>
                          <TableCell>
                            <div>{labelFor(volume.provider)}</div>
                            <div className="text-xs text-muted-foreground">{volume.site_id ?? L.noSite} / {volume.array_endpoint}</div>
                          </TableCell>
                          <TableCell>
                            <div>{L.retentionSnapshots(volume.retention_max_snapshots)}</div>
                            <div className="text-xs text-muted-foreground">{L.maxAge(formatDuration(volume.retention_max_age_seconds))}</div>
                          </TableCell>
                          <TableCell>
                            <div>{snapshot ? labelFor(snapshot.kind) : L.notAttached}</div>
                            <div className="text-xs text-muted-foreground">
                              {snapshot ? L.changedBytes(formatBytes(snapshot.changed_bytes)) : L.snapshotFeedUnavailable}
                            </div>
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              status={snapshot?.state ?? (volumeSnapshots(volume).length > 0 ? 'pending' : 'volume_registered')}
                              label={snapshot ? undefined : L.registered}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ReadinessLine
                icon={Archive}
                label={L.rlVolumePolicies}
                ready={storageVolumes.length > 0}
                detail={storageVolumes.length > 0 ? L.offloadSources(storageVolumes.length) : L.noStorageVolumeSources}
              />
              <ReadinessLine
                icon={DatabaseBackup}
                label={L.rlSnapshotFeed}
                ready={knownSnapshotCount > 0}
                detail={knownSnapshotCount > 0 ? L.snapshotsVisible(knownSnapshotCount) : L.snapshotListNotPassed}
              />
              <ReadinessLine
                icon={PackageCheck}
                label={L.rlRemoteReplica}
                ready={knownSnapshotCount > 0 && replicatedSnapshotCount > 0 && failedSnapshotCount === 0}
                detail={knownSnapshotCount > 0 ? L.replicatedFailed(replicatedSnapshotCount, failedSnapshotCount) : L.replicationStateUnavailable}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.selfDrTitle}</CardTitle>
              <CardDescription>{L.selfDrReadinessDesc()}</CardDescription>
            </div>
            <StatusBadge status={latestAssessment?.verdict ?? 'unscored'} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={L.miniScore} value={`${selfDRScore}%`} />
              <MiniDatum label={L.miniRequired} value={requiredKinds.length} />
              <MiniDatum label={L.miniBackups} value={`${backupReadyCount}/${assessedComponents.length}`} />
              <MiniDatum label={L.miniRestores} value={`${restoreReadyCount}/${assessedComponents.length}`} />
            </div>
            <Progress
              value={selfDRScore}
              className="h-2"
              indicatorClassName={selfDRScore < 60 ? 'bg-error-500' : selfDRScore < 85 ? 'bg-amber-500' : 'bg-primary'}
            />

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ReadinessLine
                icon={ListChecks}
                label={L.rlComponentManifest}
                ready={requiredKinds.length > 0}
                detail={requiredKinds.length > 0 ? L.requiredComponents(requiredKinds.length) : L.requiredListMissing}
              />
              <ReadinessLine
                icon={ShieldCheck}
                label={L.rlSealedArtifacts}
                ready={selfDRComponents?.sealing_enabled === true}
                detail={selfDRComponents?.sealing_enabled ? L.sealingEnabled : L.sealingNotReported}
              />
              <ReadinessLine
                icon={CheckCircle2}
                label={L.rlLatestAssessment}
                ready={normalizeStatus(latestAssessment?.verdict) === 'ready'}
                detail={latestAssessment ? L.verdictOn(labelFor(latestAssessment.verdict), formatDateTime(latestAssessment.created_at)) : L.noAssessment}
              />
              <ReadinessLine
                icon={FileArchive}
                label={L.rlOfflineBundle}
                ready={offlineBundleReady(offlineBundle)}
                detail={offlineBundle ? L.bundleSizeDate(formatBytes(offlineBundle.size_bytes), formatDateTime(offlineBundle.captured_at)) : L.noOfflineBundle}
              />
            </div>

            <div className="space-y-2">
              {findings.slice(0, 4).map((finding) => (
                <div key={`${finding.code}-${finding.component_id ?? finding.component_kind ?? 'global'}`} className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{finding.code}</div>
                      <div className="text-xs text-muted-foreground">{finding.component_kind ? labelFor(finding.component_kind) : L.profileFallback()}</div>
                    </div>
                    <StatusBadge status={finding.severity} />
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{finding.message}</div>
                </div>
              ))}
              {findings.length === 0 ? (
                <EmptyLine icon={CheckCircle2} text={latestAssessment ? L.noSelfDrFindings : L.noSelfDrAssessment} />
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.restorePlanTitle}</CardTitle>
              <CardDescription>{L.restorePlanDesc()}</CardDescription>
            </div>
            <Badge variant="outline">{L.wavesBadge(latestAssessment?.restore_plan?.waves?.length ?? 0)}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {(latestAssessment?.restore_plan?.waves ?? []).length === 0 ? (
              <EmptyLine icon={Layers3} text={L.noRestorePlan} />
            ) : (
              latestAssessment?.restore_plan?.waves.slice(0, 5).map((wave) => (
                <div key={wave.sequence} className="rounded-lg border px-3 py-2">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">{L.waveLabel(wave.sequence)}</div>
                    <Badge variant="outline">{L.componentsBadge(wave.components.length)}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    {wave.components.slice(0, 4).map((component) => (
                      <div key={component.id} className="flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <div className="truncate">{component.name}</div>
                          <div className="text-xs text-muted-foreground">{labelFor(component.kind)}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <StatusBadge status={component.backup.available ? 'backup_ready' : 'backup_missing'} label={component.backup.available ? L.backupLabel() : L.missingLabel} />
                          <StatusBadge status={component.restore.passed ? 'restore_passed' : 'untested'} label={component.restore.passed ? L.testedLabel : L.untestedLabel} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{L.artifactsTitle}</CardTitle>
              <CardDescription>{L.artifactsDescription}</CardDescription>
            </div>
            <Badge variant="outline">{L.artifactsBadge(artifacts.length)}</Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{L.colArtifact}</TableHead>
                    <TableHead>{L.colComponent}</TableHead>
                    <TableHead>{L.colSize}</TableHead>
                    <TableHead>{L.colEvidence}</TableHead>
                    <TableHead>{L.colCaptured2}</TableHead>
                    <TableHead>{L.colHash2}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {artifacts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">
                        {L.noSelfDrArtifacts}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortByTime(artifacts, 'captured_at').slice(0, 8).map((artifact) => (
                      <TableRow key={artifact.id}>
                        <TableCell>
                          <div className="font-medium">{labelFor(artifact.kind)}</div>
                          <div className="font-mono text-xs text-muted-foreground">{artifact.key ?? artifact.uri ?? artifact.id}</div>
                        </TableCell>
                        <TableCell>
                          <div>{artifact.component_kind ? labelFor(artifact.component_kind) : L.profileFallback()}</div>
                          <div className="text-xs text-muted-foreground">{artifact.location_id ?? L.noLocation}</div>
                        </TableCell>
                        <TableCell>{formatBytes(artifact.size_bytes)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1.5">
                            <StatusBadge status={artifact.immutable ? 'immutable' : 'mutable'} />
                            <StatusBadge status={artifact.encrypted ? 'encrypted' : 'unencrypted'} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>{formatDateTime(artifact.captured_at)}</div>
                          <div className="text-xs text-muted-foreground">{L.retainPrefix(formatDate(artifact.retain_until))}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{shortHash(artifact.sha256)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Bridge the panel's dynamic state tone onto the materialized `.kpi-theme-*`
// semantic palette: RAG is preserved (success→emerald, warning→gold/amber,
// critical→rose/red) and `info`→sky (count/quantity), `neutral`→flat.
const COVERAGE_TONE_THEME: Record<Tone, string> = {
  success: 'kpi-theme-emerald',
  warning: 'kpi-theme-amber',
  critical: 'kpi-theme-red',
  info: 'kpi-theme-sky',
  neutral: '',
};

function CoverageMetric({
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
  if (tone === 'neutral') {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-overline font-semibold uppercase text-muted-foreground">{title}</div>
              <div className="mt-3 truncate text-3xl font-semibold tracking-tight">{value}</div>
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
  return (
    <div className={cn('kpi-card-themed', COVERAGE_TONE_THEME[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-overline font-semibold uppercase text-[color:var(--kpi-accent)]">
            {title}
          </div>
          <div className="mt-3 truncate text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        </div>
        <div className="kpi-icon-badge shrink-0">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      </div>
      <div className="mt-3 min-h-5 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function MiniDatum({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <div className="text-overline font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function ReadinessLine({
  icon: Icon,
  label,
  ready,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  ready: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2">
      <div className={cn('mt-0.5 rounded-lg p-1.5', ready ? 'bg-primary/10 text-primary' : 'bg-amber-50 text-warning-700 dark:bg-amber-950/25 dark:text-warning-300')}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{label}</div>
          <StatusBadge status={ready ? 'ready' : 'pending'} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const normalized = normalizeStatus(status);
  const variant =
    ['critical', 'failed', 'error', 'not_ready', 'expired', 'unencrypted', 'mutable'].includes(normalized)
      ? 'destructive'
      : ['warning', 'degraded', 'pending', 'paused', 'creating', 'replicating', 'baseline_needed', 'backup_missing', 'untested', 'unscored'].includes(normalized)
        ? 'warning'
        : ['ready', 'healthy', 'completed', 'passed', 'active', 'enabled', 'available', 'replicated', 'backup_ready', 'restore_passed', 'immutable', 'encrypted'].includes(normalized)
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label ?? labelFor(normalized)}</span>
    </Badge>
  );
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
      <Icon className="h-4 w-4" />
      <span>{text}</span>
    </div>
  );
}

function estimateIacDiff(base?: DRIaCSnapshot | null, target?: DRIaCSnapshot | null): IacDiffEstimate | null {
  if (!base || !target) return null;
  const baseResources = base.resources ?? [];
  const targetResources = target.resources ?? [];
  if (baseResources.length === 0 || targetResources.length === 0) {
    return {
      ready: true,
      inline: false,
      added: null,
      removed: null,
      modified: null,
    };
  }

  const baseMap = new Map(baseResources.map((resource) => [resource.address || `${resource.provider}/${resource.type}/${resource.name}`, resource]));
  const targetMap = new Map(targetResources.map((resource) => [resource.address || `${resource.provider}/${resource.type}/${resource.name}`, resource]));

  let added = 0;
  let removed = 0;
  let modified = 0;

  for (const [key, resource] of targetMap.entries()) {
    const previous = baseMap.get(key);
    if (!previous) {
      added += 1;
    } else if (previous.hash !== resource.hash) {
      modified += 1;
    }
  }

  for (const key of baseMap.keys()) {
    if (!targetMap.has(key)) removed += 1;
  }

  return {
    ready: true,
    inline: true,
    added,
    removed,
    modified,
  };
}

function providerSummary(snapshot: DRIaCSnapshot, L: CoverageSelfDrLabels) {
  const resources = snapshot.resources ?? [];
  if (resources.length === 0) return L.resourcesNotExpanded;
  const counts = new Map<string, number>();
  for (const resource of resources) {
    counts.set(resource.provider, (counts.get(resource.provider) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([provider, count]) => `${provider} ${count}`)
    .join(', ');
}

function latestEpochForSource(sourceID: string, epochs: DRWorkloadCaptureEpoch[]) {
  return sortByTime(
    epochs.filter((epoch) => epoch.source_id === sourceID),
    'captured_at',
  )[0] ?? null;
}

function sourceName(sourceID: string, sources: DRWorkloadCaptureSource[]) {
  return sources.find((source) => source.id === sourceID)?.name ?? sourceID;
}

function latestSnapshotForVolume(volume: DRStorageVolume) {
  const hints = volume as DRStorageVolume & StorageVolumeSnapshotHints;
  if (hints.latest_snapshot) return hints.latest_snapshot;
  return sortByTime(hints.snapshots ?? [], 'created_at')[0] ?? null;
}

function volumeSnapshots(volume: DRStorageVolume) {
  return (volume as DRStorageVolume & StorageVolumeSnapshotHints).snapshots ?? [];
}

function volumeKnownSnapshots(volume: DRStorageVolume) {
  const hints = volume as DRStorageVolume & StorageVolumeSnapshotHints;
  const snapshots = hints.snapshots ?? [];
  if (!hints.latest_snapshot || snapshots.some((snapshot) => snapshot.id === hints.latest_snapshot?.id)) return snapshots;
  return [hints.latest_snapshot, ...snapshots];
}

function snapshotCount(volume: DRStorageVolume) {
  const hints = volume as DRStorageVolume & StorageVolumeSnapshotHints;
  return hints.snapshot_count ?? volumeKnownSnapshots(volume).length;
}

function replicatedSnapshots(volume: DRStorageVolume) {
  const hints = volume as DRStorageVolume & StorageVolumeSnapshotHints;
  if (typeof hints.replicated_snapshot_count === 'number') return hints.replicated_snapshot_count;
  return volumeKnownSnapshots(volume).filter((snapshot) => normalizeStatus(snapshot.state) === 'replicated' || Boolean(snapshot.replicated_at)).length;
}

function failedSnapshots(volume: DRStorageVolume) {
  const hints = volume as DRStorageVolume & StorageVolumeSnapshotHints;
  if (typeof hints.failed_snapshot_count === 'number') return hints.failed_snapshot_count;
  return volumeKnownSnapshots(volume).filter((snapshot) => normalizeStatus(snapshot.state) === 'failed').length;
}

function componentsFromAssessment(report?: DRSelfDRAssessmentReport | null) {
  const components = new Map<string, DRSelfDRComponent>();
  for (const wave of report?.assessment.restore_plan?.waves ?? []) {
    for (const component of wave.components) {
      components.set(component.id, component);
    }
  }
  return [...components.values()];
}

function mergeArtifacts(primary: DRSelfDRStoredArtifact[], secondary: DRSelfDRStoredArtifact[]) {
  const artifacts = new Map<string, DRSelfDRStoredArtifact>();
  for (const artifact of [...primary, ...secondary]) {
    artifacts.set(artifact.id, artifact);
  }
  return [...artifacts.values()];
}

function latestOfflineBundle(artifacts: DRSelfDRStoredArtifact[]) {
  return sortByTime(
    artifacts.filter((artifact) => normalizeStatus(artifact.kind) === 'offline_restore_bundle'),
    'captured_at',
  )[0] ?? null;
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

function selfDRReadinessScore({
  requiredCount,
  assessedCount,
  sealingEnabled,
  verdict,
  findings,
  offlineBundle,
}: {
  requiredCount: number;
  assessedCount: number;
  sealingEnabled: boolean;
  verdict?: string | null;
  findings: DRSelfDRFinding[];
  offlineBundle?: DRSelfDRStoredArtifact | null;
}) {
  let score = 0;
  if (requiredCount > 0) score += 15;
  if (assessedCount > 0) score += 15;
  if (sealingEnabled) score += 15;
  if (normalizeStatus(verdict) === 'ready') score += 30;
  else if (normalizeStatus(verdict) === 'degraded') score += 15;
  if (!findings.some((finding) => normalizeStatus(finding.severity) === 'critical')) score += 10;
  if (offlineBundleReady(offlineBundle)) score += 15;
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

function finiteNumber(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatNullableCount(value: number | null | undefined, L: CoverageSelfDrLabels) {
  return typeof value === 'number' ? value : L.na;
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(value?: string | null) {
  const normalized = normalizeStatus(value);
  if (normalized === 'iac') return 'IaC';
  if (normalized === 'k8s_workload') return 'K8s workload';
  if (normalized === 'vm_disk') return 'VM disk';
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

function formatDuration(seconds?: number | null) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const mins = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const minRem = mins % 60;
  return minRem > 0 ? `${hours}h ${minRem}m` : `${hours}h`;
}

function formatBytes(bytes?: number | null) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
}

function formatDate(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function timestampMs(value: unknown) {
  if (!value) return 0;
  const date = new Date(value as string | Date);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
