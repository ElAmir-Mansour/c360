'use client';

import { AlertTriangle, Clock3, Database, Rows3, HardDrive, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { type DataSource, type SourceStats, type SyncHistory } from '@/lib/data-suite';
import {
  formatMaybeBytes,
  formatMaybeCompact,
  formatMaybeDateTime,
  formatMaybeDurationMs,
  getSourceTypeVisual,
} from '@/lib/data-suite/utils';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface SourceOverviewTabProps {
  source: DataSource;
  stats: SourceStats | null;
  syncHistory: SyncHistory[];
}

export function SourceOverviewTab({
  source,
  stats,
  syncHistory,
}: SourceOverviewTabProps) {
  const labels = useDataLabels();
  const typeVisual = getSourceTypeVisual(source.type);
  const latestSync = syncHistory[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
        {/* Table/row/size counts are quantities -> sky; last sync is time -> gold. */}
        <DetailStatCard label={labels.sources.colTables} value={formatMaybeCompact(stats?.table_count ?? source.table_count)} tone="sky" icon={Database} />
        <DetailStatCard label={labels.sources.colRows} value={formatMaybeCompact(stats?.total_row_count ?? source.total_row_count)} tone="sky" icon={Rows3} />
        <DetailStatCard label={labels.sources.colSize} value={formatMaybeBytes(stats?.total_size_bytes ?? source.total_size_bytes)} tone="sky" icon={HardDrive} />
        <DetailStatCard label={labels.sourcesDetail.lastSyncLabel} value={formatMaybeDateTime(stats?.last_synced_at ?? source.last_synced_at)} tone="gold" icon={Clock3} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>{labels.sourcesDetail.propsTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <PropertyRow label={labels.common.type} value={typeVisual.label} />
            <PropertyRow label={labels.common.status} value={source.status} />
            <PropertyRow label={labels.sourcesDetail.pSyncFrequency} value={source.sync_frequency ?? labels.sources.freqManual} />
            <PropertyRow label={labels.sourcesDetail.pSchemaDiscovered} value={formatMaybeDateTime(source.schema_discovered_at)} />
            <PropertyRow label={labels.sourcesDetail.pCreated} value={formatMaybeDateTime(source.created_at)} />
            <PropertyRow label={labels.sourcesDetail.pUpdated} value={formatMaybeDateTime(source.updated_at)} />
            <PropertyRow
              label={labels.sources.tags}
              value={source.tags.length > 0 ? source.tags.join(', ') : '—'}
              className="md:col-span-2"
            />
            <PropertyRow
              label={labels.common.description}
              value={source.description || labels.sources.noDescription}
              className="md:col-span-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{labels.sourcesDetail.healthTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="text-sm">
                {source.status === 'active' ? labels.sourcesDetail.connValidated : labels.sourcesDetail.currentStatus(source.status)}
              </span>
            </div>
            {source.last_error || source.last_sync_error ? (
              <Alert className="border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30">
                <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                <AlertTitle className="text-rose-700 dark:text-rose-300">{labels.sourcesDetail.latestErrorTitle}</AlertTitle>
                <AlertDescription className="text-rose-700 dark:text-rose-300">
                  {source.last_error || source.last_sync_error}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-primary/30 bg-primary/10">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <AlertTitle className="text-primary">{labels.sourcesDetail.noErrorsTitle}</AlertTitle>
                <AlertDescription className="text-primary">
                  {labels.sourcesDetail.noErrorsDesc}
                </AlertDescription>
              </Alert>
            )}
            {latestSync ? (
              <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                <div className="font-medium">{labels.sourcesDetail.latestSyncTitle}</div>
                <div className="mt-2 grid gap-2 text-muted-foreground">
                  <span>{labels.sourcesDetail.statusLine(latestSync.status)}</span>
                  <span>{labels.sourcesDetail.rowsWrittenLine(formatMaybeCompact(latestSync.rows_written))}</span>
                  <span>{labels.sourcesDetail.durationLine(formatMaybeDurationMs(latestSync.duration_ms))}</span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{labels.sourcesDetail.syncHistoryTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {syncHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.sourcesDetail.noSyncHistory}</p>
          ) : (
            syncHistory.slice(0, 10).map((sync) => (
              <div key={sync.id} className="rounded-lg border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{sync.sync_type}</Badge>
                    <Badge variant="outline" className="capitalize">
                      {sync.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatMaybeDateTime(sync.completed_at ?? sync.started_at)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span>{labels.sourcesDetail.rowsReadCount(formatMaybeCompact(sync.rows_read))}</span>
                  <span>{labels.sourcesDetail.rowsWrittenCount(formatMaybeCompact(sync.rows_written))}</span>
                  <span>{labels.sourcesDetail.tablesCount(String(sync.tables_synced))}</span>
                  <span>{formatMaybeDurationMs(sync.duration_ms)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PropertyRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
