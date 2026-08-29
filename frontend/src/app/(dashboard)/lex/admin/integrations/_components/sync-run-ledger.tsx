'use client';

/**
 * SyncRunLedger — the recorded sync-run history for one endpoint.
 *
 * Reads GET /integrations/{id}/sync-runs and renders a `.table-premium` ledger,
 * newest first, with a bilingual mode + status badge per row and the
 * processed/created/updated/skipped/failed counts. Failed reads surface as a
 * retryable unavailable state, not as an empty ledger.
 */
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { StatusBadge } from '@/components/shared/status-badge';
import { RelativeTime } from '@/components/shared/relative-time';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { listSyncRunsResult, type SyncRun } from '@/lib/lex/integrations';
import { useIntegrationLabels } from '../_lib/use-integration-labels';
import { buildSyncStatusConfig } from '../_lib/integration-status-config';

interface SyncRunLedgerProps {
  endpointId: string;
}

export function SyncRunLedger({ endpointId }: SyncRunLedgerProps) {
  const t = useIntegrationLabels();
  const { direction } = useLocaleOrDefault();
  const syncStatusConfig = buildSyncStatusConfig(t);

  const q = useQuery({
    queryKey: ['lex-integration-sync-runs', endpointId],
    queryFn: () => listSyncRunsResult(endpointId, 50),
    enabled: Boolean(endpointId),
  });

  const runs = q.data?.runs ?? [];
  const degraded = q.data?.degraded ?? false;

  return (
    <SectionCard title={t.ledgerTitle} description={t.ledgerSubtitle}>
      {q.isLoading ? (
        <LoadingSkeleton variant="table-row" count={4} />
      ) : q.isError || degraded ? (
        <ErrorState
          variant="generic"
          title={t.loadErrorTitle}
          message={t.loadErrorBody}
          onRetry={() => void q.refetch()}
        />
      ) : runs.length === 0 ? (
        <EmptyState icon={History} title={t.ledgerEmpty} description={t.ledgerSubtitle} size="compact" />
      ) : (
        <div className="overflow-x-auto" dir={direction}>
          <table className="table-premium w-full text-sm">
            <thead>
              <tr>
                <th className="text-start">{t.ledgerColWhen}</th>
                <th className="text-start">{t.ledgerColMode}</th>
                <th className="text-start">{t.ledgerColStatus}</th>
                <th className="text-end">{t.ledgerColProcessed}</th>
                <th className="text-end">{t.ledgerColCreated}</th>
                <th className="text-end">{t.ledgerColUpdated}</th>
                <th className="text-end">{t.ledgerColSkipped}</th>
                <th className="text-end">{t.ledgerColFailed}</th>
                <th className="text-start">{t.ledgerColDetail}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run: SyncRun) => (
                <tr key={run.id}>
                  <td className="whitespace-nowrap">
                    <RelativeTime date={run.started_at} />
                  </td>
                  <td>{run.mode === 'full' ? t.modeFull : t.modeDelta}</td>
                  <td>
                    <StatusBadge status={run.status} config={syncStatusConfig} size="sm" />
                  </td>
                  <td className="text-end tabular-nums">{run.processed}</td>
                  <td className="text-end tabular-nums">{run.created}</td>
                  <td className="text-end tabular-nums">{run.updated}</td>
                  <td className="text-end tabular-nums">{run.skipped}</td>
                  <td className="text-end tabular-nums">
                    <span className={run.failed > 0 ? 'font-medium text-destructive' : undefined}>
                      {run.failed}
                    </span>
                  </td>
                  <td className="max-w-[18rem] truncate text-muted-foreground" title={run.error || run.detail}>
                    {run.error || run.detail || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
