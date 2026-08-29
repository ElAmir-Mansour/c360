'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Download,
  FileClock,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageHeader } from '@/components/common/page-header';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { RelativeTime } from '@/components/shared/relative-time';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { useDataTable } from '@/hooks/use-data-table';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  getDefaultAuditDateRange,
  resolveAuditSeverity,
} from '@/lib/audit';
import { downloadBlob } from '@/lib/format';
import { showApiError } from '@/lib/toast';
import type { AuditLog } from '@/types/models';
import type { FetchParams, FilterConfig } from '@/types/table';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import {
  type LexAuditCopy,
  useLexAuditCopy,
} from './_components/audit-copy';
import {
  auditCsv,
  fetchLexAuditLogs,
  fetchLexAuditTimeline,
} from './_audit-data';

function shortHash(value?: string | null) {
  if (!value) return '—';
  if (value.length <= 20) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function formatAction(action: string) {
  return action
    .replace(/^com\.clario360\.lex\./, '')
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function createColumns(copy: LexAuditCopy): ColumnDef<AuditLog>[] {
  return [
    {
      id: 'id',
      header: copy.columns.transaction,
      accessorKey: 'id',
      enableSorting: false,
      cell: ({ row }) => (
        <code className="font-mono text-xs font-semibold text-foreground">
          {shortHash(row.original.event_id || row.original.id)}
        </code>
      ),
    },
    {
      id: 'created_at',
      header: copy.columns.timestamp,
      accessorKey: 'created_at',
      enableSorting: true,
      cell: ({ row }) => <RelativeTime date={row.original.created_at} />,
    },
    {
      id: 'user_email',
      header: copy.columns.actor,
      accessorKey: 'user_email',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="block max-w-52 truncate text-sm" dir="auto">
          {row.original.user_email || copy.timeline.system}
        </span>
      ),
    },
    {
      id: 'action',
      header: copy.columns.action,
      accessorKey: 'action',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline" className="max-w-52 truncate font-mono text-xs">
          {formatAction(row.original.action)}
        </Badge>
      ),
    },
    {
      id: 'resource',
      header: copy.columns.resource,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="max-w-56 truncate text-sm font-medium" dir="auto">
            {row.original.resource_id || '—'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.original.resource_type || '—'}
          </p>
        </div>
      ),
    },
    {
      id: 'ip_address',
      header: copy.columns.ip,
      accessorKey: 'ip_address',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.ip_address || '—'}
        </span>
      ),
    },
    {
      id: 'severity',
      header: copy.columns.severity,
      accessorKey: 'severity',
      enableSorting: true,
      cell: ({ row }) => (
        <SeverityIndicator
          severity={resolveAuditSeverity(
            row.original.action,
            row.original.severity,
          )}
          size="sm"
        />
      ),
    },
  ];
}

function auditFilters(copy: LexAuditCopy): FilterConfig[] {
  return [
    {
      key: 'severity',
      label: copy.filters.severity,
      type: 'select',
      options: [
        { label: copy.filters.info, value: 'info' },
        { label: copy.filters.warning, value: 'warning' },
        { label: copy.filters.high, value: 'high' },
        { label: copy.filters.critical, value: 'critical' },
      ],
    },
  ];
}

