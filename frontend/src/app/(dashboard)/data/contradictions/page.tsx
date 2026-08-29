'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { useDataTable } from '@/hooks/use-data-table';
import { buildContradictionColumns } from '@/app/(dashboard)/data/contradictions/_components/contradiction-columns';
import { ContradictionDetailPanel } from '@/app/(dashboard)/data/contradictions/_components/contradiction-detail-panel';
import { ContradictionResolveDialog } from '@/app/(dashboard)/data/contradictions/_components/contradiction-resolve-dialog';
import { ContradictionScanDialog } from '@/app/(dashboard)/data/contradictions/_components/contradiction-scan-dialog';
import { ContradictionStatBar } from '@/app/(dashboard)/data/contradictions/_components/contradiction-stat-bar';
import { dataSuiteApi, type Contradiction } from '@/lib/data-suite';
import type { ContradictionResolutionValues } from '@/lib/data-suite/forms';
import { showApiError, showSuccess } from '@/lib/toast';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

export default function DataContradictionsPage() {
  const labels = useDataLabels();
  const [selected, setSelected] = useState<Contradiction | null>(null);
  const [resolving, setResolving] = useState<Contradiction | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [submittingResolve, setSubmittingResolve] = useState(false);

  const contradictionFilters = [
    {
      key: 'type',
      label: labels.contradictions.colType,
      type: 'multi-select' as const,
      options: [
        { label: labels.contradictions.ctLogical, value: 'logical' },
        { label: labels.contradictions.ctSemantic, value: 'semantic' },
        { label: labels.contradictions.ctTemporal, value: 'temporal' },
        { label: labels.contradictions.ctAnalytical, value: 'analytical' },
      ],
    },
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
  ];

  const statsQuery = useQuery({
    queryKey: ['data-contradictions-stats'],
    queryFn: () => dataSuiteApi.getContradictionStats(),
  });

  const { tableProps, searchValue, setSearch, refetch } = useDataTable<Contradiction>({
    queryKey: 'data-contradictions',
    fetchFn: (params) => dataSuiteApi.listContradictions(params),
    defaultPageSize: 25,
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: ['contradiction.detected'],
  });

  const updateStatus = async (contradiction: Contradiction, status: string) => {
    try {
      await dataSuiteApi.updateContradictionStatus(contradiction.id, status);
      showSuccess(labels.contradictions.updated);
      void refetch();
      void statsQuery.refetch();
    } catch (error) {
      showApiError(error);
    }
  };

  const resolveContradiction = async (values: ContradictionResolutionValues) => {
    if (!resolving) {
      return;
    }
    try {
      setSubmittingResolve(true);
      await dataSuiteApi.resolveContradiction(resolving.id, values);
      showSuccess(labels.contradictions.resolved);
      setResolving(null);
      setSelected(null);
      void refetch();
      void statsQuery.refetch();
    } catch (error) {
      showApiError(error);
    } finally {
      setSubmittingResolve(false);
    }
  };

  if (statsQuery.isLoading) {
    return (
      <PermissionRedirect permission="data:read">
        <div className="space-y-6">
          <PageHeader eyebrow="Data Platform" title={labels.contradictions.pageTitle} description={labels.contradictions.loadingDesc} />
          <LoadingSkeleton variant="kpi" count={4} />
          <LoadingSkeleton variant="table" count={8} />
        </div>
      </PermissionRedirect>
    );
  }

  if (statsQuery.error || !statsQuery.data) {
    return (
      <PermissionRedirect permission="data:read">
        <ErrorState message={labels.contradictions.loadError} onRetry={() => void statsQuery.refetch()} />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="data:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow="Data Platform"
          title={labels.contradictions.pageTitle}
          description={labels.contradictions.pageDesc}
          actions={
            <Button type="button" onClick={() => setScanOpen(true)}>
              {labels.contradictions.scanNow}
            </Button>
          }
        />

        <ContradictionStatBar
          stats={statsQuery.data}
          activeStatus={tableProps.activeFilters?.status}
          onFilterStatus={(status) => tableProps.onFilterChange?.('status', status)}
        />

        <DataTable
          {...tableProps}
          columns={buildContradictionColumns({ labels, onOpen: setSelected })}
          filters={contradictionFilters}
          searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={labels.contradictions.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
          emptyState={{
            icon: AlertTriangle,
            title: labels.contradictions.emptyTitle,
            description: labels.contradictions.emptyDesc,
          }}
        />

        <ContradictionDetailPanel
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) {
              setSelected(null);
            }
          }}
          contradiction={selected}
          onInvestigate={(item) => void updateStatus(item, 'investigating')}
          onAccept={(item) => void updateStatus(item, 'accepted')}
          onResolve={(item) => setResolving(item)}
          onFalsePositive={(item) => void updateStatus(item, 'false_positive')}
        />

        <ContradictionResolveDialog
          open={Boolean(resolving)}
          onOpenChange={(open) => {
            if (!open) {
              setResolving(null);
            }
          }}
          contradiction={resolving}
          submitting={submittingResolve}
          onSubmit={(values) => void resolveContradiction(values)}
        />

        <ContradictionScanDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onComplete={() => {
            void refetch();
            void statsQuery.refetch();
          }}
        />
      </div>
    </PermissionRedirect>
  );
}
