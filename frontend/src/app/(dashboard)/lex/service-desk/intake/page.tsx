'use client';

/**
 * Intake Triage Queue (`/lex/service-desk/intake`, CAP-001..005, CAP-015).
 *
 * Surfaces email-ingested + direct-submission intake messages that are otherwise
 * invisible, so legal-ops can triage them into the request register. Reuses the
 * shared `useDataTable` / `DataTable` pattern (URL-driven pagination, sort,
 * search, status filter), a KPI header counting the loaded page, and a detail
 * side-sheet with a "Create request from this message" deep-link.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Inbox,
  Paperclip,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatusBadge } from '@/components/shared/status-badge';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { useDataTable } from '@/hooks/use-data-table';
import { useLocale } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { lexRequestsApi, type IntakeMessage } from '@/lib/lex/requests';
import type { StatusConfig } from '@/lib/status-configs';
import { INTAKE_STATUS_OPTIONS, useIntakeLabels } from './_labels';
import { IntakeMessageSheet } from './_intake-message-sheet';
import { SimulateInboundDialog } from './_simulate-inbound-dialog';
import { IntakeKpis, type IntakeKpiScope } from './_intake-kpis';

/**
 * Locale-resolved StatusConfig for intake messages. Co-located per the feature
 * brief: pending = gold/Clock, processed = emerald/CheckCircle, errored =
 * red/AlertTriangle. Colours/icons are decorative semantics only.
 */
function buildIntakeStatusConfig(statusOptions: Record<string, string>): StatusConfig {
  return {
    pending: { label: statusOptions.pending, color: 'yellow', icon: Clock },
    processed: { label: statusOptions.processed, color: 'green', icon: CheckCircle },
    errored: { label: statusOptions.errored, color: 'red', icon: AlertTriangle },
  };
}


export default function IntakeTriagePage() {
  const { locale, direction } = useLocale();
  const { hasPermission } = useAuth();
  const labels = useIntakeLabels();
  const [activeMessage, setActiveMessage] = useState<IntakeMessage | null>(null);
  const [kpiScope, setKpiScope] = useState<IntakeKpiScope | null>(null);

  // The Simulate-Inbound action creates real intake messages + legal_requests, so
  // it is gated on the same mailbox-admin tier as mailbox CRUD
  // (lex:catalog:manage OR coarse lex:write; lex:* / admin:* wildcards satisfy it).
  const canSimulate = hasPermission('lex:catalog:manage') || hasPermission('lex:write');

  const statusConfig = useMemo(
    () => buildIntakeStatusConfig(labels.statusOptions),
    [labels.statusOptions],
  );

  const filters = useMemo(
    () => [
      {
        key: 'status',
        label: labels.filters.status,
        type: 'select' as const,
        options: INTAKE_STATUS_OPTIONS.map((value) => ({
          label: labels.statusOptions[value] ?? value,
          value,
        })),
      },
    ],
    [labels.filters.status, labels.statusOptions],
  );

  const { tableProps, searchValue, setSearch } = useDataTable<IntakeMessage>({
    queryKey: 'lex-intake-messages',
    fetchFn: (params) => lexRequestsApi.listIntakeMessages(params),
    defaultPageSize: 25,
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: ['lex.intake-messages'],
  });

  const rows = tableProps.data;

  const stats = useMemo(() => {
    let pending = 0;
    let processed = 0;
    let errored = 0;
    for (const row of rows) {
      if (row.status === 'pending') pending += 1;
      else if (row.status === 'processed') processed += 1;
      else if (row.status === 'errored') errored += 1;
    }
    return { pending, processed, errored };
  }, [rows]);
  const loadedCount = rows.length;
  const scopedRows = useMemo(
    () => kpiScope ? rows.filter((row) => row.status === kpiScope) : rows,
    [kpiScope, rows],
  );
  const drillIntoKpi = (scope: IntakeKpiScope) => {
    setKpiScope((current) => current === scope ? null : scope);
    window.requestAnimationFrame(() => {
      document.getElementById('intake-message-records')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  const columns: ColumnDef<IntakeMessage>[] = useMemo(
    () => [
      {
        id: 'from_address',
        accessorKey: 'from_address',
        header: labels.columns.from,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.from_address}</span>
        ),
      },
      {
        id: 'subject',
        accessorKey: 'subject',
        header: labels.columns.subject,
        cell: ({ row }) => (
          <span className="block max-w-[28rem] truncate">
            {row.original.subject?.trim() || (
              <span className="text-muted-foreground">{labels.noSubject}</span>
            )}
          </span>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: labels.columns.status,
        enableSorting: true,
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} config={statusConfig} size="sm" />
        ),
      },
      {
        id: 'attachments',
        accessorKey: 'attachment_file_ids',
        header: labels.columns.attachments,
        enableSorting: false,
        cell: ({ row }) => {
          const count = row.original.attachment_file_ids?.length ?? 0;
          return (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              {count}
            </span>
          );
        },
      },
      {
        id: 'linked_request',
        accessorKey: 'legal_request_id',
        header: labels.columns.linkedRequest,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.legal_request_id ? (
            <Link
              href={`/lex/service-desk/${row.original.legal_request_id}`}
              className="text-sm text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {labels.sheet.viewRequest}
            </Link>
          ) : (
            <span className="text-sm text-muted-foreground">{labels.notLinked}</span>
          ),
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: labels.columns.received,
        enableSorting: true,
        cell: ({ row }) => <RelativeTime date={row.original.created_at} />,
      },
    ],
    [labels.columns, labels.notLinked, labels.noSubject, labels.sheet.viewRequest, statusConfig],
  );

  return (
    <LexRouteGuard requirement="lex:request:view">
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          title={labels.pageTitle}
          description={labels.pageDescription}
          actions={canSimulate ? <SimulateInboundDialog /> : undefined}
        />

        <IntakeKpis
          stats={stats}
          loadedCount={loadedCount}
          loading={Boolean(tableProps.isLoading) && rows.length === 0}
          activeScope={kpiScope}
          onScopeChange={drillIntoKpi}
        />

        <div id="intake-message-records" className="scroll-mt-24">
          <DataTable
            {...tableProps}
            data={scopedRows}
            totalRows={kpiScope ? scopedRows.length : tableProps.totalRows}
            columns={columns}
            filters={filters}
            getRowId={(row) => row.id}
            onRowClick={(row) => setActiveMessage(row)}
            searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={labels.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
            emptyState={{
              icon: Inbox,
              title: labels.emptyTitle,
              description: labels.emptyDescription,
            }}
          />
        </div>

        <IntakeMessageSheet
          message={activeMessage}
          statusConfig={statusConfig}
          onClose={() => setActiveMessage(null)}
        />
      </div>
    </LexRouteGuard>
  );
}
