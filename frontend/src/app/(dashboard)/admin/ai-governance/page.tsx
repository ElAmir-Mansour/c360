'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { AIDashboardModelRow, AIModelVersion, AIRegisteredModel } from '@/types/ai-governance';
import { createModelColumns } from './_components/model-columns';
import { ModelCard } from './_components/model-card';
import { ModelFormDialog } from './_components/model-form-dialog';
import { PromoteDialog } from './_components/promote-dialog';
import { RollbackDialog } from './_components/rollback-dialog';
import { useAdminT } from '../_lib/admin-i18n';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export default function AIGovernancePage() {
  const labels = useAdminT();
  const { locale } = useLocaleOrDefault();
  const dashboardQuery = useQuery({
    queryKey: ['ai-dashboard'],
    queryFn: () => enterpriseApi.ai.getDashboard(),
  });

  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [modelFormOpen, setModelFormOpen] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState<{ model: AIRegisteredModel; version: AIModelVersion } | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<AIRegisteredModel | null>(null);

  const { tableProps, refetch } = useDataTable<AIDashboardModelRow>({
    queryKey: 'ai-models',
    fetchFn: (params) => enterpriseApi.ai.listModels(params).then((response) => ({
      data: (response.data ?? []).map((item) => ({
        id: item.model.id,
        name: item.model.name,
        slug: item.model.slug,
        suite: item.model.suite,
        type: item.model.model_type,
        risk_tier: item.model.risk_tier,
        status: item.model.status,
        production_version: item.production_version ?? undefined,
        shadow_version: item.shadow_version ?? undefined,
        predictions_24h: dashboardQuery.data?.models.find((row) => row.id === item.model.id)?.predictions_24h ?? 0,
        avg_confidence: dashboardQuery.data?.models.find((row) => row.id === item.model.id)?.avg_confidence ?? undefined,
        drift_status: dashboardQuery.data?.models.find((row) => row.id === item.model.id)?.drift_status ?? 'none',
      })),
      meta: response.meta,
    })),
    defaultPageSize: 20,
    defaultSort: { column: 'name', direction: 'asc' },
  });

  const handlePromote = useCallback((row: AIDashboardModelRow) => {
    const targetVersion = row.shadow_version;
    if (!targetVersion) {
      return;
    }
    setPromoteTarget({
      model: {
        id: row.id,
        tenant_id: '',
        name: row.name,
        slug: row.slug,
        description: '',
        model_type: row.type,
        suite: row.suite,
        risk_tier: row.risk_tier,
        status: row.status,
        tags: [],
        metadata: {},
        created_by: '',
        created_at: '',
        updated_at: '',
      },
      version: targetVersion,
    });
  }, []);

  const handleStartShadow = useCallback(async (row: AIDashboardModelRow) => {
    try {
      setBusyModelId(row.id);
      const versions = await enterpriseApi.ai.listVersions(row.id);
      const candidate = versions.find((version) => version.status === 'staging')
        ?? versions.find((version) => version.status === 'development');
      if (!candidate) {
        throw new Error(labels.aiGovernance.noStagingVersion);
      }
      await enterpriseApi.ai.startShadow(row.id, { version_id: candidate.id });
      showSuccess(labels.aiGovernance.shadowStarted, labels.aiGovernance.shadowStartedDetail(row.slug, candidate.version_number));
      await Promise.all([dashboardQuery.refetch(), refetch()]);
    } catch (error) {
      showApiError(error);
    } finally {
      setBusyModelId(null);
    }
  }, [dashboardQuery, refetch, labels.aiGovernance]);

  const columns = useMemo(
    () =>
      createModelColumns({
        busyModelId,
        onPromote: handlePromote,
        onRollback: (row) =>
          setRollbackTarget({
            id: row.id,
            tenant_id: '',
            name: row.name,
            slug: row.slug,
            description: '',
            model_type: row.type,
            suite: row.suite,
            risk_tier: row.risk_tier,
            status: row.status,
            tags: [],
            metadata: {},
            created_by: '',
            created_at: '',
            updated_at: '',
          }),
        onStartShadow: handleStartShadow,
        locale,
      }),
    [busyModelId, handlePromote, handleStartShadow, locale],
  );

  const kpis = dashboardQuery.data?.kpis;

  return (
    <PermissionRedirect permission="admin:read">
      <div className="space-y-6">
        <PageHeader
          title={labels.aiGovernance.title}
          description={labels.aiGovernance.description}
          actions={
            <div className="flex items-center gap-2">
              <Button onClick={() => setModelFormOpen(true)}>
                <Plus className="me-1.5 h-4 w-4" />
                {labels.aiGovernance.registerModel}
              </Button>
              <Button variant="outline" onClick={() => void Promise.all([dashboardQuery.refetch(), refetch()])}>
                {labels.aiGovernance.refresh}
              </Button>
            </div>
          }
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <ModelCard label={labels.aiGovernance.kpiTotalModels} value={kpis?.total_models ?? 0} tone="sky" helper={labels.aiGovernance.kpiTotalModelsHelper} />
          <ModelCard label={labels.aiGovernance.kpiInProduction} value={kpis?.in_production ?? 0} tone="emerald" helper={labels.aiGovernance.kpiInProductionHelper} />
          <ModelCard label={labels.aiGovernance.kpiShadowTesting} value={kpis?.shadow_testing ?? 0} tone="gold" helper={labels.aiGovernance.kpiShadowTestingHelper} />
          <ModelCard label={labels.aiGovernance.kpiPredictions24h} value={(kpis?.predictions_24h ?? 0).toLocaleString()} tone="sky" helper={labels.aiGovernance.kpiPredictions24hHelper} />
          <ModelCard label={labels.aiGovernance.kpiDriftAlerts} value={kpis?.drift_alerts ?? 0} tone="rose" helper={labels.aiGovernance.kpiDriftAlertsHelper} />
        </section>

        <div className="rounded-3xl border border-border/70 bg-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3 text-primary">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-h3 font-semibold">{labels.aiGovernance.modelRegistry}</h2>
              <p className="text-sm text-muted-foreground">
                {labels.aiGovernance.modelRegistryHint}
              </p>
            </div>
          </div>
          <DataTable
            {...tableProps}
            columns={columns}
            emptyState={{
              icon: Bot,
              title: labels.aiGovernance.noModelsFound,
              description: labels.aiGovernance.noModelsFoundDescription,
            }}
          />
        </div>
      </div>

      <PromoteDialog
        open={Boolean(promoteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setPromoteTarget(null);
          }
        }}
        model={promoteTarget?.model ?? null}
        version={promoteTarget?.version ?? null}
        onSaved={() => {
          void Promise.all([dashboardQuery.refetch(), refetch()]);
        }}
      />

      <ModelFormDialog
        open={modelFormOpen}
        onOpenChange={setModelFormOpen}
        onSaved={() => {
          void Promise.all([dashboardQuery.refetch(), refetch()]);
        }}
      />

      <RollbackDialog
        open={Boolean(rollbackTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRollbackTarget(null);
          }
        }}
        model={rollbackTarget}
        onSaved={() => {
          void Promise.all([dashboardQuery.refetch(), refetch()]);
        }}
      />
    </PermissionRedirect>
  );
}