export default function LexAuditPage() {
  const { locale, direction } = useLocaleOrDefault();
  const copy = useLexAuditCopy();
  const defaultRange = useMemo(() => getDefaultAuditDateRange(), []);
  const [activeTab, setActiveTab] = useState<'logs' | 'timeline'>('logs');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [exporting, setExporting] = useState(false);
  const columns = useMemo(() => createColumns(copy), [copy]);
  const filters = useMemo(() => auditFilters(copy), [copy]);
  const fetchLogs = useCallback(
    (params: FetchParams) => fetchLexAuditLogs(params, defaultRange),
    [defaultRange],
  );

  const {
    data,
    tableProps,
    searchValue,
    setSearch,
    activeFilters,
    refetch,
  } = useDataTable<AuditLog>({
    fetchFn: fetchLogs,
    queryKey: 'lex-audit-log',
    defaultPageSize: 25,
    defaultSort: { column: 'created_at', direction: 'desc' },
    wsTopics: ['lex.audit'],
  });

  const timelineQuery = useQuery({
    queryKey: [
      'lex-audit-timeline',
      selectedLog?.resource_type,
      selectedLog?.resource_id,
      defaultRange.date_from,
      defaultRange.date_to,
    ],
    queryFn: () =>
      fetchLexAuditTimeline(
        selectedLog?.resource_id ?? '',
        selectedLog?.resource_type ?? '',
        defaultRange,
      ),
    enabled: Boolean(selectedLog?.resource_id && selectedLog.resource_type),
    staleTime: 30_000,
  });

  const timelineRows = useMemo(() => {
    if (!selectedLog?.resource_id) return data;
    return timelineQuery.data ?? [selectedLog];
  }, [data, selectedLog, timelineQuery.data]);

  const selected = selectedLog ?? timelineRows[0] ?? null;
  const actorCount = new Set(
    timelineRows.map((row) => row.user_email).filter(Boolean),
  ).size;

  const exportFiltered = async () => {
    setExporting(true);
    try {
      const first = await fetchLexAuditLogs(
        {
          page: 1,
          per_page: 200,
          sort: tableProps.sortColumn,
          order: tableProps.sortDirection,
          search: searchValue || undefined,
          filters:
            Object.keys(activeFilters).length > 0
              ? activeFilters
              : undefined,
        },
        defaultRange,
      );
      const rows = [...first.data];
      for (let page = 2; page <= first.meta.total_pages; page += 1) {
        const next = await fetchLexAuditLogs(
          {
            page,
            per_page: 200,
            sort: tableProps.sortColumn,
            order: tableProps.sortDirection,
            search: searchValue || undefined,
            filters:
              Object.keys(activeFilters).length > 0
                ? activeFilters
                : undefined,
          },
          defaultRange,
        );
        rows.push(...next.data);
      }
      downloadBlob(
        new Blob([`\uFEFF${auditCsv(rows, copy)}`], {
          type: 'text/csv;charset=utf-8',
        }),
        `watheeq-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <LexRouteGuard route="/lex/audit">
      <div
        className="space-y-6"
        dir={direction}
        lang={locale}
        data-testid="lex-audit-page"
      >
        <PageHeader
          title={copy.title}
          description={copy.description}
          tags={[
            {
              label: copy.tamperEvident,
              icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
              tone: 'success',
            },
          ]}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void exportFiltered()}
                disabled={exporting}
              >
                {exporting ? (
                  <RefreshCw
                    className="me-2 h-4 w-4 animate-spin"
                    aria-hidden
                  />
                ) : (
                  <Download className="me-2 h-4 w-4" aria-hidden />
                )}
                {exporting ? copy.exporting : copy.exportCsv}
              </Button>
              <Button
                type="button"
                onClick={() => refetch()}
                disabled={tableProps.isLoading}
              >
                <RefreshCw
                  className={`me-2 h-4 w-4 ${
                    tableProps.isLoading ? 'animate-spin' : ''
                  }`}
                  aria-hidden
                />
                {copy.refresh}
              </Button>
            </div>
          }
        />

        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value as 'logs' | 'timeline')
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="logs" className="gap-2">
                <FileClock className="h-4 w-4" aria-hidden />
                {copy.logTab}
              </TabsTrigger>
              <TabsTrigger value="timeline" className="gap-2">
                <Activity className="h-4 w-4" aria-hidden />
                {copy.timelineTab}
              </TabsTrigger>
            </TabsList>
            <Button variant="outline" asChild>
              <Link href="/lex/admin/role-matrix">
                <Users className="me-2 h-4 w-4" aria-hidden />
                {copy.permissionMatrix}
              </Link>
            </Button>
          </div>

          <TabsContent value="logs" className="mt-6">
            <Card>
              <CardContent className="pt-6">
                <DataTable
                  {...tableProps}
                  columns={columns}
                  filters={filters}
                  onRowClick={(row) => {
                    setSelectedLog(row);
                    setActiveTab('timeline');
                  }}
                  searchSlot={
                    <SearchInput
                      value={searchValue}
                      onChange={setSearch}
                      placeholder={copy.search}
                      loading={tableProps.isLoading}
                    />
                  }
                  emptyState={{
                    icon: ShieldCheck,
                    title: copy.empty.title,
                    description: copy.empty.description,
                  }}
                  tableId="lex-audit-log"
                  stickyHeader
                  striped
                  enableColumnToggle
                  enableDensityToggle
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline" className="mt-6">
            <AuditTimeline
              rows={timelineRows}
              selected={selected}
              actorCount={actorCount}
              copy={copy}
            />
          </TabsContent>
        </Tabs>
      </div>
    </LexRouteGuard>
  );
}

function AuditTimeline({
  rows,
  selected,
  actorCount,
  copy,
}: {
  rows: AuditLog[];
  selected: AuditLog | null;
  actorCount: number;
  copy: LexAuditCopy;
}) {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="xl:sticky xl:top-6">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-label text-primary">
            {copy.timeline.target}
          </p>
          <CardTitle className="break-words text-lg" dir="auto">
            {selected?.resource_id || copy.timeline.noSelection}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="space-y-4">
            <TimelineMeta
              label={copy.timeline.recordType}
              value={selected?.resource_type || '—'}
            />
            <TimelineMeta
              label={copy.timeline.recordId}
              value={selected?.resource_id || '—'}
              mono
            />
            <TimelineMeta
              label={copy.timeline.integrityHash}
              value={shortHash(selected?.entry_hash)}
              mono
            />
            <TimelineMeta
              label={copy.timeline.previousHash}
              value={shortHash(selected?.previous_hash)}
              mono
            />
            <TimelineMeta
              label={copy.timeline.latestActivity}
              value={selected ? formatAction(selected.action) : '—'}
            />
          </dl>
          <div className="grid grid-cols-2 gap-3 border-t border-border/70 pt-5">
            <div className="rounded-xl bg-muted/35 p-3">
              <p className="text-xl font-semibold tabular-nums text-primary">
                {rows.length}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {copy.timeline.totalActions}
              </p>
            </div>
            <div className="rounded-xl bg-muted/35 p-3">
              <p className="text-xl font-semibold tabular-nums text-foreground">
                {actorCount}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {copy.timeline.actors}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.timeline.title}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {selected ? copy.timeline.description : copy.timeline.selectHint}
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {copy.empty.description}
            </div>
          ) : (
            <ol className="relative ms-4 border-s border-border/80">
              {rows.map((row) => (
                <li key={row.id} className="relative pb-7 ps-7 last:pb-0">
                  <span className="absolute -start-3 grid h-6 w-6 place-items-center rounded-full border border-primary bg-card text-primary">
                    <Activity className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">
                          {formatAction(row.action)}
                        </p>
                        <p className="mt-0.5 break-words text-xs text-muted-foreground">
                          {copy.timeline.by}{' '}
                          <span dir="auto">
                            {row.user_email || copy.timeline.system}
                          </span>
                        </p>
                      </div>
                      <time
                        className="shrink-0 font-mono text-xs text-muted-foreground"
                        dateTime={row.created_at}
                      >
                        {new Date(row.created_at).toLocaleString()}
                      </time>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{row.resource_type}</Badge>
                        <span className="font-mono" dir="auto">
                          {row.resource_id || '—'}
                        </span>
                        <span aria-hidden>•</span>
                        <span className="font-mono">
                          {row.ip_address || '—'}
                        </span>
                      </div>
                      {row.old_value || row.new_value ? (
                        <div className="mt-3 grid gap-3 lg:grid-cols-2">
                          {row.old_value ? (
                            <AuditValue
                              label={copy.timeline.oldValue}
                              value={row.old_value}
                            />
                          ) : null}
                          {row.new_value ? (
                            <AuditValue
                              label={copy.timeline.newValue}
                              value={row.new_value}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <p className="mt-6 rounded-xl border border-primary/20 bg-primary/[0.045] p-4 text-sm leading-6 text-muted-foreground">
            {copy.timeline.appendOnly}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function TimelineMeta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-label text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-1 break-words text-sm font-semibold text-foreground ${
          mono ? 'font-mono' : ''
        }`}
        dir="auto"
      >
        {value}
      </dd>
    </div>
  );
}

function AuditValue({
  label,
  value,
}: {
  label: string;
  value: Record<string, unknown>;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-label text-muted-foreground">
        {label}
      </p>
      <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-2 font-mono text-xs text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
