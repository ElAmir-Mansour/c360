'use client';

/**
 * admin/integrations — Integration Platform console (list / grouped-by-kind).
 *
 * Surfaces the tenant's external connector registry grouped by kind, with a
 * header KPI strip counting endpoints per health grade, per-kind rollup health
 * dots, last-checked relative time, a per-connector uptime SPARKLINE (Feature 6),
 * a Test quick-action that summarizes its diagnostic steps (Feature 2), and a
 * bulk-actions toolbar (Test all / Enable / Disable selected — bonus). Empty
 * kinds render an "+ Configure" CTA. Registry reads keep an explicit degraded
 * flag so a failed request is not confused with a genuinely empty tenant.
 *
 * Gated on `lex:integration:read`; the write affordances (New / Configure / per-row
 * Test) and the bulk Enable/Disable MANAGE actions all require the real
 * `lex:integration:manage` verb. There is NO `lex:integration:write` slug in the
 * backend — the connector routes gate lex:integration:read / :manage (with coarse
 * lex:read / lex:write as RequireAnyPermission fallbacks), so gating the CTAs on
 * the phantom slug only worked by accident via the checkPermission implication.
 */
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Loader2,
  Plug,
  PlugZap,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  X,
} from 'lucide-react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess, showWarning } from '@/lib/toast';
import {
  lexIntegrationsApi,
  type HealthCheckRecord,
  type IntegrationEndpoint,
  type TestResult,
} from '@/lib/lex/integrations';
import { groupByKind, indexHealth, tallyGrades } from './_lib/health-presentation';
import { integrationsLabels } from './_lib/integrations-i18n';
import { useObservabilityLabels } from './_lib/observability-labels';
import { HealthKpiStrip } from './_components/health-kpi-strip';
import { IntegrationKindCard } from './_components/integration-kind-card';

const REGISTRY_KEY = ['lex-admin-integrations'] as const;
const HEALTH_KEY = ['lex-admin-integrations', 'health'] as const;
const HISTORY_KEY = (id: string) => ['lex-admin-integrations', 'health-history', id] as const;

const BASE = '/lex/admin/integrations';
const endpointHref = (id: string) => `${BASE}/${id}`;
const configureHref = (kind: string) => `${BASE}/new?kind=${kind}`;
// Kind-agnostic entry point: /new (no ?kind) renders the connector catalog
// gallery, then routes the picked kind to its configure/setup step.
const newIntegrationHref = `${BASE}/new`;

type BulkAction = 'test' | 'enable' | 'disable';

