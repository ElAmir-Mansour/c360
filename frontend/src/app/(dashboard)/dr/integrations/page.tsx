'use client';

import { useState } from 'react';
import { Plus, Plug, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/common/empty-state';
import { useAuth } from '@/hooks/use-auth';
import {
  useCreateDRIntegration,
  useDeleteDRIntegration,
  useDRIntegrations,
  useTestDRIntegration,
  useUpdateDRIntegration,
} from '@/hooks/use-dr-integrations';
import type { DRCreateIntegrationRequest, DRIntegration } from '@/lib/clario-dr';
import { IntegrationFormDialog } from './_components/integration-form-dialog';
import { IntegrationHealthHeader } from './_components/integration-health-header';
import {
  isIntegrationsFeatureDisabled,
  summarizeIntegrationHealth,
  useIntegrationHealthLabels,
} from './_components/integration-health';
import { IntegrationsDisabledNotice } from './_components/integrations-disabled-notice';
import { IntegrationsFirstRun } from './_components/integrations-first-run';
import { IntegrationsTable } from './_components/integrations-table';

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export default function DRIntegrationsPage() {
  const copy = useIntegrationHealthLabels();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('dr:write');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DRIntegration | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DRIntegration | null>(null);
  const [testingAll, setTestingAll] = useState(false);

  const integrationsQuery = useDRIntegrations();
  const createMutation = useCreateDRIntegration();
  const updateMutation = useUpdateDRIntegration();
  const deleteMutation = useDeleteDRIntegration();
  const testMutation = useTestDRIntegration();

  const integrations = integrationsQuery.data ?? [];
  const submitting = createMutation.isPending || updateMutation.isPending;
  const healthSummary = summarizeIntegrationHealth(integrations);
  // The feature is "not enabled" (DR_INTEGRATIONS_ENC_KEY unset → router not
  // mounted → 404) rather than genuinely failing. This is informational, so it
  // pre-empts both the error and empty branches, and suppresses the create CTA.
  const featureDisabled =
    integrationsQuery.isError &&
    isIntegrationsFeatureDisabled(integrationsQuery.error);
  const showCreateAction = canWrite && !featureDisabled;
  const isEmpty =
    !integrationsQuery.isLoading &&
    !integrationsQuery.isError &&
    integrations.length === 0;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (integration: DRIntegration) => {
    setEditing(integration);
    setDialogOpen(true);
  };

  const handleSubmit = async (payload: DRCreateIntegrationRequest) => {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, payload });
        toast.success(copy.toastUpdated(payload.name));
      } else {
        await createMutation.mutateAsync(payload);
        toast.success(copy.toastCreated(payload.name));
      }
      setDialogOpen(false);
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error, copy.toastSaveFailed));
    }
  };

  const handleTest = async (integration: DRIntegration) => {
    try {
      const result = await testMutation.mutateAsync(integration.id);
      if (result.status === 'error') {
        toast.error(
          result.last_test_error
            ? copy.toastTestFailedWithError(result.last_test_error)
            : copy.toastTestFailedFor(integration.name),
        );
      } else {
        toast.success(copy.toastTestSucceededFor(integration.name));
      }
    } catch (error) {
      toast.error(errorMessage(error, copy.toastTestFailedGeneric));
    }
  };

  const handleTestAll = async () => {
    if (testingAll || integrations.length === 0) return;
    setTestingAll(true);
    let failures = 0;
    try {
      // Fan out the real per-integration connection test sequentially so the
      // backend is never hit with a thundering herd; tally the DRIntegrationTestResult
      // outcomes for a single summary toast.
      for (const integration of integrations) {
        try {
          const result = await testMutation.mutateAsync(integration.id);
          if (result.status === 'error') failures += 1;
        } catch {
          failures += 1;
        }
      }
      if (failures === 0) {
        toast.success(copy.toastTestAllSucceeded(integrations.length));
      } else {
        toast.error(copy.toastTestAllFailed(failures, integrations.length));
      }
    } finally {
      setTestingAll(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteCandidate) return;
    try {
      await deleteMutation.mutateAsync(deleteCandidate.id);
      toast.success(copy.toastDeleted(deleteCandidate.name));
      setDeleteCandidate(null);
    } catch (error) {
      toast.error(errorMessage(error, copy.toastDeleteFailed));
      throw error;
    }
  };

  return (
    <PermissionRedirect permission="dr:read">
      <div className="space-y-6">
        <PageHeader
          title={copy.pageTitle}
          description={copy.pageDescription}
          actions={
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => void integrationsQuery.refetch()}
                disabled={integrationsQuery.isFetching}
              >
                <RefreshCw
                  className={`me-2 h-4 w-4 ${integrationsQuery.isFetching ? 'animate-spin' : ''}`}
                />
                {copy.refreshAction}
              </Button>
              {showCreateAction ? (
                <Button onClick={openCreate}>
                  <Plus className="me-2 h-4 w-4" />
                  {copy.emptyAction}
                </Button>
              ) : null}
            </div>
          }
        />

        {featureDisabled ? (
          <IntegrationsDisabledNotice copy={copy} />
        ) : integrationsQuery.isError ? (
          <ErrorState
            title={copy.loadErrorTitle}
            message={errorMessage(integrationsQuery.error, copy.loadErrorMessage)}
            onRetry={() => void integrationsQuery.refetch()}
          />
        ) : isEmpty ? (
          <div className="space-y-4">
            {/* Prominent first-run on-ramp: makes "connect a source" the explicit
                first step before any replication can run. The compact empty card
                below it keeps the existing add affordance + read-only copy. */}
            <IntegrationsFirstRun copy={copy} canWrite={canWrite} onConnect={openCreate} />
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={Plug}
                  title={copy.emptyTitle}
                  description={canWrite ? copy.emptyDescription : copy.emptyReadOnlyDescription}
                  action={canWrite ? { label: copy.emptyAction, onClick: openCreate } : undefined}
                  size="compact"
                />
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {!integrationsQuery.isLoading && integrations.length > 0 ? (
              <IntegrationHealthHeader
                summary={healthSummary}
                canWrite={canWrite}
                testingAll={testingAll}
                onTestAll={() => void handleTestAll()}
              />
            ) : null}
            <IntegrationsTable
              integrations={integrations}
              loading={integrationsQuery.isLoading}
              canWrite={canWrite}
              testingId={
                testMutation.isPending ? testMutation.variables ?? null : null
              }
              onEdit={openEdit}
              onTest={(integration) => void handleTest(integration)}
              onDelete={setDeleteCandidate}
            />
          </>
        )}

        <IntegrationFormDialog
          open={dialogOpen}
          onOpenChange={(next) => {
            setDialogOpen(next);
            if (!next) setEditing(null);
          }}
          integration={editing}
          submitting={submitting}
          onSubmit={handleSubmit}
        />

        {deleteCandidate ? (
          <ConfirmDialog
            open={Boolean(deleteCandidate)}
            onOpenChange={(next) => !next && setDeleteCandidate(null)}
            title={copy.deleteTitle}
            description={copy.deleteDescription(deleteCandidate.name)}
            confirmLabel={copy.deleteConfirm}
            variant="destructive"
            loading={deleteMutation.isPending}
            onConfirm={handleDelete}
          />
        ) : null}
      </div>
    </PermissionRedirect>
  );
}
