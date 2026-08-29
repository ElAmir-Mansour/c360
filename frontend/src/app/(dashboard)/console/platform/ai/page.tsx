'use client';

import { useMemo, useState } from 'react';
import { RefreshCw, BrainCircuit } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/shared/forms/search-input';
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { useFleetAiModels, type FleetAiParams } from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';
import type { FleetAiModelSlug } from '@/types/platform';
import { AiKpiRow } from './_components/ai-kpi-row';
import { SuiteBreakdown } from './_components/suite-breakdown';
import { TenantDriftTable } from './_components/tenant-drift-table';
import { FleetModelsTable } from './_components/fleet-models-table';
import { ModelDrilldownPanel } from './_components/model-drilldown-panel';

/**
 * Platform Console — AI Governance (fleet view), §E.5 #8 / gap G23.
 *
 * Extends the single-tenant `/admin/ai-governance` to a cross-tenant rollup:
 *   • KPI row: total tenants/models, in-production, shadow, drift alerts.
 *   • Suite / drift / risk-tier filters wired to the G23 query params.
 *   • By-suite breakdown (derived client-side from the per-slug rollup).
 *   • Per-tenant drift health table.
 *   • Per-model-slug drill-down (`/fleet/models/{slug}`) in a side panel.
 *
 * The whole /platform area is already gated on `admin:console` by the layout, but
 * this page wraps its own <PermissionRedirect> too so it is self-sufficient
 * (task contract). All reads go through useFleetAiModels (G23); until that gap is
 * built the query errors and the screen renders ErrorState (detectVariant
 * classifies 401/403 → permission). No mocks.
 */

const DRIFT_OPTIONS = ['healthy', 'warning', 'critical'] as const;
const RISK_TIER_OPTIONS = ['low', 'medium', 'high', 'critical'] as const;

