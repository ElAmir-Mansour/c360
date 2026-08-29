'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Activity, Clock, Database, GitBranch, Pause, Play, PlayCircle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { RootCauseAnalysisPanel } from '@/components/cyber/root-cause-analysis-panel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RunDetailPanel } from '@/app/(dashboard)/data/pipelines/[id]/_components/run-detail-panel';
import { RunProgressTracker } from '@/app/(dashboard)/data/pipelines/[id]/_components/run-progress-tracker';
import { PipelineConfigTab } from '@/app/(dashboard)/data/pipelines/[id]/_components/pipeline-config-tab';
import { PipelineLineageTab } from '@/app/(dashboard)/data/pipelines/[id]/_components/pipeline-lineage-tab';
import { PipelineQualityTab } from '@/app/(dashboard)/data/pipelines/[id]/_components/pipeline-quality-tab';
import { PipelineRunsTab } from '@/app/(dashboard)/data/pipelines/[id]/_components/pipeline-runs-tab';
import { pipelineCanResume } from '@/app/(dashboard)/data/pipelines/_components/pipeline-status-indicator';
import { dataSuiteApi, type Pipeline, type PipelineRun } from '@/lib/data-suite';
import { formatMaybeCompact, formatMaybeDateTime, formatMaybeDurationMs } from '@/lib/data-suite/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import type { RootCauseAnalysis } from '@/types/cyber';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

