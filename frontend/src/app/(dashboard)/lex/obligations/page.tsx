'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  BellRing,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  KanbanSquare,
  Loader2,
  List,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LexStatusChip, LexPriorityChip, LexSeverityChip } from '@/components/lex/status-chip';
import { SlaAgingBadge, computeAgingTier } from '@/components/lex/sla-aging-badge';
import { LexEmptyState } from '@/components/lex/empty-state';
import { LexListSkeleton } from '@/components/lex/list-skeleton';
import { LexRecordPicker } from '@/components/lex/lex-record-picker';
import { FeedbackState } from '@/components/shared/feedback-state';
import { useLexFormat } from '@/lib/lex/ksa';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useDataTable } from '@/hooks/use-data-table';
import { useLocale } from '@/components/providers/locale-provider';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  LexContractRenewalWarning,
  LexCreateObligationPayload,
  LexObligation,
  LexUpdateObligationPayload,
} from '@/types/suites';
import { type ObligationsLabels, useObligationsLabels } from './_lib/obligations-labels';
import { ObligationsCalendar, type ObligationCalendarEvent } from './_components/obligations-calendar';
import { ObligationsBoard } from './_components/obligations-board';

const OBLIGATION_TYPES = [
  'contractual',
  'renewal',
  'notice',
  'payment',
  'delivery',
  'reporting',
  'compliance',
  'covenant',
  'condition_precedent',
  'regulatory',
  'other',
] as const;

const OBLIGATION_STATUSES = ['open', 'in_progress', 'blocked', 'completed', 'waived', 'cancelled'] as const;
const OBLIGATION_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

type ObligationScope = 'all' | 'overdue' | 'due_this_week' | 'at_risk' | 'completed';

function buildObligationFilters(labels: ObligationsLabels) {
  const { filters } = labels;
  const { options } = filters;
  return [
    {
      key: 'status',
      label: filters.status,
      type: 'select' as const,
      options: [
        { label: options.open, value: 'open' },
        { label: options.inProgress, value: 'in_progress' },
        { label: options.blocked, value: 'blocked' },
        { label: options.completed, value: 'completed' },
        { label: options.waived, value: 'waived' },
        { label: options.cancelled, value: 'cancelled' },
      ],
    },
    {
      key: 'priority',
      label: filters.priority,
      type: 'select' as const,
      options: [
        { label: options.critical, value: 'critical' },
        { label: options.high, value: 'high' },
        { label: options.medium, value: 'medium' },
        { label: options.low, value: 'low' },
      ],
    },
    {
      key: 'reminder_enabled',
      label: filters.reminders,
      type: 'select' as const,
      options: [
        { label: options.enabled, value: 'true' },
        { label: options.disabled, value: 'false' },
      ],
    },
    {
      key: 'escalation_enabled',
      label: filters.escalation,
      type: 'select' as const,
      options: [
        { label: options.enabled, value: 'true' },
        { label: options.disabled, value: 'false' },
      ],
    },
  ];
}

