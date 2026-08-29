'use client';

import {
  ArchiveRestore,
  BookmarkCheck,
  CheckCircle2,
  FileClock,
  Fingerprint,
  GitCommitHorizontal,
  PlayCircle,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';
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
import type {
  DRAttestationLedgerVerifyResult,
  DRJournalBookmark,
  DRJournalTimeline,
  DRRecoveryPoint,
} from '@/types/clario-dr';
import { useWorkbenchLabels, type WorkbenchLabels } from '../_lib/dr-action-labels';

type WorkbenchGroup = {
  id?: string;
  group_id?: string;
  groupId?: string;
  name?: string | null;
  rpo_objective_seconds?: number | null;
  rto_objective_seconds?: number | null;
};

export function DRRecoveryWorkbench({
  activeStreamId,
  journalBookmarks,
  journalTimeline,
  ledgerVerification,
  loading,
  error,
  recoveryPoints,
  selectedGroup,
  onRetry,
  onOpenFailover,
}: {
  activeStreamId?: string | null;
  journalBookmarks: DRJournalBookmark[];
  journalTimeline?: DRJournalTimeline | null;
  ledgerVerification?: DRAttestationLedgerVerifyResult | null;
  loading: boolean;
  error: unknown;
  recoveryPoints: DRRecoveryPoint[];
  selectedGroup?: WorkbenchGroup | null;
  onRetry: () => void;
  onOpenFailover: () => void;
}) {
  const t = useWorkbenchLabels();
  if (loading && recoveryPoints.length === 0 && !journalTimeline) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && recoveryPoints.length === 0 && !journalTimeline && !ledgerVerification) {
    return <ErrorState message={t.loadError} onRetry={onRetry} />;
  }

  const latestPoint = selectLatestRecoveryPoint(recoveryPoints);
  const validatedPoints = recoveryPoints.filter((point) => point.is_validated).length;
  const wormLockedPoints = recoveryPoints.filter((point) => point.legal_hold).length;
  const recoverable = Boolean(journalTimeline?.recoverable);
  const coverageSeconds = journalTimeline ? Math.max(0, timestampMs(journalTimeline.latest_ts) - timestampMs(journalTimeline.earliest_ts)) / 1000 : 0;
  const totalFrames = (journalTimeline?.segments ?? []).reduce((sum, segment) => sum + segment.frame_count, 0);
  const ledgerIntact = ledgerVerification?.intact ?? false;
  const groupName = selectedGroup?.name ?? groupID(selectedGroup) ?? t.selectedGroupFallback;
  const streamName = activeStreamId ?? t.selectedStreamFallback;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <WorkbenchMetric
          title={t.metricRecoveryPoints}
          value={recoveryPoints.length}
          detail={t.validatedWormDetail(validatedPoints, wormLockedPoints)}
          icon={ArchiveRestore}
          tone={validatedPoints > 0 ? 'success' : 'warning'}
        />
        <WorkbenchMetric
          title={t.metricApitJournal}
          value={recoverable ? formatDuration(coverageSeconds) : t.na}
          detail={activeStreamId ? t.framesOnStream(totalFrames, activeStreamId) : t.noStreamSelected}
          icon={FileClock}
          tone={recoverable && !journalTimeline?.has_gaps ? 'success' : 'warning'}
        />
        <WorkbenchMetric
          title={t.metricBookmarks}
          value={journalBookmarks.length}
          detail={journalBookmarks[0]?.name ?? t.noRestoreBookmarks}
          icon={BookmarkCheck}
          tone={journalBookmarks.length > 0 ? 'info' : 'neutral'}
        />
        <WorkbenchMetric
          title={t.metricLedgerChain}
          value={ledgerIntact ? t.ledgerIntact : t.ledgerCheck}
          detail={ledgerVerification ? t.entriesVerified(ledgerVerification.entries_checked) : t.verificationNotReturned}
          icon={ShieldCheck}
          tone={ledgerIntact ? 'success' : 'warning'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.catalogTitle}</CardTitle>
              <CardDescription>{t.catalogDescription(groupName)}</CardDescription>
            </div>
            <Badge variant="outline">{t.pointsBadge(recoveryPoints.length)}</Badge>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recoveryPoints.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        {t.noRecoveryPointsReturned}
                      </TableCell>
                    </TableRow>
                  ) : (
                    recoveryPoints.slice(0, 8).map((point) => (
                      <TableRow key={point.id}>
                        <TableCell>
                          <div className="font-mono text-xs">{point.id}</div>
                          <div className="text-xs text-muted-foreground">LSN {point.marker_lsn}</div>
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
                            <span className="text-xs text-muted-foreground">{t.untilPrefix} {formatDate(point.retention_until)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{shortHash(point.content_hash)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.restoreReadinessTitle}</CardTitle>
            <CardDescription>{t.restoreReadinessDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MiniDatum label={t.latestPoint} value={latestPoint?.id ?? t.na} />
              <MiniDatum label={t.sealed} value={formatDateTime(latestPoint?.sealed_at)} />
              <MiniDatum label={t.rtoTarget} value={formatDuration(selectedGroup?.rto_objective_seconds)} />
              <MiniDatum label={t.rpoTarget} value={formatDuration(selectedGroup?.rpo_objective_seconds)} />
            </div>
            <div className="space-y-2">
              <ReadinessLine
                icon={CheckCircle2}
                label={t.validateSealedPoint}
                ready={Boolean(latestPoint?.is_validated)}
                detail={latestPoint ? t.validationRatioDetail(formatRatio(latestPoint.validation_ratio)) : t.noSealedPoint}
                t={t}
              />
              <ReadinessLine
                icon={GitCommitHorizontal}
                label={t.resolveApitTarget}
                ready={recoverable && !journalTimeline?.has_gaps}
                detail={journalTimeline ? `${journalTimeline.earliest_lsn} to ${journalTimeline.latest_lsn}` : t.noJournalTimeline}
                t={t}
              />
              <ReadinessLine
                icon={PlayCircle}
                label={t.instantRecoverySession}
                ready={Boolean(latestPoint?.is_validated && latestPoint.legal_hold)}
                detail={latestPoint?.legal_hold ? t.immutableSourceAvailable : t.requiresWormSource}
                t={t}
              />
              <ReadinessLine
                icon={Fingerprint}
                label={t.attestationChain}
                ready={ledgerIntact}
                detail={ledgerVerification?.head_hash ? shortHash(ledgerVerification.head_hash) : ledgerVerification?.reason ?? t.noVerificationResult}
                t={t}
              />
            </div>
            <Button className="w-full" variant="outline" disabled={!latestPoint?.is_validated} onClick={onOpenFailover}>
              <PlayCircle className="me-1.5 h-4 w-4" />
              {t.stageFailover}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.apitTimelineTitle}</CardTitle>
              <CardDescription>{t.apitTimelineDescription(streamName)}</CardDescription>
            </div>
            <StatusBadge status={recoverable ? (journalTimeline?.has_gaps ? 'warning' : 'healthy') : 'empty'} label={recoverable ? (journalTimeline?.has_gaps ? t.gapped : t.recoverable) : t.empty} t={t} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MiniDatum label={t.segments} value={journalTimeline?.segments?.length ?? 0} />
              <MiniDatum label={t.frames} value={totalFrames} />
              <MiniDatum label={t.earliest} value={formatDateTime(journalTimeline?.earliest_ts)} />
              <MiniDatum label={t.latest} value={formatDateTime(journalTimeline?.latest_ts)} />
            </div>
            <Progress
              value={recoverable ? (journalTimeline?.has_gaps ? 66 : 100) : 0}
              className="h-2"
              indicatorClassName={journalTimeline?.has_gaps ? 'bg-amber-500' : 'bg-primary'}
            />
            <div className="space-y-2">
              {(journalTimeline?.segments ?? []).slice(0, 5).map((segment) => (
                <div key={segment.id} className="rounded-lg border px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs">{segment.id}</div>
                      <div className="text-xs text-muted-foreground">
                        seq {segment.min_seq}-{segment.max_seq} / {formatBytes(segment.payload_bytes)}
                      </div>
                    </div>
                    <StatusBadge status={segment.pruned ? 'pruned' : 'sealed'} t={t} />
                  </div>
                </div>
              ))}
              {(journalTimeline?.segments ?? []).length === 0 ? (
                <EmptyLine icon={FileClock} text={t.noJournalSegments} />
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.bookmarksLedgerTitle}</CardTitle>
              <CardDescription>{t.bookmarksLedgerDescription}</CardDescription>
            </div>
            <StatusBadge status={ledgerIntact ? 'healthy' : 'warning'} label={ledgerIntact ? t.verified : t.unverified} t={t} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{t.ledgerVerificationTitle}</div>
                <StatusBadge status={ledgerIntact ? 'healthy' : 'warning'} t={t} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <MiniDatum label={t.entries} value={ledgerVerification?.entries_checked ?? 0} />
                <MiniDatum label={t.brokenSeq} value={ledgerVerification?.first_broken_seq ?? t.none} />
                <MiniDatum label={t.reason} value={ledgerVerification?.reason ?? t.chainIntact} />
                <MiniDatum label={t.head} value={shortHash(ledgerVerification?.head_hash)} />
              </div>
            </div>
            <div className="space-y-2">
              {journalBookmarks.length === 0 ? (
                <EmptyLine icon={BookmarkCheck} text={t.noApitBookmarks} />
              ) : (
                journalBookmarks.slice(0, 6).map((bookmark) => (
                  <div key={bookmark.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{bookmark.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {bookmark.kind} / {t.seqPrefix} {bookmark.at_seq} / {formatDateTime(bookmark.at_ts)}
                      </div>
                    </div>
                    <Badge variant="outline" className="max-w-[9rem]">
                      <span className="truncate">{bookmark.at_lsn}</span>
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function WorkbenchMetric({
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
  tone: 'success' | 'warning' | 'info' | 'neutral';
}) {
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

function ReadinessLine({
  icon: Icon,
  label,
  ready,
  detail,
  t,
}: {
  icon: LucideIcon;
  label: string;
  ready: boolean;
  detail: string;
  t: WorkbenchLabels;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2">
      <div className={cn('mt-0.5 rounded-lg p-1.5', ready ? 'bg-primary/10 text-primary' : 'bg-amber-50 text-warning-700 dark:bg-amber-950/25 dark:text-warning-300')}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{label}</div>
          <StatusBadge status={ready ? 'ready' : 'pending'} t={t} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function MiniDatum({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  /** Optional semantic accent; defaults to the historic muted label (untoned). */
  tone?: StatTone;
}) {
  const toned = tone !== undefined && tone !== 'neutral';
  return (
    <div className={cn('min-w-0', toned && TONE_THEME_CLASS[tone])}>
      <div
        className={cn(
          'text-overline font-semibold uppercase',
          toned ? 'text-[color:var(--kpi-accent)]' : 'text-muted-foreground',
        )}
      >
        {label}
      </div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({ status, label, t }: { status?: string | null; label?: string; t: WorkbenchLabels }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' || normalized === 'failed' || normalized === 'error'
      ? 'destructive'
      : normalized === 'warning' || normalized === 'pending' || normalized === 'pruned'
        ? 'warning'
        : normalized === 'healthy' || normalized === 'validated' || normalized === 'ready' || normalized === 'sealed' || normalized === 'worm'
          ? 'success'
          : 'outline';

  return (
    <Badge variant={variant} className="max-w-full normal-case">
      <span className="truncate">{label ?? t.statusLabels[normalized] ?? normalized.replace(/_/g, ' ')}</span>
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

function selectLatestRecoveryPoint(points: DRRecoveryPoint[]) {
  return [...points].sort((left, right) => timestampMs(right.sealed_at) - timestampMs(left.sealed_at))[0] ?? null;
}

function groupID(group?: WorkbenchGroup | null) {
  return group?.group_id ?? group?.groupId ?? group?.id;
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function toneClass(tone: 'success' | 'warning' | 'info' | 'neutral', part: 'soft' | 'text') {
  const styles = {
    success: { soft: 'bg-primary/10', text: 'text-primary' },
    warning: { soft: 'bg-amber-50 dark:bg-amber-950/25', text: 'text-warning-700 dark:text-warning-300' },
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

function shortHash(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function timestampMs(value?: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
