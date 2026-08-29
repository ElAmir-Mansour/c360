'use client';

import {
  AlertTriangle,
  ArchiveRestore,
  BadgeCheck,
  BookmarkCheck,
  BookmarkPlus,
  DatabaseZap,
  FileClock,
  HardDriveDownload,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
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
  DRInstantRecoveryProgress,
  DRInstantRecoverySession,
  DRJournalBookmark,
  DRJournalTimeline,
  DRRecoveryPoint,
} from '@/types/clario-dr';
import { useRecoveryActionLabels, type RecoveryActionLabels } from '../_lib/dr-action-labels';

export type DRRecoveryActionsPanelProps = {
  selectedGroupId?: string | null;
  selectedGroupName?: string | null;
  activeStreamId?: string | null;
  recoveryPoints: DRRecoveryPoint[];
  journalTimeline: DRJournalTimeline | null;
  journalBookmarks: DRJournalBookmark[];
  selectedRecoveryPoint?: DRRecoveryPoint | null;
  latestValidation?: DRRecoveryPoint | null;
  latestSealedPoint?: DRRecoveryPoint | null;
  latestMaterializedPoint?: DRRecoveryPoint | null;
  latestInstantSession?: DRInstantRecoverySession | null;
  latestInstantProgress?: DRInstantRecoveryProgress | null;
  loading: boolean;
  validatingPoint: boolean;
  sealingPoint: boolean;
  creatingBookmark: boolean;
  deletingBookmark: boolean;
  materializingPoint: boolean;
  startingInstant: boolean;
  finalizingInstant: boolean;
  error: unknown;
  onValidatePoint: (pointID: string) => void;
  onSealPoint: (pointID: string) => void;
  onCreateBookmark: () => void;
  onDeleteBookmark: (bookmarkID: string) => void;
  onMaterializePoint: () => void;
  onStartInstantRecovery: (pointID: string) => void;
  onFinalizeInstantRecovery: (sessionID: string) => void;
  onRetry: () => void;
};

