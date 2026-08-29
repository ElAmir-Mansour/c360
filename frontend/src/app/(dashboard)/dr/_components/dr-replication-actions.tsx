'use client';

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  PauseCircle,
  PlayCircle,
  Radio,
  RefreshCw,
  ShieldAlert,
  Timer,
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
import type { DRReplicationStream } from '@/types/clario-dr';
import { useReplicationActionLabels, type ReplicationActionLabels } from '../_lib/dr-action-labels';

type NullableReplicationStream = {
  [Key in keyof DRReplicationStream]?: DRReplicationStream[Key] | null;
};

export type DRReplicationActionStream = Omit<
  NullableReplicationStream,
  'applied_at' | 'created_at' | 'updated_at'
> & {
  stream_id?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  site_id?: string | null;
  site_name?: string | null;
  site_kind?: string | null;
  health?: string | null;
  rpo_seconds?: number | null;
  lag_seconds?: number | null;
  rpo_objective_seconds?: number | null;
  has_data?: boolean | null;
  breaches_rpo?: boolean | null;
  applied_at?: string | Date | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  measured_at?: string | Date | null;
};

export type DRReplicationActionsPanelProps = {
  streams: DRReplicationActionStream[];
  activeStreamId?: string | null;
  selectedGroupId?: string | null;
  latestPausedStreamId?: string | null;
  latestResumedStreamId?: string | null;
  loading: boolean;
  pausingStream: boolean;
  resumingStream: boolean;
  error: unknown;
  onPauseStream: (streamID: string) => void;
  onResumeStream: (streamID: string) => void;
  onRetry: () => void;
};

type Tone = 'success' | 'warning' | 'critical' | 'info' | 'neutral';
type StreamClass = 'healthy' | 'degraded' | 'paused' | 'unknown';

type StreamRow = {
  source: DRReplicationActionStream;
  id: string | null;
  key: string;
  label: string;
  siteLabel: string;
  siteKind: string;
  groupId: string | null;
  status: string;
  health: string;
  className: StreamClass;
  appliedSeq: number | null;
  sourceLsn: string | null;
  appliedAt: string | Date | null;
  measuredAt: string | Date | null;
  lastError: string | null;
  rpoSeconds: number | null;
  lagSeconds: number | null;
  rpoObjectiveSeconds: number | null;
  breachesRPO: boolean;
};

