'use client';

/**
 * Integration Sync + activity logs page — `/lex/admin/integrations/{id}/logs`.
 *
 * Reads the sync-run ledger (`listSyncRunsResult(id)`) into a `.table-premium`
 * and pairs it with a session-local connection-test timeline (`testConnection(id)` results).
 * A small KPI strip summarises the ledger (total runs / succeeded / partial /
 * failed / last run). Ledger read failures surface as unavailable instead of
 * zero-run history; the header endpoint lookup falls back to the raw id. Gated
 * on `lex:integration:read`; the test trigger additionally requires write
 * access.
 *
 * Mirrors the org-entities admin module: PermissionRedirect wrapper, PageHeader,
 * KpiCard strip, SectionCard sections, bilingual labels via resolveLocalized,
 * react-query, RTL via `dir`/`lang`.
 */
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  ListChecks,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock4,
  ScanSearch,
} from 'lucide-react';
import { format } from 'date-fns';
import { ar as arLocale, enUS } from 'date-fns/locale';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { KpiCard } from '@/components/shared/kpi-card';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexIntegrationsApi, type SyncMode } from '@/lib/lex/integrations';
import { integrationLabels } from '../../_labels';
import { kindMeta } from '../../_lib/integration-kinds';
import { useLogsLabels } from './_components/logs-labels';
import { SyncRunsTable } from './_components/sync-runs-table';
import { SyncPreviewDialog } from './_components/sync-preview-dialog';
import { ReconciliationPanel } from './_components/reconciliation-panel';
import { TestResultsTimeline, type TestResultEntry } from './_components/test-results-timeline';

