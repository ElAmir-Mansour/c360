'use client';

import { useMemo, useCallback, useState } from 'react';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, ArrowUpCircle, CheckCircle2, Inbox, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LexStatusChip, LexPriorityChip } from '@/components/lex/status-chip';
import { SlaCountdown } from '@/components/lex/sla-countdown';
import { SlaAgingBadge } from '@/components/lex/sla-aging-badge';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { showSuccess, showBackendError } from '@/lib/toast';
import {
  lexRequestsApi,
  type SLAClockView,
  type SLAClockBoardFilters,
  type SLAClockOutcome,
  type SLATargetPriority,
} from '@/lib/lex/requests';
import { useSlaBoardLabels } from './_labels';
import { useServiceTypeLabel } from '../_components/lex-enums-i18n';

const QUERY_KEY = 'lex-sla-clocks';

/** Server-side filter keys this board maps into `SLAClockBoardFilters`. */
const OUTCOME_OPTIONS: SLAClockOutcome[] = ['pending', 'on_time', 'breached'];
const PRIORITY_OPTIONS: SLATargetPriority[] = ['urgent', 'normal'];
const ESCALATION_LEVEL_OPTIONS = ['0', '1', '2', '3'] as const;
type SlaKpiScope = 'breachImminent' | 'ackRisk' | 'breached' | 'escalated';

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/**
 * Translate the DataTable's raw URL filter map into the typed
 * `SLAClockBoardFilters` the server endpoint expects. Coerces the string-valued
 * URL params (`'true'` → boolean, `'2'` → number) and drops empties.
 */
function toBoardFilters(raw: Record<string, string | string[]> | undefined): SLAClockBoardFilters {
  if (!raw) return {};
  const pick = (key: string): string | undefined => {
    const v = raw[key];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s !== '' ? s : undefined;
  };
  const out: SLAClockBoardFilters = {};
  const outcome = pick('outcome');
  if (outcome) out.outcome = outcome as SLAClockOutcome;
  const priority = pick('priority');
  if (priority) out.priority = priority as SLATargetPriority;
  const breached = pick('breached');
  if (breached) out.breached = breached === 'true';
  const escalationLevel = pick('escalation_level');
  if (escalationLevel !== undefined) out.escalation_level = Number(escalationLevel);
  const serviceCode = pick('service_code');
  if (serviceCode) out.service_code = serviceCode;
  const dueBefore = pick('due_before');
  if (dueBefore) out.due_before = dueBefore;
  return out;
}

