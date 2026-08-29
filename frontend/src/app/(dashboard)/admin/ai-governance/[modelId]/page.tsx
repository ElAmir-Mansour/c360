'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Bot, PencilLine, Plus, Target, ThumbsDown, ThumbsUp } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { RelativeTime } from '@/components/shared/relative-time';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AIModelVersion, AIPredictionStats, AIRegisteredModel } from '@/types/ai-governance';
import { modelTypeLabel, riskTierLabel } from '../_lib/enum-labels';
import { VersionTimeline } from '../_components/version-timeline';
import { PredictionLogTable } from '../_components/prediction-log-table';
import { ShadowComparisonChart } from '../_components/shadow-comparison-chart';
import { DriftChart } from '../_components/drift-chart';
import { ModelFormDialog } from '../_components/model-form-dialog';
import { PerformanceChart } from '../_components/performance-chart';
import { PromoteDialog } from '../_components/promote-dialog';
import { RollbackDialog } from '../_components/rollback-dialog';
import { VersionFormDialog } from '../_components/version-form-dialog';
import { VersionLifecycleDialog, type VersionLifecycleAction } from '../_components/version-lifecycle-dialog';
import { useAdminT } from '../../_lib/admin-i18n';

type GovernanceTab = 'versions' | 'predictions' | 'shadow' | 'drift' | 'performance' | 'feedback';