export function DRRecoveryActionsPanel({
  selectedGroupId,
  selectedGroupName,
  activeStreamId,
  recoveryPoints,
  journalTimeline,
  journalBookmarks,
  selectedRecoveryPoint,
  latestValidation,
  latestSealedPoint,
  latestMaterializedPoint,
  latestInstantSession,
  latestInstantProgress,
  loading,
  validatingPoint,
  sealingPoint,
  creatingBookmark,
  deletingBookmark,
  materializingPoint,
  startingInstant,
  finalizingInstant,
  error,
  onValidatePoint,
  onSealPoint,
  onCreateBookmark,
  onDeleteBookmark,
  onMaterializePoint,
  onStartInstantRecovery,
  onFinalizeInstantRecovery,
  onRetry,
}: DRRecoveryActionsPanelProps) {
  const t = useRecoveryActionLabels();
  const sortedPoints = sortRecoveryPoints(recoveryPoints);
  const latestPoint = sortedPoints[0] ?? null;
  const selectedPoint = selectedRecoveryPoint ?? latestPoint;
  const validatedPoint = latestValidation ?? sortedPoints.find((point) => point.is_validated) ?? null;
  const sealedPoint = latestSealedPoint ?? latestPoint;
  const bookmarks = mergeBookmarks(journalBookmarks, journalTimeline?.bookmarks ?? []);
  const instantSession = latestInstantProgress?.session ?? latestInstantSession ?? null;
  const instantProgress = instantPercent(latestInstantProgress, instantSession);
  const timelineCoverageSeconds = journalTimeline
    ? Math.max(0, timestampMs(journalTimeline.latest_ts) - timestampMs(journalTimeline.earliest_ts)) / 1000
    : 0;
  const journalFrames = (journalTimeline?.segments ?? []).reduce((sum, segment) => sum + segment.frame_count, 0);
  const hasData = Boolean(
    selectedGroupId ||
      activeStreamId ||
      recoveryPoints.length > 0 ||
      journalTimeline ||
      bookmarks.length > 0 ||
      latestValidation ||
      latestSealedPoint ||
      latestMaterializedPoint ||
      instantSession,
  );

  if (loading && !hasData) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && !hasData) {
    return <ErrorState message={t.loadError} onRetry={onRetry} />;
  }

  const groupLabel = selectedGroupName ?? selectedGroupId ?? t.noGroupSelected;
  const pointActionID = latestPoint?.id ?? null;
  const instantPointID = selectedPoint?.id ?? null;
  const instantState = normalizeStatus(instantSession?.state);
  const instantActive = Boolean(instantSession && !isInstantTerminal(instantSession.state));
  const canFinalizeInstant = Boolean(instantSession?.id && instantState === 'ready');
  const validateDisabled = loading || validatingPoint || !selectedGroupId || !pointActionID;
  const sealDisabled = loading || sealingPoint || !selectedGroupId || !pointActionID;
  const bookmarkDisabled = loading || creatingBookmark || !activeStreamId || !journalTimeline || !journalTimeline.recoverable;
  const materializeDisabled =
    loading || materializingPoint || !selectedGroupId || !activeStreamId || !journalTimeline || !journalTimeline.recoverable;
  const startInstantDisabled =
    loading ||
    startingInstant ||
    !selectedGroupId ||
    !instantPointID ||
    !selectedPoint?.is_validated ||
    instantActive;
  const finalizeInstantDisabled = loading || finalizingInstant || !instantSession?.id || !canFinalizeInstant;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{formatError(error, t)}</span>
          </div>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={onRetry}>
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
            {t.retry}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <RecoveryMetric
          title={t.metricGroup}
          value={groupLabel}
          detail={selectedGroupId ? shortID(selectedGroupId) : t.selectConsistencyGroup}
          icon={ShieldCheck}
          tone={selectedGroupId ? 'info' : 'neutral'}
        />
        <RecoveryMetric
          title={t.metricSelectedPoint}
          value={selectedPoint ? shortID(selectedPoint.id) : t.na}
          detail={selectedPoint ? `${formatDuration(selectedPoint.rpo_seconds)} ${t.rpoSuffix} / ${shortHash(selectedPoint.content_hash)}` : t.noRecoveryPointSelected}
          icon={ArchiveRestore}
          tone={selectedPoint ? (selectedPoint.is_validated ? 'success' : 'warning') : 'neutral'}
        />
        <RecoveryMetric
          title={t.metricValidation}
          value={validatedPoint ? formatRatio(validatedPoint.validation_ratio) : t.pending}
          detail={validatedPoint ? `${shortID(validatedPoint.id)} ${t.validatedSuffix}` : t.noValidatedPoint}
          icon={BadgeCheck}
          tone={validatedPoint ? 'success' : sortedPoints.length > 0 ? 'warning' : 'neutral'}
        />
        <RecoveryMetric
          title={t.metricApitCoverage}
          value={journalTimeline?.recoverable ? formatDuration(timelineCoverageSeconds) : t.na}
          detail={journalTimeline ? t.framesBookmarksDetail(journalFrames, bookmarks.length) : activeStreamId ? t.timelineNotLoaded : t.noStreamSelected}
          icon={FileClock}
          tone={journalTimeline?.recoverable ? (journalTimeline.has_gaps ? 'warning' : 'success') : activeStreamId ? 'warning' : 'neutral'}
        />
        <RecoveryMetric
          title={t.metricInstantRecovery}
          value={instantSession ? labelFor(instantState, t) : t.idle}
          detail={instantSession ? t.hydratedDetail(instantProgress, shortID(instantSession.id)) : t.noActiveCowSession}
          icon={PlayCircle}
          tone={statusTone(instantSession?.state)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.actionsTitle}</CardTitle>
              <CardDescription>{t.actionsDescription}</CardDescription>
            </div>
            {loading ? <StatusBadge status="pending" label={t.refreshing} t={t} /> : <StatusBadge status={selectedGroupId ? 'ready' : 'pending'} t={t} />}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ActionButton
                label={t.validateLatestPoint}
                loadingVerb={t.verbValidating}
                description={validateDisabled ? pointActionDisabledReason(selectedGroupId, latestPoint, t) : t.runValidationOn(shortID(pointActionID))}
                icon={BadgeCheck}
                loading={validatingPoint}
                disabled={validateDisabled}
                onClick={() => pointActionID && onValidatePoint(pointActionID)}
              />
              <ActionButton
                label={t.sealLatestPoint}
                loadingVerb={t.verbSealing}
                description={sealDisabled ? pointActionDisabledReason(selectedGroupId, latestPoint, t) : t.sealRetentionSource(shortID(pointActionID))}
                icon={ShieldCheck}
                loading={sealingPoint}
                disabled={sealDisabled}
                onClick={() => pointActionID && onSealPoint(pointActionID)}
              />
              <ActionButton
                label={t.createApitBookmark}
                loadingVerb={t.verbCreating}
                description={bookmarkDisabled ? bookmarkDisabledReason(activeStreamId, journalTimeline, t) : t.bookmarkSeq(String(journalTimeline?.latest_seq ?? t.na))}
                icon={BookmarkPlus}
                loading={creatingBookmark}
                disabled={bookmarkDisabled}
                onClick={onCreateBookmark}
              />
              <ActionButton
                label={t.materializeJournalPoint}
                loadingVerb={t.verbMaterializing}
                description={materializeDisabled ? materializeDisabledReason(selectedGroupId, activeStreamId, journalTimeline, t) : t.replayStream(shortID(activeStreamId))}
                icon={DatabaseZap}
                loading={materializingPoint}
                disabled={materializeDisabled}
                onClick={onMaterializePoint}
              />
              <ActionButton
                label={t.startInstantRecovery}
                loadingVerb={t.verbStarting}
                description={startInstantDisabled ? startInstantDisabledReason(selectedGroupId, selectedPoint, instantActive, t) : t.serveThroughCow(shortID(instantPointID))}
                icon={PlayCircle}
                loading={startingInstant}
                disabled={startInstantDisabled}
                onClick={() => instantPointID && onStartInstantRecovery(instantPointID)}
              />
              <ActionButton
                label={t.finalizeInstantRecovery}
                loadingVerb={t.verbFinalizing}
                description={finalizeInstantDisabled ? finalizeInstantDisabledReason(instantSession, t) : t.finalizeSession(shortID(instantSession?.id))}
                icon={HardDriveDownload}
                loading={finalizingInstant}
                disabled={finalizeInstantDisabled}
                onClick={() => instantSession?.id && onFinalizeInstantRecovery(instantSession.id)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.outputsTitle}</CardTitle>
              <CardDescription>{t.outputsDescription}</CardDescription>
            </div>
            <StatusBadge status={latestOutputStatus(validatedPoint, sealedPoint, latestMaterializedPoint, instantSession)} t={t} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={t.validated} value={validatedPoint ? shortID(validatedPoint.id) : t.na} tone="slate" />
              <MiniDatum label={t.sealed} value={sealedPoint ? shortID(sealedPoint.id) : t.na} tone="slate" />
              <MiniDatum label={t.materialized} value={latestMaterializedPoint ? shortID(latestMaterializedPoint.id) : t.na} tone="slate" />
              <MiniDatum
                label={t.instant}
                value={instantSession ? labelFor(instantState, t) : t.idle}
                tone={instantSession ? statusStatTone(instantSession.state) : 'slate'}
              />
            </div>

            <div className="space-y-2">
              <OutputLine
                icon={BadgeCheck}
                label={t.validationOutput}
                status={validatedPoint?.is_validated ? 'validated' : 'pending'}
                detail={validatedPoint ? t.validationOutputDetail(formatRatio(validatedPoint.validation_ratio), formatDateTime(validatedPoint.sealed_at)) : t.noValidationResult}
                t={t}
              />
              <OutputLine
                icon={ShieldCheck}
                label={t.sealOutput}
                status={sealedPoint ? (sealedPoint.legal_hold ? 'worm' : 'sealed') : 'pending'}
                detail={sealedPoint ? t.sealOutputDetail(formatDate(sealedPoint.retention_until), shortHash(sealedPoint.content_hash)) : t.noSealedPoint}
                t={t}
              />
              <OutputLine
                icon={DatabaseZap}
                label={t.materializationOutput}
                status={latestMaterializedPoint ? (latestMaterializedPoint.is_validated ? 'validated' : 'sealed') : 'pending'}
                detail={latestMaterializedPoint ? t.atLsn(shortID(latestMaterializedPoint.id), latestMaterializedPoint.marker_lsn) : t.noMaterializedPoint}
                t={t}
              />
              <OutputLine
                icon={PlayCircle}
                label={t.instantOutput}
                status={instantSession?.state ?? 'idle'}
                detail={instantSession ? instantSessionDetail(instantSession, instantProgress, t) : t.noInstantSession}
                t={t}
              />
            </div>

            {instantSession ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-muted-foreground">{t.hydrationProgress}</span>
                  <span className="font-semibold">{instantProgress}%</span>
                </div>
                <Progress
                  value={instantProgress}
                  className="h-2"
                  indicatorClassName={instantProgress < 100 ? 'bg-amber-500' : 'bg-primary'}
                />
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MiniDatum label={t.chunks} value={`${instantSession.chunks_hydrated}/${instantSession.chunks_total}`} tone="sky" />
                  <MiniDatum label={t.chunkSize} value={formatBytes(instantSession.chunk_size)} tone="sky" />
                  <MiniDatum label={t.overlay} value={shortPath(instantSession.overlay_location)} tone="slate" />
                  <MiniDatum label={t.finalized} value={shortPath(instantSession.finalized_location)} tone="slate" />
                </div>
                {instantSession.last_error ? (
                  <div className="rounded-lg border border-error-100 bg-error-50 px-3 py-2 text-sm text-error-700 dark:border-error-700/50 dark:bg-error-700/25 dark:text-error-300">
                    {instantSession.last_error}
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.catalogTitle}</CardTitle>
              <CardDescription>{t.catalogDescription}</CardDescription>
            </div>
            <Badge variant="outline">{t.pointsBadge(sortedPoints.length)}</Badge>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.colPoint}</TableHead>
                    <TableHead>{t.colRpo}</TableHead>
                    <TableHead>{t.colValidation}</TableHead>
                    <TableHead>{t.colRetention}</TableHead>
                    <TableHead>{t.colHash}</TableHead>
                    <TableHead className="text-end">{t.colActions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPoints.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">
                        {t.noRecoveryPointsReturned}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedPoints.slice(0, 8).map((point) => {
                      const selected = point.id === selectedPoint?.id;
                      const pointInstantActive = instantActive && instantSession?.recovery_point_id === point.id;
                      const startPointDisabled = loading || startingInstant || !selectedGroupId || !point.is_validated || instantActive;

                      return (
                        <TableRow key={point.id} data-state={selected ? 'selected' : undefined}>
                          <TableCell>
                            <div className="flex min-w-[11rem] items-center gap-2">
                              <div className="min-w-0">
                                <div className="truncate font-mono text-xs">{point.id}</div>
                                <div className="text-xs text-muted-foreground">LSN {point.marker_lsn}</div>
                              </div>
                              {selected ? <Badge variant="outline">{t.selectedTag}</Badge> : null}
                            </div>
                          </TableCell>
                          <TableCell>{formatDuration(point.rpo_seconds)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge status={point.is_validated ? 'validated' : 'pending'} t={t} />
                              <span className="text-xs text-muted-foreground">{formatRatio(point.validation_ratio)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge status={point.legal_hold ? 'worm' : 'retained'} label={point.legal_hold ? t.worm : t.retained} t={t} />
                              <span className="text-xs text-muted-foreground">{formatDate(point.retention_until)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{shortHash(point.content_hash)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={loading || validatingPoint || !selectedGroupId}
                                aria-label={t.runValidationOn(point.id)}
                                onClick={() => onValidatePoint(point.id)}
                              >
                                {validatingPoint ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="me-1.5 h-3.5 w-3.5" />}
                                {t.validate}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant={pointInstantActive ? 'secondary' : 'outline'}
                                disabled={startPointDisabled}
                                aria-label={t.serveThroughCow(point.id)}
                                onClick={() => onStartInstantRecovery(point.id)}
                              >
                                {startingInstant ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="me-1.5 h-3.5 w-3.5" />}
                                {pointInstantActive ? t.activeBtn : t.instantBtn}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {sortedPoints.length > 8 ? (
              <div className="mt-3 text-xs text-muted-foreground">
                {t.additionalPointsHidden(sortedPoints.length - 8)}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.bookmarksTitle}</CardTitle>
              <CardDescription>{t.bookmarksDescription(activeStreamId ? shortID(activeStreamId) : t.selectedStreamFallback)}</CardDescription>
            </div>
            <StatusBadge status={journalTimeline?.recoverable ? (journalTimeline.has_gaps ? 'warning' : 'healthy') : 'empty'} label={journalTimeline?.recoverable ? (journalTimeline.has_gaps ? t.gapped : t.recoverable) : t.emptyTag} t={t} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MiniDatum label={t.segments} value={journalTimeline?.segments.length ?? 0} tone="sky" />
              <MiniDatum label={t.frames} value={journalFrames} tone="sky" />
              <MiniDatum label={t.earliest} value={formatDateTime(journalTimeline?.earliest_ts)} tone="gold" />
              <MiniDatum label={t.latest} value={formatDateTime(journalTimeline?.latest_ts)} tone="gold" />
            </div>
            <div className="space-y-2">
              {bookmarks.length === 0 ? (
                <EmptyLine icon={BookmarkCheck} text={t.noApitBookmarks} />
              ) : (
                bookmarks.slice(0, 6).map((bookmark) => (
                  <div key={bookmark.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div className="min-w-0 truncate font-medium">{bookmark.name}</div>
                        <Badge variant="outline" className="normal-case tracking-normal">{bookmark.kind}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t.seqPrefix} {bookmark.at_seq} / {formatDateTime(bookmark.at_ts)}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{bookmark.at_lsn}</div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={loading || deletingBookmark || !activeStreamId}
                      aria-label={`${t.bookmarksTitle}: ${bookmark.name}`}
                      onClick={() => onDeleteBookmark(bookmark.id)}
                    >
                      {deletingBookmark ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                ))
              )}
            </div>
            {bookmarks.length > 6 ? (
              <div className="text-xs text-muted-foreground">
                {t.additionalBookmarksHidden(bookmarks.length - 6)}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RecoveryMetric({
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
  tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral';
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
  loadingVerb,
  description,
  icon: Icon,
  loading,
  disabled,
  onClick,
  variant = 'outline',
}: {
  label: string;
  loadingVerb: string;
  description: string;
  icon: LucideIcon;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
}) {
  return (
    <Button
      type="button"
      variant={disabled ? 'secondary' : variant}
      className={cn(
        'h-auto min-h-[82px] justify-start gap-3 whitespace-normal px-3 py-3 text-start',
        disabled && 'opacity-70',
      )}
      disabled={disabled || loading}
      aria-label={label}
      title={description}
      onClick={onClick}
    >
      <span className={cn('rounded-lg p-2', disabled ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-5">{loading ? loadingVerb : label}</span>
        <span className="mt-1 block text-xs leading-4 text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

function OutputLine({
  icon: Icon,
  label,
  status,
  detail,
  t,
}: {
  icon: LucideIcon;
  label: string;
  status?: string | null;
  detail: string;
  t: RecoveryActionLabels;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2">
      <div className={cn('mt-0.5 rounded-lg p-1.5', toneClass(statusTone(status), 'soft'))}>
        <Icon className={cn('h-4 w-4', toneClass(statusTone(status), 'text'))} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{label}</div>
          <StatusBadge status={status} t={t} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
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

function StatusBadge({ status, label, t }: { status?: string | null; label?: string; t: RecoveryActionLabels }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error'
      ? 'destructive'
      : normalized === 'warning' || normalized === 'pending' || normalized === 'hydrating' || normalized === 'finalizing'
        ? 'warning'
        : normalized === 'healthy' ||
            normalized === 'validated' ||
            normalized === 'ready' ||
            normalized === 'sealed' ||
            normalized === 'worm' ||
            normalized === 'retained' ||
            normalized === 'finalized'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case tracking-normal">
      <span className="truncate">{label ?? labelFor(normalized, t)}</span>
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

function sortRecoveryPoints(points: DRRecoveryPoint[]) {
  return [...points].sort((left, right) => timestampMs(right.sealed_at) - timestampMs(left.sealed_at));
}

function mergeBookmarks(primary: DRJournalBookmark[], secondary: DRJournalBookmark[]) {
  const byID = new Map<string, DRJournalBookmark>();
  for (const bookmark of [...primary, ...secondary]) {
    byID.set(bookmark.id, bookmark);
  }
  return [...byID.values()].sort((left, right) => timestampMs(right.created_at) - timestampMs(left.created_at));
}

function pointActionDisabledReason(selectedGroupId: string | null | undefined, latestPoint: DRRecoveryPoint | null, t: RecoveryActionLabels) {
  if (!selectedGroupId) return t.reasonSelectGroup;
  if (!latestPoint) return t.reasonNoRecoveryPoint;
  return t.reasonActionUnavailable;
}

function bookmarkDisabledReason(activeStreamId: string | null | undefined, timeline: DRJournalTimeline | null, t: RecoveryActionLabels) {
  if (!activeStreamId) return t.reasonSelectStream;
  if (!timeline) return t.reasonLoadTimeline;
  if (!timeline.recoverable) return t.reasonTimelineNotRecoverable;
  return t.reasonBookmarkUnavailable;
}

function materializeDisabledReason(
  selectedGroupId: string | null | undefined,
  activeStreamId: string | null | undefined,
  timeline: DRJournalTimeline | null,
  t: RecoveryActionLabels,
) {
  if (!selectedGroupId) return t.reasonSelectGroup;
  if (!activeStreamId) return t.reasonSelectStream;
  if (!timeline) return t.reasonLoadTimeline;
  if (!timeline.recoverable) return t.reasonTimelineNotRecoverable;
  return t.reasonMaterializeUnavailable;
}

function startInstantDisabledReason(
  selectedGroupId: string | null | undefined,
  point: DRRecoveryPoint | null,
  instantActive: boolean,
  t: RecoveryActionLabels,
) {
  if (!selectedGroupId) return t.reasonSelectGroup;
  if (!point) return t.reasonSelectRecoveryPoint;
  if (!point.is_validated) return t.reasonValidateFirst;
  if (instantActive) return t.reasonInstantActive;
  return t.reasonInstantUnavailable;
}

function finalizeInstantDisabledReason(session: DRInstantRecoverySession | null, t: RecoveryActionLabels) {
  if (!session) return t.reasonNoInstantSession;
  const status = normalizeStatus(session.state);
  if (status === 'hydrating') return t.reasonHydrationComplete(instantPercent(null, session));
  if (status === 'finalizing') return t.reasonFinalizationInProgress;
  if (status === 'finalized') return t.reasonAlreadyFinalized;
  if (status === 'failed') return t.reasonSessionFailed;
  return t.reasonSessionNotReady;
}

function instantSessionDetail(session: DRInstantRecoverySession, progress: number, t: RecoveryActionLabels) {
  const status = normalizeStatus(session.state);
  if (session.finalized_location) return t.finalizedTo(shortPath(session.finalized_location));
  if (session.ready_at && status === 'ready') return t.readyAtWithHydration(formatDateTime(session.ready_at), progress);
  if (session.last_error) return session.last_error;
  return t.chunksHydratedFrom(session.chunks_hydrated, session.chunks_total, shortID(session.recovery_point_id));
}

function latestOutputStatus(
  validatedPoint: DRRecoveryPoint | null,
  sealedPoint: DRRecoveryPoint | null,
  materializedPoint: DRRecoveryPoint | null | undefined,
  session: DRInstantRecoverySession | null,
) {
  if (session && ['failed', 'error'].includes(normalizeStatus(session.state))) return 'failed';
  if (session && ['hydrating', 'finalizing'].includes(normalizeStatus(session.state))) return session.state;
  if (materializedPoint || session || validatedPoint || sealedPoint) return 'ready';
  return 'pending';
}

function instantPercent(
  progress?: DRInstantRecoveryProgress | null,
  session?: DRInstantRecoverySession | null,
) {
  if (progress?.percent_complete !== undefined && progress.percent_complete !== null) {
    return clampPercent(progress.percent_complete);
  }
  if (!session) return 0;
  const status = normalizeStatus(session.state);
  if (status === 'ready' || status === 'finalizing' || status === 'finalized') return 100;
  if (session.chunks_total <= 0) return 0;
  return clampPercent((session.chunks_hydrated / session.chunks_total) * 100);
}

function clampPercent(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isInstantTerminal(status?: string | null) {
  return ['finalized', 'failed'].includes(normalizeStatus(status));
}

function statusTone(status?: string | null): 'success' | 'warning' | 'critical' | 'info' | 'neutral' {
  const normalized = normalizeStatus(status);
  if (normalized === 'empty' || normalized === 'idle') return 'neutral';
  if (normalized === 'failed' || normalized === 'error') return 'critical';
  if (normalized === 'validated' || normalized === 'ready' || normalized === 'sealed' || normalized === 'worm' || normalized === 'retained' || normalized === 'finalized' || normalized === 'healthy') return 'success';
  if (normalized === 'hydrating') return 'info';
  return 'warning';
}

/** Map a run/operation status to a semantic `StatTone` for compact stat tiles. */
function statusStatTone(status?: string | null): StatTone {
  const tone = statusTone(status);
  if (tone === 'critical') return 'rose';
  if (tone === 'success') return 'emerald';
  if (tone === 'info') return 'sky';
  if (tone === 'warning') return 'gold';
  return 'slate';
}

function toneClass(tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral', part: 'soft' | 'text') {
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

function formatRatio(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return 'n/a';
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
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

function shortID(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function shortPath(value?: string | null) {
  if (!value) return 'n/a';
  const last = value.split('/').filter(Boolean).pop();
  return last ? shortID(last) : shortID(value);
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(value: string | null | undefined, t: RecoveryActionLabels) {
  const normalized = normalizeStatus(value);
  return t.statusLabels[normalized] ?? normalized.replace(/_/g, ' ');
}

function timestampMs(value?: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatError(error: unknown, t: RecoveryActionLabels) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return t.refreshError;
}
