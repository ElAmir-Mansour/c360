'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Shield,
  Copy,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { useDspmLabels } from '../_lib/dspm-i18n';
import type { ProliferationOverview, DataProliferation, SpreadEvent } from '@/types/cyber';

const STATUS_CONFIG: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
  contained: { color: 'bg-primary/15 text-primary', icon: CheckCircle2 },
  spreading: { color: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300', icon: TrendingUp },
  uncontrolled: { color: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300', icon: AlertTriangle },
};

const CLASSIFICATION_COLORS: Record<string, string> = {
  public: 'bg-primary/15 text-primary',
  internal: 'bg-info-50 text-info-700 dark:bg-info-700/15 dark:text-info-300',
  confidential: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  restricted: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
  top_secret: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DataProliferationPage() {
  const t = useDspmLabels().proliferation;
  const statusLabel = (status: string): string =>
    ({ contained: t.statusContained, spreading: t.statusSpreading, uncontrolled: t.statusUncontrolled } as Record<string, string>)[status] ??
    t.statusContained;
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dspm-proliferation-overview'],
    queryFn: () =>
      apiGet<{ data: ProliferationOverview }>(API_ENDPOINTS.CYBER_DSPM_PROLIFERATION_OVERVIEW),
  });

  const overview = data?.data;

  function toggleExpanded(assetId: string) {
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }

  const kpis: Array<{ label: string; value: number; icon: typeof Shield; tone: StatTone }> = overview
    ? [
        {
          label: t.kpiTrackedAssets,
          value: overview.total_tracked_assets,
          icon: Shield,
          tone: 'sky',
        },
        {
          label: t.kpiSpreading,
          value: overview.spreading_count,
          icon: TrendingUp,
          tone: overview.spreading_count > 0 ? 'gold' : 'emerald',
        },
        {
          label: t.kpiUncontrolled,
          value: overview.uncontrolled_count,
          icon: AlertTriangle,
          tone: overview.uncontrolled_count > 0 ? 'rose' : 'emerald',
        },
        {
          label: t.kpiUnauthorizedCopies,
          value: overview.total_unauthorized_copies,
          icon: Copy,
          tone: overview.total_unauthorized_copies > 0 ? 'rose' : 'emerald',
        },
      ]
    : [];

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
        />

        {isLoading ? (
          <LoadingSkeleton variant="card" count={4} />
        ) : error || !overview ? (
          <ErrorState
            message={t.loadError}
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            {/* KPI Cards */}
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

            {/* Proliferations List */}
            {overview.proliferations.length === 0 ? (
              <Card>
                <CardContent className="p-0">
                  <EmptyState
                    size="compact"
                    icon={CheckCircle2}
                    title={t.noProliferationTitle}
                    description={t.noProliferationDescription}
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-xl border bg-card">
                <div className="border-b px-5 py-4">
                  <h3 className="text-sm font-semibold">{t.trackedAssetsTitle}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t.trackedAssetsSubtitle(overview.proliferations.length)}
                  </p>
                </div>
                <div className="divide-y">
                  {overview.proliferations.map((proliferation: DataProliferation) => {
                    const isExpanded = expandedAssets.has(proliferation.asset_id);
                    const statusConfig =
                      STATUS_CONFIG[proliferation.status] ?? STATUS_CONFIG.contained;
                    const StatusIcon = statusConfig.icon;
                    const classificationColor =
                      CLASSIFICATION_COLORS[proliferation.classification] ??
                      'bg-muted text-muted-foreground';

                    return (
                      <div key={proliferation.asset_id}>
                        {/* Asset Row */}
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-start transition-colors hover:bg-muted/50"
                          onClick={() => toggleExpanded(proliferation.asset_id)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{proliferation.asset_name}</p>
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${classificationColor}`}
                              >
                                {proliferation.classification.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span className="tabular-nums">
                                {t.totalCopies(proliferation.total_copies)}
                              </span>
                              <span className="tabular-nums">
                                {t.authorizedCopies(proliferation.authorized_copies)}
                              </span>
                              {proliferation.unauthorized_copies > 0 && (
                                <span className="tabular-nums font-medium text-status-error">
                                  {t.unauthorizedCopies(proliferation.unauthorized_copies)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig.color}`}
                            >
                              <StatusIcon className="h-3 w-3" />
                              {statusLabel(proliferation.status)}
                            </span>
                            {proliferation.spread_events.length > 0 && (
                              <span className="text-muted-foreground">
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Expanded Spread Events */}
                        {isExpanded && proliferation.spread_events.length > 0 && (
                          <div className="border-t bg-muted/20 px-5 py-3">
                            <p className="mb-3 text-xs font-medium text-muted-foreground">
                              {t.spreadEvents(proliferation.spread_events.length)}
                            </p>
                            <div className="space-y-2">
                              {proliferation.spread_events.map(
                                (event: SpreadEvent, idx: number) => (
                                  <div
                                    key={`${event.target_asset_id}-${idx}`}
                                    className="flex items-start justify-between gap-4 rounded-lg border bg-background p-3"
                                  >
                                    <div className="min-w-0 space-y-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-medium">
                                          {event.target_asset_name}
                                        </p>
                                        <Badge variant="outline" className="text-xs capitalize">
                                          {event.edge_type.replace(/_/g, ' ')}
                                        </Badge>
                                        {event.classification_changed && (
                                          <Badge
                                            variant="secondary"
                                            className="text-xs"
                                          >
                                            {t.classificationChanged}
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        {t.detectedAt(formatDate(event.detected_at))}
                                      </p>
                                    </div>
                                    <span
                                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                        event.authorized
                                          ? 'bg-primary/15 text-primary'
                                          : 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300'
                                      }`}
                                    >
                                      {event.authorized ? (
                                        <>
                                          <CheckCircle2 className="h-3 w-3" />
                                          {t.authorized}
                                        </>
                                      ) : (
                                        <>
                                          <AlertTriangle className="h-3 w-3" />
                                          {t.unauthorized}
                                        </>
                                      )}
                                    </span>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PermissionRedirect>
  );
}
