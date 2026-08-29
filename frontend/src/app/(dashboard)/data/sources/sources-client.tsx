'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FolderOpen, LayoutGrid, Rows3 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/shared/forms/search-input';
import { DataTableToolbar } from '@/components/shared/data-table/data-table-toolbar';
import { useDataTable } from '@/hooks/use-data-table';
import { dataSuiteApi, type ConnectionTestResult, type DataSource } from '@/lib/data-suite';
import { showApiError, showSuccess } from '@/lib/toast';
import type { FilterConfig } from '@/types/table';
import { CreateSourceWizard } from '@/app/(dashboard)/data/sources/_components/create-source-wizard';
import { EditSourceDialog } from '@/app/(dashboard)/data/sources/_components/edit-source-dialog';
import { SourceGridView } from '@/app/(dashboard)/data/sources/_components/source-grid-view';
import { SourceTableView } from '@/app/(dashboard)/data/sources/_components/source-table-view';
import { SyncProgressIndicator } from '@/app/(dashboard)/data/sources/_components/sync-progress-indicator';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

type TestState = {
  loading: boolean;
  result?: ConnectionTestResult | null;
  error?: string | null;
};

/**
 * Interactive body of the Data Sources screen. Owns every client hook
 * (router/search-params, data-table state, connection-test/sync/delete/toggle
 * handlers + dialog state) so the server `page.tsx` shell stays static.
 * See docs/frontend/rsc-shell-pattern.md.
 */