/** "Xh Ym" / "Xm" working-minutes formatter (Western digits, both locales). */
function formatWorkingMinutes(min: number): string {
  const safe = Math.max(0, Math.round(min));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export default function SlaBoardPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const labels = useSlaBoardLabels();
  const serviceTypeLabel = useServiceTypeLabel();
  // §9/§18.4 — SLA acknowledge/escalate are request edit operations.
  const canWrite = hasPermission('lex:request:edit');
  const queryClient = useQueryClient();

  // --- Server-side board filters ---
  // Filters are driven through the DataTable's URL-based filter state so they
  // become part of `fetchParams` (and React Query re-keys + refetches when they
  // change). `fetchFn` translates the raw `params.filters` map into the typed
  // `SLAClockBoardFilters` that `listSlaClocks` expects as its second arg.
  const fetchFn = useCallback((params: Parameters<typeof lexRequestsApi.listSlaClocks>[0]) => {
    const boardFilters = toBoardFilters(params.filters);
    return lexRequestsApi.listSlaClocks(params, boardFilters);
  }, []);

  const { tableProps, totalRows, searchValue, setSearch, activeFilters, setFilter } = useDataTable<SLAClockView>({
    queryKey: QUERY_KEY,
    fetchFn,
    defaultPageSize: 25,
    defaultSort: { column: 'turnaround_due_at', direction: 'asc' },
    wsTopics: ['lex.sla-clocks'],
  });

  const rows = tableProps.data;
  const [kpiScope, setKpiScope] = useState<SlaKpiScope | null>(null);

  // --- KPI header summarizing the loaded page ---
  const stats = useMemo(() => {
    let breachImminent = 0;
    let ackRisk = 0;
    let breached = 0;
    let escalated = 0;
    for (const row of rows) {
      if (row.breach_imminent) breachImminent += 1;
      if (row.ack_risk) ackRisk += 1;
      if (row.breached) breached += 1;
      if (row.escalation_level > 0) escalated += 1;
    }
    return { breachImminent, ackRisk, breached, escalated };
  }, [rows]);
  const queueSize = rows.length;
  const breachImminentShare = percent(stats.breachImminent, queueSize);
  const ackRiskShare = percent(stats.ackRisk, queueSize);
  const breachedShare = percent(stats.breached, queueSize);
  const escalatedShare = percent(stats.escalated, queueSize);
  const scopedRows = useMemo(() => {
    if (kpiScope === 'breachImminent') return rows.filter((row) => row.breach_imminent);
    if (kpiScope === 'ackRisk') return rows.filter((row) => row.ack_risk);
    if (kpiScope === 'breached') return rows.filter((row) => row.breached);
    if (kpiScope === 'escalated') return rows.filter((row) => row.escalation_level > 0);
    return rows;
  }, [kpiScope, rows]);
  const drillIntoKpi = useCallback((scope: SlaKpiScope) => {
    setKpiScope((current) => (current === scope ? null : scope));
    window.requestAnimationFrame(() => {
      document.getElementById('sla-board-records')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, []);

  // --- Per-row "Escalate now" mutation ---
  // The mutation variable is the row's display token (legal_request_id) so the
  // success toast can name it; we resolve the clock id from the row inside
  // `mutationFn`. `escalateMutation.variables` therefore identifies the active
  // row for the pending spinner.
  const escalateMutation = useMutation({
    mutationFn: (row: SLAClockView) => lexRequestsApi.escalateClock(row.id),
    onSuccess: (_data, row) => {
      showSuccess(labels.toast.escalateSuccessTitle, labels.toast.escalateSuccessDescription(row.legal_request_id));
      void queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
    onError: (error) => {
      showBackendError(error, labels.toast.escalateErrorTitle);
    },
  });

  const handleEscalate = useCallback(
    (row: SLAClockView) => {
      escalateMutation.mutate(row);
    },
    [escalateMutation],
  );

  const columns: ColumnDef<SLAClockView>[] = useMemo(() => {
    const cols: ColumnDef<SLAClockView>[] = [
      {
        id: 'request',
        accessorKey: 'legal_request_id',
        header: labels.columns.request,
        cell: ({ row }) => (
          <Link
            href={`/lex/service-desk/${row.original.legal_request_id}`}
            className="font-mono text-xs font-medium text-primary hover:underline"
          >
            {row.original.legal_request_id}
          </Link>
        ),
      },
      {
        id: 'service_code',
        accessorKey: 'service_code',
        header: labels.columns.service,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.service_code ? serviceTypeLabel(row.original.service_code) : '—'}
          </span>
        ),
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: labels.columns.priority,
        cell: ({ row }) => <LexPriorityChip value={row.original.priority} labels={labels.priorityOptions} size="sm" />,
      },
      {
        id: 'outcome',
        accessorKey: 'outcome',
        header: labels.columns.outcome,
        cell: ({ row }) => (
          <LexStatusChip value={row.original.outcome} domain="sla" labels={labels.outcomeOptions} size="sm" />
        ),
      },
      {
        id: 'ack',
        header: labels.columns.ack,
        cell: ({ row }) => {
          const r = row.original;
          if (r.ack_done) {
            return (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {labels.ack.done}
              </span>
            );
          }
          if (r.ack_overdue) {
            return (
              <Badge variant="destructive" className="tracking-normal">
                {labels.ack.overdue}
              </Badge>
            );
          }
          if (r.ack_risk) {
            return (
              <Badge variant="warning" className="tracking-normal">
                {labels.ack.risk}
              </Badge>
            );
          }
          return <span className="text-xs text-muted-foreground">—</span>;
        },
      },
      {
        id: 'turnaround_due_at',
        accessorKey: 'turnaround_due_at',
        header: labels.columns.turnaround,
        enableSorting: true,
        cell: ({ row }) => {
          const r = row.original;
          const remaining = r.turnaround_working_minutes_remaining;
          const terminal = r.outcome === 'on_time';
          return (
            <div className="flex w-48 flex-col gap-1.5 text-start">
              {/* #20 SLA countdown bar + aging badge */}
              <SlaCountdown dueAt={r.turnaround_due_at} startAt={r.clock_started_at} hideTiming />
              <div className="flex items-center gap-1.5">
                <SlaAgingBadge dueAt={r.turnaround_due_at} status={terminal ? 'closed' : undefined} size="sm" />
                {typeof remaining === 'number' ? (
                  remaining <= 0 ? (
                    <span className="text-caption font-medium text-error-600 dark:text-error-300">
                      {labels.turnaround.overdue}
                    </span>
                  ) : (
                    <span className="text-caption text-muted-foreground">
                      {labels.turnaround.timeLeft(formatWorkingMinutes(remaining))}
                    </span>
                  )
                ) : null}
              </div>
            </div>
          );
        },
      },
      {
        id: 'escalation',
        accessorKey: 'escalation_level',
        header: labels.columns.escalation,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex flex-col gap-0.5 text-start">
              <span className="text-sm font-medium text-foreground">
                {r.escalation_level > 0 ? labels.escalation.level(r.escalation_level) : labels.escalation.none}
              </span>
              {r.next_escalation_recipient ? (
                <span className="text-xs text-muted-foreground">
                  {labels.escalation.nextRecipientPrefix} {r.next_escalation_recipient}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'risk',
        header: labels.columns.risk,
        cell: ({ row }) => {
          const r = row.original;
          const chips: { key: string; label: string }[] = [];
          if (r.breach_imminent) {
            chips.push({ key: 'breach', label: labels.risk.breachImminent });
          }
          if (r.ack_risk) {
            chips.push({ key: 'ack', label: labels.risk.ackRisk });
          }
          if (r.escalation_imminent) {
            chips.push({ key: 'esc', label: labels.risk.escalationImminent });
          }
          if (chips.length === 0) {
            return (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                {labels.risk.clear}
              </span>
            );
          }
          return (
            <div className="flex flex-wrap gap-1">
              {chips.map((chip) => (
                <Badge
                  key={chip.key}
                  variant={chip.key === 'breach' ? 'destructive' : 'warning'}
                  className="tracking-normal"
                >
                  {chip.label}
                </Badge>
              ))}
            </div>
          );
        },
      },
    ];

    if (canWrite) {
      cols.push({
        id: 'actions',
        header: labels.columns.actions,
        cell: ({ row }) => {
          const pending = escalateMutation.isPending && escalateMutation.variables?.id === row.original.id;
          return (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => handleEscalate(row.original)}>
              <ArrowUpCircle className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {pending ? labels.actions.escalating : labels.actions.escalateNow}
            </Button>
          );
        },
      });
    }

    return cols;
  }, [canWrite, escalateMutation.isPending, escalateMutation.variables, handleEscalate, labels, serviceTypeLabel]);

  const filters = useMemo(
    () => [
      {
        key: 'outcome',
        label: labels.filters.outcome,
        type: 'select' as const,
        options: OUTCOME_OPTIONS.map((value) => ({
          label: labels.outcomeOptions[value] ?? value,
          value,
        })),
      },
      {
        key: 'breached',
        label: labels.filters.breached,
        type: 'select' as const,
        options: [
          { label: labels.booleanOptions.yes, value: 'true' },
          { label: labels.booleanOptions.no, value: 'false' },
        ],
      },
      {
        key: 'escalation_level',
        label: labels.filters.escalationLevel,
        type: 'select' as const,
        options: ESCALATION_LEVEL_OPTIONS.map((value) => ({
          label: labels.escalationLevelOptions[value] ?? value,
          value,
        })),
      },
      {
        key: 'priority',
        label: labels.filters.priority,
        type: 'select' as const,
        options: PRIORITY_OPTIONS.map((value) => ({
          label: labels.priorityOptions[value] ?? value,
          value,
        })),
      },
      {
        key: 'service_code',
        label: labels.filters.serviceCode,
        type: 'text' as const,
        placeholder: labels.filters.serviceCodePlaceholder,
      },
    ],
    [labels],
  );

  // `due_before` lives in the same URL filter state as the select filters, but is
  // driven by a dedicated datetime control rather than a DataTable filter chip.
  const dueBeforeRaw = activeFilters.due_before;
  const dueBefore = (Array.isArray(dueBeforeRaw) ? dueBeforeRaw[0] : dueBeforeRaw) ?? '';

  const kpiLoading = tableProps.isLoading && rows.length === 0;
  const kpiItems: LexKpiItem[] = useMemo(
    () => [
      {
        id: 'breachImminent',
        label: labels.kpis.breachImminent,
        value: stats.breachImminent,
        theme: 'orange',
        icon: AlertOctagon,
        loading: kpiLoading,
        description: labels.kpis.breachImminentDescription,
        progress: breachImminentShare,
        progressLabel: labels.pageTitle,
        detail: labels.pageTitle,
        detailValue: `${breachImminentShare}%`,
        onAction: () => drillIntoKpi('breachImminent'),
        pressed: kpiScope === 'breachImminent',
      },
      {
        id: 'ackRisk',
        label: labels.kpis.ackRisk,
        value: stats.ackRisk,
        theme: 'amber',
        icon: ShieldAlert,
        loading: kpiLoading,
        description: labels.kpis.ackRiskDescription,
        progress: ackRiskShare,
        progressLabel: labels.pageTitle,
        detail: labels.pageTitle,
        detailValue: `${ackRiskShare}%`,
        onAction: () => drillIntoKpi('ackRisk'),
        pressed: kpiScope === 'ackRisk',
      },
      {
        id: 'breached',
        label: labels.kpis.breached,
        value: stats.breached,
        theme: 'red',
        icon: AlertTriangle,
        loading: kpiLoading,
        description: labels.kpis.breachedDescription,
        progress: breachedShare,
        progressLabel: labels.pageTitle,
        detail: labels.pageTitle,
        detailValue: `${breachedShare}%`,
        onAction: () => drillIntoKpi('breached'),
        pressed: kpiScope === 'breached',
      },
      {
        id: 'escalated',
        label: labels.kpis.escalated,
        value: stats.escalated,
        theme: 'primary',
        icon: ArrowUpCircle,
        loading: kpiLoading,
        description: labels.kpis.escalatedDescription,
        progress: escalatedShare,
        progressLabel: labels.pageTitle,
        detail: labels.pageTitle,
        detailValue: `${escalatedShare}%`,
        onAction: () => drillIntoKpi('escalated'),
        pressed: kpiScope === 'escalated',
      },
    ],
    [
      ackRiskShare,
      breachImminentShare,
      breachedShare,
      escalatedShare,
      labels.kpis,
      labels.pageTitle,
      stats,
      kpiLoading,
      drillIntoKpi,
      kpiScope,
    ],
  );

  return (
    <LexRouteGuard requirement="lex:request:view">
      <div dir={direction} lang={locale} className="space-y-6 motion-safe:animate-fade-up">
        <PageHeader eyebrow={labels.eyebrow} title={labels.pageTitle} description={labels.pageDescription} />

        <LexKpiStrip items={kpiItems} />

        <div id="sla-board-records" className="scroll-mt-24">
          <DataTable
            {...tableProps}
            data={scopedRows}
            columns={columns}
            totalRows={kpiScope ? scopedRows.length : totalRows}
            filters={filters}
            getRowId={(row) => row.id}
            searchSlot={
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                  value={searchValue}
                  onChange={setSearch}
                  placeholder={labels.searchPlaceholder}
                  loading={tableProps.isLoading}
                />
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="sla-due-before">
                    {labels.filters.dueBefore}
                  </label>
                  <Input
                    id="sla-due-before"
                    type="datetime-local"
                    className="h-9 w-auto"
                    value={dueBefore ? dueBefore.slice(0, 16) : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFilter('due_before', v ? new Date(v).toISOString() : undefined);
                    }}
                  />
                  {dueBefore ? (
                    <Button size="sm" variant="ghost" onClick={() => setFilter('due_before', undefined)}>
                      {labels.filters.dueBeforeClear}
                    </Button>
                  ) : null}
                </div>
              </div>
            }
            emptyState={{
              icon: Inbox,
              title: labels.emptyTitle,
              description: labels.emptyDescription,
            }}
          />
        </div>
      </div>
    </LexRouteGuard>
  );
}