export function DRReplicationActionsPanel({
  streams,
  activeStreamId,
  selectedGroupId,
  latestPausedStreamId,
  latestResumedStreamId,
  loading,
  pausingStream,
  resumingStream,
  error,
  onPauseStream,
  onResumeStream,
  onRetry,
}: DRReplicationActionsPanelProps) {
  const t = useReplicationActionLabels();
  const scopedStreams = scopeStreams(streams, selectedGroupId);
  const rows = scopedStreams.map(toStreamRow).sort(compareStreamRows);
  const hasData = Boolean(rows.length || activeStreamId || latestPausedStreamId || latestResumedStreamId);

  if (loading && !hasData) {
    return <LoadingSkeleton variant="card" count={4} />;
  }

  if (error && !hasData) {
    return <ErrorState message={t.loadError} onRetry={onRetry} />;
  }

  const healthyCount = rows.filter((row) => row.className === 'healthy').length;
  const degradedCount = rows.filter((row) => row.className === 'degraded').length;
  const pausedCount = rows.filter((row) => row.className === 'paused').length;
  const worstRPO = selectWorstRPORow(rows);
  const activeStream = activeStreamId ? rows.find((row) => row.id === activeStreamId) ?? null : null;
  const latestPaused = latestPausedStreamId ? findStreamById(rows, latestPausedStreamId) : null;
  const latestResumed = latestResumedStreamId ? findStreamById(rows, latestResumedStreamId) : null;
  const liveCount = rows.filter((row) => row.className !== 'paused').length;
  const totalCount = rows.length;

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
        <ReplicationMetric
          title={t.metricHealthy}
          value={healthyCount}
          detail={t.withinPolicy(healthyCount, totalCount)}
          icon={CheckCircle2}
          tone={healthyCount > 0 ? 'success' : totalCount > 0 ? 'warning' : 'neutral'}
        />
        <ReplicationMetric
          title={t.metricDegraded}
          value={degradedCount}
          detail={degradedCount > 0 ? t.degradedDetail : t.noDegraded}
          icon={ShieldAlert}
          tone={degradedCount > 0 ? 'warning' : 'success'}
        />
        <ReplicationMetric
          title={t.metricPaused}
          value={pausedCount}
          detail={t.liveVsPaused(liveCount, pausedCount)}
          icon={PauseCircle}
          tone={pausedCount > 0 ? 'warning' : totalCount > 0 ? 'success' : 'neutral'}
        />
        <ReplicationMetric
          title={t.metricWorstRpo}
          value={formatSeconds(worstRPO?.rpoSeconds)}
          detail={worstRPO ? t.worstRpoDetail(worstRPO.siteLabel, formatSeconds(worstRPO.rpoObjectiveSeconds)) : t.noMeasuredRpo}
          icon={Timer}
          tone={worstRPO?.breachesRPO ? 'warning' : worstRPO ? 'info' : 'neutral'}
        />
        <ReplicationMetric
          title={t.metricActiveStream}
          value={activeStream ? shortID(activeStream.id) : t.none}
          detail={activeStream ? t.activeStreamDetail(activeStream.siteLabel, labelFor(activeStream.status, t)) : t.noActiveStream}
          icon={Radio}
          tone={activeStream ? classTone(activeStream.className) : 'neutral'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">{t.actionsTitle}</CardTitle>
              <CardDescription>{t.actionsDescription}</CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {loading ? <StatusBadge status="pending" label={t.refreshing} t={t} /> : null}
              <StatusBadge status={degradedCount > 0 ? 'warning' : pausedCount > 0 ? 'paused' : totalCount > 0 ? 'healthy' : 'empty'} t={t} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 lg:hidden">
              {rows.length === 0 ? (
                <EmptyLine icon={Radio} text={t.noStreamsReturned} />
              ) : (
                rows.map((row) => (
                  <CompactStreamActionRow
                    key={row.key}
                    row={row}
                    active={row.id !== null && row.id === activeStreamId}
                    loading={loading}
                    pausingStream={pausingStream}
                    resumingStream={resumingStream}
                    onPauseStream={onPauseStream}
                    onResumeStream={onResumeStream}
                    t={t}
                  />
                ))
              )}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.colSite}</TableHead>
                    <TableHead>{t.colStream}</TableHead>
                    <TableHead>{t.colStatus}</TableHead>
                    <TableHead>{t.colRpo}</TableHead>
                    <TableHead>{t.colLag}</TableHead>
                    <TableHead>{t.colCheckpoint}</TableHead>
                    <TableHead>{t.colError}</TableHead>
                    <TableHead className="text-end">{t.colActions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-sm text-muted-foreground">
                        {t.noStreamsReturned}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.key} data-state={row.id !== null && row.id === activeStreamId ? 'selected' : undefined}>
                        <TableCell>
                          <div className="font-medium">{row.siteLabel}</div>
                          <div className="text-xs capitalize text-muted-foreground">{row.siteKind}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-xs">{shortID(row.id)}</div>
                          {row.groupId ? <div className="mt-1 font-mono text-xs text-muted-foreground">{shortID(row.groupId)}</div> : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={row.health !== 'empty' ? row.health : row.status} t={t} />
                            {row.id !== null && row.id === activeStreamId ? <Badge variant="outline" className="normal-case tracking-normal">{t.active}</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-40">
                          <RPOStatus row={row} t={t} />
                        </TableCell>
                        <TableCell>{formatSeconds(row.lagSeconds)}</TableCell>
                        <TableCell>
                          <div className="text-sm">{formatDateTime(row.appliedAt)}</div>
                          <div className="font-mono text-xs text-muted-foreground">{t.seqPrefix} {formatNumber(row.appliedSeq)}</div>
                        </TableCell>
                        <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                          {row.lastError ?? '-'}
                        </TableCell>
                        <TableCell>
                          <StreamActionButtons
                            row={row}
                            loading={loading}
                            pausingStream={pausingStream}
                            resumingStream={resumingStream}
                            onPauseStream={onPauseStream}
                            onResumeStream={onResumeStream}
                            t={t}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t.summaryTitle}</CardTitle>
              <CardDescription>{t.summaryDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ActionSummaryLine
                icon={PauseCircle}
                label={t.latestPause}
                streamId={latestPausedStreamId}
                stream={latestPaused}
                tone={latestPausedStreamId ? 'warning' : 'neutral'}
                t={t}
              />
              <ActionSummaryLine
                icon={PlayCircle}
                label={t.latestResume}
                streamId={latestResumedStreamId}
                stream={latestResumed}
                tone={latestResumedStreamId ? 'success' : 'neutral'}
                t={t}
              />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <MiniDatum label={t.scope} value={selectedGroupId ? shortID(selectedGroupId) : t.allStreams} tone="slate" />
                <MiniDatum label={t.rows} value={rows.length} tone="sky" />
                <MiniDatum label={t.paused} value={pausedCount} tone={pausedCount > 0 ? 'rose' : 'sky'} />
                <MiniDatum label={t.degraded} value={degradedCount} tone={degradedCount > 0 ? 'rose' : 'sky'} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t.readinessTitle}</CardTitle>
              <CardDescription>{t.readinessDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ReadinessLine
                icon={Activity}
                label={t.liveCoverage}
                ready={totalCount > 0 && pausedCount === 0}
                detail={t.acceptingWrites(liveCount, totalCount)}
                t={t}
              />
              <ReadinessLine
                icon={Timer}
                label={t.rpoPolicy}
                ready={totalCount > 0 && degradedCount === 0}
                detail={worstRPO ? t.worstMeasuredRpo(formatSeconds(worstRPO.rpoSeconds)) : t.noRpoMeasurements}
                t={t}
              />
              <ReadinessLine
                icon={Clock3}
                label={t.checkpointFreshness}
                ready={rows.some((row) => Boolean(row.appliedAt || row.measuredAt))}
                detail={formatFreshness(rows, t)}
                t={t}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CompactStreamActionRow({
  row,
  active,
  loading,
  pausingStream,
  resumingStream,
  onPauseStream,
  onResumeStream,
  t,
}: {
  row: StreamRow;
  active: boolean;
  loading: boolean;
  pausingStream: boolean;
  resumingStream: boolean;
  onPauseStream: (streamID: string) => void;
  onResumeStream: (streamID: string) => void;
  t: ReplicationActionLabels;
}) {
  return (
    <div className={cn('rounded-lg border px-3 py-3', active && 'border-primary/40 bg-primary/5')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{row.siteLabel}</div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{shortID(row.id)}</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <StatusBadge status={row.health !== 'empty' ? row.health : row.status} t={t} />
          {active ? <Badge variant="outline" className="normal-case tracking-normal">{t.active}</Badge> : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <MiniDatum label={t.colRpo} value={formatSeconds(row.rpoSeconds)} tone={row.breachesRPO ? 'rose' : 'gold'} />
        <MiniDatum label={t.colLag} value={formatSeconds(row.lagSeconds)} tone="gold" />
        <MiniDatum label={t.seqPrefix} value={formatNumber(row.appliedSeq)} tone="sky" />
        <MiniDatum label={t.colCheckpoint} value={formatDateTime(row.appliedAt)} tone="gold" />
      </div>
      {row.lastError ? (
        <div className="mt-3 truncate rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-warning-700 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-warning-300">
          {row.lastError}
        </div>
      ) : null}
      <div className="mt-3">
        <StreamActionButtons
          row={row}
          loading={loading}
          pausingStream={pausingStream}
          resumingStream={resumingStream}
          onPauseStream={onPauseStream}
          onResumeStream={onResumeStream}
          t={t}
          fullWidth
        />
      </div>
    </div>
  );
}

function StreamActionButtons({
  row,
  loading,
  pausingStream,
  resumingStream,
  onPauseStream,
  onResumeStream,
  t,
  fullWidth = false,
}: {
  row: StreamRow;
  loading: boolean;
  pausingStream: boolean;
  resumingStream: boolean;
  onPauseStream: (streamID: string) => void;
  onResumeStream: (streamID: string) => void;
  t: ReplicationActionLabels;
  fullWidth?: boolean;
}) {
  const pauseDisabled = loading || pausingStream || resumingStream || !row.id || isPausedStatus(row.status) || isPausedStatus(row.health);
  const resumeDisabled = loading || pausingStream || resumingStream || !row.id || !canResumeStream(row);

  return (
    <div className={cn('flex justify-end gap-2', fullWidth && 'grid grid-cols-2')}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn('min-w-24', fullWidth && 'w-full')}
        disabled={pauseDisabled}
        aria-label={t.pauseAria(row.label)}
        title={pauseDisabled ? pauseDisabledReason(row, loading, pausingStream, resumingStream, t) : t.pauseTitle(row.label)}
        onClick={() => {
          if (row.id) onPauseStream(row.id);
        }}
      >
        {pausingStream ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="me-1.5 h-3.5 w-3.5" />}
        {t.pause}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={resumeDisabled ? 'secondary' : 'default'}
        className={cn('min-w-24', fullWidth && 'w-full')}
        disabled={resumeDisabled}
        aria-label={t.resumeAria(row.label)}
        title={resumeDisabled ? resumeDisabledReason(row, loading, pausingStream, resumingStream, t) : t.resumeTitle(row.label)}
        onClick={() => {
          if (row.id) onResumeStream(row.id);
        }}
      >
        {resumingStream ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="me-1.5 h-3.5 w-3.5" />}
        {t.resume}
      </Button>
    </div>
  );
}

function RPOStatus({ row, t }: { row: StreamRow; t: ReplicationActionLabels }) {
  const value = row.rpoSeconds;
  const objective = row.rpoObjectiveSeconds;
  const percent = objective && objective > 0 && value !== null
    ? Math.min(100, Math.round((value / objective) * 100))
    : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className={cn('font-medium', row.breachesRPO && 'text-warning-700 dark:text-warning-300')}>
          {formatSeconds(value)}
        </div>
        <StatusBadge status={row.breachesRPO ? 'warning' : value !== null ? 'healthy' : 'empty'} label={row.breachesRPO ? t.rpoBreach : value !== null ? t.rpoWithin : t.na} t={t} />
      </div>
      <Progress value={percent} className="h-1.5" />
      <div className="text-xs text-muted-foreground">{t.rpoTargetPrefix} {formatSeconds(objective)}</div>
    </div>
  );
}

function ReplicationMetric({
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

function ActionSummaryLine({
  icon: Icon,
  label,
  streamId,
  stream,
  tone,
  t,
}: {
  icon: LucideIcon;
  label: string;
  streamId?: string | null;
  stream?: StreamRow | null;
  tone: Tone;
  t: ReplicationActionLabels;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border px-3 py-2">
      <div className={cn('rounded-lg p-1.5', toneClass(tone, 'soft'))}>
        <Icon className={cn('h-4 w-4', toneClass(tone, 'text'))} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="truncate text-sm font-medium">{label}</div>
          <StatusBadge status={streamId ? 'completed' : 'empty'} label={streamId ? t.recorded : t.none} t={t} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {streamId ? `${stream?.siteLabel ?? t.colStream} / ${shortID(streamId)}` : t.noActionRecorded}
        </div>
      </div>
    </div>
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
  t: ReplicationActionLabels;
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
    <div className={cn('min-w-0 rounded-lg border bg-muted/20 px-3 py-2', toned && TONE_THEME_CLASS[tone])}>
      <div
        className={cn(
          'text-overline font-semibold uppercase',
          toned ? 'text-[color:var(--kpi-accent)]' : 'text-muted-foreground',
        )}
      >
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({ status, label, t }: { status?: string | null; label?: string; t: ReplicationActionLabels }) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === 'critical' ||
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'unhealthy' ||
    normalized === 'stalled'
      ? 'destructive'
      : normalized === 'warning' ||
          normalized === 'degraded' ||
          normalized === 'lagging' ||
          normalized === 'paused' ||
          normalized === 'pending' ||
          normalized === 'suspended'
        ? 'warning'
        : normalized === 'healthy' ||
            normalized === 'ready' ||
            normalized === 'running' ||
            normalized === 'streaming' ||
            normalized === 'active' ||
            normalized === 'completed'
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

function scopeStreams(streams: DRReplicationActionStream[], selectedGroupId?: string | null) {
  if (!selectedGroupId) return streams;
  const hasGroupScopedData = streams.some((stream) => Boolean(stream.group_id));
  if (!hasGroupScopedData) return streams;
  return streams.filter((stream) => stream.group_id === selectedGroupId);
}

function toStreamRow(stream: DRReplicationActionStream, index: number): StreamRow {
  const id = streamID(stream);
  const status = normalizeStatus(stream.status);
  const health = normalizeStatus(stream.health);
  const rpoSeconds = normalizeNumber(stream.rpo_seconds);
  const rpoObjectiveSeconds = normalizeNumber(stream.rpo_objective_seconds);
  const breachesRPO = Boolean(
    stream.breaches_rpo ||
      (rpoSeconds !== null && rpoObjectiveSeconds !== null && rpoObjectiveSeconds > 0 && rpoSeconds > rpoObjectiveSeconds),
  );
  const siteLabel = stream.site_name ?? stream.site_id ?? id ?? `Stream ${index + 1}`;

  return {
    source: stream,
    id,
    key: id ?? `${stream.site_id ?? 'stream'}-${stream.applied_seq ?? index}`,
    label: `${siteLabel} ${id ? `(${shortID(id)})` : ''}`.trim(),
    siteLabel,
    siteKind: stream.site_kind ?? 'site',
    groupId: stream.group_id ?? null,
    status,
    health,
    className: classifyStream(status, health, Boolean(stream.last_error), breachesRPO),
    appliedSeq: normalizeNumber(stream.applied_seq),
    sourceLsn: stream.source_lsn ?? null,
    appliedAt: stream.applied_at ?? null,
    measuredAt: stream.measured_at ?? null,
    lastError: stream.last_error ?? null,
    rpoSeconds,
    lagSeconds: normalizeNumber(stream.lag_seconds),
    rpoObjectiveSeconds,
    breachesRPO,
  };
}

function compareStreamRows(left: StreamRow, right: StreamRow) {
  const leftActive = classSortWeight(left.className);
  const rightActive = classSortWeight(right.className);
  if (leftActive !== rightActive) return leftActive - rightActive;
  const leftUpdated = timestampMs(left.source.updated_at ?? left.appliedAt ?? left.measuredAt);
  const rightUpdated = timestampMs(right.source.updated_at ?? right.appliedAt ?? right.measuredAt);
  return rightUpdated - leftUpdated;
}

function selectWorstRPORow(rows: StreamRow[]) {
  return rows
    .filter((row) => row.rpoSeconds !== null)
    .sort((left, right) => (right.rpoSeconds ?? 0) - (left.rpoSeconds ?? 0))[0] ?? null;
}

function findStreamById(rows: StreamRow[], id: string) {
  return rows.find((row) => row.id === id) ?? null;
}

function streamID(stream: DRReplicationActionStream) {
  const id = stream.id ?? stream.stream_id ?? null;
  return id && id.length > 0 ? id : null;
}

function classifyStream(status: string, health: string, hasError: boolean, breachesRPO: boolean): StreamClass {
  if (isPausedStatus(status) || isPausedStatus(health)) return 'paused';
  if (hasError || breachesRPO || isProblemStatus(status) || isProblemStatus(health)) return 'degraded';
  if (isHealthyStatus(status) || isHealthyStatus(health)) return 'healthy';
  return 'unknown';
}

function classSortWeight(streamClass: StreamClass) {
  if (streamClass === 'degraded') return 0;
  if (streamClass === 'paused') return 1;
  if (streamClass === 'unknown') return 2;
  return 3;
}

function classTone(streamClass: StreamClass): Tone {
  if (streamClass === 'healthy') return 'success';
  if (streamClass === 'degraded') return 'warning';
  if (streamClass === 'paused') return 'warning';
  return 'neutral';
}

function canResumeStream(row: StreamRow) {
  if (isResumableStatus(row.status) || isResumableStatus(row.health)) return true;
  if (isHealthyStatus(row.status) || isHealthyStatus(row.health)) return false;
  return ['stopped', 'halted', 'idle'].includes(row.status);
}

function pauseDisabledReason(row: StreamRow, loading: boolean, pausingStream: boolean, resumingStream: boolean, t: ReplicationActionLabels) {
  if (loading) return t.reasonRefreshing;
  if (pausingStream) return t.reasonPauseRunning;
  if (resumingStream) return t.reasonResumeRunning;
  if (!row.id) return t.reasonStreamIdUnavailable;
  if (isPausedStatus(row.status) || isPausedStatus(row.health)) return t.reasonAlreadyPaused;
  return t.reasonPauseUnavailable;
}

function resumeDisabledReason(row: StreamRow, loading: boolean, pausingStream: boolean, resumingStream: boolean, t: ReplicationActionLabels) {
  if (loading) return t.reasonRefreshing;
  if (pausingStream) return t.reasonPauseRunning;
  if (resumingStream) return t.reasonResumeRunning;
  if (!row.id) return t.reasonStreamIdUnavailable;
  if (!canResumeStream(row)) {
    if (isHealthyStatus(row.status) || isHealthyStatus(row.health)) return t.reasonStreamingCannotResume;
    return t.reasonNotPaused;
  }
  return t.reasonResumeUnavailable;
}

function isPausedStatus(status: string) {
  return ['paused', 'pausing', 'suspended'].includes(status);
}

function isResumableStatus(status: string) {
  return ['paused', 'suspended'].includes(status);
}

function isHealthyStatus(status: string) {
  return ['healthy', 'ready', 'running', 'streaming', 'active', 'ok'].includes(status);
}

function isProblemStatus(status: string) {
  return ['critical', 'degraded', 'failed', 'error', 'lagging', 'stalled', 'unhealthy', 'warning'].includes(status);
}

function formatFreshness(rows: StreamRow[], t: ReplicationActionLabels) {
  const newest = rows
    .map((row) => timestampMs(row.appliedAt ?? row.measuredAt))
    .filter((value) => value > 0)
    .sort((left, right) => right - left)[0];

  if (!newest) return t.noCheckpointTimestamps;
  return t.latestCheckpoint(formatDateTime(new Date(newest).toISOString()));
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

function formatSeconds(seconds?: number | null) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return 'n/a';
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder > 0 ? `${hours}h ${minuteRemainder}m` : `${hours}h`;
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatNumber(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return 'n/a';
  return new Intl.NumberFormat().format(value);
}

function shortID(value?: string | null) {
  if (!value) return 'n/a';
  if (value.length <= 14) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function normalizeNumber(value?: number | null) {
  return value === undefined || value === null || Number.isNaN(value) ? null : value;
}

function normalizeStatus(status?: string | null) {
  return (status ?? 'empty').toLowerCase().replace(/\s+/g, '_');
}

function labelFor(value: string, t: ReplicationActionLabels) {
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  return t.statusLabels[normalized] ?? value.replace(/_/g, ' ');
}

function timestampMs(value?: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatError(error: unknown, t: ReplicationActionLabels) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.length > 0) return error;
  return t.refreshError;
}