export function DataSourcesClient() {
  const labels = useDataLabels();
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = pathname ?? '/data/sources';
  const searchParams = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<DataSource | null>(null);
  const [syncSource, setSyncSource] = useState<DataSource | null>(null);
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [statusToggleSource, setStatusToggleSource] = useState<DataSource | null>(null);
  const [togglingStatus, setTogglingStatus] = useState(false);

  const sourceFilters: FilterConfig[] = [
    {
      key: 'type',
      label: labels.sources.filterType,
      type: 'multi-select',
      options: [
        { label: 'PostgreSQL', value: 'postgresql' },
        { label: 'MySQL', value: 'mysql' },
        { label: 'ClickHouse', value: 'clickhouse' },
        { label: 'Dolt', value: 'dolt' },
        { label: 'Apache Impala', value: 'impala' },
        { label: 'Apache Hive', value: 'hive' },
        { label: 'HDFS', value: 'hdfs' },
        { label: 'Apache Spark', value: 'spark' },
        { label: 'Dagster', value: 'dagster' },
        { label: 'API', value: 'api' },
        { label: 'CSV', value: 'csv' },
        { label: 'S3', value: 's3' },
        { label: 'Stream', value: 'stream' },
      ],
    },
    {
      key: 'status',
      label: labels.sources.filterStatus,
      type: 'multi-select',
      options: [
        { label: labels.sources.statusActive, value: 'active' },
        { label: labels.sources.statusSyncing, value: 'syncing' },
        { label: labels.sources.statusInactive, value: 'inactive' },
        { label: labels.sources.statusError, value: 'error' },
        { label: labels.sources.statusPendingTest, value: 'pending_test' },
      ],
    },
  ];

  const view = searchParams?.get('view') === 'table' ? 'table' : 'cards';

  const { tableProps, searchValue, setSearch, refetch } = useDataTable<DataSource>({
    queryKey: 'data-sources',
    fetchFn: (params) => dataSuiteApi.listSources(params),
    defaultPageSize: 24,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });

  const sources = tableProps.data;
  const hasSources = sources.length > 0;

  const viewActions = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant={view === 'cards' ? 'default' : 'outline'}
          onClick={() => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('view', 'cards');
            router.push(`${currentPath}?${params.toString()}`);
          }}
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant={view === 'table' ? 'default' : 'outline'}
          onClick={() => {
            const params = new URLSearchParams(searchParams?.toString() ?? '');
            params.set('view', 'table');
            router.push(`${currentPath}?${params.toString()}`);
          }}
        >
          <Rows3 className="h-4 w-4" />
        </Button>
      </div>
    ),
    [currentPath, router, searchParams, view],
  );

  const clearTestStateLater = (sourceId: string) => {
    window.setTimeout(() => {
      setTestStates((current) => {
        const next = { ...current };
        delete next[sourceId];
        return next;
      });
    }, 10_000);
  };

  const handleTest = async (source: DataSource) => {
    setTestStates((current) => ({ ...current, [source.id]: { loading: true } }));
    try {
      const result = await dataSuiteApi.testSource(source.id);
      setTestStates((current) => ({ ...current, [source.id]: { loading: false, result } }));
      clearTestStateLater(source.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : labels.sources.connectionTestFailed;
      setTestStates((current) => ({ ...current, [source.id]: { loading: false, error: message } }));
      clearTestStateLater(source.id);
    }
  };

  const handleSync = async (source: DataSource) => {
    try {
      await dataSuiteApi.syncSource(source.id, 'full');
      setSyncSource(source);
      showSuccess(labels.sources.syncStarted, labels.sources.syncStartedDesc(source.name));
    } catch (error) {
      showApiError(error);
    }
  };

  const handleDelete = async (source: DataSource) => {
    if (!window.confirm(labels.sources.confirmDeleteSource(source.name))) {
      return;
    }
    try {
      await dataSuiteApi.deleteSource(source.id);
      showSuccess(labels.sources.sourceDeleted);
      void refetch();
    } catch (error) {
      showApiError(error);
    }
  };

  const handleToggleStatus = async () => {
    if (!statusToggleSource) return;
    const newStatus = statusToggleSource.status === 'active' ? 'inactive' : 'active';
    setTogglingStatus(true);
    try {
      await dataSuiteApi.changeSourceStatus(statusToggleSource.id, newStatus);
      showSuccess(newStatus === 'active' ? labels.sources.sourceActivated : labels.sources.sourceDeactivated);
      setStatusToggleSource(null);
      void refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setTogglingStatus(false);
    }
  };

  return (
    <PermissionRedirect permission="data:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Data Platform"
          title={labels.sources.pageTitle}
          description={labels.sources.pageDesc}
          actions={
            <div className="flex items-center gap-2">
              {viewActions}
              <Button type="button" onClick={() => setWizardOpen(true)}>
                {labels.sources.addSource}
              </Button>
            </div>
          }
        />

        {!hasSources && !tableProps.isLoading ? (
          <EmptyState
            icon={FolderOpen}
            title={labels.sources.emptyTitle}
            description={labels.sources.emptyDesc}
            action={{ label: labels.sources.addSourceShort, onClick: () => setWizardOpen(true) }}
          />
        ) : view === 'cards' ? (
          <div className="space-y-4">
            <DataTableToolbar
              searchSlot={
                <SearchInput
                  value={searchValue}
                  onChange={setSearch}
                  placeholder={labels.sources.searchPlaceholder}
                  loading={tableProps.isLoading}
                />
              }
              filters={sourceFilters}
              activeFilters={tableProps.activeFilters}
              onFilterChange={tableProps.onFilterChange}
              onClearFilters={tableProps.onClearFilters}
            />
            <SourceGridView
              sources={sources}
              testStates={testStates}
              onTest={(source) => void handleTest(source)}
              onSync={(source) => void handleSync(source)}
              onEdit={setEditingSource}
              onDelete={(source) => void handleDelete(source)}
              onToggleStatus={setStatusToggleSource}
            />
          </div>
        ) : (
          <SourceTableView
            tableProps={tableProps}
            searchValue={searchValue}
            setSearch={setSearch}
            filters={sourceFilters}
            onRowClick={(source) => router.push(`/data/sources/${source.id}`)}
            onEdit={setEditingSource}
            onDelete={(source) => void handleDelete(source)}
            onTest={(source) => void handleTest(source)}
            onSync={(source) => void handleSync(source)}
            onToggleStatus={setStatusToggleSource}
          />
        )}

        {view === 'cards' && hasSources ? (
          <div className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm">
            <span>
              {labels.sources.pageOf(String(tableProps.page), String(Math.max(1, Math.ceil(tableProps.totalRows / tableProps.pageSize))))}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={tableProps.page <= 1}
                onClick={() => tableProps.onPageChange(tableProps.page - 1)}
              >
                {labels.sources.previous}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={tableProps.page >= Math.ceil(tableProps.totalRows / tableProps.pageSize)}
                onClick={() => tableProps.onPageChange(tableProps.page + 1)}
              >
                {labels.common.next}
              </Button>
            </div>
          </div>
        ) : null}

        <CreateSourceWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          onCreated={() => void refetch()}
        />

        <EditSourceDialog
          open={Boolean(editingSource)}
          onOpenChange={(next) => {
            if (!next) {
              setEditingSource(null);
            }
          }}
          source={editingSource}
          onUpdated={() => void refetch()}
        />

        <SyncProgressIndicator
          open={Boolean(syncSource)}
          onOpenChange={(next) => {
            if (!next) {
              setSyncSource(null);
            }
          }}
          source={syncSource}
          onComplete={() => void refetch()}
        />

        <ConfirmDialog
          open={Boolean(statusToggleSource)}
          onOpenChange={(open) => { if (!open) setStatusToggleSource(null); }}
          title={statusToggleSource?.status === 'active' ? labels.sources.deactivateTitle : labels.sources.activateTitle}
          description={statusToggleSource?.status === 'active' ? labels.sources.deactivateConfirm(statusToggleSource?.name ?? '') : labels.sources.activateConfirm(statusToggleSource?.name ?? '')}
          confirmLabel={statusToggleSource?.status === 'active' ? labels.sources.deactivate : labels.sources.activate}
          variant={statusToggleSource?.status === 'active' ? 'destructive' : 'default'}
          onConfirm={handleToggleStatus}
          loading={togglingStatus}
        />
      </div>
    </PermissionRedirect>
  );
}
