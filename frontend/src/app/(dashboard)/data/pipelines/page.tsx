'use client';

import { useState } from 'react';
import { GitBranch, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { CreatePipelineWizard } from '@/app/(dashboard)/data/pipelines/_components/create-pipeline-wizard';
import { buildPipelineColumns } from '@/app/(dashboard)/data/pipelines/_components/pipeline-columns';
import { dataSuiteApi, type Pipeline } from '@/lib/data-suite';
import { showApiError, showSuccess } from '@/lib/toast';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

export default function DataPipelinesPage() {
  const labels = useDataLabels();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const pipelineFilters = [
    {
      key: 'type',
      label: labels.pipelines.filterType,
      type: 'multi-select' as const,
      options: [
        { label: labels.pipelines.ptEtl, value: 'etl' },
        { label: labels.pipelines.ptElt, value: 'elt' },
        { label: labels.pipelines.ptBatch, value: 'batch' },
        { label: labels.pipelines.ptStreaming, value: 'streaming' },
      ],
    },
    {
      key: 'status',
      label: labels.pipelines.filterStatus,
      type: 'multi-select' as const,
      options: [
        { label: labels.pipelines.psActive, value: 'active' },
        { label: labels.pipelines.psPaused, value: 'paused' },
        { label: labels.pipelines.psDisabled, value: 'disabled' },
        { label: labels.pipelines.psError, value: 'error' },
      ],
    },
  ];

  const { tableProps, searchValue, setSearch, refetch } = useDataTable<Pipeline>({
    queryKey: 'data-pipelines',
    fetchFn: (params) => dataSuiteApi.listPipelines(params),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['pipeline.run.completed', 'pipeline.run.failed'],
  });

  const runPipeline = async (pipeline: Pipeline) => {
    try {
      setRunningId(pipeline.id);
      await dataSuiteApi.runPipeline(pipeline.id);
      showSuccess(labels.pipelines.runStarted, labels.pipelines.runStartedDesc(pipeline.name));
      void refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setRunningId(null);
    }
  };

  const pausePipeline = async (pipeline: Pipeline) => {
    try {
      setMutatingId(pipeline.id);
      await dataSuiteApi.pausePipeline(pipeline.id);
      showSuccess(labels.pipelines.paused, labels.pipelines.pausedDesc(pipeline.name));
      void refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setMutatingId(null);
    }
  };

  const resumePipeline = async (pipeline: Pipeline) => {
    try {
      setMutatingId(pipeline.id);
      await dataSuiteApi.resumePipeline(pipeline.id);
      showSuccess(labels.pipelines.resumed, labels.pipelines.resumedDesc(pipeline.name));
      void refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setMutatingId(null);
    }
  };

  const deletePipeline = async (pipeline: Pipeline) => {
    if (!window.confirm(labels.pipelines.confirmDelete(pipeline.name))) {
      return;
    }
    try {
      setMutatingId(pipeline.id);
      await dataSuiteApi.deletePipeline(pipeline.id);
      showSuccess(labels.pipelines.deleted);
      void refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setMutatingId(null);
    }
  };

  return (
    <PermissionRedirect permission="data:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Data Platform"
          title={labels.pipelines.pageTitle}
          description={labels.pipelines.pageDesc}
          actions={
            <Button type="button" onClick={() => setWizardOpen(true)}>
              <Plus className="me-2 h-4 w-4" />
              {labels.pipelines.createPipeline}
            </Button>
          }
        />

        <DataTable
          {...tableProps}
          columns={buildPipelineColumns({
            labels,
            runningId,
            mutatingId,
            onRun: (pipeline) => void runPipeline(pipeline),
            onPause: (pipeline) => void pausePipeline(pipeline),
            onResume: (pipeline) => void resumePipeline(pipeline),
            onDelete: (pipeline) => void deletePipeline(pipeline),
          })}
          filters={pipelineFilters}
          searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={labels.pipelines.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
          emptyState={{
            icon: GitBranch,
            title: labels.pipelines.emptyTitle,
            description: labels.pipelines.emptyDesc,
          }}
        />

        <CreatePipelineWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          onCreated={() => {
            void refetch();
          }}
        />
      </div>
    </PermissionRedirect>
  );
}
