'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Brain,
  AlertTriangle,
  ShieldAlert,
  Shield,
  Lock,
  CheckCircle2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { AISecurityDashboard, AIDataUsage } from '@/types/cyber';
import { useDspmLabels } from '../_lib/dspm-i18n';

// Severity ramp via tokens: a faint tint of the severity color + the same ink,
// preserving the 5-level distinction while re-theming in dark mode.
const RISK_COLORS: Record<string, string> = {
  critical: 'bg-severity-critical/10 text-severity-critical',
  high: 'bg-severity-high/10 text-severity-high',
  medium: 'bg-severity-medium/10 text-warning-700 dark:text-warning-300',
  low: 'bg-severity-info/10 text-severity-info',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-primary/15 text-primary',
  inactive: 'bg-secondary text-foreground/70',
  blocked: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  under_review: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
};

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AISecurityPage() {
  const t = useDspmLabels().ai;
  const {
    data: dashboardEnvelope,
    isLoading: dashLoading,
    error: dashError,
    refetch: refetchDash,
  } = useQuery({
    queryKey: ['dspm-ai-dashboard'],
    queryFn: () => apiGet<{ data: AISecurityDashboard }>(API_ENDPOINTS.CYBER_DSPM_AI_DASHBOARD),
    staleTime: 120000,
  });

  const {
    data: rankingEnvelope,
    isLoading: rankingLoading,
    error: rankingError,
    refetch: refetchRanking,
  } = useQuery({
    queryKey: ['dspm-ai-risk-ranking'],
    queryFn: () => apiGet<{ data: AIDataUsage[] }>(API_ENDPOINTS.CYBER_DSPM_AI_RISK_RANKING),
    staleTime: 120000,
  });

  const isLoading = dashLoading || rankingLoading;
  const error = dashError || rankingError;
  const dashboard = dashboardEnvelope?.data;
  const riskyUsages = rankingEnvelope?.data ?? [];

  const kpis: Array<{ key: string; label: string; value: number; icon: typeof Brain; tone: StatTone }> = [
    {
      key: 'total_usages',
      label: t.totalUsages,
      value: dashboard?.total_ai_data_usages ?? 0,
      icon: Brain,
      tone: 'sky',
    },
    {
      key: 'high_risk_count',
      label: t.highRiskCount,
      value: dashboard?.high_risk_count ?? 0,
      icon: AlertTriangle,
      tone: (dashboard?.high_risk_count ?? 0) > 0 ? 'rose' : 'emerald',
    },
    {
      key: 'pii_in_ai_count',
      label: t.piiInAiCount,
      value: dashboard?.pii_in_ai_count ?? 0,
      icon: ShieldAlert,
      tone: (dashboard?.pii_in_ai_count ?? 0) > 0 ? 'rose' : 'emerald',
    },
    {
      key: 'consent_gap_count',
      label: t.consentGapCount,
      value: dashboard?.consent_gap_count ?? 0,
      icon: Shield,
      tone: (dashboard?.consent_gap_count ?? 0) > 0 ? 'gold' : 'emerald',
    },
  ];

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
        />

        {isLoading ? (
          <LoadingSkeleton variant="card" count={4} />
        ) : error ? (
          <ErrorState
            message={t.loadError}
            onRetry={() => {
              void refetchDash();
              void refetchRanking();
            }}
          />
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpis.map((kpi) => (
                <StatCard
                  key={kpi.key}
                  label={kpi.label}
                  value={kpi.value}
                  icon={kpi.icon}
                  tone={kpi.tone}
                  className=""
                />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Risk Distribution */}
              <div className="rounded-xl border bg-card p-5">
                <h3 className="mb-4 text-sm font-semibold">{t.riskDistribution}</h3>
                {dashboard?.risk_distribution && Object.keys(dashboard.risk_distribution).length > 0 ? (
                  <div className="space-y-3">
                    {(['critical', 'high', 'medium', 'low'] as const).map((level) => {
                      const count = dashboard.risk_distribution[level] ?? 0;
                      const total = dashboard.total_ai_data_usages || 1;
                      const pct = Math.round((count / total) * 100);
                      const riskLabel = level === 'critical' ? t.riskCritical : level === 'high' ? t.riskHigh : level === 'medium' ? t.riskMedium : t.riskLow;
                      return (
                        <div key={level}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="flex items-center gap-2">
                              <Badge variant="secondary" className={`${RISK_COLORS[level]} capitalize`}>
                                {riskLabel}
                              </Badge>
                            </span>
                            <span className="font-medium tabular-nums">
                              {count} ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full transition-all ${
                                level === 'critical'
                                  ? 'bg-severity-critical'
                                  : level === 'high'
                                    ? 'bg-severity-high'
                                    : level === 'medium'
                                      ? 'bg-severity-medium'
                                      : 'bg-severity-info'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t.noRiskData}</p>
                )}
              </div>

              {/* Usage Type Distribution */}
              <div className="rounded-xl border bg-card p-5">
                <h3 className="mb-4 text-sm font-semibold">{t.usageTypeDistribution}</h3>
                {dashboard?.usage_type_distribution && Object.keys(dashboard.usage_type_distribution).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(dashboard.usage_type_distribution)
                      .sort(([, a], [, b]) => b - a)
                      .map(([usageType, count]) => {
                        const total = dashboard.total_ai_data_usages || 1;
                        const pct = Math.round((count / total) * 100);
                        return (
                          <div key={usageType}>
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{formatLabel(usageType)}</span>
                              <span className="font-medium tabular-nums">
                                {count} ({pct}%)
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary/70 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t.noUsageTypeData}</p>
                )}
              </div>
            </div>

            {/* Top Risky AI Data Usages Table */}
            <div className="rounded-xl border bg-card">
              <div className="border-b px-5 py-4">
                <h3 className="text-sm font-semibold">{t.topRiskyTitle}</h3>
                <p className="text-xs text-muted-foreground">
                  {t.topRiskySubtitle}
                </p>
              </div>
              <div className="p-5">
                {riskyUsages.length === 0 && (!dashboard?.top_risky_usages || dashboard.top_risky_usages.length === 0) ? (
                  <EmptyState
                    size="compact"
                    icon={CheckCircle2}
                    title={t.noRiskyTitle}
                    description={t.noRiskyDescription}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.colAssetName}</TableHead>
                          <TableHead>{t.colUsageType}</TableHead>
                          <TableHead>{t.colRiskLevel}</TableHead>
                          <TableHead className="text-end">{t.colRiskScore}</TableHead>
                          <TableHead>{t.colPiiTypes}</TableHead>
                          <TableHead>{t.colConsent}</TableHead>
                          <TableHead>{t.colAnonymization}</TableHead>
                          <TableHead>{t.colStatus}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(riskyUsages.length > 0 ? riskyUsages : dashboard?.top_risky_usages ?? []).map(
                          (usage: AIDataUsage) => (
                            <TableRow key={usage.id}>
                              <TableCell className="font-medium">
                                {usage.data_asset_name ?? usage.data_asset_id}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs capitalize">
                                  {formatLabel(usage.usage_type)}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="secondary"
                                  className={`capitalize ${RISK_COLORS[usage.ai_risk_level] ?? 'bg-muted text-muted-foreground'}`}
                                >
                                  {usage.ai_risk_level}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-end tabular-nums font-medium">
                                {usage.ai_risk_score}
                              </TableCell>
                              <TableCell>
                                {usage.pii_types.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {usage.pii_types.slice(0, 3).map((pii) => (
                                      <Badge key={pii} variant="outline" className="text-xs">
                                        {formatLabel(pii)}
                                      </Badge>
                                    ))}
                                    {usage.pii_types.length > 3 && (
                                      <Badge variant="outline" className="text-xs text-muted-foreground">
                                        +{usage.pii_types.length - 3}
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{t.none}</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {usage.consent_verified ? (
                                  <div className="flex items-center gap-1 text-primary">
                                    <Lock className="h-3.5 w-3.5" />
                                    <span className="text-xs font-medium">{t.verified}</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 text-severity-critical">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    <span className="text-xs font-medium">{t.gap}</span>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                <span className="text-xs capitalize">
                                  {usage.anonymization_level
                                    ? formatLabel(usage.anonymization_level)
                                    : t.notApplicable}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="secondary"
                                  className={`capitalize ${STATUS_COLORS[usage.status] ?? 'bg-muted text-muted-foreground'}`}
                                >
                                  {formatLabel(usage.status)}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ),
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
