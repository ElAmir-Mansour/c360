'use client';

import { useState } from 'react';
import { Boxes, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { buildModelColumns } from '@/app/(dashboard)/data/models/_components/model-columns';
import { ModelKpiCards } from '@/app/(dashboard)/data/models/_components/model-kpi-cards';
import { DeriveModelFromSourceDialog } from '@/app/(dashboard)/data/models/_components/derive-model-from-source-dialog';
import { dataSuiteApi, type DataModel } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

export default function DataModelsPage() {
  const labels = useDataLabels();
  const [deriveOpen, setDeriveOpen] = useState(false);
  const { tableProps, searchValue, setSearch } = useDataTable<DataModel>({
    queryKey: 'data-models',
    fetchFn: (params) => dataSuiteApi.listModels(params),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });

  const modelFilters = [
    {
      key: 'status',
      label: labels.common.status,
      type: 'multi-select' as const,
      options: [
        { label: labels.models.fDraft, value: 'draft' },
        { label: labels.pipelines.psActive, value: 'active' },
        { label: labels.models.fDeprecated, value: 'deprecated' },
        { label: labels.models.fArchived, value: 'archived' },
      ],
    },
    {
      key: 'data_classification',
      label: labels.models.classification,
      type: 'multi-select' as const,
      options: [
        { label: labels.models.clPublic, value: 'public' },
        { label: labels.models.clInternal, value: 'internal' },
        { label: labels.models.clConfidential, value: 'confidential' },
        { label: labels.models.clRestricted, value: 'restricted' },
      ],
    },
  ];

  return (
    <PermissionRedirect permission="data:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Data Platform"
          title={labels.models.pageTitle}
          description={labels.models.pageDesc}
          tags={[
            { label: labels.models.tagSemantic, tone: 'info' },
            { label: labels.models.tagVersioned, tone: 'primary' },
            { label: labels.models.tagQualityGoverned, tone: 'success' },
          ]}
          actions={
            <Button type="button" onClick={() => setDeriveOpen(true)}>
              <Plus className="me-2 h-4 w-4" />
              {labels.sourcesDetail.deriveModelTitle}
            </Button>
          }
        />

        <ModelKpiCards />

        <DataTable
          {...tableProps}
          columns={buildModelColumns(labels)}
          filters={modelFilters}
          searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={labels.models.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
          emptyState={{
            icon: Boxes,
            title: labels.models.emptyTitle,
            description: labels.models.emptyDesc,
            action: {
              label: labels.models.deriveFirst,
              icon: Plus,
              onClick: () => setDeriveOpen(true),
            },
          }}
        />

        <DeriveModelFromSourceDialog open={deriveOpen} onOpenChange={setDeriveOpen} />
      </div>
    </PermissionRedirect>
  );
}
