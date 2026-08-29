'use client';

import { type ComponentType, type FormEvent, useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Archive,
  CheckCircle2,
  CircleSlash,
  Clock,
  FileWarning,
  History,
  LayoutGrid,
  Link2,
  List,
  MessageSquare,
  Pencil,
  PenLine,
  PlayCircle,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  ShieldX,
  Trash2,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable } from '@/components/shared/data-table/data-table';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LexBoardSkeleton } from '@/components/lex/list-skeleton';
import { LexEmptyState } from '@/components/lex/empty-state';
import { StatusChip, type StatusChipProps } from '@/components/shared/status-chip';
import { rowAccentClass } from '@/components/lex/row-accents';
import { useLexFormat } from '@/lib/lex/ksa';
import { SearchInput } from '@/components/shared/forms/search-input';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { parseApiError } from '@/lib/format';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import { showApiError, showError, showSuccess } from '@/lib/toast';
import type { RowAction } from '@/types/table';
import type { JsonObject, LexGovernanceDecision, LexGovernanceDecisionRequest, LexRegulation } from '@/types/suites';
import { type RegulationLabels, useRegulationLabels } from './_components/regulation-content-labels';
import { useRegulationAuthorityLabel } from '../contracts/_lib/contracts-labels';
import { useRegulationTypeLabel } from './_components/regulation-type-labels';
import { RegulationClauseLinksDialog } from './_components/regulation-clause-links-dialog';
import { RegulationFormDialog } from './_components/regulation-form-dialog';
import { RegulationSearchPanel } from './_components/regulation-search-panel';
import { RegulationsBoard } from './_components/regulations-board';
import { GovernanceStatusBadge, normalizeGovernanceStatus } from '../_components/governance-badge';

type GovernanceAwareRegulation = LexRegulation & { governance_status?: string | null };
type GovernanceActionIntent = LexGovernanceDecision | 'request_changes';

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

interface GovernanceActionConfig {
  intent: GovernanceActionIntent;
  decision: LexGovernanceDecision;
  label: string;
  title: string;
  description: string;
  submitLabel: string;
  successTitle: string;
  commentPlaceholder: string;
  icon: typeof CheckCircle2;
  variant?: 'destructive';
}

interface DecisionDraft {
  regulation: GovernanceAwareRegulation;
  action: GovernanceActionConfig;
}

function buildGovernanceActions(labels: RegulationLabels): GovernanceActionConfig[] {
  const a = labels.governance.actions;
  return [
    {
      intent: 'submit_review',
      decision: 'submit_review',
      label: a.submitReview.label,
      title: a.submitReview.title,
      description: a.submitReview.description,
      submitLabel: a.submitReview.submitLabel,
      successTitle: a.submitReview.successTitle,
      commentPlaceholder: a.submitReview.commentPlaceholder,
      icon: RefreshCw,
    },
    {
      intent: 'approve',
      decision: 'approve',
      label: a.approve.label,
      title: a.approve.title,
      description: a.approve.description,
      submitLabel: a.approve.submitLabel,
      successTitle: a.approve.successTitle,
      commentPlaceholder: a.approve.commentPlaceholder,
      icon: CheckCircle2,
    },
    {
      intent: 'request_changes',
      decision: 'reject',
      label: a.requestChanges.label,
      title: a.requestChanges.title,
      description: a.requestChanges.description,
      submitLabel: a.requestChanges.submitLabel,
      successTitle: a.requestChanges.successTitle,
      commentPlaceholder: a.requestChanges.commentPlaceholder,
      icon: MessageSquare,
    },
    {
      intent: 'reject',
      decision: 'reject',
      label: a.reject.label,
      title: a.reject.title,
      description: a.reject.description,
      submitLabel: a.reject.submitLabel,
      successTitle: a.reject.successTitle,
      commentPlaceholder: a.reject.commentPlaceholder,
      icon: XCircle,
      variant: 'destructive',
    },
  ];
}

