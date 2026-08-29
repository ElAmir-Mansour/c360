'use client';

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Gavel, Plus, ShieldCheck, ShieldOff, Unlock } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { StatTile } from '@/components/shared/stat-tile';
import { DataTable } from '@/components/shared/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { fetchSuitePaginated } from '@/lib/suite-api';
import type { FilterConfig, RowAction } from '@/types/table';
import {
  legalHoldsApi,
  LEGAL_HOLD_STATUS_VALUES,
  LEGAL_HOLD_SUBJECT_TYPE_VALUES,
  type LegalHold,
} from '@/lib/lex/legal-holds';
import { LegalHoldFormDialog } from './_components/legal-hold-form-dialog';
import { LegalHoldReleaseDialog } from './_components/legal-hold-release-dialog';
import { statusLabel, subjectTypeLabel, useLegalHoldCopy } from './_components/legal-hold-copy';

const LEGAL_HOLDS_ENDPOINT = '/api/v1/lex/legal-holds';

// View gate mirrors the backend list tier (coarse `lex:read`); mutating actions
// (apply/release) are gated on `lex:write`, matching handler/routes.go.
const VIEW_REQUIREMENT = 'lex:read';

export default function LegalHoldsPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const format = useLexFormat();
  const copy = useLegalHoldCopy();
  const canWrite = hasPermission('lex:write');

  const [createOpen, setCreateOpen] = useState(false);
  const [releasing, setReleasing] = useState<LegalHold | null>(null);

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'subject_type',
        label: copy.filters.subjectType,
        type: 'select',
        options: LEGAL_HOLD_SUBJECT_TYPE_VALUES.map((value) => ({
          label: subjectTypeLabel(value, locale),
          value,
        })),
      },
      {
        key: 'status',
        label: copy.filters.status,
        type: 'select',
        options: LEGAL_HOLD_STATUS_VALUES.map((value) => ({
          label: statusLabel(value, locale),
          value,
        })),
      },
      { key: 'reference', label: copy.filters.reference, type: 'text' },
    ],
    [copy, locale],
  );

  const { tableProps, totalRows } = useDataTable<LegalHold>({
    queryKey: 'lex-admin-legal-holds',
    fetchFn: (params) => fetchSuitePaginated<LegalHold>(LEGAL_HOLDS_ENDPOINT, params),
    defaultPageSize: 25,
    defaultSort: { column: 'applied_at', direction: 'desc' },
    wsTopics: ['lex.legal-holds'],
  });

  const rows = tableProps.data;
  const stats = useMemo(() => {
    let active = 0;
    let released = 0;
    for (const row of rows) {
      if (row.status === 'active') active += 1;
      else if (row.status === 'released') released += 1;
    }
    return { total: totalRows, active, released };
  }, [rows, totalRows]);

  const columns: ColumnDef<LegalHold>[] = [
    {
      id: 'reference',
      header: copy.columns.reference,
      cell: ({ row }) => <span className="font-medium">{row.original.reference || copy.noReference}</span>,
    },
    {
      id: 'subject',
      header: copy.columns.subject,
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <Badge variant="secondary" className="w-fit">
            {subjectTypeLabel(row.original.subject_type, locale)}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground" title={row.original.subject_id}>
            {row.original.subject_id.slice(0, 8)}
          </span>
        </div>
      ),
    },
    {
      id: 'reason',
      header: copy.columns.reason,
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-md text-sm text-muted-foreground">{row.original.reason}</span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: copy.columns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'active' ? 'default' : 'outline'}>
          {statusLabel(row.original.status, locale)}
        </Badge>
      ),
    },
    {
      id: 'custodian',
      header: copy.columns.custodian,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.custodian || '—'}</span>,
    },
    {
      id: 'appliedAt',
      accessorKey: 'applied_at',
      header: copy.columns.appliedAt,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{format.formatDate(row.original.applied_at)}</span>
      ),
    },
  ];

  const rowActions = (hold: LegalHold): RowAction<LegalHold>[] => {
    if (!canWrite || hold.status !== 'active') return [];
    return [
      {
        label: copy.actions.release,
        icon: Unlock,
        onClick: (row) => setReleasing(row),
      },
    ];
  };

  return (
    <LexAccessGuard requirement={VIEW_REQUIREMENT} resourceName={copy.pageTitle}>
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          eyebrow={copy.eyebrow}
          title={copy.pageTitle}
          description={copy.pageDescription}
          actions={
            canWrite ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="me-1.5 h-4 w-4" />
                {copy.apply}
              </Button>
            ) : undefined
          }
        />

        <div className="legal-hold-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label={copy.stats.total}
            value={stats.total}
            themeClass="kpi-theme-primary"
            icon={Gavel}
            loading={tableProps.isLoading}
            size="md"
            appearance="operational"
            className="legal-hold-kpi-card"
            href="/lex/admin/legal-holds"
          />
          <StatTile
            label={copy.stats.active}
            value={stats.active}
            themeClass="kpi-theme-red"
            icon={ShieldCheck}
            loading={tableProps.isLoading}
            size="md"
            appearance="operational"
            className="legal-hold-kpi-card"
            href="/lex/admin/legal-holds?status=active"
          />
          <StatTile
            label={copy.stats.released}
            value={stats.released}
            themeClass="kpi-theme-emerald"
            icon={ShieldOff}
            loading={tableProps.isLoading}
            size="md"
            appearance="operational"
            className="legal-hold-kpi-card"
            href="/lex/admin/legal-holds?status=released"
          />
        </div>

        <DataTable
          {...tableProps}
          columns={columns}
          filters={filters}
          getRowId={(row) => row.id}
          rowActions={canWrite ? rowActions : undefined}
          emptyState={{
            icon: Gavel,
            title: copy.emptyTitle,
            description: copy.emptyDescription,
          }}
        />

        {canWrite ? (
          <>
            <LegalHoldFormDialog open={createOpen} onOpenChange={setCreateOpen} />
            <LegalHoldReleaseDialog
              hold={releasing}
              open={releasing !== null}
              onOpenChange={(o) => !o && setReleasing(null)}
            />
          </>
        ) : null}
      </div>
    </LexAccessGuard>
  );
}
