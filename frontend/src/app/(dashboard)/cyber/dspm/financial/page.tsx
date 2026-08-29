'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { DollarSign, TrendingUp, AlertTriangle, BarChart3, PlayCircle, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { useAuth } from '@/hooks/use-auth';
import { apiGet, apiPost } from '@/lib/api';
import { parseApiError } from '@/lib/format';
import { API_ENDPOINTS } from '@/lib/constants';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { PortfolioRisk, FinancialImpact, FinancialRunResult } from '@/types/cyber';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const compactCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCurrency(value: number): string {
  return value >= 1_000_000
    ? compactCurrencyFormatter.format(value)
    : currencyFormatter.format(value);
}

function shortenAssetId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

function probabilityColor(probability: number): string {
  if (probability > 0.5) return 'text-status-error';
  if (probability > 0.2) return 'text-severity-high';
  return 'text-primary';
}

function probabilityBadgeVariant(probability: number): 'destructive' | 'default' | 'secondary' {
  if (probability > 0.5) return 'destructive';
  if (probability > 0.2) return 'default';
  return 'secondary';
}

export default function FinancialRiskQuantificationPage() {
  const t = useDspmLabels().financial;
  const {
    data: portfolioEnvelope,
    isLoading: portfolioLoading,
    isFetching: portfolioFetching,
    error: portfolioError,
    refetch: refetchPortfolio,
  } = useQuery({
    queryKey: ['dspm-financial-portfolio'],
    queryFn: () => apiGet<{ data: PortfolioRisk }>(API_ENDPOINTS.CYBER_DSPM_FINANCIAL_PORTFOLIO),
    staleTime: 120000,
  });

  const {
    data: topRisksEnvelope,
    isLoading: topRisksLoading,
    isFetching: topRisksFetching,
    error: topRisksError,
    refetch: refetchTopRisks,
  } = useQuery({
    queryKey: ['dspm-financial-top-risks'],
    queryFn: () => apiGet<{ data: FinancialImpact[] }>(API_ENDPOINTS.CYBER_DSPM_FINANCIAL_TOP_RISKS),
    staleTime: 120000,
  });

  const portfolio = portfolioEnvelope?.data;
  const topRisks = topRisksEnvelope?.data ?? [];
  const isLoading = portfolioLoading || topRisksLoading;
  const hasError = portfolioError || topRisksError;

  const kpis = useMemo<
    Array<{ label: string; value: string; icon: LucideIcon; tone: StatTone }>
  >(() => {
    if (!portfolio) return [];
    return [
      {
        label: t.kpiBreachCostExposure,
        value: formatCurrency(portfolio.total_breach_cost),
        icon: DollarSign,
        tone: 'rose',
      },
      {
        label: t.kpiAnnualExpectedLoss,
        value: formatCurrency(portfolio.total_expected_loss),
        icon: TrendingUp,
        tone: 'rose',
      },
      {
        label: t.kpiMaxSingleBreach,
        value: formatCurrency(portfolio.max_single_breach),
        icon: AlertTriangle,
        tone: 'rose',
      },
      {
        label: t.kpiAssetsAtRisk,
        value: portfolio.asset_count.toLocaleString(),
        icon: BarChart3,
        tone: 'sky',
      },
    ];
  }, [portfolio, t]);

  function handleRetry() {
    void refetchPortfolio();
    void refetchTopRisks();
  }

  // "Run Financial Analysis" triggers a REAL server-side recomputation via
  // POST /dspm/financial/run — it re-quantifies + upserts every asset's impact
  // row and records a run snapshot. On success we refetch the impact + top-risks
  // GET queries so the refreshed portfolio is shown. Gated on cyber:write.
  const { hasPermission } = useAuth();
  const canRun = hasPermission('cyber:write');
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const runMutation = useMutation({
    mutationFn: () => apiPost<{ data: FinancialRunResult }>(API_ENDPOINTS.CYBER_DSPM_FINANCIAL_RUN),
    onSuccess: (result) => {
      setLastRunAt(result.data.run.computed_at);
      void refetchPortfolio();
      void refetchTopRisks();
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const isRunning = runMutation.isPending || portfolioFetching || topRisksFetching;
  function runAnalysis() {
    if (!canRun || runMutation.isPending) return;
    runMutation.mutate();
  }

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            canRun ? (
              <div className="flex items-center gap-3">
                {lastRunAt && (
                  <span className="text-xs text-muted-foreground">
                    {t.lastComputed(format(new Date(lastRunAt), 'MMM d, yyyy HH:mm'))}
                  </span>
                )}
                <Button size="sm" onClick={runAnalysis} disabled={isRunning}>
                  <PlayCircle className="me-1.5 h-3.5 w-3.5" />
                  {isRunning ? t.runningAnalysis : t.runAnalysis}
                </Button>
              </div>
            ) : undefined
          }
        />

        {isLoading ? (
          <LoadingSkeleton variant="card" count={4} />
        ) : hasError ? (
          <ErrorState
            message={t.loadError}
            onRetry={handleRetry}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map((kpi) => (
                <StatCard
                  key={kpi.label}
                  label={kpi.label}
                  value={kpi.value}
                  icon={kpi.icon}
                  tone={kpi.tone}
                  className=""
                />
              ))}
            </div>

            <div className="rounded-xl border bg-card">
              <div className="border-b px-5 py-4">
                <h3 className="text-sm font-semibold">{t.topRisksTitle}</h3>
                <p className="text-xs text-muted-foreground">
                  {t.topRisksSubtitle}
                </p>
              </div>
              <div className="overflow-x-auto">
                {topRisks.length === 0 ? (
                  <EmptyState
                    size="compact"
                    icon={BarChart3}
                    title={t.noDataTitle}
                    description={t.noDataDescription}
                    action={
                      canRun
                        ? {
                            label: isRunning ? t.runningAnalysis : t.runAnalysis,
                            onClick: runAnalysis,
                          }
                        : undefined
                    }
                  />
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-5 py-3 text-start text-xs font-medium text-muted-foreground">
                          {t.colAsset}
                        </th>
                        <th className="px-5 py-3 text-end text-xs font-medium text-muted-foreground">
                          {t.colBreachCost}
                        </th>
                        <th className="px-5 py-3 text-end text-xs font-medium text-muted-foreground">
                          {t.colCostPerRecord()}
                        </th>
                        <th className="px-5 py-3 text-end text-xs font-medium text-muted-foreground">
                          {t.colRecords}
                        </th>
                        <th className="px-5 py-3 text-center text-xs font-medium text-muted-foreground">
                          {t.colBreachProbability}
                        </th>
                        <th className="px-5 py-3 text-end text-xs font-medium text-muted-foreground">
                          {t.colAnnualExpectedLoss}
                        </th>
                        <th className="px-5 py-3 text-start text-xs font-medium text-muted-foreground">
                          {t.colMethodology}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {topRisks.map((risk) => {
                        const prob = risk.breach_probability_annual;
                        const pctStr = `${(prob * 100).toFixed(1)}%`;
                        return (
                          <tr
                            key={risk.id}
                            className="transition-colors hover:bg-muted/30"
                          >
                            <td className="px-5 py-3 font-medium" title={risk.data_asset_id}>
                              {shortenAssetId(risk.data_asset_id)}
                            </td>
                            <td className="px-5 py-3 text-end tabular-nums">
                              {currencyFormatter.format(risk.estimated_breach_cost)}
                            </td>
                            <td className="px-5 py-3 text-end tabular-nums">
                              {currencyFormatter.format(risk.cost_per_record)}
                            </td>
                            <td className="px-5 py-3 text-end tabular-nums">
                              {risk.record_count.toLocaleString()}
                            </td>
                            <td className="px-5 py-3 text-center">
                              <Badge
                                variant={probabilityBadgeVariant(prob)}
                                className={probabilityColor(prob)}
                              >
                                {pctStr}
                              </Badge>
                            </td>
                            <td className="px-5 py-3 text-end tabular-nums font-medium">
                              {currencyFormatter.format(risk.annual_expected_loss)}
                            </td>
                            <td className="px-5 py-3">
                              <Badge variant="outline" className="text-xs capitalize">
                                {risk.methodology.replace(/_/g, ' ')}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