export default function IntegrationsPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocaleOrDefault();
  const t = integrationsLabels(locale);
  const obs = useObservabilityLabels();
  const qc = useQueryClient();
  // Write CTAs gate on the REAL backend verb lex:integration:manage (there is no
  // lex:integration:write slug). The connector Create/Test/Sync routes gate the
  // manage tier, so this keeps the config-only System Administrator (holds
  // lex:integration:manage) and admin/`*` roles authorized while no longer relying
  // on a phantom slug that only resolved via the checkPermission implication.
  const canWrite = hasPermission('lex:integration:manage');
  const canManage = hasPermission('lex:integration:manage');

  const [testingId, setTestingId] = useState<string | null>(null);
  // Last connection-test outcome per endpoint id (Feature 2 step summary).
  const [testResults, setTestResults] = useState<Map<string, TestResult>>(new Map());
  // Bulk selection set + the action currently running (bonus toolbar).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<BulkAction | null>(null);

  const registryQuery = useQuery({
    queryKey: REGISTRY_KEY,
    // Never throws; degraded=true means the registry could not be read.
    queryFn: () => lexIntegrationsApi.listIntegrationsResult(),
  });

  const healthQuery = useQuery({
    queryKey: HEALTH_KEY,
    // Never throws; aggregate health can be unavailable while registry actions remain usable.
    queryFn: () => lexIntegrationsApi.getIntegrationsHealthResult(),
  });

  const endpoints = useMemo<IntegrationEndpoint[]>(() => registryQuery.data?.endpoints ?? [], [registryQuery.data]);
  const registryDegraded = registryQuery.data?.degraded ?? false;
  const healthDegraded = healthQuery.data?.degraded ?? false;
  const health = useMemo(() => indexHealth(healthQuery.data?.health ?? []), [healthQuery.data]);
  const groups = useMemo(() => groupByKind(endpoints), [endpoints]);
  const counts = useMemo(() => tallyGrades(endpoints, health), [endpoints, health]);

  // Per-endpoint health-history (Feature 6 sparkline). One query per endpoint so
  // the React-query cache de-dupes + the Test mutation can invalidate just one.
  // degraded=true means unavailable, not "no health history".
  const historyQueries = useQueries({
    queries: endpoints.map((ep) => ({
      queryKey: HISTORY_KEY(ep.id),
      queryFn: () => lexIntegrationsApi.getHealthHistoryResult(ep.id, 30),
      // Health history is slow-moving; don't refetch on every focus.
      staleTime: 60_000,
    })),
  });

  const historyById = useMemo(() => {
    const m = new Map<string, HealthCheckRecord[]>();
    endpoints.forEach((ep, i) => {
      m.set(ep.id, historyQueries[i]?.data?.records ?? []);
    });
    return m;
  }, [endpoints, historyQueries]);
  const historyDegradedById = useMemo(() => {
    const m = new Map<string, boolean>();
    endpoints.forEach((ep, i) => {
      const query = historyQueries[i];
      m.set(ep.id, Boolean(query?.isError || query?.data?.degraded));
    });
    return m;
  }, [endpoints, historyQueries]);

  const historyLoading = historyQueries.some((q) => q.isLoading);

  const refreshing = registryQuery.isFetching || healthQuery.isFetching || historyQueries.some((q) => q.isFetching);

  const refresh = useCallback(() => {
    registryQuery.refetch();
    healthQuery.refetch();
    qc.invalidateQueries({ queryKey: ['lex-admin-integrations', 'health-history'] });
  }, [qc, registryQuery, healthQuery]);

  /* ------------------------------------------------------------------ *
   * Selection helpers (bonus bulk toolbar).
   * ------------------------------------------------------------------ */
  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleMany = useCallback((ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectedEndpoints = useMemo(() => endpoints.filter((ep) => selectedIds.has(ep.id)), [endpoints, selectedIds]);

  /* ------------------------------------------------------------------ *
   * Per-row Test quick-action (Feature 2 — records steps for the summary).
   * ------------------------------------------------------------------ */
  const recordResult = useCallback((id: string, result: TestResult) => {
    setTestResults((prev) => {
      const next = new Map(prev);
      next.set(id, result);
      return next;
    });
  }, []);

  const testMutation = useMutation({
    mutationFn: (endpoint: IntegrationEndpoint) => lexIntegrationsApi.testConnection(endpoint.id),
    onMutate: (endpoint) => setTestingId(endpoint.id),
    onSuccess: async (result, endpoint) => {
      recordResult(endpoint.id, result);
      if (result.reachable) {
        showSuccess(t.toastReachable, result.detail || undefined);
      } else {
        showWarning(t.toastUnreachable, result.detail || undefined);
      }
      // A probe updates last_checked_at / grade — refresh aggregate + history.
      await Promise.all([
        qc.invalidateQueries({ queryKey: HEALTH_KEY }),
        qc.invalidateQueries({ queryKey: REGISTRY_KEY }),
        qc.invalidateQueries({ queryKey: HISTORY_KEY(endpoint.id) }),
      ]);
    },
    onError: showApiError,
    onSettled: () => setTestingId(null),
  });

  /* ------------------------------------------------------------------ *
   * Bulk actions (bonus). Test = write; Enable/Disable = manage. Each runs
   * the per-endpoint call sequentially over the selection and reports a
   * partial-success toast, then refreshes the affected queries.
   * ------------------------------------------------------------------ */
  const runBulk = useCallback(
    async (action: BulkAction) => {
      const targets = selectedEndpoints;
      if (targets.length === 0) return;
      if (action !== 'test' && !canManage) {
        showWarning(t.bulkManageDenied);
        return;
      }
      setBulkBusy(action);
      let ok = 0;
      try {
        for (const ep of targets) {
          try {
            if (action === 'test') {
              const result = await lexIntegrationsApi.testConnection(ep.id);
              recordResult(ep.id, result);
              if (result.reachable) ok += 1;
            } else {
              await lexIntegrationsApi.updateIntegration(ep.id, {
                status: action === 'enable' ? 'active' : 'disabled',
              });
              ok += 1;
            }
          } catch {
            // Per-target failure is tolerated; summarized below.
          }
        }

        const total = targets.length;
        if (action === 'test') {
          if (ok === total) showSuccess(t.bulkTestDone(ok, total));
          else showWarning(t.bulkPartial(ok, total));
        } else if (action === 'enable') {
          if (ok === total) showSuccess(t.bulkEnableDone(ok));
          else showWarning(t.bulkPartial(ok, total));
        } else {
          if (ok === total) showSuccess(t.bulkDisableDone(ok));
          else showWarning(t.bulkPartial(ok, total));
        }

        await Promise.all([
          qc.invalidateQueries({ queryKey: REGISTRY_KEY }),
          qc.invalidateQueries({ queryKey: HEALTH_KEY }),
          qc.invalidateQueries({
            queryKey: ['lex-admin-integrations', 'health-history'],
          }),
        ]);
        clearSelection();
      } catch (err) {
        showApiError(err);
      } finally {
        setBulkBusy(null);
      }
    },
    [selectedEndpoints, canManage, t, recordResult, qc, clearSelection],
  );

  const isInitialLoading = registryQuery.isLoading;
  const hasError = registryQuery.isError || registryDegraded;
  const isEmpty = !isInitialLoading && !hasError && endpoints.length === 0;

  const selectable = canWrite || canManage;
  const selectedCount = selectedIds.size;
  const bulkBusyActive = bulkBusy !== null;

  return (
    <PermissionRedirect permission="lex:integration:read">
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          eyebrow={t.eyebrow}
          title={t.pageTitle}
          description={t.pageDescription}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canWrite ? (
                <Button asChild size="sm">
                  <Link href={newIntegrationHref}>
                    <Plus className="me-1.5 h-4 w-4" aria-hidden />
                    {t.newIntegration}
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline" size="sm">
                <Link href={`${BASE}/observability`}>
                  <Activity className="me-1.5 h-4 w-4" aria-hidden />
                  {obs.obsTab}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`${BASE}/events`}>
                  <Inbox className="me-1.5 h-4 w-4" aria-hidden />
                  {obs.eventsTab}
                </Link>
              </Button>
              <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
                <RefreshCw className={`me-1.5 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
                {t.refresh}
              </Button>
            </div>
          }
        />

        {!canWrite ? <p className="text-xs text-muted-foreground">{t.readOnlyNote}</p> : null}

        {/* KPI strip — always show (even at zero) so the grade legend is visible. */}
        <HealthKpiStrip counts={counts} labels={t} loading={isInitialLoading} />

        {/* Bulk-actions toolbar (bonus) — appears once a connector is selected. */}
        {selectable && selectedCount > 0 ? (
          <div
            className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-card px-4 py-2.5 shadow-lg"
            role="region"
            aria-label={t.bulkSelected(selectedCount)}
            data-testid="bulk-actions-toolbar"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              {t.bulkSelected(selectedCount)}
            </span>

            <div className="ms-auto flex flex-wrap items-center gap-2">
              {canWrite ? (
                <Button variant="outline" size="sm" disabled={bulkBusyActive} onClick={() => runBulk('test')}>
                  {bulkBusy === 'test' ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <PlugZap className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {bulkBusy === 'test' ? t.bulkTesting : t.bulkTestAll}
                </Button>
              ) : null}

              {canManage ? (
                <>
                  <Button variant="outline" size="sm" disabled={bulkBusyActive} onClick={() => runBulk('enable')}>
                    {bulkBusy === 'enable' ? (
                      <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Power className="me-1.5 h-3.5 w-3.5" aria-hidden />
                    )}
                    {bulkBusy === 'enable' ? t.bulkEnabling : t.bulkEnable}
                  </Button>
                  <Button variant="outline" size="sm" disabled={bulkBusyActive} onClick={() => runBulk('disable')}>
                    {bulkBusy === 'disable' ? (
                      <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <PowerOff className="me-1.5 h-3.5 w-3.5" aria-hidden />
                    )}
                    {bulkBusy === 'disable' ? t.bulkDisabling : t.bulkDisable}
                  </Button>
                </>
              ) : null}

              <Button variant="ghost" size="sm" disabled={bulkBusyActive} onClick={clearSelection} title={t.bulkClear}>
                <X className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {t.bulkClear}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Hard registry error */}
        {hasError ? (
          <Alert variant="destructive">
            <AlertTitle>{t.errorTitle}</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{t.errorBody}</p>
              <Button variant="outline" size="sm" onClick={() => registryQuery.refetch()}>
                <RefreshCw className="me-1.5 h-4 w-4" aria-hidden />
                {t.refresh}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {healthDegraded && !hasError ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t.healthUnavailableTitle}</AlertTitle>
            <AlertDescription>{t.healthUnavailableBody}</AlertDescription>
          </Alert>
        ) : null}

        {/* Loading */}
        {isInitialLoading ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <LoadingSkeleton variant="card" count={6} />
          </div>
        ) : null}

        {/* Empty registry — still show the kind grid below so each kind offers a CTA. */}
        {isEmpty ? (
          <EmptyState
            icon={Plug}
            title={t.emptyTitle}
            description={t.emptyBody}
            action={canWrite ? { label: t.emptyCta, href: configureHref('najiz') } : undefined}
          />
        ) : null}

        {/* Grouped-by-kind cards (rendered whenever the registry loaded, even at zero
            so each kind exposes a "+ Configure" affordance). */}
        {!isInitialLoading && !hasError ? (
          <div id="integration-registry" className="scroll-mt-24 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <IntegrationKindCard
                key={group.kind}
                kind={group.kind}
                endpoints={group.endpoints}
                health={health}
                locale={locale}
                direction={direction}
                labels={t}
                canWrite={canWrite}
                endpointHref={endpointHref}
                configureHref={configureHref(group.kind)}
                testingId={testingId}
                onTest={(ep) => testMutation.mutate(ep)}
                historyById={historyById}
                historyLoading={historyLoading}
                historyDegradedById={historyDegradedById}
                lastTestById={testResults}
                selectable={selectable}
                selectedIds={selectedIds}
                onSelectChange={toggleOne}
                onSelectKind={toggleMany}
              />
            ))}
          </div>
        ) : null}
      </div>
    </PermissionRedirect>
  );
}