export default function AIModelDetailPage() {
  const labels = useAdminT();
  const { locale } = useLocaleOrDefault();
  const params = useParams<{ modelId: string }>();
  const modelId = params?.modelId ?? '';
  const hasModelId = modelId.trim().length > 0;
  const queryClient = useQueryClient();

  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [modelFormOpen, setModelFormOpen] = useState(false);
  const [versionFormOpen, setVersionFormOpen] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState<AIModelVersion | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [lifecycleTarget, setLifecycleTarget] = useState<{ action: VersionLifecycleAction; version: AIModelVersion } | null>(null);
  const [activeTab, setActiveTab] = useState<GovernanceTab>('versions');
  const [refreshing, setRefreshing] = useState(false);

  const modelQuery = useQuery({
    queryKey: ['ai-model', modelId],
    queryFn: () => enterpriseApi.ai.getModel(modelId),
    enabled: hasModelId,
  });
  const detailQueriesEnabled = Boolean(modelQuery.data?.model);

  const versionsQuery = useQuery({
    queryKey: ['ai-model-versions', modelId],
    queryFn: () => enterpriseApi.ai.listVersions(modelId),
    enabled: detailQueriesEnabled,
  });
  const historyQuery = useQuery({
    queryKey: ['ai-model-history', modelId],
    queryFn: () => enterpriseApi.ai.lifecycleHistory(modelId),
    enabled: detailQueriesEnabled,
  });
  const latestComparisonQuery = useQuery({
    queryKey: ['ai-model-shadow-latest', modelId],
    queryFn: () => enterpriseApi.ai.latestComparison(modelId),
    enabled: detailQueriesEnabled && activeTab === 'shadow',
  });
  const comparisonHistoryQuery = useQuery({
    queryKey: ['ai-model-shadow-history', modelId],
    queryFn: () => enterpriseApi.ai.comparisonHistory(modelId),
    enabled: detailQueriesEnabled && activeTab === 'shadow',
  });
  const divergencesQuery = useQuery({
    queryKey: ['ai-model-divergences', modelId],
    queryFn: () =>
      enterpriseApi.ai.divergences(modelId, {
        page: 1,
        per_page: 10,
        sort: 'created_at',
        order: 'desc',
      }),
    enabled: detailQueriesEnabled && activeTab === 'shadow',
  });
  const latestDriftQuery = useQuery({
    queryKey: ['ai-model-drift-latest', modelId],
    queryFn: () => enterpriseApi.ai.latestDrift(modelId),
    enabled: detailQueriesEnabled && activeTab === 'drift',
  });
  const driftHistoryQuery = useQuery({
    queryKey: ['ai-model-drift-history', modelId],
    queryFn: () => enterpriseApi.ai.driftHistory(modelId),
    enabled: detailQueriesEnabled && activeTab === 'drift',
  });
  const performanceQuery = useQuery({
    queryKey: ['ai-model-performance', modelId],
    queryFn: () => enterpriseApi.ai.performance(modelId),
    enabled: detailQueriesEnabled && activeTab === 'performance',
  });
  const predictionStatsQuery = useQuery({
    queryKey: ['ai-prediction-stats', modelId],
    queryFn: () => enterpriseApi.ai.predictionStats(),
    enabled: detailQueriesEnabled && activeTab === 'feedback',
  });

  const model = modelQuery.data?.model ?? null;
  const productionVersion = modelQuery.data?.production_version ?? null;
  const versions = versionsQuery.data ?? [];
  const lifecycleHistory = historyQuery.data ?? [];
  const predictionStats = useMemo(
    () => (predictionStatsQuery.data ?? []).filter((item) => item.model_id === modelId),
    [predictionStatsQuery.data, modelId],
  );
  const feedbackSummary = summarizeFeedback(predictionStats);

  const buildActiveRefreshes = () => {
    if (!detailQueriesEnabled) {
      return [] as Array<Promise<unknown>>;
    }

    switch (activeTab) {
      case 'predictions':
        return [queryClient.invalidateQueries({ queryKey: ['ai-predictions', modelId] })];
      case 'shadow':
        return [
          latestComparisonQuery.refetch(),
          comparisonHistoryQuery.refetch(),
          divergencesQuery.refetch(),
        ];
      case 'drift':
        return [latestDriftQuery.refetch(), driftHistoryQuery.refetch()];
      case 'performance':
        return [performanceQuery.refetch()];
      case 'feedback':
        return [predictionStatsQuery.refetch()];
      default:
        return [];
    }
  };

  const refreshAll = async () => {
    const refreshes: Array<Promise<unknown>> = [modelQuery.refetch()];

    if (detailQueriesEnabled) {
      refreshes.push(versionsQuery.refetch(), historyQuery.refetch(), ...buildActiveRefreshes());
    }

    await Promise.all(refreshes);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const startShadow = async (version: AIModelVersion) => {
    try {
      setBusyVersionId(version.id);
      await enterpriseApi.ai.startShadow(modelId, { version_id: version.id });
      showSuccess(
        labels.aiModelDetail.shadowStarted,
        labels.aiGovernance.shadowStartedDetail(model?.slug ?? 'model', version.version_number),
      );
      await refreshAll();
    } catch (error) {
      showApiError(error);
    } finally {
      setBusyVersionId(null);
    }
  };

  if (!hasModelId) {
    return (
      <PermissionRedirect permission="admin:read">
        <div className="space-y-6">
          <PageHeader
            title={labels.aiModelDetail.pageTitle}
            description={labels.aiModelDetail.pageDescription}
          />
          <ErrorState message={labels.aiModelDetail.missingId} />
        </div>
      </PermissionRedirect>
    );
  }

  if (modelQuery.isLoading) {
    return (
      <PermissionRedirect permission="admin:read">
        <div className="space-y-6">
          <PageHeader
            title={labels.aiModelDetail.pageTitle}
            description={labels.aiModelDetail.loadingDescription}
          />
          <LoadingSkeleton variant="card" count={3} />
        </div>
      </PermissionRedirect>
    );
  }

  if (modelQuery.error) {
    return (
      <PermissionRedirect permission="admin:read">
        <div className="space-y-6">
          <PageHeader
            title={labels.aiModelDetail.pageTitle}
            description={labels.aiModelDetail.pageDescription}
          />
          {isNotFoundError(modelQuery.error) ? (
            <EmptyState
              icon={Bot}
              title={labels.aiModelDetail.notFoundTitle}
              description={labels.aiModelDetail.notFoundDescription}
              action={{ label: labels.aiModelDetail.backToRegistry, href: '/admin/ai-governance' }}
            />
          ) : (
            <ErrorState
              message={labels.aiModelDetail.loadFailed}
              onRetry={() => void handleRefresh()}
            />
          )}
        </div>
      </PermissionRedirect>
    );
  }

  if (!model) {
    return (
      <PermissionRedirect permission="admin:read">
        <div className="space-y-6">
          <PageHeader
            title={labels.aiModelDetail.pageTitle}
            description={labels.aiModelDetail.pageDescription}
          />
          <EmptyState
            icon={Bot}
            title={labels.aiModelDetail.notFoundTitle}
            description={labels.aiModelDetail.notFoundDescription}
            action={{ label: labels.aiModelDetail.backToRegistry, href: '/admin/ai-governance' }}
          />
        </div>
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="admin:read">
      <div className="space-y-6">
        <PageHeader
          title={model?.name ?? labels.aiModelDetail.pageTitle}
          description={model?.description ?? labels.aiModelDetail.pageDescription}
          actions={
            <div className="flex items-center gap-2">
              {model ? (
                <Button variant="outline" onClick={() => setModelFormOpen(true)}>
                  <PencilLine className="me-1.5 h-3.5 w-3.5" />
                  {labels.aiModelDetail.editModel}
                </Button>
              ) : null}
              {model ? (
                <Button onClick={() => setVersionFormOpen(true)}>
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {labels.aiModelDetail.newVersion}
                </Button>
              ) : null}
              {productionVersion ? (
                <Button variant="outline" onClick={() => setRollbackOpen(true)}>
                  <ArrowLeftRight className="me-1.5 h-3.5 w-3.5" />
                  {labels.aiModelDetail.rollback}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void handleRefresh()} disabled={refreshing}>
                {refreshing ? labels.aiModelDetail.refreshing : labels.aiModelDetail.refresh}
              </Button>
            </div>
          }
        />

        <Card className="overflow-hidden border-border/70">
          <CardContent className="grid grid-cols-1 gap-4 p-4 sm:p-6 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-caps-xwide text-muted-foreground">{labels.aiModelDetail.suite}</p>
              <div className="mt-2">
                <Badge variant="secondary">{model.suite}</Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-caps-xwide text-muted-foreground">{labels.aiModelDetail.type}</p>
              <div className="mt-2">
                <Badge variant="outline">{modelTypeLabel(model.model_type, locale)}</Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-caps-xwide text-muted-foreground">{labels.aiModelDetail.riskTier}</p>
              <div className="mt-2">
                <Badge
                  variant={
                    model.risk_tier === 'critical'
                      ? 'destructive'
                      : model.risk_tier === 'high'
                        ? 'warning'
                        : 'secondary'
                  }
                >
                  {riskTierLabel(model.risk_tier, locale)}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-caps-xwide text-muted-foreground">{labels.aiModelDetail.owner}</p>
              <div className="mt-2 text-sm font-medium">
                {model.owner_team || model.owner_user_id || labels.aiModelDetail.unassigned}
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as GovernanceTab)} className="space-y-4">
          <TabsList className="grid w-full grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            <TabsTrigger value="versions">{labels.aiModelDetail.tabVersions}</TabsTrigger>
            <TabsTrigger value="predictions">{labels.aiModelDetail.tabPredictions}</TabsTrigger>
            <TabsTrigger value="shadow">{labels.aiModelDetail.tabShadow}</TabsTrigger>
            <TabsTrigger value="drift">{labels.aiModelDetail.tabDrift}</TabsTrigger>
            <TabsTrigger value="performance">{labels.aiModelDetail.tabPerformance}</TabsTrigger>
            <TabsTrigger value="feedback">{labels.aiModelDetail.tabFeedback}</TabsTrigger>
          </TabsList>

          <TabsContent value="versions" className="space-y-4">
            {versionsQuery.isLoading || historyQuery.isLoading ? (
              <LoadingSkeleton variant="card" count={2} />
            ) : versionsQuery.error || historyQuery.error ? (
              <ErrorState
                message={labels.aiModelDetail.versionsLoadFailed}
                onRetry={() => void handleRefresh()}
              />
            ) : versions.length === 0 ? (
              <EmptyState
                icon={Plus}
                title={labels.aiModelDetail.noVersionsTitle}
                description={labels.aiModelDetail.noVersionsDescription}
                action={{ label: labels.aiModelDetail.newVersion, onClick: () => setVersionFormOpen(true) }}
              />
            ) : (
              <VersionTimeline
                versions={versions}
                history={lifecycleHistory}
                busyVersionId={busyVersionId}
                onPromote={(version) => setPromoteTarget(version)}
                onStartShadow={(version) => void startShadow(version)}
                onStopShadow={(version) => setLifecycleTarget({ action: 'stop_shadow', version })}
                onRetire={(version) => setLifecycleTarget({ action: 'retire', version })}
                onFail={(version) => setLifecycleTarget({ action: 'fail', version })}
              />
            )}
          </TabsContent>

          <TabsContent value="predictions" className="space-y-4">
            <PredictionLogTable modelId={modelId} />
          </TabsContent>

          <TabsContent value="shadow" className="space-y-4" id="shadow">
            {latestComparisonQuery.isLoading || comparisonHistoryQuery.isLoading || divergencesQuery.isLoading ? (
              <LoadingSkeleton variant="card" count={3} />
            ) : latestComparisonQuery.error || comparisonHistoryQuery.error || divergencesQuery.error ? (
              <ErrorState
                message={labels.aiModelDetail.shadowLoadFailed}
                onRetry={() => void handleRefresh()}
              />
            ) : (
              <>
                <ShadowComparisonChart
                  latest={latestComparisonQuery.data ?? null}
                  history={comparisonHistoryQuery.data ?? []}
                />
                <Card className="border-border/70">
                  <CardHeader>
                    <CardTitle>{labels.aiModelDetail.divergenceSamples}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(divergencesQuery.data?.data ?? []).length > 0 ? (
                      (divergencesQuery.data?.data ?? []).map((item) => (
                        <div key={item.prediction_id} className="rounded-lg border border-border/70 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium">{item.use_case}</div>
                            <RelativeTime date={item.created_at} className="text-xs text-muted-foreground" />
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{item.reason}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {labels.aiModelDetail.noDivergence}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="drift" className="space-y-4">
            {latestDriftQuery.isLoading || driftHistoryQuery.isLoading ? (
              <LoadingSkeleton variant="chart" count={2} />
            ) : latestDriftQuery.error || driftHistoryQuery.error ? (
              <ErrorState
                message={labels.aiModelDetail.driftLoadFailed}
                onRetry={() => void handleRefresh()}
              />
            ) : (
              <DriftChart latest={latestDriftQuery.data ?? null} history={driftHistoryQuery.data ?? []} />
            )}
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            {performanceQuery.isLoading ? (
              <LoadingSkeleton variant="chart" count={2} />
            ) : performanceQuery.error ? (
              <ErrorState
                message={labels.aiModelDetail.performanceLoadFailed}
                onRetry={() => void handleRefresh()}
              />
            ) : (
              <PerformanceChart points={performanceQuery.data ?? []} />
            )}
          </TabsContent>

          <TabsContent value="feedback" className="space-y-4">
            {predictionStatsQuery.isLoading ? (
              <LoadingSkeleton variant="card" count={2} />
            ) : predictionStatsQuery.error ? (
              <ErrorState
                message={labels.aiModelDetail.feedbackLoadFailed}
                onRetry={() => void handleRefresh()}
              />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <DetailStatCard
                    label={labels.aiModelDetail.correctFeedback}
                    value={feedbackSummary.correct.toLocaleString()}
                    tone="emerald"
                    icon={ThumbsUp}
                  />
                  <DetailStatCard
                    label={labels.aiModelDetail.incorrectFeedback}
                    value={feedbackSummary.incorrect.toLocaleString()}
                    tone="rose"
                    icon={ThumbsDown}
                  />
                  <DetailStatCard
                    label={labels.aiModelDetail.accuracyFromFeedback}
                    value={`${feedbackSummary.accuracy}%`}
                    tone="emerald"
                    icon={Target}
                  />
                </div>
                <Card className="border-border/70">
                  <CardHeader>
                    <CardTitle>{labels.aiModelDetail.useCases}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {predictionStats.length > 0 ? (
                      predictionStats.map((item: AIPredictionStats) => (
                        <div
                          key={`${item.use_case}-${item.model_id}`}
                          className="flex items-center justify-between rounded-lg border border-border/70 p-4"
                        >
                          <div>
                            <div className="font-medium">{item.use_case}</div>
                            <div className="text-sm text-muted-foreground">
                              {item.total.toLocaleString()} {labels.aiModelDetail.prodPredictionsSuffix} • {item.shadow_total.toLocaleString()} {labels.aiModelDetail.shadowSuffix}
                            </div>
                          </div>
                          <div className="text-end text-sm">
                            <div>{labels.aiModelDetail.correctPrefix} {item.correct_feedback}</div>
                            <div className="text-muted-foreground">{labels.aiModelDetail.incorrectPrefix} {item.wrong_feedback}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {labels.aiModelDetail.noReviewerFeedback}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <PromoteDialog
        open={Boolean(promoteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setPromoteTarget(null);
          }
        }}
        model={model as AIRegisteredModel | null}
        version={promoteTarget}
        onSaved={() => {
          void refreshAll();
        }}
      />

      <ModelFormDialog
        open={modelFormOpen}
        onOpenChange={setModelFormOpen}
        model={model as AIRegisteredModel | null}
        onSaved={() => {
          void refreshAll();
        }}
      />

      <VersionFormDialog
        open={versionFormOpen}
        onOpenChange={setVersionFormOpen}
        model={model as AIRegisteredModel | null}
        onSaved={() => {
          void refreshAll();
        }}
      />

      <RollbackDialog
        open={rollbackOpen}
        onOpenChange={setRollbackOpen}
        model={model as AIRegisteredModel | null}
        onSaved={() => {
          void refreshAll();
        }}
      />

      <VersionLifecycleDialog
        action={lifecycleTarget?.action ?? null}
        open={Boolean(lifecycleTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setLifecycleTarget(null);
          }
        }}
        model={model as AIRegisteredModel | null}
        version={lifecycleTarget?.version ?? null}
        onSaved={() => {
          void refreshAll();
        }}
      />
    </PermissionRedirect>
  );
}

function summarizeFeedback(items: AIPredictionStats[]) {
  const summary = items.reduce(
    (acc, item) => {
      acc.correct += item.correct_feedback;
      acc.incorrect += item.wrong_feedback;
      return acc;
    },
    { correct: 0, incorrect: 0 },
  );
  const total = summary.correct + summary.incorrect;
  return {
    ...summary,
    accuracy: total === 0 ? 0 : Math.round((summary.correct / total) * 100),
  };
}

function isNotFoundError(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 404,
  );
}