const SYNC_RUNS_KEY = 'lex-integration-sync-runs';

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function IntegrationLogsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const lang = locale === 'ar' ? 'ar' : 'en';
  const shared = lang === 'ar' ? integrationLabels.ar : integrationLabels.en;
  const local = useLogsLabels(lang);
  const qc = useQueryClient();

  const canManage = hasPermission('lex:integration:manage') || hasPermission('lex:write');
  const canTest = canManage;
  const BackIcon = direction === 'rtl' ? ArrowRight : ArrowLeft;

  // Sync preview → confirm-and-run dialog (manage-gated).
  const [previewOpen, setPreviewOpen] = useState(false);
  // The real mode the confirm action runs; delta is the safe default.
  const syncMode: SyncMode = 'delta';
  const syncModeLabel = shared.modeDelta;

  // Endpoint header context (graceful: getIntegration throws → we fall back to id).
  const endpointQuery = useQuery({
    queryKey: ['lex-integration', id],
    queryFn: () => lexIntegrationsApi.getIntegration(id),
    enabled: Boolean(id),
    retry: false,
    staleTime: 60_000,
  });

  // Sync-run ledger: degraded=true means unavailable, not "no runs".
  const runsQuery = useQuery({
    queryKey: [SYNC_RUNS_KEY, id],
    queryFn: () => lexIntegrationsApi.listSyncRunsResult(id),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
  const runs = useMemo(() => runsQuery.data?.runs ?? [], [runsQuery.data]);
  const ledgerDegraded = runsQuery.isError || (runsQuery.data?.degraded ?? false);

  // Session-local connection-test receipts (backend keeps no test ledger).
  const [testEntries, setTestEntries] = useState<TestResultEntry[]>([]);
  const testMutation = useMutation({
    mutationFn: () => lexIntegrationsApi.testConnection(id),
    onSuccess: (result) => {
      setTestEntries((prev) => [{ id: `${Date.now()}-${prev.length}`, result, at: Date.now() }, ...prev]);
      showSuccess(shared.toastTestDone);
    },
    onError: showApiError,
  });

  const endpoint = endpointQuery.data;
  const meta = endpoint ? kindMeta(endpoint.kind) : null;
  const headerTitle = endpoint ? endpoint.name || resolveLocalized(meta!.name, locale) : id || local.pageTitle;

  const stats = useMemo(() => {
    let succeeded = 0;
    let partial = 0;
    let failed = 0;
    let lastRunAt = '';
    for (const run of runs) {
      if (run.status === 'succeeded') succeeded += 1;
      else if (run.status === 'partial') partial += 1;
      else failed += 1;
      if (!lastRunAt || run.started_at > lastRunAt) lastRunAt = run.started_at;
    }
    let lastRunLabel = local.kpiNever;
    if (lastRunAt) {
      const parsed = new Date(lastRunAt);
      lastRunLabel = Number.isNaN(parsed.getTime())
        ? lastRunAt
        : format(parsed, 'PP p', { locale: locale === 'ar' ? arLocale : enUS });
    }
    return { total: runs.length, succeeded, partial, failed, lastRunLabel };
  }, [runs, local.kpiNever, locale]);
  const successShare = percent(stats.succeeded, stats.total);
  const partialShare = percent(stats.partial, stats.total);
  const failedShare = percent(stats.failed, stats.total);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [SYNC_RUNS_KEY, id] });
  };

  return (
    <PermissionRedirect permission="lex:integration:read">
      <div dir={direction} lang={locale} className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 h-8 px-2 text-muted-foreground">
            <Link href={`/lex/admin/integrations/${id}`}>
              <BackIcon className="me-1.5 h-4 w-4" aria-hidden />
              {shared.backToList}
            </Link>
          </Button>

          <PageHeader
            eyebrow={local.pageEyebrow}
            title={headerTitle}
            description={local.pageSubtitle}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {canManage ? (
                  <Button variant="default" size="sm" onClick={() => setPreviewOpen(true)}>
                    <ScanSearch className="me-1.5 h-4 w-4" aria-hidden />
                    {local.previewOpen}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" onClick={refresh} disabled={runsQuery.isFetching}>
                  <RefreshCw className={`me-1.5 h-4 w-4 ${runsQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden />
                  {shared.refresh}
                </Button>
              </div>
            }
          />
        </div>

        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
          data-testid="integration-logs-kpi-grid"
        >
          <KpiCard
            appearance="operational"
            title={local.kpiRuns}
            value={stats.total}
            tone="teal"
            icon={ListChecks}
            loading={runsQuery.isLoading}
            isError={ledgerDegraded}
            detail={local.kpiRuns}
            detailValue={stats.total}
            href="#integration-sync-runs"
          />
          <KpiCard
            appearance="operational"
            title={local.kpiSucceeded}
            value={stats.succeeded}
            tone="emerald"
            icon={CheckCircle2}
            loading={runsQuery.isLoading}
            isError={ledgerDegraded}
            progress={successShare}
            progressLabel={local.kpiRuns}
            detail={local.kpiRuns}
            detailValue={`${successShare}%`}
            href="#integration-sync-runs"
          />
          <KpiCard
            appearance="operational"
            title={local.kpiPartial}
            value={stats.partial}
            tone="gold"
            icon={AlertTriangle}
            loading={runsQuery.isLoading}
            isError={ledgerDegraded}
            progress={partialShare}
            progressLabel={local.kpiRuns}
            detail={local.kpiRuns}
            detailValue={`${partialShare}%`}
            href="#integration-sync-runs"
          />
          <KpiCard
            appearance="operational"
            title={local.kpiFailed}
            value={stats.failed}
            tone="rose"
            icon={XCircle}
            loading={runsQuery.isLoading}
            isError={ledgerDegraded}
            progress={failedShare}
            progressLabel={local.kpiRuns}
            detail={local.kpiRuns}
            detailValue={`${failedShare}%`}
            href="#integration-sync-runs"
          />
          <KpiCard
            appearance="operational"
            title={local.kpiLastRun}
            value={stats.lastRunLabel}
            tone="slate"
            icon={Clock4}
            loading={runsQuery.isLoading}
            isError={ledgerDegraded}
            detail={local.kpiRuns}
            detailValue={stats.total}
            href="#integration-sync-runs"
          />
        </div>

        <div id="integration-sync-runs" className="scroll-mt-24">
          <SectionCard title={shared.ledgerTitle} description={shared.ledgerSubtitle}>
            <SyncRunsTable
              runs={runs}
              loading={runsQuery.isLoading}
              degraded={ledgerDegraded}
              onRetry={() => void runsQuery.refetch()}
              shared={shared}
              local={local}
            />
          </SectionCard>
        </div>

        <SectionCard title={local.reconTitle} description={local.reconSubtitle}>
          <ReconciliationPanel endpointId={id} enabled={Boolean(id)} local={local} />
        </SectionCard>

        <SectionCard title={local.testsTitle} description={local.testsSubtitle}>
          <TestResultsTimeline
            entries={testEntries}
            running={testMutation.isPending}
            canTest={canTest}
            onRunTest={() => testMutation.mutate()}
            local={local}
          />
        </SectionCard>

        {canManage ? (
          <SyncPreviewDialog
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            endpointId={id}
            mode={syncMode}
            ledgerQueryKey={[SYNC_RUNS_KEY, id]}
            dir={direction === 'rtl' ? 'rtl' : 'ltr'}
            lang={lang}
            local={local}
            modeLabel={syncModeLabel}
          />
        ) : null}
      </div>
    </PermissionRedirect>
  );
}