export default function LexObligationsPage() {
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const resolvedDir: 'ltr' | 'rtl' = direction === 'rtl' ? 'rtl' : 'ltr';
  const labels = useObligationsLabels();
  // §9 — obligations track contract commitments; gate mutation on contract:edit.
  const canWrite = hasPermission('lex:contract:edit');

  // Localized copy for the board/calendar view-level states (error / empty) that
  // fall outside the DataTable's own built-in loading/error/empty handling. Kept
  // page-local (mirrors the labels bundle's MSA register) so the non-table views
  // stay consistent with the table without hand-rolling divergent messaging.
  const viewStateCopy = {
    errorTitle: locale === 'ar' ? 'تعذّر تحميل الالتزامات' : 'Could not load obligations',
    retry: locale === 'ar' ? 'إعادة المحاولة' : 'Retry',
    calendarEmptyDescription:
      locale === 'ar'
        ? 'ستظهر تواريخ استحقاق الالتزامات ومحفّزات تجديد العقود هنا عند توفّرها.'
        : 'Obligation due dates and contract renewal triggers will appear here once available.',
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LexObligation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LexObligation | null>(null);
  const [view, setView] = useState<'list' | 'board' | 'calendar'>('list');
  const [obligationScope, setObligationScope] = useState<ObligationScope>('all');

  useEffect(() => {
    if (window.location.hash === '#overdue') setObligationScope('overdue');
  }, []);

  const { data, tableProps, searchValue, setSearch } = useDataTable<LexObligation>({
    queryKey: 'lex-obligations',
    fetchFn: enterpriseApi.lex.listObligations,
    defaultPageSize: 25,
    defaultSort: { column: 'due_date', direction: 'asc' },
  });

  const renewalWarningsQuery = useQuery({
    queryKey: ['lex-contract-renewal-warnings', 60, 30],
    queryFn: () =>
      enterpriseApi.lex.getContractRenewalWarnings({
        horizon_days: 60,
        lead_days: 30,
      }),
  });

  const reminderPlanQuery = useQuery({
    queryKey: ['lex-obligation-reminder-plan', 30, true],
    queryFn: () =>
      enterpriseApi.lex.getObligationReminderPlan({
        horizon_days: 30,
        include_escalations: true,
      }),
  });

  const refreshObligations = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lex-obligations'] }),
      queryClient.invalidateQueries({
        queryKey: ['lex-obligation-reminder-plan'],
      }),
      queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
    ]);
  };

  const updateStatusMutation = useMutation({
    mutationFn: ({ obligation, status }: { obligation: LexObligation; status: string }) =>
      enterpriseApi.lex.updateObligationStatus(obligation.id, { status }),
    onSuccess: async (_updated, variables) => {
      showSuccess(variables.status === 'completed' ? labels.toasts.completed : labels.toasts.statusUpdated);
      await refreshObligations();
    },
    onError: showApiError,
  });

  const markReminderSentMutation = useMutation({
    mutationFn: (obligation: LexObligation) =>
      enterpriseApi.lex.markObligationReminderSent(obligation.id, {
        channel: 'in_app',
        event_type: 'reminder',
        lead_days: obligation.reminder_lead_days[0] ?? 0,
        provider: 'manual',
      }),
    onSuccess: async () => {
      showSuccess(labels.toasts.reminderSent);
      await refreshObligations();
    },
    onError: showApiError,
  });

  const enqueueRemindersMutation = useMutation({
    mutationFn: () =>
      enterpriseApi.lex.enqueueObligationReminders({
        horizon_days: 30,
        include_escalations: true,
        channels: ['email', 'calendar'],
      }),
    onSuccess: async (result) => {
      showSuccess(
        labels.enqueueResult.title,
        labels.enqueueResult.description(result.queued_count, result.skipped_duplicate_count),
      );
      await refreshObligations();
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.deleteObligation(id),
    onSuccess: async () => {
      showSuccess(labels.toasts.deleted);
      setDeleteTarget(null);
      await refreshObligations();
    },
    onError: showApiError,
  });

  const columns: ColumnDef<LexObligation>[] = [
    {
      id: 'title',
      accessorKey: 'title',
      header: labels.columns.obligation,
      enableSorting: true,
      cell: ({ row }) => (
        <div>
          <p className="font-medium" dir="auto">
            {row.original.title}
          </p>
          <p className="text-xs text-muted-foreground" dir="auto">
            {resolveEnum(labels.enums.types, row.original.type ?? 'contractual')}
          </p>
        </div>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: labels.columns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <LexStatusChip value={row.original.status} domain="obligation" labels={labels.enums.statuses} size="sm" />
      ),
    },
    {
      id: 'priority',
      accessorKey: 'priority',
      header: labels.columns.priority,
      enableSorting: true,
      cell: ({ row }) =>
        row.original.priority ? (
          <LexPriorityChip value={row.original.priority} labels={labels.enums.priorities} size="sm" />
        ) : (
          <span className="text-sm text-muted-foreground">{labels.cells.priorityNone}</span>
        ),
    },
    {
      id: 'source',
      header: labels.columns.source,
      cell: ({ row }) => {
        if (row.original.contract_id) {
          return (
            <Link
              href={`/lex/contracts/${row.original.contract_id}`}
              className="text-sm font-medium hover:underline"
              dir="auto"
            >
              {row.original.contract_title ?? labels.cells.contractFallback}
            </Link>
          );
        }
        return (
          <span className="text-sm text-muted-foreground" dir="auto">
            {row.original.matter_title ?? labels.cells.notLinked}
          </span>
        );
      },
    },
    {
      id: 'owner_name',
      accessorKey: 'owner_name',
      header: labels.columns.owner,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground" dir="auto">
          {row.original.owner_name ?? labels.cells.unassigned}
        </span>
      ),
    },
    {
      id: 'due_date',
      accessorKey: 'due_date',
      header: labels.columns.due,
      enableSorting: true,
      cell: ({ row }) => (
        <div className="space-y-1.5">
          {row.original.due_date ? (
            <p className="text-sm font-medium tabular-nums">{f.formatDate(row.original.due_date)}</p>
          ) : (
            <span className="text-sm text-muted-foreground">{labels.cells.noDueDate}</span>
          )}
          {row.original.due_date ? (
            <SlaAgingBadge dueAt={row.original.due_date} status={row.original.status} size="sm" />
          ) : null}
        </div>
      ),
    },
    {
      id: 'reminders',
      header: labels.columns.reminders,
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <Badge variant={row.original.reminder_enabled ? 'success' : 'outline'}>
            {row.original.reminder_enabled ? labels.cells.enabled : labels.cells.disabled}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {row.original.reminder_enabled
              ? formatLeadDays(row.original.reminder_lead_days, labels)
              : labels.cells.noReminders}
          </p>
          {row.original.last_reminder_at ? (
            <p className="text-xs text-muted-foreground">
              {labels.cells.lastReminder(f.formatDate(row.original.last_reminder_at))}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'escalation',
      header: labels.columns.escalation,
      cell: ({ row }) => (
        <div className="space-y-1 text-sm">
          <Badge variant={row.original.escalation_enabled ? 'warning' : 'outline'}>
            {row.original.escalation_enabled ? labels.cells.enabled : labels.cells.disabled}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {row.original.escalation_enabled
              ? formatLeadDays(row.original.escalation_lead_days, labels)
              : labels.cells.noEscalation}
          </p>
          {row.original.escalation_target ? (
            <p className="text-xs text-muted-foreground" dir="auto">
              {row.original.escalation_target}
            </p>
          ) : null}
        </div>
      ),
    },
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: '',
            cell: ({ row }: { row: { original: LexObligation } }) => {
              const obligation = row.original;
              const complete = obligation.status === 'completed';
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={labels.actions.openActions}>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setEditTarget(obligation)}>
                      <Pencil className="me-2 h-4 w-4" />
                      {labels.actions.edit}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        updateStatusMutation.mutate({
                          obligation,
                          status: complete ? 'open' : 'completed',
                        })
                      }
                    >
                      <CheckCircle2 className="me-2 h-4 w-4" />
                      {complete ? labels.actions.reopen : labels.actions.markCompleted}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => markReminderSentMutation.mutate(obligation)}>
                      <Send className="me-2 h-4 w-4" />
                      {labels.actions.markReminderSent}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(obligation)}>
                      <Trash2 className="me-2 h-4 w-4" />
                      {labels.actions.delete}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
          } satisfies ColumnDef<LexObligation>,
        ]
      : []),
  ];

  const reminderEvents = (reminderPlanQuery.data?.events ?? [])
    .slice()
    .sort((left, right) => new Date(left.planned_for).valueOf() - new Date(right.planned_for).valueOf())
    .slice(0, 6);

  const obligationRows = data;
  const renewalItems = renewalWarningsQuery.data?.items;

  // KPI strip: live, client-computed metrics over the loaded obligation rows.
  // Open/active items are measured against their due date via the shared SLA
  // aging tiers (overdue / stale / aging) so the strip speaks the same staleness
  // language as the row badges. Terminal statuses are excluded from risk counts.
  const kpiItems = useMemo<LexKpiItem[]>(() => {
    const now = Date.now();
    const total = obligationRows.length;
    const completed = obligationRows.filter((item) => item.status === 'completed').length;

    let overdue = 0;
    let dueThisWeek = 0;
    let atRisk = 0;
    for (const item of obligationRows) {
      if (item.status === 'completed' || item.status === 'cancelled' || item.status === 'waived') {
        continue;
      }
      const tier = computeAgingTier(item.due_date, now);
      if (tier === 'overdue') {
        overdue += 1;
        atRisk += 1;
      } else if (tier === 'stale') {
        atRisk += 1;
        dueThisWeek += 1;
      } else if (tier === 'aging') {
        dueThisWeek += 1;
      }
    }

    const overdueShare = percent(overdue, total);
    const dueThisWeekShare = percent(dueThisWeek, total);
    const atRiskShare = percent(atRisk, total);
    const completedShare = percent(completed, total);
    const completionRate = completedShare;

    return [
      {
        label: labels.kpis.total,
        value: total,
        theme: 'primary',
        icon: ListChecks,
        description: labels.kpiDetails.total,
        progress: total > 0 ? 100 : 0,
        progressLabel: labels.kpiDetails.obligationShare,
        detail: labels.kpiDetails.activeQueue,
        detailValue: f.formatNumber(total - completed),
        onAction: () => setObligationScope('all'),
        pressed: obligationScope === 'all',
      },
      {
        label: labels.kpis.overdue,
        value: overdue,
        theme: 'red',
        icon: AlertOctagon,
        description: labels.kpiDetails.overdue,
        progress: overdueShare,
        progressLabel: labels.kpiDetails.obligationShare,
        detail: labels.kpis.overdue,
        detailValue: `${f.formatNumber(overdueShare)}%`,
        trendGoodWhenDown: true,
        onAction: () => setObligationScope('overdue'),
        pressed: obligationScope === 'overdue',
      },
      {
        label: labels.kpis.dueThisWeek,
        value: dueThisWeek,
        theme: 'amber',
        icon: CalendarClock,
        description: labels.kpiDetails.dueThisWeek,
        progress: dueThisWeekShare,
        progressLabel: labels.kpiDetails.obligationShare,
        detail: labels.kpis.dueThisWeek,
        detailValue: `${f.formatNumber(dueThisWeekShare)}%`,
        onAction: () => setObligationScope('due_this_week'),
        pressed: obligationScope === 'due_this_week',
      },
      {
        label: labels.kpis.atRisk,
        value: atRisk,
        theme: 'orange',
        icon: BellRing,
        description: labels.kpiDetails.atRisk,
        progress: atRiskShare,
        progressLabel: labels.kpiDetails.obligationShare,
        detail: labels.kpis.atRisk,
        detailValue: `${f.formatNumber(atRiskShare)}%`,
        trendGoodWhenDown: true,
        onAction: () => setObligationScope('at_risk'),
        pressed: obligationScope === 'at_risk',
      },
      {
        label: labels.kpis.completed,
        value: completed,
        theme: 'emerald',
        icon: CheckCircle2,
        description: labels.kpiDetails.completed,
        progress: completedShare,
        progressLabel: labels.kpiDetails.obligationShare,
        detail: labels.kpis.completed,
        detailValue: `${f.formatNumber(completedShare)}%`,
        onAction: () => setObligationScope('completed'),
        pressed: obligationScope === 'completed',
      },
      {
        label: labels.kpis.completionRate,
        value: f.formatPercent(completionRate, { fromPercent: true }),
        theme: 'green',
        icon: CheckCircle2,
        description: labels.kpiDetails.completionRate,
        progress: completionRate,
        progressLabel: labels.kpis.completionRate,
        detail: labels.kpis.completed,
        detailValue: f.formatNumber(completed),
        onAction: () => setObligationScope('completed'),
      },
    ];
  }, [obligationRows, labels, f, obligationScope]);

  const scopedObligationRows = useMemo(() => {
    if (obligationScope === 'all') return obligationRows;
    const now = Date.now();
    return obligationRows.filter((item) => {
      if (obligationScope === 'completed') return item.status === 'completed';
      if (item.status === 'completed' || item.status === 'cancelled' || item.status === 'waived') {
        return false;
      }
      const tier = computeAgingTier(item.due_date, now);
      if (obligationScope === 'overdue') return tier === 'overdue';
      if (obligationScope === 'due_this_week') return tier === 'stale' || tier === 'aging';
      return tier === 'overdue' || tier === 'stale';
    });
  }, [obligationRows, obligationScope]);

  const calendarEvents = useMemo<ObligationCalendarEvent[]>(() => {
    const dueEvents: ObligationCalendarEvent[] = scopedObligationRows
      .filter((obligation) => Boolean(obligation.due_date))
      .map((obligation) => ({
        id: `obligation-${obligation.id}`,
        date: obligation.due_date,
        title: obligation.title,
        severity: priorityToSeverity(obligation.priority),
        kind: labels.calendar.dueKind,
        href: obligation.contract_id ? `/lex/contracts/${obligation.contract_id}` : '/lex/obligations',
        meta: labels.calendar.dueMeta(obligation.owner_name ?? labels.cells.unassigned),
        dueAt: obligation.due_date,
        status: obligation.status,
      }));

    const renewalEvents: ObligationCalendarEvent[] = (renewalItems ?? [])
      .filter((warning) => Boolean(warning.trigger_date ?? warning.expiry_date))
      .map((warning) => ({
        id: `renewal-${warning.contract_id}`,
        date: (warning.trigger_date ?? warning.expiry_date) as string,
        title: warning.title,
        severity: warning.severity === 'urgent' ? 'critical' : 'high',
        kind: labels.calendar.renewalKind,
        href: `/lex/contracts/${warning.contract_id}`,
        meta: labels.calendar.renewalMeta(warning.counterparty || labels.renewalItem.noCounterparty),
        dueAt: warning.trigger_date ?? warning.expiry_date ?? null,
      }));

    return [...dueEvents, ...renewalEvents];
  }, [scopedObligationRows, renewalItems, labels]);

  return (
    <LexRouteGuard requirement="lex:contract:view">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          title={labels.pageTitle}
          description={labels.pageDescription}
          eyebrow={labels.eyebrow}
          actions={
            canWrite ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => enqueueRemindersMutation.mutate()}
                  disabled={enqueueRemindersMutation.isPending}
                  className=""
                >
                  {enqueueRemindersMutation.isPending ? (
                    <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <BellRing className="me-1.5 h-4 w-4" />
                  )}
                  {labels.actions.enqueueReminders}
                </Button>
                <Button onClick={() => setCreateOpen(true)} className="">
                  <Plus className="me-1.5 h-4 w-4" />
                  {labels.actions.newObligation}
                </Button>
              </>
            ) : undefined
          }
        />
        <div className="motion-safe:animate-fade-up">
          <LexKpiStrip items={kpiItems} dir={resolvedDir} />
        </div>
        <SectionCard title={labels.renewals.title} description={labels.renewals.description}>
          {renewalWarningsQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <LoadingSkeleton variant="card" count={2} label={labels.renewals.loading} />
            </div>
          ) : renewalWarningsQuery.isError ? (
            <p className="text-sm text-destructive">{labels.renewals.error}</p>
          ) : !renewalWarningsQuery.data || renewalWarningsQuery.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.renewals.empty}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="destructive">{labels.renewals.urgent(renewalWarningsQuery.data.urgent)}</Badge>
                <Badge variant="warning">{labels.renewals.warning(renewalWarningsQuery.data.warning)}</Badge>
                <span className="text-muted-foreground">
                  {labels.renewals.generated(f.formatDate(renewalWarningsQuery.data.generated_at))}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {renewalWarningsQuery.data.items.slice(0, 6).map((warning) => (
                  <RenewalWarningItem key={warning.contract_id} warning={warning} labels={labels} />
                ))}
              </div>
            </div>
          )}
        </SectionCard>
        <SectionCard title={labels.reminderCalendar.title} description={labels.reminderCalendar.description}>
          {reminderPlanQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <LoadingSkeleton variant="card" count={3} label={labels.reminderCalendar.loading} />
            </div>
          ) : reminderPlanQuery.isError ? (
            <p className="text-sm text-destructive">{labels.reminderCalendar.error}</p>
          ) : reminderEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.reminderCalendar.empty}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {reminderEvents.map((event) => (
                <Link
                  key={event.event_id}
                  href={
                    event.contract_id
                      ? `/lex/contracts/${event.contract_id}`
                      : `/lex/obligations?search=${encodeURIComponent(event.obligation_title)}`
                  }
                  className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5 transition-[box-shadow,border-color] duration-200 hover:border-primary/30 hover:shadow-sm"
                >
                  <span
                    className={`absolute inset-y-0 start-0 w-1 ${event.type === 'escalation' ? 'bg-warning-500/80' : 'bg-warning-300/60'}`}
                    aria-hidden
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" dir="auto">
                        {event.obligation_title}
                      </p>
                      <p className="text-xs text-muted-foreground" dir="auto">
                        {event.owner_name ?? labels.reminderCalendar.unassigned} • {f.formatDate(event.planned_for)}
                      </p>
                    </div>
                    <Badge variant={event.type === 'escalation' ? 'warning' : 'outline'}>
                      {resolveEnum(labels.enums.eventTypes, event.type)}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" />
                    <span>{labels.reminderCalendar.leadSuffix(event.channel, event.lead_days)}</span>
                    <span>{labels.reminderCalendar.duePrefix(f.formatDate(event.due_date))}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
        <div id="overdue" className="scroll-mt-24 flex justify-end">
          <div
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/60 p-0.5"
            role="group"
            aria-label={labels.viewToggle.aria}
          >
            <Button
              type="button"
              variant={view === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 px-2.5"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              <List className="h-3.5 w-3.5" aria-hidden />
              {labels.viewToggle.list}
            </Button>
            <Button
              type="button"
              variant={view === 'board' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 px-2.5"
              aria-pressed={view === 'board'}
              onClick={() => setView('board')}
            >
              <KanbanSquare className="h-3.5 w-3.5" aria-hidden />
              {labels.viewToggle.board}
            </Button>
            <Button
              type="button"
              variant={view === 'calendar' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 px-2.5"
              aria-pressed={view === 'calendar'}
              onClick={() => setView('calendar')}
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {labels.viewToggle.calendar}
            </Button>
          </div>
        </div>
        {view === 'calendar' ? (
          <SectionCard title={labels.calendar.title} description={labels.calendar.description}>
            {tableProps.isLoading || renewalWarningsQuery.isLoading ? (
              <LexListSkeleton rows={6} cols={4} />
            ) : tableProps.error ? (
              <FeedbackState
                tone="error"
                title={viewStateCopy.errorTitle}
                description={tableProps.error}
                action={{
                  label: viewStateCopy.retry,
                  onClick: tableProps.onRetry,
                }}
              />
            ) : calendarEvents.length === 0 ? (
              <LexEmptyState
                icon={CalendarDays}
                title={labels.calendar.noEvents}
                description={viewStateCopy.calendarEmptyDescription}
                action={
                  canWrite
                    ? {
                        label: labels.actions.newObligation,
                        icon: Plus,
                        onClick: () => setCreateOpen(true),
                      }
                    : undefined
                }
              />
            ) : (
              <ObligationsCalendar events={calendarEvents} labels={labels.calendar} dir={resolvedDir} />
            )}
          </SectionCard>
        ) : view === 'board' ? (
          <SectionCard title={labels.board.title} description={labels.board.description}>
            {tableProps.isLoading ? (
              <LexListSkeleton rows={6} cols={6} />
            ) : tableProps.error ? (
              <FeedbackState
                tone="error"
                title={viewStateCopy.errorTitle}
                description={tableProps.error}
                action={{
                  label: viewStateCopy.retry,
                  onClick: tableProps.onRetry,
                }}
              />
            ) : scopedObligationRows.length === 0 ? (
              <LexEmptyState
                icon={ListChecks}
                title={labels.table.emptyTitle}
                description={labels.table.emptyDescription}
                action={
                  canWrite
                    ? {
                        label: labels.actions.newObligation,
                        icon: Plus,
                        onClick: () => setCreateOpen(true),
                      }
                    : undefined
                }
              />
            ) : (
              <ObligationsBoard
                obligations={scopedObligationRows}
                canWrite={canWrite}
                dir={resolvedDir}
                labels={labels}
                onChangeStatus={(obligation, status) => updateStatusMutation.mutate({ obligation, status })}
                isMoving={updateStatusMutation.isPending}
              />
            )}
          </SectionCard>
        ) : (
          <DataTable
            {...tableProps}
            data={scopedObligationRows}
            columns={columns}
            filters={buildObligationFilters(labels)}
            getRowId={(row) => row.id}
            enableColumnToggle
            enableDensityToggle
            stickyHeader
            striped
            tableId="lex-obligations"
            searchSlot={
              <SearchInput
                value={searchValue}
                onChange={setSearch}
                placeholder={labels.table.searchPlaceholder}
                loading={tableProps.isLoading}
              />
            }
            emptyState={{
              icon: ListChecks,
              title: labels.table.emptyTitle,
              description: labels.table.emptyDescription,
            }}
          />
        )}
        {canWrite ? (
          <>
            <ObligationFormDialog
              open={createOpen}
              currentUser={{
                id: user?.id ?? '',
                name:
                  user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || '',
              }}
              onOpenChange={setCreateOpen}
              onSaved={refreshObligations}
              labels={labels}
            />
            {editTarget ? (
              <ObligationFormDialog
                open
                obligation={editTarget}
                currentUser={{
                  id: user?.id ?? '',
                  name:
                    user?.full_name ||
                    [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
                    user?.email ||
                    '',
                }}
                onOpenChange={(open) => {
                  if (!open) setEditTarget(null);
                }}
                onSaved={refreshObligations}
                labels={labels}
              />
            ) : null}
            <ConfirmDialog
              open={deleteTarget !== null}
              onOpenChange={(open) => {
                if (!open) setDeleteTarget(null);
              }}
              title={labels.deleteDialog.title}
              description={labels.deleteDialog.description(deleteTarget?.title ?? '')}
              confirmLabel={labels.deleteDialog.confirm}
              variant="destructive"
              loading={deleteMutation.isPending}
              onConfirm={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id);
                }
              }}
            />
          </>
        ) : null}
      </div>
    </LexRouteGuard>
  );
}

interface ObligationFormValues {
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  contract_id: string;
  matter_id: string;
  owner_user_id: string;
  owner_name: string;
  due_date: string;
  reminder_enabled: boolean;
  reminder_lead_days: string;
  escalation_enabled: boolean;
  escalation_lead_days: string;
  escalation_target: string;
  tags: string;
}

interface ObligationFormDialogProps {
  open: boolean;
  obligation?: LexObligation | null;
  currentUser: { id: string; name: string };
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  labels: ObligationsLabels;
}

function ObligationFormDialog({
  open,
  obligation,
  currentUser,
  onOpenChange,
  onSaved,
  labels,
}: ObligationFormDialogProps) {
  const isEdit = Boolean(obligation);
  const form = labels.form;
  const [values, setValues] = useState<ObligationFormValues>(() => obligationFormDefaults(obligation, currentUser));

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-obligation-dialog'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: open,
  });
  const directoryUsers = usersQuery.data?.data ?? [];
  const usersById = new Map(directoryUsers.map((entry) => [entry.id, entry]));
  const saveMutation = useMutation({
    mutationFn: (payload: LexCreateObligationPayload | LexUpdateObligationPayload) =>
      isEdit && obligation
        ? enterpriseApi.lex.updateObligation(obligation.id, payload as LexUpdateObligationPayload)
        : enterpriseApi.lex.createObligation(payload as LexCreateObligationPayload),
    onSuccess: async () => {
      showSuccess(isEdit ? labels.toasts.updated : labels.toasts.created);
      await onSaved();
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const canSubmit =
    values.title.trim() !== '' &&
    values.owner_user_id.trim() !== '' &&
    values.owner_name.trim() !== '' &&
    values.due_date.trim() !== '';

  const updateValue = <K extends keyof ObligationFormValues>(key: K, value: ObligationFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    saveMutation.mutate(buildObligationPayload(values));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? form.editTitle : form.newTitle}</DialogTitle>
          <DialogDescription>{form.description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="obligation-title">{form.title}</Label>
              <Input
                id="obligation-title"
                value={values.title}
                onChange={(event) => updateValue('title', event.target.value)}
                placeholder={form.titlePlaceholder}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="obligation-description">{form.descriptionLabel}</Label>
              <Textarea
                id="obligation-description"
                value={values.description}
                onChange={(event) => updateValue('description', event.target.value)}
                rows={3}
                placeholder={form.descriptionPlaceholder}
              />
            </div>
            <SelectField
              label={form.type}
              value={values.type}
              onValueChange={(value) => updateValue('type', value)}
              options={OBLIGATION_TYPES}
              optionLabels={labels.enums.types}
            />
            <SelectField
              label={form.status}
              value={values.status}
              onValueChange={(value) => updateValue('status', value)}
              options={OBLIGATION_STATUSES}
              optionLabels={labels.enums.statuses}
            />
            <SelectField
              label={form.priority}
              value={values.priority}
              onValueChange={(value) => updateValue('priority', value)}
              options={OBLIGATION_PRIORITIES}
              optionLabels={labels.enums.priorities}
            />
            <div className="space-y-2">
              <Label htmlFor="obligation-due-date">{form.dueDate}</Label>
              <Input
                id="obligation-due-date"
                type="datetime-local"
                value={values.due_date}
                onChange={(event) => updateValue('due_date', event.target.value)}
                required
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="obligation-owner">{form.ownerName}</Label>
              <Select
                value={values.owner_user_id || undefined}
                onValueChange={(value) => {
                  const directoryUser = usersById.get(value);
                  setValues((current) => ({
                    ...current,
                    owner_user_id: value,
                    owner_name: directoryUser ? userDisplayName(directoryUser) : current.owner_name,
                  }));
                }}
              >
                <SelectTrigger id="obligation-owner">
                  <SelectValue placeholder={form.ownerSelectPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {directoryUsers.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {userDisplayName(entry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="obligation-contract-id">{form.contractId}</Label>
              <LexRecordPicker
                id="obligation-contract-id"
                kind="contract"
                ariaLabel={form.contractId}
                value={values.contract_id}
                onChange={(value) => updateValue('contract_id', value)}
                enabled={open}
                allowClear
                labels={{
                  select: form.contractIdPlaceholder,
                  search: form.contractIdPlaceholder,
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="obligation-matter-id">{form.matterId}</Label>
              <LexRecordPicker
                id="obligation-matter-id"
                kind="matter"
                ariaLabel={form.matterId}
                value={values.matter_id}
                onChange={(value) => updateValue('matter_id', value)}
                enabled={open}
                allowClear
                labels={{
                  select: form.matterIdPlaceholder,
                  search: form.matterIdPlaceholder,
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{form.reminders}</p>
                  <p className="text-xs text-muted-foreground">{form.remindersHint}</p>
                </div>
                <Switch
                  checked={values.reminder_enabled}
                  onCheckedChange={(checked) => updateValue('reminder_enabled', checked)}
                  aria-label={form.remindersToggleAria}
                />
              </div>
              <Input
                className="mt-4"
                value={values.reminder_lead_days}
                onChange={(event) => updateValue('reminder_lead_days', event.target.value)}
                placeholder={form.remindersPlaceholder}
                disabled={!values.reminder_enabled}
              />
            </div>
            <div className="rounded-lg border px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{form.escalation}</p>
                  <p className="text-xs text-muted-foreground">{form.escalationHint}</p>
                </div>
                <Switch
                  checked={values.escalation_enabled}
                  onCheckedChange={(checked) => updateValue('escalation_enabled', checked)}
                  aria-label={form.escalationToggleAria}
                />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  value={values.escalation_lead_days}
                  onChange={(event) => updateValue('escalation_lead_days', event.target.value)}
                  placeholder={form.escalationLeadPlaceholder}
                  disabled={!values.escalation_enabled}
                  aria-label={form.escalationLeadPlaceholder}
                />
                <Select
                  value={values.escalation_target || undefined}
                  onValueChange={(value) => updateValue('escalation_target', value === '__none__' ? '' : value)}
                  disabled={!values.escalation_enabled}
                >
                  <SelectTrigger aria-label={form.escalationTargetLabel}>
                    <SelectValue placeholder={form.escalationTargetPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{form.escalationTargetUnassigned}</SelectItem>
                    {directoryUsers.map((entry) => (
                      <SelectItem key={entry.id} value={userDisplayName(entry)}>
                        {userDisplayName(entry)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="obligation-tags">{form.tags}</Label>
            <Input
              id="obligation-tags"
              value={values.tags}
              onChange={(event) => updateValue('tags', event.target.value)}
              placeholder={form.tagsPlaceholder}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {form.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit || saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
              {isEdit ? form.save : form.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
  optionLabels,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  optionLabels: Record<string, string>;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {resolveEnum(optionLabels, option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function obligationFormDefaults(
  obligation: LexObligation | null | undefined,
  currentUser: { id: string; name: string },
): ObligationFormValues {
  return {
    title: obligation?.title ?? '',
    description: obligation?.description ?? '',
    type: obligation?.type ?? 'contractual',
    status: obligation?.status ?? 'open',
    priority: obligation?.priority ?? 'medium',
    contract_id: obligation?.contract_id ?? '',
    matter_id: obligation?.matter_id ?? '',
    owner_user_id: obligation?.owner_user_id ?? currentUser.id,
    owner_name: obligation?.owner_name ?? currentUser.name,
    due_date: toDateTimeLocalInput(obligation?.due_date) ?? '',
    reminder_enabled: obligation?.reminder_enabled ?? true,
    reminder_lead_days: obligation?.reminder_lead_days?.join(', ') ?? '30, 7, 1',
    escalation_enabled: obligation?.escalation_enabled ?? false,
    escalation_lead_days: obligation?.escalation_lead_days?.join(', ') ?? '7, 1',
    escalation_target: obligation?.escalation_target ?? '',
    tags: obligation?.tags?.join(', ') ?? '',
  };
}

function buildObligationPayload(values: ObligationFormValues): LexCreateObligationPayload & LexUpdateObligationPayload {
  const reminderLeadDays = parseLeadDays(values.reminder_lead_days);
  const escalationLeadDays = parseLeadDays(values.escalation_lead_days);
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    type: values.type,
    status: values.status,
    priority: values.priority,
    contract_id: optionalString(values.contract_id),
    matter_id: optionalString(values.matter_id),
    owner_user_id: values.owner_user_id.trim(),
    owner_name: values.owner_name.trim(),
    due_date: toISODateTime(values.due_date),
    reminder_enabled: values.reminder_enabled,
    reminder_lead_days: values.reminder_enabled ? reminderLeadDays : [],
    escalation_enabled: values.escalation_enabled,
    escalation_lead_days: values.escalation_enabled ? escalationLeadDays : [],
    escalation_target: values.escalation_enabled ? optionalString(values.escalation_target) : '',
    tags: parseTags(values.tags),
    metadata: { source: 'watheeq_obligations_page' },
  };
}

function parseLeadDays(value: string): number[] {
  return value
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .sort((left, right) => right - left);
}

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDateTimeLocalInput(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  const offset = parsed.getTimezoneOffset();
  const local = new Date(parsed.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function toISODateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString();
}

function priorityToSeverity(priority: string | null | undefined): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  switch (priority) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return priority;
    default:
      return 'info';
  }
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}

/**
 * resolveEnum returns the localized label for a raw backend token, falling back
 * to the de-tokenized form so unknown values still render gracefully.
 */
function resolveEnum(map: Record<string, string>, token: string): string {
  return map[token] ?? formatToken(token);
}

function formatLeadDays(days: number[] | undefined, labels: ObligationsLabels): string {
  if (!days || days.length === 0) {
    return labels.cells.defaultLeadTime;
  }
  return labels.cells.leadDays(days.join(', '), days.length === 1 && days[0] === 1 ? 1 : days.length);
}

function RenewalWarningItem({ warning, labels }: { warning: LexContractRenewalWarning; labels: ObligationsLabels }) {
  const f = useLexFormat();
  // Renewal warnings are risk items → rose leading accent (urgent reads darker
  // than non-urgent). Severity reads through the unified severity chip.
  const accent = warning.severity === 'urgent' ? 'bg-destructive/70' : 'bg-destructive/40';
  return (
    <Link
      href={`/lex/contracts/${warning.contract_id}`}
      className="group relative block overflow-hidden rounded-lg border px-4 py-3 ps-5 outline-none transition-[box-shadow,border-color] duration-fast ease-standard hover:border-primary/30 hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={`absolute inset-y-0 start-0 w-1 ${accent}`} aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-medium group-hover:underline" dir="auto">
            {warning.title}
          </span>
          <p className="mt-1 text-xs text-muted-foreground" dir="auto">
            {warning.owner || labels.renewalItem.unassigned} •{' '}
            {warning.counterparty || labels.renewalItem.noCounterparty}
          </p>
        </div>
        <LexSeverityChip value={warning.severity === 'urgent' ? 'critical' : 'high'} size="sm" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {labels.renewalItem.triggerPrefix}{' '}
          {warning.trigger_date ? f.formatRelative(warning.trigger_date) : labels.renewalItem.notSet}
        </span>
        <span>
          {labels.renewalItem.expiryPrefix}{' '}
          {warning.expiry_date ? f.formatDate(warning.expiry_date) : labels.renewalItem.notSet}
        </span>
        <span>{warning.auto_renew ? labels.renewalItem.autoRenews : labels.renewalItem.manualRenewal}</span>
      </div>
    </Link>
  );
}
