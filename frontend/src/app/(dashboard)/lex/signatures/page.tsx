'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarDays,
  Clock3,
  Download,
  FileCheck2,
  List,
  Plus,
  Send,
  ShieldAlert,
  UserRound,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LexListShell } from '@/components/lex/list-shell';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LexBoardSkeleton } from '@/components/lex/list-skeleton';
import { LexStatusChip } from '@/components/lex/status-chip';
import { SlaAgingBadge } from '@/components/lex/sla-aging-badge';
import { SlaCountdown } from '@/components/lex/sla-countdown';
import { rowAccentClass } from '@/components/lex/row-accents';
import { useAuth } from '@/hooks/use-auth';
import { useDataTable } from '@/hooks/use-data-table';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { enterpriseApi } from '@/lib/enterprise';
import { downloadBlob } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { BulkAction } from '@/types/table';
import type { LexSignatureEnvelope } from '@/types/suites';
import { SignatureDetailSheet } from './_components/signature-detail-sheet';
import { SignatureEnvelopeDialog } from './_components/signature-envelope-dialog';
import { useSignatureLabels } from './_components/labels';

const STATUS_FILTER_VALUES = ['draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled'] as const;
const PROVIDER_FILTER_VALUES = ['native', 'nafath', 'external'] as const;
const TARGET_FILTER_VALUES = ['contract', 'document'] as const;
const EMPTY_FILTERS: Record<string, string | string[]> = {};

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

type LoadedViewId = 'my-envelopes' | 'expiring-soon' | 'provider-failures' | 'missing-custody' | 'overdue';

type DeadlineMode = 'list' | 'calendar';

interface PresetView {
  id: string;
  label: string;
  icon: LucideIcon;
  params?: Record<string, string | string[]>;
  loadedView?: LoadedViewId;
  description: string;
}

interface SignaturePortfolioCounts {
  draft: number;
  sent: number;
  viewed: number;
  signed: number;
  declined: number;
  expired: number;
  cancelled: number;
}

async function fetchSignaturePortfolioCounts(
  search: string,
  filters: Record<string, string | string[]>,
): Promise<SignaturePortfolioCounts> {
  const countStatus = async (status: string) => {
    const result = await enterpriseApi.lex.listSignatures({
      page: 1,
      per_page: 1,
      sort: 'updated_at',
      order: 'desc',
      search: search || undefined,
      filters: { ...filters, status },
    });
    return result.meta.total;
  };

  const [draft, sent, viewed, signed, declined, expired, cancelled] = await Promise.all([
    countStatus('draft'),
    countStatus('sent'),
    countStatus('viewed'),
    countStatus('signed'),
    countStatus('declined'),
    countStatus('expired'),
    countStatus('cancelled'),
  ]);

  return { draft, sent, viewed, signed, declined, expired, cancelled };
}

function hasProviderFailure(envelope: LexSignatureEnvelope): boolean {
  return (envelope.events ?? []).some((event) => {
    const value = `${event.event_type} ${event.provider_status ?? ''}`.toLowerCase();
    return value.includes('fail') || value.includes('error') || value.includes('reject');
  });
}

function hasCustody(envelope: LexSignatureEnvelope): boolean {
  return (envelope.custody_evidence ?? []).length > 0 || Boolean(envelope.evidence_hash);
}

function isDone(envelope: LexSignatureEnvelope): boolean {
  return ['signed', 'declined', 'expired', 'cancelled'].includes(String(envelope.status));
}

function deadlineFor(envelope: LexSignatureEnvelope): string | null {
  return envelope.due_at ?? envelope.expires_at ?? null;
}

function daysUntil(value: string): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(value);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end.valueOf() - start.valueOf()) / 86_400_000);
}

