'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { Archive, ArrowLeft, MoreHorizontal, Pencil, ShieldCheck, Upload } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ModelQualityRules } from '@/app/(dashboard)/data/models/_components/model-quality-rules';
import { ModelSchemaViewer } from '@/app/(dashboard)/data/models/_components/model-schema-viewer';
import { ModelVersionHistory } from '@/app/(dashboard)/data/models/_components/model-version-history';
import { EditModelDialog } from '@/app/(dashboard)/data/models/_components/edit-model-dialog';
import { ModelValidationDialog } from '@/app/(dashboard)/data/models/_components/model-validation-dialog';
import { dataSuiteApi, type ModelValidationResult } from '@/lib/data-suite';
import { formatMaybeDateTime, getClassificationBadge } from '@/lib/data-suite/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

export default function DataModelDetailPage() {
  const labels = useDataLabels();
  const params = useParams<{ id: string }>();
  const modelId = params?.id ?? '';

  const [editOpen, setEditOpen] = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ModelValidationResult | null>(null);
  const [lifecyclePending, setLifecyclePending] = useState(false);

  const [modelQuery, versionsQuery, lineageQuery, rulesQuery] = useQueries({
    queries: [
      { queryKey: ['data-model', modelId], queryFn: () => dataSuiteApi.getModel(modelId) },
      { queryKey: ['data-model-versions', modelId], queryFn: () => dataSuiteApi.getModelVersions(modelId) },
      { queryKey: ['data-model-lineage', modelId], queryFn: () => dataSuiteApi.getModelLineage(modelId) },
      {
        queryKey: ['data-model-rules', modelId],
        queryFn: () =>
          dataSuiteApi.listQualityRules({
            page: 1,
            per_page: 200,
            sort: 'updated_at',
            order: 'desc',
            filters: { model_id: modelId },
          }),
      },
    ],
  });

  const model = modelQuery.data;
  const error = [modelQuery, versionsQuery, lineageQuery, rulesQuery].find((query) => query.error)?.error;

  const validateModel = async () => {
    setValidateOpen(true);
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await dataSuiteApi.validateModel(modelId);
      setValidationResult(result);
    } catch (err) {
      showApiError(err);
      setValidateOpen(false);
    } finally {
      setValidating(false);
    }
  };

  // Publish mints a real immutable version via POST /models/{id}/versions —
  // it freezes the current definition into a new head row (new id + bumped
  // version) and stamps publish provenance (published_at/published_by). Deprecate
  // is a status transition on the existing head, so it stays on the Update
  // endpoint (PUT /models/{id}).
  const publishVersion = async () => {
    try {
      setLifecyclePending(true);
      await dataSuiteApi.publishModelVersion(modelId);
      showSuccess(labels.models.modelPublished);
      // Publish returns a new head version row; refetch so the current model and
      // the version-history tab reflect the freshly published row.
      void modelQuery.refetch();
      void versionsQuery.refetch();
    } catch (err) {
      showApiError(err);
    } finally {
      setLifecyclePending(false);
    }
  };

  const changeStatus = async (status: 'deprecated', successTitle: string) => {
    try {
      setLifecyclePending(true);
      await dataSuiteApi.updateModel(modelId, { status });
      showSuccess(successTitle);
      void modelQuery.refetch();
      void versionsQuery.refetch();
    } catch (err) {
      showApiError(err);
    } finally {
      setLifecyclePending(false);
    }
  };

  if (modelQuery.isLoading || !model) {
    return (
      <PermissionRedirect permission="data:read">
        <div className="space-y-6">
          <PageHeader eyebrow="Data Model" title={labels.models.loadingTitle} description={labels.models.loadingDesc} />
          <LoadingSkeleton variant="card" />
        </div>
      </PermissionRedirect>
    );
  }

  if (error) {
    return (
      <PermissionRedirect permission="data:read">
        <ErrorState message={error instanceof Error ? error.message : labels.models.loadError} onRetry={() => void modelQuery.refetch()} />
      </PermissionRedirect>
    );
  }

  const classification = getClassificationBadge(model.data_classification);

  return (
    <PermissionRedirect permission="data:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Data Model"
          title={model.display_name || model.name}
          description={model.description || labels.models.detailDescFallback}
          actions={
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void validateModel()} disabled={validating}>
                <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
                {validating ? labels.models.validating : labels.models.validateModel}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={labels.models.modelActions}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <Pencil className="me-2 h-4 w-4" />
                    {labels.common.edit}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void publishVersion()}
                    disabled={lifecyclePending}
                  >
                    <Upload className="me-2 h-4 w-4" />
                    {labels.models.publishVersion}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void changeStatus('deprecated', labels.models.modelDeprecated)}
                    disabled={lifecyclePending || model.status === 'deprecated'}
                    className="text-destructive focus:text-destructive"
                  >
                    <Archive className="me-2 h-4 w-4" />
                    {labels.models.deprecate}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button variant="outline" size="sm" asChild>
                <Link href="/data/models">
                  <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
                  {labels.models.backToModels}
                </Link>
              </Button>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label={labels.common.status} value={model.status} />
          <SummaryCard label={labels.models.sFields} value={model.field_count.toLocaleString()} />
          <SummaryCard label={labels.models.sPiiColumns} value={model.pii_columns.length.toLocaleString()} />
          <SummaryCard label={labels.models.sUpdated} value={formatMaybeDateTime(model.updated_at)} />
        </div>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <span className="text-sm text-muted-foreground">{labels.models.classification}</span>
            <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${classification.className}`}>
              {classification.label}
            </span>
            {model.source_id ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/data/sources/${model.source_id}`}>{labels.models.openSource}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Tabs defaultValue="schema">
          <TabsList>
            <TabsTrigger value="schema">{labels.models.tabSchema}</TabsTrigger>
            <TabsTrigger value="quality">{labels.models.tabQualityRules}</TabsTrigger>
            <TabsTrigger value="lineage">{labels.models.tabLineage}</TabsTrigger>
            <TabsTrigger value="versions">{labels.models.tabVersions}</TabsTrigger>
          </TabsList>

          <TabsContent value="schema">
            <ModelSchemaViewer model={model} />
          </TabsContent>
          <TabsContent value="quality">
            <ModelQualityRules rules={rulesQuery.data?.data ?? []} />
          </TabsContent>
          <TabsContent value="lineage">
            <Card>
              <CardContent className="space-y-4 py-4">
                <div className="text-sm">
                  {labels.models.upstreamSource(lineageQuery.data?.source?.name ?? '—')}
                </div>
                <div className="text-sm">
                  {labels.models.sourceTableLine(lineageQuery.data?.source_table?.name ?? '—')}
                </div>
                <div className="text-sm">
                  {labels.models.consumers(String(lineageQuery.data?.consumers?.length ?? 0))}
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/data/lineage?type=data_model&id=${model.id}`}>{labels.sourcesDetail.openFullLineage}</Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="versions">
            <ModelVersionHistory versions={versionsQuery.data ?? []} currentModelId={model.id} />
          </TabsContent>
        </Tabs>

        <EditModelDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          model={model}
          onUpdated={() => {
            void modelQuery.refetch();
          }}
        />

        <ModelValidationDialog
          open={validateOpen}
          onOpenChange={setValidateOpen}
          result={validationResult}
          isValidating={validating}
        />
      </div>
    </PermissionRedirect>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold capitalize">{value}</div>
    </div>
  );
}
