'use client';

/**
 * HealthHistoryChart (Feature 6 — detail).
 *
 * Renders the recent reachability series from getHealthHistoryResult as a
 * compact sparkline (reachable → 1, unreachable → 0) plus an uptime summary and
 * a per-probe dot strip colored by recorded grade. Failed reads surface as
 * unavailable rather than empty. Read-only.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { TrendSparkline } from '@/components/shared/trend-sparkline';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import {
  getHealthHistoryResult,
  type HealthCheckRecord,
  type IntegrationHealthGrade,
} from '@/lib/lex/integrations';
import { useDetailOpsLabels, fillOpsToken } from '../_lib/detail-ops-labels';
import { formatRelative } from '../_lib/detail-ops-format';

interface HealthHistoryChartProps {
  endpointId: string;
  limit?: number;
}

const GRADE_DOT: Record<IntegrationHealthGrade, string> = {
  healthy: 'bg-primary',
  degraded: 'bg-warning-500',
  down: 'bg-destructive',
  unconfigured: 'bg-muted-foreground/40',
  disabled: 'bg-muted-foreground/40',
};

export function HealthHistoryChart({ endpointId, limit = 30 }: HealthHistoryChartProps) {
  const t = useDetailOpsLabels();
  const { locale, direction } = useLocaleOrDefault();
  const [selectedRecord, setSelectedRecord] = useState<HealthCheckRecord | null>(null);

  const q = useQuery({
    queryKey: ['lex-integration-health-history', endpointId, limit],
    queryFn: () => getHealthHistoryResult(endpointId, limit),
    enabled: Boolean(endpointId),
    staleTime: 30_000,
  });

  const records = useMemo(() => q.data?.records ?? [], [q.data]);
  const degraded = q.data?.degraded ?? false;

  // History arrives newest-first from the backend convention; chart oldest→newest.
  const ordered = useMemo<HealthCheckRecord[]>(() => [...records].reverse(), [records]);

  const series = useMemo(
    () =>
      ordered.map((r, i) => ({
        label: `#${i + 1}`,
        value: r.reachable ? 1 : 0,
      })),
    [ordered],
  );

  const uptimePct = useMemo(() => {
    if (records.length === 0) return 0;
    const up = records.filter((r) => r.reachable).length;
    return Math.round((up / records.length) * 100);
  }, [records]);

  const latest = records[0];

  return (
    <div className="space-y-3" dir={direction} lang={locale}>
      <p className="text-xs text-muted-foreground">{t.healthHistorySubtitle}</p>

      {q.isLoading ? (
        <LoadingSkeleton variant="chart" count={1} />
      ) : q.isError || degraded ? (
        <ErrorState
          variant="generic"
          title={t.healthHistoryTitle}
          message={t.opsError}
          onRetry={() => void q.refetch()}
        />
      ) : records.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={t.healthHistoryEmpty}
          description={t.healthHistorySubtitle}
          size="compact"
        />
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-semibold tabular-nums text-foreground">
              {fillOpsToken(t.healthHistoryUptime, 'pct', uptimePct)}
            </span>
            {latest ? (
              <span className="text-xs text-muted-foreground">
                {t.healthHistoryLatest}: {formatRelative(latest.checked_at, locale)}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setSelectedRecord(latest ?? null)}
            className="block w-full rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <TrendSparkline data={series} height={44} />
          </button>

          {/* Per-probe dot strip (oldest → newest), LTR for time direction. */}
          <div className="flex flex-wrap gap-1" dir="ltr">
            {ordered.map((r, i) => (
              <button
                type="button"
                key={`${r.checked_at}-${i}`}
                onClick={() => setSelectedRecord(r)}
                className={cn('h-2.5 w-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', GRADE_DOT[r.grade] ?? GRADE_DOT.degraded)}
                title={`${r.reachable ? t.healthHistoryUptime.replace('{pct}', '100') : ''} ${r.detail}`.trim()}
                aria-label={`${formatRelative(r.checked_at, locale)}: ${r.detail}`}
              />
            ))}
          </div>

          {selectedRecord ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" role="status">
              <span className="font-medium text-foreground">{formatRelative(selectedRecord.checked_at, locale)}</span>
              {selectedRecord.detail ? <span className="ms-2">{selectedRecord.detail}</span> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