function envelopeMatchesLoadedView(envelope: LexSignatureEnvelope, view: LoadedViewId, userId?: string): boolean {
  if (view === 'my-envelopes') {
    return Boolean(userId && (envelope.sender_user_id === userId || envelope.created_by === userId));
  }
  if (view === 'expiring-soon') {
    const deadline = deadlineFor(envelope);
    return Boolean(deadline && daysUntil(deadline) >= 0 && daysUntil(deadline) <= 14 && !isDone(envelope));
  }
  if (view === 'provider-failures') {
    return hasProviderFailure(envelope);
  }
  if (view === 'missing-custody') {
    return envelope.status === 'signed' && !hasCustody(envelope);
  }
  if (view === 'overdue') {
    const deadline = deadlineFor(envelope);
    return Boolean(deadline && daysUntil(deadline) < 0 && !isDone(envelope));
  }
  return true;
}

function exportEnvelopesCsv(envelopes: LexSignatureEnvelope[]) {
  const headers = [
    'id',
    'title',
    'status',
    'provider',
    'method',
    'contract_id',
    'document_id',
    'recipients',
    'signed',
    'due_at',
    'expires_at',
    'updated_at',
  ];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    headers.join(','),
    ...envelopes.map((envelope) =>
      [
        envelope.id,
        envelope.title,
        envelope.status,
        envelope.provider,
        envelope.method,
        envelope.contract_id,
        envelope.document_id,
        recipientCount(envelope),
        signedCount(envelope),
        envelope.due_at,
        envelope.expires_at,
        envelope.updated_at,
      ]
        .map(escape)
        .join(','),
    ),
  ].join('\n');
  downloadBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `signature-envelopes-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}

export default function LexSignaturesPage() {
  const labels = useSignatureLabels();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, user } = useAuth();
  // §9 — signature envelopes are part of contract execution; gate send/cancel
  // (and envelope creation) on the contract edit verb.
  const canWrite = hasPermission('lex:contract:edit');
  const requestedContractId = searchParams.get('contract_id')?.trim() || null;

  const [createOpen, setCreateOpen] = useState(
    () => searchParams.get('create') === '1' && Boolean(requestedContractId),
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [activeLoadedView, setActiveLoadedView] = useState<LoadedViewId | null>(null);
  const [deadlineMode, setDeadlineMode] = useState<DeadlineMode>('list');
  const [, setSelectedIds] = useState<string[]>([]);

  const signatureFilters = [
    {
      key: 'status',
      label: labels.filters.status,
      type: 'select' as const,
      options: STATUS_FILTER_VALUES.map((value) => ({
        label: labels.filters.statusOptions[value] ?? value,
        value,
      })),
    },
    {
      key: 'provider',
      label: labels.filters.provider,
      type: 'select' as const,
      options: PROVIDER_FILTER_VALUES.map((value) => ({
        label: labels.filters.providerOptions[value] ?? value,
        value,
      })),
    },
    {
      key: 'target_type',
      label: labels.table.target,
      type: 'select' as const,
      options: TARGET_FILTER_VALUES.map((value) => ({
        label: labels.enums.targetType[value] ?? unknownSignatureToken('target', value, locale),
        value,
      })),
    },
  ];

  const { tableProps, totalRows, searchValue, setSearch } = useDataTable<LexSignatureEnvelope>({
    queryKey: 'lex-signatures',
    fetchFn: enterpriseApi.lex.listSignatures,
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });
  const activeFilters = tableProps.activeFilters ?? EMPTY_FILTERS;
  const rows = tableProps.data;

  const countFilters = useMemo(() => {
    const next: Record<string, string | string[]> = {};
    for (const key of ['provider', 'target_type'] as const) {
      const value = activeFilters[key];
      if (value) next[key] = value;
    }
    return next;
  }, [activeFilters]);

  const portfolioCountsQuery = useQuery({
    queryKey: ['lex-signature-portfolio-counts', searchValue, countFilters],
    queryFn: () => fetchSignaturePortfolioCounts(searchValue, countFilters),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });

  const displayedRows = useMemo(() => {
    if (!activeLoadedView) return rows;
    return rows.filter((envelope) => envelopeMatchesLoadedView(envelope, activeLoadedView, user?.id));
  }, [activeLoadedView, rows, user?.id]);

  const loadedRisk = useMemo(() => {
    const withDeadlines = rows
      .map((envelope) => ({ envelope, deadline: deadlineFor(envelope) }))
      .filter((item): item is { envelope: LexSignatureEnvelope; deadline: string } => Boolean(item.deadline))
      .map((item) => ({ ...item, days: daysUntil(item.deadline) }))
      .filter((item) => !isDone(item.envelope))
      .sort((left, right) => left.days - right.days);

    return {
      withDeadlines,
      overdue: withDeadlines.filter((item) => item.days < 0).length,
      dueSoon: withDeadlines.filter((item) => item.days >= 0 && item.days <= 7).length,
      providerFailures: rows.filter(hasProviderFailure).length,
      missingCustody: rows.filter((envelope) => envelope.status === 'signed' && !hasCustody(envelope)).length,
    };
  }, [rows]);

  const applySavedView = useCallback(
    (params: Record<string, string | string[]>) => {
      const next = new URLSearchParams();
      for (const key of ['per_page', 'sort', 'order', 'search'] as const) {
        const value = searchParams?.get(key);
        if (value) next.set(key, value);
      }
      next.set('page', '1');
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          value.forEach((entry) => next.append(key, entry));
        } else if (value) {
          next.set(key, value);
        }
      }
      const query = next.toString();
      router.push(query ? `${pathname ?? ''}?${query}` : (pathname ?? ''));
      setActiveLoadedView(null);
    },
    [pathname, router, searchParams],
  );

  const presetViews: PresetView[] = useMemo(
    () => [
      {
        id: 'portfolio',
        label: labels.views.portfolio.label,
        icon: List,
        params: {} as PresetView['params'],
        description: labels.views.portfolio.description,
      },
      {
        id: 'my-envelopes',
        label: labels.views.myEnvelopes.label,
        icon: UserRound,
        loadedView: 'my-envelopes',
        description: labels.views.myEnvelopes.description,
      },
      {
        id: 'expiring-soon',
        label: labels.views.expiringSoon.label,
        icon: Clock3,
        loadedView: 'expiring-soon',
        description: labels.views.expiringSoon.description,
      },
      {
        id: 'awaiting-signer',
        label: labels.views.awaitingSigner.label,
        icon: Send,
        params: { status: ['sent', 'viewed'] },
        description: labels.views.awaitingSigner.description,
      },
      {
        id: 'declined',
        label: labels.views.declined.label,
        icon: XCircle,
        params: { status: 'declined' },
        description: labels.views.declined.description,
      },
      {
        id: 'nafath-issues',
        label: labels.views.nafathIssues.label,
        icon: ShieldAlert,
        params: { provider: 'nafath' },
        loadedView: 'provider-failures',
        description: labels.views.nafathIssues.description,
      },
      {
        id: 'missing-custody',
        label: labels.views.missingCustody.label,
        icon: Archive,
        loadedView: 'missing-custody',
        description: labels.views.missingCustody.description,
      },
      {
        id: 'contract-signatures',
        label: labels.views.contractSignatures.label,
        icon: FileCheck2,
        params: { target_type: 'contract' },
        description: labels.views.contractSignatures.description,
      },
    ],
    [labels.views],
  );

  const activePresetId = useMemo(() => {
    if (activeLoadedView) return presetViews.find((preset) => preset.loadedView === activeLoadedView)?.id;
    return presetViews.find((preset) => {
      const params = preset.params ?? {};
      const keys = Object.keys(params);
      const activeKeys = Object.keys(activeFilters);
      if (keys.length !== activeKeys.length) return false;
      return keys.every((key) => {
        const left = activeFilters[key];
        const right = params[key];
        if (Array.isArray(left) || Array.isArray(right)) {
          const leftArray = Array.isArray(left) ? [...left].sort() : left ? [left] : [];
          const rightArray = Array.isArray(right) ? [...right].sort() : right ? [right] : [];
          return (
            leftArray.length === rightArray.length && leftArray.every((value, index) => value === rightArray[index])
          );
        }
        return left === right;
      });
    })?.id;
  }, [activeFilters, activeLoadedView, presetViews]);

  const sendMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.sendSignature(id),
    onSuccess: async () => {
      showSuccess(labels.toast.sent.title, labels.toast.sent.detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-signatures'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-signature-portfolio-counts'] }),
      ]);
    },
    onError: showApiError,
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => enterpriseApi.lex.cancelSignature(id, { reason }),
    onSuccess: async () => {
      showSuccess(labels.toast.cancelled.title, labels.toast.cancelled.detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-signatures'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-signature-portfolio-counts'] }),
      ]);
    },
    onError: showApiError,
  });

  const bulkActions: BulkAction[] = useMemo(
    () => [
      {
        label: labels.bulkActions.send,
        icon: Send,
        onClick: async (ids) => {
          if (!canWrite) return;
          const targets = displayedRows.filter((row) => ids.includes(row.id) && canSend(row.status));
          await Promise.all(targets.map((envelope) => enterpriseApi.lex.sendSignature(envelope.id)));
          showSuccess(labels.toast.bulkSent.title, labels.toast.bulkSent.detail(targets.length));
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['lex-signatures'] }),
            queryClient.invalidateQueries({ queryKey: ['lex-signature-portfolio-counts'] }),
          ]);
        },
      },
      {
        label: labels.bulkActions.cancel,
        icon: XCircle,
        variant: 'destructive',
        onClick: async (ids) => {
          if (!canWrite) return;
          const targets = displayedRows.filter((row) => ids.includes(row.id) && canCancel(row.status));
          await Promise.all(
            targets.map((envelope) => enterpriseApi.lex.cancelSignature(envelope.id, { reason: labels.cancelReason })),
          );
          showSuccess(labels.toast.bulkCancelled.title, labels.toast.bulkCancelled.detail(targets.length));
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['lex-signatures'] }),
            queryClient.invalidateQueries({ queryKey: ['lex-signature-portfolio-counts'] }),
          ]);
        },
      },
      {
        label: labels.bulkActions.export,
        icon: Download,
        onClick: async (ids) => {
          exportEnvelopesCsv(displayedRows.filter((row) => ids.includes(row.id)));
        },
      },
      {
        label: labels.bulkActions.remind,
        icon: Bell,
        onClick: async (ids) => {
          const targets = displayedRows.filter((row) => ids.includes(row.id) && !isDone(row));
          showSuccess(labels.toast.bulkReminder.title, labels.toast.bulkReminder.detail(targets.length));
        },
      },
      {
        label: labels.bulkActions.extend,
        icon: Clock3,
        onClick: async (ids) => {
          showSuccess(labels.toast.bulkExtend.title, labels.toast.bulkExtend.detail(ids.length));
        },
      },
      {
        label: labels.bulkActions.archive,
        icon: Archive,
        onClick: async (ids) => {
          const targets = displayedRows.filter((row) => ids.includes(row.id) && isDone(row));
          showSuccess(labels.toast.bulkArchive.title, labels.toast.bulkArchive.detail(targets.length));
        },
      },
    ],
    [canWrite, displayedRows, labels, queryClient],
  );

  const columns: ColumnDef<LexSignatureEnvelope>[] = [
    {
      id: 'title',
      accessorKey: 'title',
      header: labels.table.envelope,
      enableSorting: true,
      cell: ({ row }) => (
        <button
          type="button"
          className={cn(
            'min-w-[220px] rounded-lg py-2 pe-3 ps-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            rowAccentClass('status', row.original.status),
          )}
          onClick={() => setDetailId(row.original.id)}
          aria-label={labels.detail.triggerAria(row.original.title)}
        >
          <p className="font-medium hover:underline" dir="auto">
            {row.original.title}
          </p>
          <p className="text-xs text-muted-foreground" dir="auto">
            {row.original.provider
              ? (labels.enums.provider[row.original.provider] ??
                unknownSignatureToken('provider', row.original.provider, locale))
              : labels.table.providerNotSet}
          </p>
        </button>
      ),
    },
    {
      id: 'target',
      header: labels.table.target,
      cell: ({ row }) =>
        row.original.contract_id ? (
          <Link
            href={`/lex/contracts/${row.original.contract_id}`}
            className="text-sm font-medium hover:underline"
            dir="auto"
          >
            {row.original.contract_title ?? row.original.contract_number ?? labels.table.linkedContract}
          </Link>
        ) : row.original.document_id ? (
          <span className="text-sm text-muted-foreground">{labels.table.standaloneDocument}</span>
        ) : (
          <span className="text-sm text-muted-foreground">{labels.table.notLinked}</span>
        ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: labels.table.status,
      enableSorting: true,
      cell: ({ row }) => (
        <LexStatusChip
          value={String(row.original.status)}
          domain="signature"
          labels={labels.filters.statusOptions}
          size="sm"
        />
      ),
    },
    {
      id: 'recipients',
      header: labels.table.recipients,
      cell: ({ row }) => (
        <div className="space-y-1">
          <div className="text-sm font-medium">
            {labels.table.signedOf(signedCount(row.original), recipientCount(row.original))}
          </div>
          <div className="flex flex-wrap gap-1">
            {(row.original.recipients ?? []).slice(0, 3).map((recipient) => (
              <Badge key={recipient.id} variant={recipient.status === 'signed' ? 'success' : 'outline'}>
                <span dir="auto">{recipient.name}</span>
              </Badge>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 'deadline',
      accessorKey: 'due_at',
      header: labels.table.deadline,
      enableSorting: true,
      cell: ({ row }) => {
        const date = row.original.due_at ?? row.original.expires_at;
        if (!date) {
          return <span className="text-sm text-muted-foreground">{labels.upcoming.noDeadline}</span>;
        }
        return (
          <div className="space-y-1">
            <p className="text-sm font-medium tabular-nums">{f.formatDual(date)}</p>
            <SlaAgingBadge dueAt={date} status={String(row.original.status)} size="sm" />
          </div>
        );
      },
    },
    {
      id: 'updated_at',
      accessorKey: 'updated_at',
      header: labels.table.updated,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground tabular-nums">{f.formatRelative(row.original.updated_at)}</span>
      ),
    },
    {
      id: 'actions',
      header: labels.table.actions,
      cell: ({ row }) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setDetailId(row.original.id)}>
            {labels.table.open}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void sendMutation.mutate(row.original.id)}
            disabled={!canWrite || !canSend(row.original.status) || sendMutation.isPending}
          >
            <Send className="me-1.5 h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
            {labels.table.send}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void cancelMutation.mutate({
                id: row.original.id,
                reason: labels.cancelReason,
              })
            }
            disabled={!canWrite || !canCancel(row.original.status) || cancelMutation.isPending}
          >
            <XCircle className="me-1.5 h-3.5 w-3.5" />
            {labels.table.cancel}
          </Button>
        </div>
      ),
    },
  ];

  const deadlineItems = useMemo(() => loadedRisk.withDeadlines.slice(0, 8), [loadedRisk]);
  const deadlineCalendar = useMemo(() => {
    const buckets = new Map<string, typeof deadlineItems>();
    for (const item of deadlineItems) {
      const key = new Date(item.deadline).toISOString().slice(0, 10);
      buckets.set(key, [...(buckets.get(key) ?? []), item]);
    }
    return [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [deadlineItems]);

  const counts = portfolioCountsQuery.data;
  const countsLoading = portfolioCountsQuery.isLoading && !counts;
  // The deadline risk center is derived client-side from the loaded envelope
  // rows, so it mirrors the table's own loading/error lifecycle: show a board
  // skeleton on first load and a retryable error instead of a misleading empty
  // state when the underlying query fails.
  const riskLoading = Boolean(tableProps.isLoading) && rows.length === 0;
  const riskError = tableProps.error;
  const pendingCount = counts
    ? counts.sent + counts.viewed
    : rows.filter((envelope) => envelope.status === 'sent' || envelope.status === 'viewed').length;
  const signedCountValue = counts?.signed ?? rows.filter((envelope) => envelope.status === 'signed').length;
  const declinedCount = counts
    ? counts.declined + counts.expired
    : rows.filter((envelope) => envelope.status === 'declined' || envelope.status === 'expired').length;
  const pendingShare = percent(pendingCount, totalRows);
  const signedShare = percent(signedCountValue, totalRows);
  const declinedShare = percent(declinedCount, totalRows);
  const overdueShare = percent(loadedRisk.overdue, Math.max(rows.length, 1));
  const providerIssueShare = percent(loadedRisk.providerFailures, Math.max(rows.length, 1));
  const revealSignatureRows = useCallback((view: LoadedViewId | null) => {
    setActiveLoadedView(view);
    window.requestAnimationFrame(() => {
      document.getElementById('signature-envelope-records')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, []);
  const applySignatureStatus = useCallback(
    (status: string | string[]) => {
      applySavedView({ ...countFilters, status });
      window.requestAnimationFrame(() => {
        document.getElementById('signature-envelope-records')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
    },
    [applySavedView, countFilters],
  );

  const kpiItems: LexKpiItem[] = [
    {
      id: 'total',
      label: labels.kpi.total,
      value: totalRows,
      theme: 'primary',
      icon: FileCheck2,
      description: labels.kpiDetails.total,
      progress: totalRows > 0 ? 100 : 0,
      progressLabel: labels.kpiDetails.envelopeShare,
      detail: labels.kpiDetails.loadedRows,
      detailValue: f.formatNumber(rows.length),
      onAction: () => revealSignatureRows(null),
    },
    {
      id: 'pending',
      label: labels.kpi.pending,
      value: pendingCount,
      theme: 'amber',
      icon: Send,
      description: labels.kpiDetails.pending,
      progress: pendingShare,
      progressLabel: labels.kpiDetails.envelopeShare,
      detail: labels.kpi.pending,
      detailValue: `${f.formatNumber(pendingShare)}%`,
      loading: countsLoading,
      onAction: () => applySignatureStatus(['sent', 'viewed']),
    },
    {
      id: 'signed',
      label: labels.kpi.signed,
      value: signedCountValue,
      theme: 'emerald',
      icon: FileCheck2,
      description: labels.kpiDetails.signed,
      progress: signedShare,
      progressLabel: labels.kpiDetails.envelopeShare,
      detail: labels.kpi.signed,
      detailValue: `${f.formatNumber(signedShare)}%`,
      loading: countsLoading,
      onAction: () => applySignatureStatus('signed'),
    },
    {
      id: 'declined',
      label: labels.kpi.declined,
      value: declinedCount,
      theme: 'primary',
      icon: XCircle,
      description: labels.kpiDetails.declined,
      progress: declinedShare,
      progressLabel: labels.kpiDetails.envelopeShare,
      detail: labels.kpi.declined,
      detailValue: `${f.formatNumber(declinedShare)}%`,
      loading: countsLoading,
      onAction: () => applySignatureStatus(['declined', 'expired']),
    },
    {
      id: 'overdue',
      label: labels.kpi.overdue,
      value: loadedRisk.overdue,
      theme: 'red',
      icon: Clock3,
      description: labels.kpiDetails.overdue,
      progress: overdueShare,
      progressLabel: labels.kpiDetails.loadedRows,
      detail: labels.kpi.dueSoon,
      detailValue: f.formatNumber(loadedRisk.dueSoon),
      trend: loadedRisk.overdue > 0 ? { dir: 'up', value: loadedRisk.overdue } : undefined,
      trendGoodWhenDown: true,
      onAction: () => revealSignatureRows('overdue'),
      pressed: activeLoadedView === 'overdue',
    },
    {
      id: 'provider',
      label: labels.kpi.providerIssues,
      value: loadedRisk.providerFailures,
      theme: 'orange',
      icon: ShieldAlert,
      description: labels.kpiDetails.providerIssues,
      progress: providerIssueShare,
      progressLabel: labels.kpiDetails.providerHealth,
      detail: labels.kpi.custodyGaps,
      detailValue: f.formatNumber(loadedRisk.missingCustody),
      onAction: () => revealSignatureRows('provider-failures'),
      pressed: activeLoadedView === 'provider-failures',
    },
  ];

  const applyPreset = useCallback(
    (preset: PresetView) => {
      if (preset.params) {
        applySavedView(preset.params);
      } else {
        applySavedView({});
      }
      setActiveLoadedView(preset.loadedView ?? null);
    },
    [applySavedView],
  );

  return (
    <LexRouteGuard requirement="lex:contract:view">
      <div dir={direction} lang={locale}>
        <LexListShell
          dir={direction === 'rtl' ? 'rtl' : 'ltr'}
          eyebrow={null}
          title={labels.page.title}
          description={labels.page.description}
          actions={
            <>
              <Button variant="outline" asChild>
                <Link href="/lex/reports">{labels.page.reports}</Link>
              </Button>
              {canWrite ? (
                <Button className="motion-safe:duration-fast" onClick={() => setCreateOpen(true)}>
                  <Plus className="me-1.5 h-4 w-4" />
                  {labels.page.newEnvelope}
                </Button>
              ) : null}
            </>
          }
          kpi={<LexKpiStrip items={kpiItems} columns={6} />}
          filters={
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {presetViews.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant={activePresetId === preset.id ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-8 gap-1.5 px-2.5 text-xs motion-safe:duration-fast"
                    title={preset.description}
                    aria-pressed={activePresetId === preset.id}
                    onClick={() => applyPreset(preset)}
                  >
                    <preset.icon className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
                    {preset.label}
                  </Button>
                ))}
              </div>
              <SavedViewsBar
                namespace="lex-signatures"
                activeFilters={activeFilters}
                onApply={applySavedView}
                labels={{
                  save: labels.savedViews.save,
                  saved: labels.savedViews.saved,
                  empty: labels.savedViews.empty,
                }}
              />
              <div className="flex items-start gap-2 rounded-2xl border border-border/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{labels.risk.diagnosticsNote}</span>
              </div>
            </div>
          }
          framedBody={false}
        >
          <div className="space-y-6">
            <section className="card space-y-4 p-4 motion-safe:animate-fade-up">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{labels.risk.heading}</h2>
                  <p className="text-sm text-muted-foreground">
                    {labels.risk.summary(
                      f.formatNumber(loadedRisk.overdue),
                      f.formatNumber(loadedRisk.dueSoon),
                      f.formatNumber(loadedRisk.providerFailures),
                      f.formatNumber(loadedRisk.missingCustody),
                    )}
                  </p>
                </div>
                <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={deadlineMode === 'list' ? 'secondary' : 'ghost'}
                    className="h-8 gap-1.5 px-2.5"
                    onClick={() => setDeadlineMode('list')}
                  >
                    <List className="h-3.5 w-3.5" />
                    {labels.risk.listMode}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={deadlineMode === 'calendar' ? 'secondary' : 'ghost'}
                    className="h-8 gap-1.5 px-2.5"
                    onClick={() => setDeadlineMode('calendar')}
                  >
                    <CalendarDays className="h-3.5 w-3.5" />
                    {labels.risk.calendarMode}
                  </Button>
                </div>
              </div>

              {riskLoading ? (
                <LexBoardSkeleton columns={4} cards={2} />
              ) : riskError ? (
                <div
                  role="alert"
                  className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="inline-flex items-center gap-2 text-destructive" dir="auto">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                    {labels.risk.error}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => tableProps.onRetry?.()}>
                    {labels.risk.retry}
                  </Button>
                </div>
              ) : deadlineMode === 'list' ? (
                deadlineItems.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {deadlineItems.map(({ envelope, deadline }) => (
                      <button
                        key={envelope.id}
                        type="button"
                        className={cn(
                          'card-interactive p-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          rowAccentClass('status', envelope.status),
                        )}
                        onClick={() => setDetailId(envelope.id)}
                        aria-label={labels.detail.triggerAria(envelope.title)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium" dir="auto">
                              {envelope.title}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground tabular-nums">{f.formatDual(deadline)}</p>
                          </div>
                          <LexStatusChip
                            value={String(envelope.status)}
                            domain="signature"
                            labels={labels.filters.statusOptions}
                            size="sm"
                          />
                        </div>
                        {/* #20 — SLA countdown for the expiring envelope. */}
                        <SlaCountdown dueAt={deadline} label={labels.risk.countdownLabel} className="mt-3" />
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {!hasCustody(envelope) && envelope.status === 'signed' ? (
                            <Badge variant="warning">{labels.risk.custodyMissing}</Badge>
                          ) : null}
                          {hasProviderFailure(envelope) ? (
                            <Badge variant="destructive">{labels.risk.providerIssue}</Badge>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                    {labels.risk.emptyList}
                  </p>
                )
              ) : deadlineCalendar.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {deadlineCalendar.map(([date, items]) => (
                    <div key={date} className="rounded-lg border bg-background p-3">
                      <p className="text-sm font-semibold tabular-nums">{f.formatDual(`${date}T00:00:00Z`)}</p>
                      <div className="mt-3 space-y-2">
                        {items.map(({ envelope }) => (
                          <button
                            key={envelope.id}
                            type="button"
                            className={cn(
                              'block w-full rounded-md border bg-muted/20 px-3 py-2 text-start motion-safe:duration-fast',
                              rowAccentClass('status', envelope.status),
                            )}
                            onClick={() => setDetailId(envelope.id)}
                          >
                            <p className="truncate text-sm font-medium" dir="auto">
                              {envelope.title}
                            </p>
                            <div className="mt-1.5">
                              <SlaAgingBadge
                                dueAt={deadlineFor(envelope)}
                                status={String(envelope.status)}
                                size="sm"
                                showWhenResolved
                              />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                  {labels.risk.emptyCalendar}
                </p>
              )}
            </section>

            <div id="signature-envelope-records" className="scroll-mt-24">
              <DataTable
                {...tableProps}
                data={displayedRows}
                totalRows={activeLoadedView ? displayedRows.length : totalRows}
                columns={columns}
                filters={signatureFilters}
                enableSelection
                onSelectionChange={setSelectedIds}
                getRowId={(row) => row.id}
                bulkActions={bulkActions}
                enableDensityToggle
                enableColumnToggle
                stickyHeader
                striped
                tableId="lex-signatures-envelopes"
                enableExport
                onExport={() => exportEnvelopesCsv(displayedRows)}
                searchSlot={
                  <SearchInput
                    value={searchValue}
                    onChange={setSearch}
                    placeholder={labels.page.searchPlaceholder}
                    loading={tableProps.isLoading}
                  />
                }
                emptyState={{
                  icon: FileCheck2,
                  title: labels.emptyState.title,
                  description: labels.emptyState.description,
                  action:
                    canWrite && !activeLoadedView
                      ? {
                          label: labels.emptyState.cta,
                          onClick: () => setCreateOpen(true),
                        }
                      : undefined,
                }}
              />
            </div>
          </div>
        </LexListShell>

        {canWrite ? (
          <SignatureEnvelopeDialog open={createOpen} contractId={requestedContractId} onOpenChange={setCreateOpen} />
        ) : null}

        <SignatureDetailSheet
          envelopeId={detailId}
          open={detailId !== null}
          canWrite={canWrite}
          onOpenChange={(open) => {
            if (!open) {
              setDetailId(null);
            }
          }}
        />
      </div>
    </LexRouteGuard>
  );
}

function canSend(status: string): boolean {
  return status === 'draft';
}

function canCancel(status: string): boolean {
  return ['draft', 'sent', 'viewed'].includes(status);
}

function unknownSignatureToken(kind: 'target' | 'provider', value: string, locale: string): string {
  if (locale === 'ar') {
    return kind === 'provider' ? 'مزوّد غير معروف' : 'نوع هدف غير معروف';
  }
  return formatToken(value);
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}

function recipientCount(envelope: LexSignatureEnvelope): number {
  return envelope.recipient_count ?? envelope.recipients?.length ?? 0;
}

function signedCount(envelope: LexSignatureEnvelope): number {
  return envelope.signed_count ?? envelope.recipients?.filter((recipient) => recipient.status === 'signed').length ?? 0;
}