export default function PlatformAiPage() {
  const t = useT();

  const [search, setSearch] = useState('');
  const [suite, setSuite] = useState<string[]>([]);
  const [drift, setDrift] = useState<string[]>([]);
  const [riskTier, setRiskTier] = useState<string[]>([]);
  const [selected, setSelected] = useState<FleetAiModelSlug | null>(null);

  // Server-side filters (G23 accepts single-valued suite/drift/risk_tier). We send
  // the first selected value; client-side search + multi-suite refinement happens
  // below so the UI stays responsive even before the gap supports arrays.
  const params = useMemo<FleetAiParams>(
    () => ({
      suite: suite.length === 1 ? suite[0] : undefined,
      drift: drift.length === 1 ? drift[0] : undefined,
      risk_tier: riskTier.length === 1 ? riskTier[0] : undefined,
    }),
    [suite, drift, riskTier],
  );

  const { data, isLoading, error, refetch, isFetching } = useFleetAiModels(params);

  const summary = data?.summary;
  const allTenants = useMemo(() => data?.tenants ?? [], [data]);
  const allModels = useMemo(() => data?.models ?? [], [data]);

  // Client-side refinement layered on top of the server query: free-text search
  // across model name/slug/suite, and multi-select suite/drift/risk-tier that the
  // single-valued endpoint can't express.
  const term = search.trim().toLowerCase();
  const models = useMemo(() => {
    return allModels.filter((m) => {
      if (suite.length && !suite.includes(m.suite ?? 'unassigned')) return false;
      if (riskTier.length && !(m.risk_tier && riskTier.includes(m.risk_tier))) return false;
      if (term) {
        const hay = `${m.display_name} ${m.slug} ${m.suite ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [allModels, suite, riskTier, term]);

  const tenants = useMemo(() => {
    return allTenants.filter((r) => {
      if (drift.length && !drift.includes(r.drift_health)) return false;
      if (term && !r.tenant_name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [allTenants, drift, term]);

  const hasFilters =
    Boolean(search) || suite.length > 0 || drift.length > 0 || riskTier.length > 0;
  const isEmpty =
    !isLoading && !error && allTenants.length === 0 && allModels.length === 0;
  const isFilteredEmpty =
    !isLoading && !error && !isEmpty && tenants.length === 0 && models.length === 0;

  // Suite options are derived from the data so the filter only offers real suites.
  const suiteOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of allModels) set.add(m.suite || 'unassigned');
    return Array.from(set)
      .sort()
      .map((value) => ({
        value,
        label: value === 'unassigned' ? t('platformConsole.ai.unassigned') : value,
      }));
  }, [allModels, t]);

  const driftOptions = DRIFT_OPTIONS.map((value) => ({
    value,
    label: t(`platformConsole.ai.health.${value}` as const),
  }));
  const riskTierOptions = RISK_TIER_OPTIONS.map((value) => ({
    value,
    label: t(`platformConsole.ai.risk.${value}` as const),
  }));

  const clearFilters = () => {
    setSearch('');
    setSuite([]);
    setDrift([]);
    setRiskTier([]);
  };

  const lastUpdated = data?.generated_at
    ? new Date(data.generated_at).toLocaleTimeString()
    : null;

  return (
    <PermissionRedirect permission="admin:console">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t('platformConsole.eyebrow')}
          title={t('platformConsole.ai.title')}
          description={t('platformConsole.ai.subtitle')}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label={t('platformConsole.refresh')}
            >
              <RefreshCw
                className={`me-1.5 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
                aria-hidden
              />
              {t('platformConsole.refresh')}
            </Button>
          }
        />

        {/* Live region: announces fetch state + freshness to assistive tech. */}
        <p className="sr-only" role="status" aria-live="polite">
          {isFetching
            ? t('platformConsole.ai.refreshing')
            : lastUpdated
              ? `${t('platformConsole.lastUpdated')}: ${lastUpdated}`
              : ''}
        </p>

        {error ? (
          <ErrorState
            variant={detectVariant(error)}
            error={error}
            message={error.message}
            onRetry={() => refetch()}
          />
        ) : isEmpty ? (
          <EmptyState
            icon={BrainCircuit}
            title={t('platformConsole.ai.emptyTitle')}
            description={t('platformConsole.ai.emptyDescription')}
          />
        ) : (
          <>
            <AiKpiRow summary={summary} loading={isLoading} />

            {/* Filters: free-text + suite / drift-health / risk-tier multi-select. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="sm:max-w-xs sm:flex-1">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder={t('platformConsole.ai.searchPlaceholder')}
                  loading={isLoading}
                />
              </div>
              <div className="w-full sm:w-44">
                <MultiSelect
                  options={suiteOptions}
                  selected={suite}
                  onChange={setSuite}
                  placeholder={t('platformConsole.ai.suite')}
                />
              </div>
              <div className="w-full sm:w-44">
                <MultiSelect
                  options={driftOptions}
                  selected={drift}
                  onChange={setDrift}
                  placeholder={t('platformConsole.ai.driftHealth')}
                />
              </div>
              <div className="w-full sm:w-44">
                <MultiSelect
                  options={riskTierOptions}
                  selected={riskTier}
                  onChange={setRiskTier}
                  placeholder={t('platformConsole.ai.riskTier')}
                />
              </div>
              {hasFilters ? (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  {t('platformConsole.ai.clearFilters')}
                </Button>
              ) : null}
            </div>

            {isFilteredEmpty ? (
              <EmptyState
                icon={BrainCircuit}
                title={t('platformConsole.ai.noMatchesTitle')}
                description={t('platformConsole.ai.noMatchesDescription')}
                action={{
                  label: t('platformConsole.ai.clearFilters'),
                  onClick: clearFilters,
                }}
              />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                  <div className="xl:col-span-1">
                    <SuiteBreakdown models={models} loading={isLoading} />
                  </div>
                  <div className="space-y-3 xl:col-span-2">
                    <h2 className="text-sm font-semibold uppercase tracking-caps-wide text-muted-foreground">
                      {t('platformConsole.ai.driftHealthTitle')}
                    </h2>
                    <TenantDriftTable rows={tenants} loading={isLoading} />
                  </div>
                </div>

                <div className="space-y-3">
                  <h2 className="text-sm font-semibold uppercase tracking-caps-wide text-muted-foreground">
                    {t('platformConsole.ai.modelsTitle')}
                  </h2>
                  <FleetModelsTable
                    models={models}
                    loading={isLoading}
                    onSelect={setSelected}
                  />
                </div>
              </>
            )}
          </>
        )}

        <ModelDrilldownPanel
          slug={selected?.slug ?? null}
          displayName={selected?.display_name}
          onClose={() => setSelected(null)}
        />
      </div>
    </PermissionRedirect>
  );
}