export default function DataPipelineDetailPage() {
  const labels = useDataLabels();
  const params = useParams<{ id: string }>();
  const pipelineId = params?.id ?? '';
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null);
  const [activeTab, setActiveTab] = useState('runs');
  const [running, setRunning] = useState(false);
  const [mutating, setMutating] = useState(false);

  const [pipelineQuery, runsQuery, lineageQuery] = useQueries({
    queries: [
      { queryKey: ['data-pipeline', pipelineId], queryFn: () => dataSuiteApi.getPipeline(pipelineId) },
      {
        queryKey: ['data-pipeline-runs', pipelineId],
        queryFn: () =>
          dataSuiteApi.listPipelineRuns(pipelineId, {
            page: 1,
            per_page: 50,
            sort: 'started_at',
            order: 'desc',
          }),
      },
      {
        queryKey: ['data-pipeline-lineage', pipelineId],
        queryFn: () => dataSuiteApi.getEntityLineageGraph('pipeline', pipelineId),
      },
    ],
  });

  const logsQuery = useQuery({
    queryKey: ['data-pipeline-run-logs', pipelineId, selectedRun?.id],
    queryFn: () => dataSuiteApi.getPipelineRunLogs(pipelineId, selectedRun!.id),
    enabled: Boolean(selectedRun?.id),
  });

  const pipeline = pipelineQuery.data;
  const runs = runsQuery.data?.data ?? [];
  const latestRun = runs[0] ?? null;
  const failedRun = selectedRun?.status === 'failed'
    ? selectedRun
    : runs.find((run) => run.status === 'failed') ?? null;
  const rootCauseQuery = useQuery({
    queryKey: ['data-pipeline-root-cause', failedRun?.id],
    queryFn: () => apiGet<{ data: RootCauseAnalysis }>(`/api/v1/rca/pipeline_failure/${failedRun!.id}`),
    enabled: activeTab === 'root-cause' && Boolean(failedRun?.id),
    staleTime: 120000,
  });
  const error = [pipelineQuery, runsQuery, lineageQuery].find((query) => query.error)?.error;

  // Same run/pause/resume controls as the pipelines list row actions, surfaced
  // in the detail header. Enable/disable follows pipelineCanResume(status).
  const runPipeline = async (target: Pipeline) => {
    try {
      setRunning(true);
      await dataSuiteApi.runPipeline(target.id);
      showSuccess(labels.pipelines.runStarted, labels.pipelines.runStartedDesc(target.name));
      void pipelineQuery.refetch();
      void runsQuery.refetch();
    } catch (err) {
      showApiError(err);
    } finally {
      setRunning(false);
    }
  };

  const pausePipeline = async (target: Pipeline) => {
    try {
      setMutating(true);
      await dataSuiteApi.pausePipeline(target.id);
      showSuccess(labels.pipelines.paused, labels.pipelines.pausedDesc(target.name));
      void pipelineQuery.refetch();
    } catch (err) {
      showApiError(err);
    } finally {
      setMutating(false);
    }
  };

  const resumePipeline = async (target: Pipeline) => {
    try {
      setMutating(true);
      await dataSuiteApi.resumePipeline(target.id);
      showSuccess(labels.pipelines.resumed, labels.pipelines.resumedDesc(target.name));
      void pipelineQuery.refetch();
    } catch (err) {
      showApiError(err);
    } finally {
      setMutating(false);
    }
  };

  if (pipelineQuery.isLoading || !pipeline) {
    return (
      <PermissionRedirect permission="data:read">
        <div className="space-y-6">
          <PageHeader eyebrow={labels.pipelinesDetail.eyebrow} title={labels.pipelinesDetail.loadingTitle} description={labels.pipelinesDetail.loadingDesc} />
          <LoadingSkeleton variant="card" />
        </div>
      </PermissionRedirect>
    );
  }

  if (error) {
    return (
      <PermissionRedirect permission="data:read">
        <ErrorState message={error instanceof Error ? error.message : labels.pipelinesDetail.loadError} onRetry={() => void pipelineQuery.refetch()} />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="data:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.pipelinesDetail.eyebrow}
          title={pipeline.name}
          description={pipeline.description || labels.pipelinesDetail.detailDescFallback}
          actions={
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void runPipeline(pipeline)} disabled={running}>
                <PlayCircle className="me-1.5 h-3.5 w-3.5" />
                {running ? labels.pipelines.starting : labels.pipelinesDetail.runPipeline}
              </Button>

              {pipelineCanResume(pipeline) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void resumePipeline(pipeline)}
                  disabled={mutating}
                >
                  <Play className="me-1.5 h-3.5 w-3.5" />
                  {mutating ? labels.pipelines.resuming : labels.pipelines.resume}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void pausePipeline(pipeline)}
                  disabled={mutating || pipeline.status !== 'active'}
                >
                  <Pause className="me-1.5 h-3.5 w-3.5" />
                  {mutating ? labels.pipelines.pausing : labels.pipelines.pause}
                </Button>
              )}

              {failedRun ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedRun(failedRun);
                    setActiveTab('root-cause');
                  }}
                >
                  <GitBranch className="me-1.5 h-3.5 w-3.5" />
                  {labels.pipelinesDetail.analyzeRootCause}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" asChild>
                <Link href="/data/pipelines">
                  <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
                  {labels.pipelinesDetail.backToPipelines}
                </Link>
              </Button>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DetailStatCard label={labels.common.status} value={<span className="capitalize">{pipeline.status}</span>} tone="slate" icon={Activity} />
          <DetailStatCard label={labels.pipelines.colRuns} value={pipeline.total_runs.toLocaleString()} tone="sky" icon={PlayCircle} />
          <DetailStatCard label={labels.pipelines.colProcessed} value={formatMaybeCompact(pipeline.total_records_processed)} tone="sky" icon={Database} />
          <DetailStatCard label={labels.pipelinesDetail.avgDuration} value={formatMaybeDurationMs(pipeline.avg_duration_ms)} tone="gold" icon={Clock} />
        </div>

        <RunProgressTracker run={latestRun} />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="runs">{labels.pipelinesDetail.tabRuns}</TabsTrigger>
            <TabsTrigger value="config">{labels.pipelinesDetail.tabConfig}</TabsTrigger>
            <TabsTrigger value="quality">{labels.pipelinesDetail.tabQuality}</TabsTrigger>
            <TabsTrigger value="lineage">{labels.pipelinesDetail.tabLineage}</TabsTrigger>
            <TabsTrigger value="root-cause">{labels.pipelinesDetail.tabRootCause}</TabsTrigger>
          </TabsList>

          <TabsContent value="runs" className="space-y-4">
            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              {labels.pipelinesDetail.lastRunStatus(formatMaybeDateTime(pipeline.last_run_at), pipeline.last_run_status ?? labels.pipelinesDetail.neverRun)}
            </div>
            <PipelineRunsTab runs={runs} onSelectRun={setSelectedRun} />
          </TabsContent>
          <TabsContent value="config">
            <PipelineConfigTab pipeline={pipeline} />
          </TabsContent>
          <TabsContent value="quality">
            <PipelineQualityTab pipeline={pipeline} />
          </TabsContent>
          <TabsContent value="lineage">
            <PipelineLineageTab pipelineId={pipelineId} graph={lineageQuery.data ?? null} />
          </TabsContent>
          <TabsContent value="root-cause">
            <RootCauseAnalysisPanel
              analysis={rootCauseQuery.data?.data}
              isLoading={rootCauseQuery.isLoading || rootCauseQuery.isFetching}
              error={rootCauseQuery.error instanceof Error ? rootCauseQuery.error.message : null}
              onAnalyze={failedRun ? () => void rootCauseQuery.refetch() : undefined}
              analyzeLabel={labels.pipelinesDetail.refreshAnalysis}
              emptyTitle={labels.pipelinesDetail.analyzeFailureTitle}
              emptyDescription={labels.pipelinesDetail.analyzeFailureDesc}
              disabledReason={failedRun ? undefined : labels.pipelinesDetail.selectFailedRun}
            />
          </TabsContent>
        </Tabs>

        <RunDetailPanel
          open={Boolean(selectedRun)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedRun(null);
            }
          }}
          run={selectedRun}
          logs={logsQuery.data ?? []}
        />
      </div>
    </PermissionRedirect>
  );
}