export default function LexRegulationsPage() {
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useRegulationLabels();
  const regulationAuthorityLabel = useRegulationAuthorityLabel();
  const regTypeLabel = useRegulationTypeLabel();
  // §9/§13 — regulation authoring + governance decisions are catalog
  // configuration; gate on lex:catalog:manage. `lex:*` wildcard still satisfies.
  const canWrite = hasPermission('lex:catalog:manage');
  const canDecideGovernance = canWrite;
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft | null>(null);
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [comment, setComment] = useState('');
  const [activateApproved, setActivateApproved] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<LexRegulation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LexRegulation | null>(null);
  const [linksTarget, setLinksTarget] = useState<LexRegulation | null>(null);
  // M19: list (table) vs board (governance kanban) view. The board groups the
  // library summary fetch by governance status (lifecycle fallback) and reuses
  // the shared BoardView, mirroring the documents/settlements/cases boards.
  const [view, setView] = useState<'table' | 'board'>('table');
  const viewLabels = useMemo(() => (locale === 'ar' ? VIEW_LABELS.ar : VIEW_LABELS.en), [locale]);

  const governanceActions = useMemo(() => buildGovernanceActions(labels), [labels]);

  const regulationFilters = useMemo(
    () => [
      {
        key: 'status',
        label: labels.filters.status,
        type: 'select' as const,
        options: [
          { label: labels.filters.statusOptions.draft, value: 'draft' },
          { label: labels.filters.statusOptions.active, value: 'active' },
          { label: labels.filters.statusOptions.superseded, value: 'superseded' },
          { label: labels.filters.statusOptions.deprecated, value: 'deprecated' },
          { label: labels.filters.statusOptions.archived, value: 'archived' },
        ],
      },
      {
        key: 'jurisdiction',
        label: labels.filters.jurisdiction,
        type: 'select' as const,
        options: [
          { label: labels.filters.jurisdictionOptions.SA, value: 'SA' },
          { label: labels.filters.jurisdictionOptions.GCC, value: 'GCC' },
          { label: labels.filters.jurisdictionOptions.GLOBAL, value: 'GLOBAL' },
        ],
      },
      {
        key: 'governance_status',
        label: labels.filters.governance,
        type: 'select' as const,
        options: [
          { label: labels.filters.governanceOptions.pending_review, value: 'pending_review' },
          { label: labels.filters.governanceOptions.in_review, value: 'in_review' },
          { label: labels.filters.governanceOptions.approved, value: 'approved' },
          { label: labels.filters.governanceOptions.rejected, value: 'rejected' },
        ],
      },
    ],
    [labels],
  );

  const { tableProps, searchValue, setSearch, refetch } = useDataTable<GovernanceAwareRegulation>({
    queryKey: 'lex-regulations',
    fetchFn: enterpriseApi.lex.listRegulations,
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });

  // Lightweight summary band: one wide page fetched once, status splits derived
  // client-side. Kept on its own query-key so the paginated table query is
  // untouched.
  const summaryQuery = useQuery({
    queryKey: ['lex-regulations-summary'],
    queryFn: () =>
      enterpriseApi.lex.listRegulations({
        page: 1,
        per_page: 200,
        sort: 'updated_at',
        order: 'desc',
      }),
  });

  const summary = useMemo(() => {
    const records = (summaryQuery.data?.data ?? []) as GovernanceAwareRegulation[];
    const total = summaryQuery.data?.meta?.total ?? records.length;
    const active = records.filter((record) => record.status === 'active').length;
    const draft = records.filter((record) => record.status === 'draft').length;
    const governanceCount = (target: string) =>
      records.filter((record) => normalizeGovernanceStatus(getGovernanceStatus(record)) === target).length;
    return {
      total,
      active,
      draft,
      pending: governanceCount('pending_review'),
      inReview: governanceCount('in_review'),
      approved: governanceCount('approved'),
      rejected: governanceCount('rejected'),
    };
  }, [summaryQuery.data]);

  // M19: the board groups the whole library (the summary fetch — up to 200
  // records, the same source the KPI strip uses) by governance status, rather
  // than only the current table page, so lanes reflect the full inventory.
  const boardRecords = useMemo(
    () => (summaryQuery.data?.data ?? []) as GovernanceAwareRegulation[],
    [summaryQuery.data],
  );

  // Premium KPI strip (computed client-side from the summary fetch). Tones follow
  // the suite's RAG vocabulary: brand=inventory, emerald=cleared, sky=queued,
  // gold=in-flight review, rose=blocked.
  const kpiItems = useMemo<LexKpiItem[]>(() => {
    const total = Math.max(0, summary.total);
    const activeShare = percent(summary.active, total);
    const pendingShare = percent(summary.pending, total);
    const inReviewShare = percent(summary.inReview, total);
    const approvedShare = percent(summary.approved, total);
    const rejectedShare = percent(summary.rejected, total);
    return [
      {
        id: 'total',
        label: labels.metrics.total,
        value: summary.total,
        theme: 'primary',
        icon: Scale,
        description: labels.metricDetails.total,
        progress: total > 0 ? 100 : 0,
        progressLabel: labels.metricDetails.regulationShare,
        detail: labels.metricDetails.governanceQueue,
        detailValue: f.formatNumber(summary.pending + summary.inReview),
        loading: summaryQuery.isLoading,
        href: '/lex/regulations',
      },
      {
        id: 'active',
        label: labels.metrics.active,
        value: summary.active,
        theme: 'emerald',
        icon: CheckCircle2,
        description: labels.metricDetails.active,
        progress: activeShare,
        progressLabel: labels.metricDetails.regulationShare,
        detail: labels.metrics.active,
        detailValue: `${f.formatNumber(activeShare)}%`,
        loading: summaryQuery.isLoading,
        href: '/lex/regulations?status=active',
      },
      {
        id: 'pending',
        label: labels.metrics.pending,
        value: summary.pending,
        theme: 'primary',
        icon: Clock,
        description: labels.metricDetails.pending,
        progress: pendingShare,
        progressLabel: labels.metricDetails.regulationShare,
        detail: labels.metrics.pending,
        detailValue: `${f.formatNumber(pendingShare)}%`,
        loading: summaryQuery.isLoading,
        href: '/lex/regulations?governance_status=pending_review',
      },
      {
        id: 'in_review',
        label: labels.metrics.inReview,
        value: summary.inReview,
        theme: 'amber',
        icon: RefreshCw,
        description: labels.metricDetails.inReview,
        progress: inReviewShare,
        progressLabel: labels.metricDetails.regulationShare,
        detail: labels.metrics.inReview,
        detailValue: `${f.formatNumber(inReviewShare)}%`,
        loading: summaryQuery.isLoading,
        href: '/lex/regulations?governance_status=in_review',
      },
      {
        id: 'approved',
        label: labels.metrics.approved,
        value: summary.approved,
        theme: 'teal',
        icon: ShieldCheck,
        description: labels.metricDetails.approved,
        progress: approvedShare,
        progressLabel: labels.metricDetails.regulationShare,
        detail: labels.metrics.approved,
        detailValue: `${f.formatNumber(approvedShare)}%`,
        loading: summaryQuery.isLoading,
        href: '/lex/regulations?governance_status=approved',
      },
      {
        id: 'rejected',
        label: labels.metrics.rejected,
        value: summary.rejected,
        theme: 'red',
        icon: ShieldX,
        description: labels.metricDetails.rejected,
        progress: rejectedShare,
        progressLabel: labels.metricDetails.regulationShare,
        detail: labels.metrics.rejected,
        detailValue: `${f.formatNumber(rejectedShare)}%`,
        loading: summaryQuery.isLoading,
        href: '/lex/regulations?governance_status=rejected',
      },
    ];
  }, [f, labels, summary, summaryQuery.isLoading]);

  const refreshRegulations = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['lex-regulations'] });
    await queryClient.invalidateQueries({ queryKey: ['lex-regulations-search'] });
    await refetch();
  }, [queryClient, refetch]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.deleteRegulation(id),
    onSuccess: async () => {
      showSuccess(labels.toast.deleted);
      setDeleteTarget(null);
      await refreshRegulations();
    },
    onError: showApiError,
  });

  const defaultReviewerName = useMemo(() => userDisplayName(user), [user]);

  const openDecisionDialog = useCallback(
    (regulation: GovernanceAwareRegulation, action: GovernanceActionConfig) => {
      setDecisionDraft({ regulation, action });
      setReviewerName(defaultReviewerName);
      setReviewerEmail(user?.email ?? '');
      setComment('');
      setActivateApproved(action.decision === 'approve' && regulation.status !== 'active');
    },
    [defaultReviewerName, user?.email],
  );

  const closeDecisionDialog = useCallback(() => {
    setDecisionDraft(null);
    setReviewerName('');
    setReviewerEmail('');
    setComment('');
    setActivateApproved(true);
  }, []);

  const rowActions = useMemo<RowAction<GovernanceAwareRegulation>[]>(
    () => [
      {
        label: labels.actions.edit,
        icon: Pencil,
        disabled: () => submitting || deleteMutation.isPending,
        onClick: (regulation) => setEditTarget(regulation),
      },
      {
        label: labels.actions.links,
        icon: Link2,
        disabled: () => submitting || deleteMutation.isPending,
        onClick: (regulation) => setLinksTarget(regulation),
      },
      ...governanceActions.map<RowAction<GovernanceAwareRegulation>>((action) => ({
        label: action.label,
        icon: action.icon,
        variant: action.variant,
        hidden: (regulation) => isGovernanceActionHidden(action, getGovernanceStatus(regulation)),
        disabled: () => submitting,
        onClick: (regulation) => openDecisionDialog(regulation, action),
      })),
      {
        label: labels.actions.delete,
        icon: Trash2,
        variant: 'destructive',
        disabled: () => submitting || deleteMutation.isPending,
        onClick: (regulation) => setDeleteTarget(regulation),
      },
    ],
    [deleteMutation.isPending, governanceActions, labels, openDecisionDialog, submitting],
  );

  const handleGovernanceSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!decisionDraft) return;

    const trimmedReviewerName = reviewerName.trim();
    const trimmedReviewerEmail = reviewerEmail.trim();
    const trimmedComment = comment.trim();

    if (!trimmedReviewerName || !trimmedComment) {
      showError(labels.governance.detailsRequiredTitle, labels.governance.detailsRequiredMessage);
      return;
    }

    const payload: LexGovernanceDecisionRequest = {
      decision: decisionDraft.action.decision,
      notes: trimmedComment,
      evidence: buildGovernanceEvidence({
        action: decisionDraft.action,
        reviewerName: trimmedReviewerName,
        reviewerEmail: trimmedReviewerEmail,
        reviewerUserId: user?.id ?? null,
      }),
      ...(decisionDraft.action.decision === 'approve' ? { activate: activateApproved } : {}),
    };

    setSubmitting(true);
    try {
      await enterpriseApi.lex.decideRegulationGovernance(decisionDraft.regulation.id, payload);
      await refreshRegulations();
      showSuccess(
        decisionDraft.action.successTitle,
        resolveLocalized({ en: decisionDraft.regulation.title_en, ar: decisionDraft.regulation.title_ar }, locale),
      );
      closeDecisionDialog();
    } catch (error) {
      showError(labels.governance.decisionFailedTitle, parseApiError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnDef<GovernanceAwareRegulation>[] = [
    {
      id: 'title_en',
      accessorKey: 'title_en',
      header: labels.columns.regulation,
      enableSorting: true,
      cell: ({ row }) => {
        // Arabic-first: the primary line resolves to the active locale (Arabic in
        // ar, falling back to the other language), and the secondary line shows the
        // opposite language so both remain visible.
        const primaryTitle = resolveLocalized({ en: row.original.title_en, ar: row.original.title_ar }, locale);
        const secondaryTitle = locale === 'ar' ? row.original.title_en : row.original.title_ar;
        const summary = resolveLocalized({ en: row.original.description_en, ar: row.original.description_ar }, locale);
        return (
          // Color-coded, elevated row accent: an inline-start bar tinted to the
          // regulation's lifecycle status (rowAccentClass), so the list scans like
          // the Settlements board. RTL-safe via the helper's logical border-s edge.
          <div
            className={cn('-my-3 max-w-xl rounded-e-lg py-3 pe-3 ps-3', rowAccentClass('status', row.original.status))}
          >
            <p className="font-medium" dir="auto">
              {primaryTitle || row.original.code}
            </p>
            {secondaryTitle ? (
              <p className="text-xs text-muted-foreground" dir="auto">
                {secondaryTitle}
              </p>
            ) : null}
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground" dir="auto">
              {summary || row.original.code || labels.columns.noSummary}
            </p>
          </div>
        );
      },
    },
    {
      id: 'authority',
      accessorKey: 'authority',
      header: labels.columns.authority,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground" dir="auto">
          {row.original.authority ? regulationAuthorityLabel(row.original.authority) : labels.columns.unspecified}
        </span>
      ),
    },
    {
      id: 'jurisdiction',
      accessorKey: 'jurisdiction',
      header: labels.columns.jurisdiction,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline" className="font-medium">
          {jurisdictionLabel(row.original.jurisdiction, labels)}
        </Badge>
      ),
    },
    {
      id: 'governance_status',
      accessorKey: 'governance_status',
      header: labels.columns.governance,
      enableSorting: true,
      cell: ({ row }) => {
        const status = getGovernanceStatus(row.original);
        return (
          <GovernanceStatusBadge
            status={status}
            label={governanceStatusLabel(normalizeGovernanceStatus(status), labels)}
          />
        );
      },
    },
    {
      id: 'regulation_type',
      accessorKey: 'regulation_type',
      header: labels.columns.type,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground" dir="auto">
          {row.original.regulation_type ? regTypeLabel(row.original.regulation_type) : labels.columns.defaultType}
        </span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: labels.columns.status,
      enableSorting: true,
      cell: ({ row }) => <RegulationLifecycleChip status={row.original.status} labels={labels} />,
    },
    {
      id: 'effective_date',
      accessorKey: 'effective_date',
      header: labels.columns.effective,
      enableSorting: true,
      // KSA: dual Gregorian (Hijri) in Arabic mode; Arabic-Indic digits applied
      // inside useLexFormat. A title carries the relative time on hover.
      cell: ({ row }) =>
        row.original.effective_date ? (
          <span className="text-sm" title={f.formatRelative(row.original.effective_date)}>
            {f.formatDual(row.original.effective_date)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{labels.columns.noDate}</span>
        ),
    },
    {
      id: 'updated_at',
      accessorKey: 'updated_at',
      header: labels.columns.updated,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground" title={f.formatDual(row.original.updated_at)}>
          {f.formatRelative(row.original.updated_at)}
        </span>
      ),
    },
  ];

  return (
    <LexRouteGuard route="/lex/regulations">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          eyebrow={labels.metrics.eyebrow}
          title={labels.page.title}
          description={labels.page.description}
          actions={
            canWrite ? (
              <Button onClick={() => setCreateOpen(true)} className="duration-fast ease-emphasized">
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {labels.actions.create}
              </Button>
            ) : undefined
          }
        />
        <LexKpiStrip items={kpiItems} columns={6} />
        <RegulationSearchPanel onSelect={canWrite ? setEditTarget : undefined} />
        {(() => {
          // M19: search + list/board view toggle controls, shared between the
          // table view (DataTable searchSlot) and the board view (standalone
          // toolbar) so search stays put when switching views.
          const searchControls = (
            <div className="flex w-full flex-wrap items-center gap-2">
              <div className="min-w-[200px] flex-1">
                <SearchInput
                  value={searchValue}
                  onChange={setSearch}
                  placeholder={labels.page.searchPlaceholder}
                  loading={tableProps.isLoading}
                />
              </div>
              <div
                className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5"
                role="group"
                aria-label={viewLabels.label}
              >
                <ViewToggle
                  active={view === 'table'}
                  onClick={() => setView('table')}
                  icon={List}
                  label={viewLabels.table}
                />
                <ViewToggle
                  active={view === 'board'}
                  onClick={() => setView('board')}
                  icon={LayoutGrid}
                  label={viewLabels.board}
                />
              </div>
            </div>
          );

          if (view === 'board') {
            return (
              <div className="space-y-3">
                {searchControls}
                {summaryQuery.isLoading ? (
                  // Board loading now mirrors the table skeleton (and the
                  // documents/service-desk board surfaces) instead of a bare
                  // text line.
                  <LexBoardSkeleton columns={4} />
                ) : summaryQuery.isError ? (
                  // Board error state (previously unhandled): the summary fetch
                  // can fail just like the table query — surface it with a retry
                  // instead of silently rendering an empty board.
                  <div
                    role="alert"
                    className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-12 text-center"
                  >
                    <p className="text-sm font-medium text-foreground" dir="auto">
                      {viewLabels.errorTitle}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground" dir="auto">
                      {parseApiError(summaryQuery.error)}
                    </p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => summaryQuery.refetch()}>
                      <RefreshCw className="me-1.5 h-4 w-4" aria-hidden />
                      {viewLabels.retry}
                    </Button>
                  </div>
                ) : boardRecords.length === 0 ? (
                  <LexEmptyState
                    icon={FileWarning}
                    title={labels.page.emptyTitle}
                    description={labels.page.emptyDescription}
                    action={
                      canWrite
                        ? { label: labels.metrics.emptyCta, icon: Plus, onClick: () => setCreateOpen(true) }
                        : undefined
                    }
                  />
                ) : (
                  <RegulationsBoard
                    regulations={boardRecords}
                    labels={labels}
                    dir={direction === 'rtl' ? 'rtl' : 'ltr'}
                    onSelect={canWrite ? setEditTarget : undefined}
                  />
                )}
              </div>
            );
          }

          return (
            <DataTable
              {...tableProps}
              columns={columns}
              filters={regulationFilters}
              striped
              stickyHeader
              enableDensityToggle
              enableColumnToggle
              tableId="lex-regulations-library"
              searchSlot={searchControls}
              emptyState={{
                icon: FileWarning,
                title: labels.page.emptyTitle,
                description: labels.page.emptyDescription,
                action: canWrite
                  ? { label: labels.metrics.emptyCta, icon: Plus, onClick: () => setCreateOpen(true) }
                  : undefined,
              }}
              rowActions={canDecideGovernance ? rowActions : undefined}
            />
          );
        })()}
        <Dialog
          open={!!decisionDraft}
          onOpenChange={(open) => {
            if (!open && !submitting) closeDecisionDialog();
          }}
        >
          {decisionDraft ? (
            <DialogContent className="sm:max-w-xl">
              <form className="space-y-5" onSubmit={handleGovernanceSubmit}>
                <DialogHeader>
                  <DialogTitle>{decisionDraft.action.title}</DialogTitle>
                  <DialogDescription>{decisionDraft.action.description}</DialogDescription>
                </DialogHeader>

                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" dir="auto">
                        {resolveLocalized(
                          { en: decisionDraft.regulation.title_en, ar: decisionDraft.regulation.title_ar },
                          locale,
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[
                          decisionDraft.regulation.authority
                            ? regulationAuthorityLabel(decisionDraft.regulation.authority)
                            : '',
                          decisionDraft.regulation.code,
                        ]
                          .filter(Boolean)
                          .join(' - ') || labels.governance.sourceFallback}
                      </p>
                    </div>
                    <GovernanceStatusBadge
                      status={getGovernanceStatus(decisionDraft.regulation)}
                      label={governanceStatusLabel(
                        normalizeGovernanceStatus(getGovernanceStatus(decisionDraft.regulation)),
                        labels,
                      )}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="regulation-governance-reviewer">{labels.governance.reviewer}</Label>
                    <Input
                      id="regulation-governance-reviewer"
                      value={reviewerName}
                      onChange={(event) => setReviewerName(event.target.value)}
                      placeholder={labels.governance.reviewerPlaceholder}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="regulation-governance-reviewer-email">{labels.governance.reviewerEmail}</Label>
                    <Input
                      id="regulation-governance-reviewer-email"
                      type="email"
                      value={reviewerEmail}
                      onChange={(event) => setReviewerEmail(event.target.value)}
                      placeholder={labels.governance.reviewerEmailPlaceholder}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="regulation-governance-comment">{labels.governance.comment}</Label>
                  <Textarea
                    id="regulation-governance-comment"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder={decisionDraft.action.commentPlaceholder}
                    required
                  />
                </div>

                {decisionDraft.action.decision === 'approve' ? (
                  <label className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/70 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border"
                      checked={activateApproved}
                      onChange={(event) => setActivateApproved(event.target.checked)}
                    />
                    {labels.governance.activateApproved}
                  </label>
                ) : null}

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={closeDecisionDialog} disabled={submitting}>
                    {labels.governance.cancel}
                  </Button>
                  <Button
                    type="submit"
                    variant={decisionDraft.action.variant === 'destructive' ? 'destructive' : 'default'}
                    disabled={submitting}
                  >
                    {submitting ? labels.governance.submitting : decisionDraft.action.submitLabel}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          ) : null}
        </Dialog>
        {canWrite ? (
          <>
            <RegulationFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={refreshRegulations} />
            {editTarget ? (
              <RegulationFormDialog
                open
                regulation={editTarget}
                onOpenChange={(open) => {
                  if (!open) setEditTarget(null);
                }}
                onSaved={refreshRegulations}
              />
            ) : null}
            {linksTarget ? (
              <RegulationClauseLinksDialog
                open
                regulation={linksTarget}
                onOpenChange={(open) => {
                  if (!open) setLinksTarget(null);
                }}
                onChanged={refreshRegulations}
              />
            ) : null}
            <ConfirmDialog
              open={deleteTarget !== null}
              onOpenChange={(open) => {
                if (!open) setDeleteTarget(null);
              }}
              title={labels.confirmDelete.title}
              description={labels.confirmDelete.description(
                resolveLocalized({ en: deleteTarget?.title_en ?? '', ar: deleteTarget?.title_ar ?? '' }, locale),
              )}
              confirmLabel={labels.confirmDelete.confirmLabel}
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

/**
 * M19 list/board view toggle copy. Board-local bilingual bundle (per the lex
 * i18n contract) so the regulation label file stays untouched; EN/MSA keyed off
 * the active locale.
 */
const VIEW_LABELS = {
  en: {
    label: 'View',
    table: 'List',
    board: 'Board',
    loading: 'Loading regulations…',
    errorTitle: 'Failed to load the regulation board.',
    retry: 'Retry',
  },
  ar: {
    label: 'العرض',
    table: 'قائمة',
    board: 'لوحة',
    loading: 'جارٍ تحميل اللوائح…',
    errorTitle: 'تعذّر تحميل لوحة اللوائح.',
    retry: 'إعادة المحاولة',
  },
} as const;

/**
 * M19: list/board view toggle button — mirrors the documents/settlements toggle
 * UI (segmented control, icon + label, aria-pressed) and is RTL-safe.
 */
function ViewToggle({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

function governanceStatusLabel(normalized: string, labels: RegulationLabels): string {
  const options = labels.filters.governanceOptions;
  switch (normalized) {
    case 'pending_review':
      return options.pending_review;
    case 'in_review':
      return options.in_review;
    case 'approved':
      return options.approved;
    case 'rejected':
      return options.rejected;
    case 'active':
      return labels.filters.statusOptions.active;
    default:
      return formatToken(normalized);
  }
}

function isGovernanceActionHidden(action: GovernanceActionConfig, status?: string | null): boolean {
  const normalized = normalizeGovernanceStatus(status);
  const isApproved = normalized === 'approved' || normalized === 'active';

  if (action.intent === 'submit_review') {
    return normalized === 'pending_review' || normalized === 'in_review' || isApproved;
  }

  if (action.intent === 'approve') {
    return isApproved;
  }

  return normalized === 'rejected';
}

function getGovernanceStatus(regulation: GovernanceAwareRegulation): string {
  const metadataStatus = regulation.metadata?.governance_status;
  return regulation.governance_status ?? (typeof metadataStatus === 'string' ? metadataStatus : 'pending_review');
}

function buildGovernanceEvidence({
  action,
  reviewerName,
  reviewerEmail,
  reviewerUserId,
}: {
  action: GovernanceActionConfig;
  reviewerName: string;
  reviewerEmail: string;
  reviewerUserId: string | null;
}): JsonObject {
  return {
    reviewer_name: reviewerName,
    reviewer_email: reviewerEmail || null,
    reviewer_user_id: reviewerUserId,
    decision_label: action.label,
    decision_style: action.intent,
    decided_at: new Date().toISOString(),
  };
}

function userDisplayName(
  user?: { full_name?: string; first_name?: string; last_name?: string; email?: string } | null,
): string {
  if (!user) return '';
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || '';
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}

/** Localized jurisdiction label, falling back to the raw token / Global default. */
function jurisdictionLabel(jurisdiction: string | null | undefined, labels: RegulationLabels): string {
  if (!jurisdiction) return labels.columns.defaultJurisdiction;
  const options = labels.filters.jurisdictionOptions as Record<string, string>;
  return options[jurisdiction] ?? jurisdiction;
}

/**
 * Lifecycle status chip for the regulation library. Renders the unified shared
 * `StatusChip` (color + icon + label, never color-only — WCAG 1.4.1) with the
 * library's restrained lifecycle tones: active=success, draft=in-flight brand,
 * superseded/deprecated/archived=neutral inert.
 */
const LIFECYCLE_STYLE: Record<string, { tone: NonNullable<StatusChipProps['tone']>; icon: typeof PlayCircle }> = {
  active: { tone: 'success', icon: PlayCircle },
  draft: { tone: 'primary', icon: PenLine },
  superseded: { tone: 'neutral', icon: History },
  deprecated: { tone: 'warning', icon: CircleSlash },
  archived: { tone: 'neutral', icon: Archive },
};

function RegulationLifecycleChip({ status, labels }: { status: string; labels: RegulationLabels }) {
  const key = status.toLowerCase();
  const style = LIFECYCLE_STYLE[key] ?? { tone: 'neutral' as const, icon: History };
  const options = labels.filters.statusOptions as Record<string, string>;
  const label = options[key] ?? formatToken(status);
  return <StatusChip label={label} tone={style.tone} icon={style.icon} size="sm" />;
}
