'use client';

import { Activity, AlertTriangle, Radio, Timer } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type StatTone } from '@/components/shared/stat-card';
import { cn } from '@/lib/utils';
import type { DRReplicationSummary } from '@/types/clario-dr';
import {
  MetricCard,
  StatusBadge,
  formatDateTime,
  formatGeneratedAt,
  formatSeconds,
  formatStatusCounts,
  labelFor,
  toneFor,
} from './protect-shared';
import { useProtectStateLabels } from './protect-labels';

/**
 * Replication operations summary (extracted verbatim, behaviour-preserving, from
 * the original `dr/page.tsx` "replication" tab): KPI cards plus the read-only
 * replication-stream telemetry table. Stream pause/resume actions live in the
 * companion `DRReplicationActionsPanel`.
 */
export function ReplicationOperations({
  replication,
  error,
  onRetry,
}: {
  replication?: DRReplicationSummary;
  error: unknown;
  onRetry: () => void;
}) {
  const L = useProtectStateLabels();
  const streams = replication?.streams ?? [];
  if (error && !replication) {
    return <ErrorState message={L.replicationLoadError} onRetry={onRetry} />;
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title={L.metricTotalStreams}
          value={replication?.total_streams ?? streams.length}
          detail={formatStatusCounts(replication?.streams_by_status)}
          icon={Radio}
          tone="info"
          accent="sky"
        />
        <MetricCard
          title={L.metricWorstRpo}
          value={formatSeconds(replication?.worst_live_rpo?.rpo_seconds)}
          detail={replication?.worst_live_rpo?.site_name ?? replication?.worst_live_rpo?.stream_id ?? L.worstRpoNoStream}
          icon={Timer}
          tone={replication?.worst_live_rpo?.breaches_rpo ? 'warning' : 'success'}
          accent={replication?.worst_live_rpo?.breaches_rpo ? 'rose' : 'gold'}
        />
        <MetricCard
          title={L.metricRpoBreaches}
          value={replication?.rpo_breaches?.length ?? 0}
          detail={L.rpoBreachesDetail}
          icon={AlertTriangle}
          tone={(replication?.rpo_breaches?.length ?? 0) > 0 ? 'warning' : 'success'}
          accent={(replication?.rpo_breaches?.length ?? 0) > 0 ? 'rose' : 'sky'}
        />
        <MetricCard
          title={L.metricOverallHealth}
          value={labelFor(replication?.overall_health ?? 'empty')}
          detail={formatGeneratedAt(replication?.generated_at)}
          icon={Activity}
          tone={toneFor(replication?.overall_health ?? 'empty')}
          accent={healthAccent(replication?.overall_health)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L.streamsTitle}</CardTitle>
          <CardDescription>{L.streamsSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{L.colSite}</TableHead>
                  <TableHead>{L.colStream}</TableHead>
                  <TableHead>{L.colStatus}</TableHead>
                  <TableHead>{L.colLiveRpo}</TableHead>
                  <TableHead>{L.colLag}</TableHead>
                  <TableHead>{L.colCheckpoint}</TableHead>
                  <TableHead>{L.colError}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {streams.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0">
                      <EmptyState
                        icon={Radio}
                        title={L.noStreamsTitle}
                        description={L.noStreamsDescription}
                        size="compact"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  streams.map((stream) => (
                    <TableRow key={stream.stream_id ?? stream.site_id ?? `${stream.status}-${stream.applied_seq}`}>
                      <TableCell>
                        <div className="font-medium">{stream.site_name ?? stream.site_id}</div>
                        <div className="text-xs capitalize text-muted-foreground">{stream.site_kind ?? 'site'}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{stream.stream_id ?? '-'}</TableCell>
                      <TableCell>
                        <StatusBadge status={stream.health ?? stream.status ?? 'empty'} />
                      </TableCell>
                      <TableCell>
                        <div className={cn('font-medium', stream.breaches_rpo && 'text-warning-700 dark:text-warning-300')}>
                          {formatSeconds(stream.rpo_seconds)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {L.targetPrefix} {formatSeconds(stream.rpo_objective_seconds)}
                        </div>
                      </TableCell>
                      <TableCell>{formatSeconds(stream.lag_seconds)}</TableCell>
                      <TableCell>
                        <div className="text-sm">{formatDateTime(stream.applied_at)}</div>
                        <div className="font-mono text-xs text-muted-foreground">{L.seqPrefix} {stream.applied_seq ?? '-'}</div>
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                        {stream.last_error ?? '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Map a RAG `overall_health` string onto a semantic stat accent, reusing the
 * existing `toneFor` classification so the orb tint and the icon tone agree:
 * healthy -> emerald (health), warning/degraded/paused -> gold, critical/error
 * /failed -> rose (risk), and everything else falls back to sky (count).
 */
function healthAccent(health?: string | null): StatTone {
  switch (toneFor(health ?? 'empty')) {
    case 'success':
      return 'emerald';
    case 'warning':
      return 'gold';
    case 'critical':
      return 'rose';
    default:
      return 'sky';
  }
}
