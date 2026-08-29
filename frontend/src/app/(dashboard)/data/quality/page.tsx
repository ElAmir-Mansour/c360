'use client';

import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { useDataTable } from '@/hooks/use-data-table';
import { QualityModelCards } from '@/app/(dashboard)/data/quality/_components/quality-model-cards';
import { buildQualityRuleColumns } from '@/app/(dashboard)/data/quality/_components/quality-rule-columns';
import {
  buildQualityRulePayload,
  QualityRuleForm,
} from '@/app/(dashboard)/data/quality/_components/quality-rule-form';
import { QualityResultDialog } from '@/app/(dashboard)/data/quality/_components/quality-result-dialog';
import { QualityScoreGauge } from '@/app/(dashboard)/data/quality/_components/quality-score-gauge';
import { QualityTrendChart } from '@/app/(dashboard)/data/quality/_components/quality-trend-chart';
import { dataSuiteApi, type QualityResult, type QualityRule } from '@/lib/data-suite';
import { showApiError, showError, showSuccess } from '@/lib/toast';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

export default function DataQualityPage() {
  const labels = useDataLabels();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<QualityResult | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<QualityRule | null>(null);
  const [submittingRule, setSubmittingRule] = useState(false);

  const qualityRuleFilters = [
    {
      key: 'severity',
      label: labels.common.severity,
      type: 'multi-select' as const,
      options: [
        { label: labels.common.critical, value: 'critical' },
        { label: labels.common.high, value: 'high' },
        { label: labels.common.medium, value: 'medium' },
        { label: labels.common.low, value: 'low' },
      ],
    },
    {
      key: 'status',
      label: labels.quality.filterLastStatus,
      type: 'multi-select' as const,
      options: [
        { label: labels.common.passed, value: 'passed' },
        { label: labels.common.failed, value: 'failed' },
        { label: labels.common.warning, value: 'warning' },
        { label: labels.common.error, value: 'error' },
      ],
    },
  ];

  const { tableProps, searchValue, setSearch, refetch } = useDataTable<QualityRule>({
    queryKey: 'data-quality-rules',
    fetchFn: (params) => dataSuiteApi.listQualityRules(params),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['quality.check_failed'],
  });

  const [dashboardQuery, scoreQuery, trendQuery, modelsQuery, sourcesQuery] = useQueries({
    queries: [
      { queryKey: ['data-quality-dashboard'], queryFn: () => dataSuiteApi.getQualityDashboard() },
      { queryKey: ['data-quality-score'], queryFn: () => dataSuiteApi.getQualityScore() },
      { queryKey: ['data-quality-trend'], queryFn: () => dataSuiteApi.getQualityTrend(30) },
      {
        queryKey: ['data-quality-models'],
        queryFn: () =>
          dataSuiteApi.listModels({ page: 1, per_page: 200, sort: 'name', order: 'asc' }),
      },
      {
        queryKey: ['data-quality-sources'],
        queryFn: () =>
          dataSuiteApi.listSources({ page: 1, per_page: 200, sort: 'name', order: 'asc' }),
      },
    ],
  });

  const isLoading = [dashboardQuery, scoreQuery, trendQuery, modelsQuery, sourcesQuery].some((query) => query.isLoading);
  const error = [dashboardQuery, scoreQuery, trendQuery, modelsQuery, sourcesQuery].find((query) => query.error)?.error;

  const runRule = async (rule: QualityRule) => {
    try {
      setRunningId(rule.id);
      const result = await dataSuiteApi.runQualityRule(rule.id);
      setSelectedResult(result);
      showSuccess(labels.quality.toastExecuted, labels.quality.toastExecutedDesc(rule.name, result.status));
      void refetch();
    } catch (err) {
      showApiError(err);
    } finally {
      setRunningId(null);
    }
  };

  const toggleRule = async (rule: QualityRule, enabled: boolean) => {
    try {
      setTogglingId(rule.id);
      await dataSuiteApi.updateQualityRule(rule.id, { enabled });
      showSuccess(enabled ? labels.quality.toastEnabled : labels.quality.toastDisabled);
      void refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setTogglingId(null);
    }
  };

  const deleteRule = async (rule: QualityRule) => {
    try {
      setDeletingId(rule.id);
      await dataSuiteApi.deleteQualityRule(rule.id);
      showSuccess(labels.quality.toastDeleted);
      if (editingRule?.id === rule.id) {
        setFormOpen(false);
        setEditingRule(null);
      }
      void refetch();
      void dashboardQuery.refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setDeletingId(null);
    }
  };

  const submitRule = async (values: Parameters<typeof buildQualityRulePayload>[0]) => {
    try {
      setSubmittingRule(true);
      const payload = buildQualityRulePayload(values);
      if (editingRule) {
        await dataSuiteApi.updateQualityRule(editingRule.id, {
          name: payload.name,
          description: payload.description,
          severity: payload.severity,
          // Send empty string explicitly so backend treats it as "clear this field".
          // The service will set the field to nil when it receives "".
          column_name: payload.column_name ?? '',
          config: payload.config,
          schedule: payload.schedule ?? '',
          enabled: payload.enabled,
          tags: payload.tags,
        });
        showSuccess(labels.quality.toastUpdated);
      } else {
        await dataSuiteApi.createQualityRule({
          model_id: payload.model_id,
          name: payload.name,
          description: payload.description,
          rule_type: payload.rule_type,
          severity: payload.severity,
          column_name: payload.column_name || null,
          config: payload.config,
          schedule: payload.schedule || null,
          enabled: payload.enabled,
          tags: payload.tags,
        });
        showSuccess(labels.quality.toastCreated);
      }
      setFormOpen(false);
      setEditingRule(null);
      void refetch();
      void dashboardQuery.refetch();
    } catch (error) {
      if (editingRule && (error as { status?: number }).status === 404) {
        showError(labels.quality.toastGoneTitle, labels.quality.toastGoneDesc);
        setFormOpen(false);
        setEditingRule(null);
        void refetch();
      } else {
        showApiError(error);
      }
    } finally {
      setSubmittingRule(false);
    }
  };

  // Error gate MUST precede the loading gate: a failed React Query v5 query has
  // isLoading=false and data=undefined, so `!scoreQuery.data` would re-select
  // the skeleton forever and this error state would be unreachable dead code.
  if (error) {
    return (
      <PermissionRedirect permission="data:read">
        <ErrorState
          message={error instanceof Error ? error.message : labels.quality.loadError}
          onRetry={() =>
            [dashboardQuery, scoreQuery, trendQuery, modelsQuery, sourcesQuery]
              .filter((query) => query.error)
              .forEach((query) => void query.refetch())
          }
        />
      </PermissionRedirect>
    );
  }

  if (isLoading || !scoreQuery.data) {
    return (
      <PermissionRedirect permission="data:read">
        <div className="space-y-6">
          <PageHeader eyebrow={labels.quality.pageEyebrow} title={labels.quality.pageTitle} description={labels.quality.pageLoadingDesc} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.42fr_0.58fr]">
            <LoadingSkeleton variant="card" />
            <LoadingSkeleton variant="chart" />
          </div>
          <LoadingSkeleton variant="table" count={6} />
        </div>
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="data:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.quality.pageEyebrow}
          title={labels.quality.pageTitle}
          description={labels.quality.pageDesc}
          actions={
            <Button
              type="button"
              onClick={() => {
                setEditingRule(null);
                setFormOpen(true);
              }}
            >
              <Plus className="me-2 h-4 w-4" />
              {labels.quality.createRule}
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.42fr_0.58fr]">
          <QualityScoreGauge score={scoreQuery.data} />
          <div className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h3 className="font-medium">{labels.quality.trendCardTitle}</h3>
            </div>
            <QualityTrendChart trend={trendQuery.data ?? []} />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-h4 font-semibold">{labels.quality.modelScoresHeading}</h3>
          <QualityModelCards items={scoreQuery.data.model_scores} />
        </div>

        <DataTable
          {...tableProps}
          columns={buildQualityRuleColumns({
            labels,
            runningId,
            togglingId,
            deletingId,
            onRun: (rule) => void runRule(rule),
            onEdit: (rule) => {
              setEditingRule(rule);
              setFormOpen(true);
            },
            onToggleEnabled: (rule, enabled) => void toggleRule(rule, enabled),
            onDelete: (rule) => void deleteRule(rule),
          })}
          filters={qualityRuleFilters}
          savedViews={{ routeKey: 'data-quality-rules' }}
          searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={labels.quality.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
          emptyState={{
            icon: ShieldCheck,
            title: labels.quality.emptyTitle,
            description: labels.quality.emptyDesc,
          }}
        />

        <QualityResultDialog
          open={Boolean(selectedResult)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedResult(null);
            }
          }}
          result={selectedResult}
        />

        <QualityRuleForm
          open={formOpen}
          onOpenChange={(open) => {
            setFormOpen(open);
            if (!open) {
              setEditingRule(null);
            }
          }}
          models={modelsQuery.data?.data ?? []}
          sources={sourcesQuery.data?.data ?? []}
          rule={editingRule}
          submitting={submittingRule}
          onSubmit={(values) => void submitRule(values)}
        />
      </div>
    </PermissionRedirect>
  );
}
