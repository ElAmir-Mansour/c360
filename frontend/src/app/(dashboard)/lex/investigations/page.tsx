'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  LayoutGrid,
  Link2,
  ListFilter,
  Plus,
  Search,
  ShieldQuestion,
  Table2,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { LexListShell } from '@/components/lex/list-shell';
import { LexKpiStrip } from '@/components/lex/kpi-strip';
import { LexStatusChip, LexPriorityChip } from '@/components/lex/status-chip';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { resolveLocalized } from '@/lib/i18n/localized';
import { casesApi } from '@/lib/lex/cases';
import { showApiError, showSuccess } from '@/lib/toast';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { cn } from '@/lib/utils';
import {
  INVESTIGATION_PRIORITY_VALUES,
  INVESTIGATION_STATUS_VALUES,
  investigationsApi,
  type Investigation,
  type InvestigationStatus,
} from '@/lib/lex/investigations';
import { formatInvestigationToken, useInvestigationLabels } from './_components/labels';
import { InvestigationBoard } from './_components/investigation-board';
import { InvestigationBoardSurface } from './_components/investigation-board-surface';
import { InvestigationFormDialog } from './_components/investigation-form-dialog';
import { InvestigationPreviewDrawer } from './_components/investigation-preview-drawer';
import { parseInvestigationWorkspace } from './_components/investigation-workspaces';

const BASE = '/api/v1/lex/investigations';

const SERVER_FILTER_KEYS = ['status', 'priority', 'case_id', 'department', 'case_type'] as const;
const DETAIL_BACKED_LOADED_VIEWS = new Set<LoadedViewId>(['missing-evidence', 'no-parties']);
const EMPTY_FILTERS: Record<string, string | string[]> = {};

type ServerFilterKey = (typeof SERVER_FILTER_KEYS)[number];
type ServerFilters = Partial<Record<ServerFilterKey, string>>;
type LoadedViewId = 'my-investigations' | 'missing-evidence' | 'no-parties' | 'ai-drafted' | 'linked-to-case';

interface ServerPreset {
  id: string;
  label: string;
  description: string;
  filters: ServerFilters;
  icon: LucideIcon;
}

interface LoadedPreset {
  id: LoadedViewId;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface PortfolioStatusCounts {
  inProgress: number;
  pendingApproval: number;
  approved: number;
}

const INVESTIGATION_WORKSPACE_LINKS: Array<{
  href: string;
  en: string;
  ar: string;
  descriptionEn: string;
  descriptionAr: string;
  icon: LucideIcon;
}> = [
  {
    href: '/lex/investigations/fraud',
    en: 'Fraud Investigations',
    ar: 'تحقيقات الاحتيال',
    descriptionEn: 'Fraud intake and active casework',
    descriptionAr: 'بلاغات الاحتيال وأعمال التحقيق النشطة',
    icon: ShieldQuestion,
  },
  {
    href: '/lex/investigations/compliance',
    en: 'Compliance Audits',
    ar: 'تدقيق الالتزام',
    descriptionEn: 'Regulatory and policy reviews',
    descriptionAr: 'المراجعات التنظيمية والسياسات',
    icon: ClipboardCheck,
  },
  {
    href: '/lex/investigations/forensics',
    en: 'Digital Forensics',
    ar: 'الأدلة الرقمية',
    descriptionEn: 'Evidence and custody operations',
    descriptionAr: 'عمليات الأدلة وسلسلة الحيازة',
    icon: FileSearch,
  },
  {
    href: '/lex/investigations/board-review',
    en: 'Board Review',
    ar: 'مراجعة المجلس',
    descriptionEn: 'Governance decision queue',
    descriptionAr: 'قائمة قرارات الحوكمة',
    icon: CheckCircle2,
  },
];

function readSingleFilter(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

function normalizeServerFilters(filters: Record<string, string | string[]>): ServerFilters {
  const next: ServerFilters = {};
  for (const key of SERVER_FILTER_KEYS) {
    const value = readSingleFilter(filters[key]);
    if (value) next[key] = value;
  }
  return next;
}

function stableFiltersKey(filters: ServerFilters): string {
  return SERVER_FILTER_KEYS.map((key) => `${key}:${filters[key] ?? ''}`).join('|');
}

function serverPresetActive(active: ServerFilters, preset: ServerPreset): boolean {
  const activeEntries = Object.entries(active).filter(([, value]) => Boolean(value));
  const presetEntries = Object.entries(preset.filters).filter(([, value]) => Boolean(value));
  if (activeEntries.length !== presetEntries.length) return false;
  return presetEntries.every(([key, value]) => active[key as ServerFilterKey] === value);
}

async function fetchPortfolioStatusCounts(search: string, filters: ServerFilters): Promise<PortfolioStatusCounts> {
  const countStatus = async (status: Investigation['status']) => {
    const result = await fetchSuitePaginated<Investigation>(BASE, {
      page: 1,
      per_page: 1,
      sort: 'updated_at',
      order: 'desc',
      search: search || undefined,
      filters: { ...filters, status },
    });
    return result.meta.total;
  };

  const [active, resultsRecorded, pendingApproval, approved, closed] = await Promise.all([
    countStatus('in_progress'),
    countStatus('results_recorded'),
    countStatus('pending_approval'),
    countStatus('approved'),
    countStatus('closed'),
  ]);

  return {
    inProgress: active + resultsRecorded,
    pendingApproval,
    approved: approved + closed,
  };
}

function loadedStatusCounts(rows: Investigation[]): PortfolioStatusCounts {
  return rows.reduce<PortfolioStatusCounts>(
    (acc, row) => {
      if (row.status === 'in_progress' || row.status === 'results_recorded') acc.inProgress += 1;
      if (row.status === 'pending_approval') acc.pendingApproval += 1;
      if (row.status === 'approved' || row.status === 'closed') acc.approved += 1;
      return acc;
    },
    { inProgress: 0, pendingApproval: 0, approved: 0 },
  );
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

function userAliases(
  user:
    | {
        id?: string;
        email?: string;
        first_name?: string;
        last_name?: string;
        full_name?: string;
      }
    | null
    | undefined,
): string[] {
  if (!user) return [];
  return [user.id, user.email, user.full_name, [user.first_name, user.last_name].filter(Boolean).join(' ')]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toLowerCase());
}

function matchesLoadedView(
  viewId: LoadedViewId,
  row: Investigation,
  details: Map<string, Investigation>,
  aliases: string[],
): boolean {
  const detail = details.get(row.id);
  const record = detail ?? row;

  switch (viewId) {
    case 'my-investigations': {
      const lead = row.lead_investigator.trim().toLowerCase();
      return row.created_by ? aliases.includes(row.created_by.toLowerCase()) : aliases.includes(lead);
    }
    case 'missing-evidence':
      return Array.isArray(record.evidence) ? record.evidence.length === 0 : false;
    case 'no-parties':
      return Array.isArray(record.parties) ? record.parties.length === 0 : false;
    case 'ai-drafted':
      return row.ai_drafted;
    case 'linked-to-case':
      return Boolean(row.case_id);
    default:
      return false;
  }
}

export default function LexInvestigationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission, hasAnyPermission, user } = useAuth();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const qc = useQueryClient();
  const labels = useInvestigationLabels();
  // §9/§18.4 — list create CTA + board advance are investigation mutations
  // (add/edit verbs), not coarse lex:write. `lex:*` wildcard still satisfies.
  const canWrite = hasAnyPermission(['lex:investigation:add', 'lex:investigation:edit']);
  const [createOpen, setCreateOpen] = useState(() => searchParams?.get('create') === '1');
  const createWorkspace = parseInvestigationWorkspace(searchParams?.get('workspace'));
  const [previewInvestigation, setPreviewInvestigation] = useState<Investigation | null>(null);
  const [activeLoadedView, setActiveLoadedView] = useState<LoadedViewId | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'board'>('table');

  const { tableProps, totalRows, searchValue, setSearch } = useDataTable<Investigation>({
    queryKey: 'lex-investigations',
    fetchFn: (params) => fetchSuitePaginated<Investigation>(BASE, params),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['lex.investigations'],
  });

  const rows = tableProps.data;
  const activeFilters = tableProps.activeFilters ?? EMPTY_FILTERS;
  const serverFilters = useMemo(() => normalizeServerFilters(activeFilters), [activeFilters]);
  const serverFiltersKey = useMemo(() => stableFiltersKey(serverFilters), [serverFilters]);
  const aliases = useMemo(() => userAliases(user), [user]);

  const portfolioCountsQuery = useQuery({
    queryKey: ['lex-investigation-portfolio-counts', searchValue, serverFiltersKey],
    queryFn: () => fetchPortfolioStatusCounts(searchValue, serverFilters),
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });

  const linkedCasesQuery = useQuery({
    queryKey: ['lex-investigation-filter-cases', locale],
    queryFn: () => casesApi.listCases({ page: 1, per_page: 100, order: 'asc' }),
    staleTime: 5 * 60_000,
  });
  const linkedCaseOptions = useMemo(
    () =>
      (linkedCasesQuery.data?.data ?? []).map((legalCase) => ({
        value: legalCase.id,
        label: `${legalCase.case_number} — ${resolveLocalized(legalCase.title, locale) || legalCase.case_number}`,
      })),
    [linkedCasesQuery.data?.data, locale],
  );

  const needsLoadedDetails = activeLoadedView !== null && DETAIL_BACKED_LOADED_VIEWS.has(activeLoadedView);
  const detailQueries = useQueries({
    queries: rows.map((row) => ({
      queryKey: ['lex-investigation-list-detail', row.id],
      queryFn: () => investigationsApi.get(row.id),
      enabled: needsLoadedDetails,
      staleTime: 60_000,
    })),
  });

  const detailsById = useMemo(() => {
    const next = new Map<string, Investigation>();
    detailQueries.forEach((query) => {
      if (query.data) next.set(query.data.id, query.data);
    });
    return next;
  }, [detailQueries]);

  const displayedRows = useMemo(() => {
    if (!activeLoadedView) return rows;
    return rows.filter((row) => matchesLoadedView(activeLoadedView, row, detailsById, aliases));
  }, [activeLoadedView, aliases, detailsById, rows]);

  const loadedViewLoading = needsLoadedDetails && detailQueries.some((query) => query.isLoading);
  const loadedFallbackCounts = useMemo(() => loadedStatusCounts(rows), [rows]);
  const stats = {
    total: totalRows,
    ...(portfolioCountsQuery.data ?? loadedFallbackCounts),
  };

  // Drag-to-advance on the board: maps the eligible status transition onto the
  // status endpoint, then refreshes the list + portfolio counts.
  const boardMoveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: InvestigationStatus }) => {
      const deadline = rows.find((row) => row.id === id)?.sla_deadline;
      let lateJustification: string | undefined;
      if (
        (status === 'closed' || status === 'cancelled') &&
        deadline &&
        Date.now() > new Date(deadline).getTime()
      ) {
        const answer = window.prompt(
          locale === 'ar'
            ? 'اشرح سبب إنهاء التحقيق بعد الموعد المحدد في اتفاقية مستوى الخدمة.'
            : 'Explain why the investigation ended after its SLA deadline.',
        );
        if (!answer?.trim()) throw new Error('Late justification is required');
        lateJustification = answer.trim();
      }
      return investigationsApi.updateStatus(id, {
        status,
        ...(lateJustification ? { late_justification: lateJustification } : {}),
      });
    },
    onSuccess: async () => {
      showSuccess(labels.toast.statusUpdated);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['lex-investigations'] }),
        qc.invalidateQueries({
          queryKey: ['lex-investigation-portfolio-counts'],
        }),
      ]);
    },
    onError: showApiError,
  });

  const serverPresets: ServerPreset[] = useMemo(
    () => [
      {
        id: 'portfolio',
        label: labels.quickFilters.server.portfolio,
        description: labels.quickFilters.server.portfolioDescription,
        filters: {},
        icon: ListFilter,
      },
      {
        id: 'critical',
        label: labels.quickFilters.server.critical,
        description: labels.quickFilters.server.criticalDescription,
        filters: { priority: 'critical' },
        icon: ShieldQuestion,
      },
      {
        id: 'pending-approval',
        label: labels.quickFilters.server.pendingApproval,
        description: labels.quickFilters.server.pendingApprovalDescription,
        filters: { status: 'pending_approval' },
        icon: ClipboardCheck,
      },
      {
        id: 'in-progress',
        label: labels.quickFilters.server.inProgress,
        description: labels.quickFilters.server.inProgressDescription,
        filters: { status: 'in_progress' },
        icon: Search,
      },
      {
        id: 'results-recorded',
        label: labels.quickFilters.server.resultsRecorded,
        description: labels.quickFilters.server.resultsRecordedDescription,
        filters: { status: 'results_recorded' },
        icon: CheckCircle2,
      },
    ],
    [labels.quickFilters.server],
  );

  const loadedPresets: LoadedPreset[] = useMemo(
    () => [
      {
        id: 'my-investigations',
        label: labels.quickFilters.loaded.mine,
        description: labels.quickFilters.loaded.mineDescription,
        icon: UserRound,
      },
      {
        id: 'missing-evidence',
        label: labels.quickFilters.loaded.missingEvidence,
        description: labels.quickFilters.loaded.missingEvidenceDescription,
        icon: FileSearch,
      },
      {
        id: 'no-parties',
        label: labels.quickFilters.loaded.noParties,
        description: labels.quickFilters.loaded.noPartiesDescription,
        icon: UsersRound,
      },
      {
        id: 'ai-drafted',
        label: labels.quickFilters.loaded.aiDrafted,
        description: labels.quickFilters.loaded.aiDraftedDescription,
        icon: Bot,
      },
      {
        id: 'linked-to-case',
        label: labels.quickFilters.loaded.linkedToCase,
        description: labels.quickFilters.loaded.linkedToCaseDescription,
        icon: BriefcaseBusiness,
      },
    ],
    [labels.quickFilters.loaded],
  );

  const selectedServerPresetId = useMemo(
    () => serverPresets.find((preset) => serverPresetActive(serverFilters, preset))?.id,
    [serverFilters, serverPresets],
  );

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

  const filters = useMemo(
    () => [
      {
        key: 'status',
        label: labels.filters.status,
        type: 'select' as const,
        options: INVESTIGATION_STATUS_VALUES.map((value) => ({
          label: labels.filters.statusOptions[value] ?? formatInvestigationToken(value),
          value,
        })),
      },
      {
        key: 'priority',
        label: labels.filters.priority,
        type: 'select' as const,
        options: INVESTIGATION_PRIORITY_VALUES.map((value) => ({
          label: labels.filters.priorityOptions[value] ?? formatInvestigationToken(value),
          value,
        })),
      },
      {
        key: 'department',
        label: labels.detail.metadata.department,
        type: 'text' as const,
        placeholder: labels.quickFilters.department,
      },
      {
        key: 'case_id',
        label: labels.detail.metadata.linkedCase,
        type: 'select' as const,
        placeholder: labels.quickFilters.caseId,
        options: linkedCaseOptions,
      },
    ],
    [
      labels.detail.metadata.department,
      labels.detail.metadata.linkedCase,
      labels.filters,
      labels.quickFilters.department,
      labels.quickFilters.caseId,
      linkedCaseOptions,
    ],
  );

  const columns: ColumnDef<Investigation>[] = useMemo(
    () => [
      {
        id: 'subject',
        accessorKey: 'subject',
        header: labels.columns.subject,
        enableSorting: true,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/lex/investigations/${row.original.id}`}
              className="font-medium hover:underline"
              onClick={(event) => event.stopPropagation()}
              dir="auto"
            >
              {row.original.subject}
            </Link>
            <p className="text-xs text-muted-foreground" dir="auto">
              {row.original.investigation_number}
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
          <LexStatusChip
            value={row.original.status}
            domain="investigation"
            labels={labels.filters.statusOptions}
            size="sm"
          />
        ),
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: labels.columns.priority,
        enableSorting: true,
        cell: ({ row }) => (
          <LexPriorityChip value={row.original.priority} labels={labels.filters.priorityOptions} size="sm" />
        ),
      },
      {
        id: 'lead_investigator',
        accessorKey: 'lead_investigator',
        header: labels.columns.lead,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground" dir="auto">
            {row.original.lead_investigator}
          </span>
        ),
      },
      {
        id: 'signals',
        header: labels.quickFilters.signalsHeader,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1.5">
            {row.original.case_id ? (
              <Badge variant="outline">
                <Link2 className="me-1 h-3 w-3" />
                {labels.quickFilters.signalCase}
              </Badge>
            ) : null}
            {row.original.ai_drafted ? (
              <Badge variant="outline">
                <Bot className="me-1 h-3 w-3" />
                {labels.quickFilters.signalAi}
              </Badge>
            ) : null}
            {!row.original.case_id && !row.original.ai_drafted ? (
              <span className="text-xs text-muted-foreground">{labels.quickFilters.noSignals}</span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'updated_at',
        accessorKey: 'updated_at',
        header: labels.columns.updated,
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground" dir="auto" title={f.formatDate(row.original.updated_at)}>
            {f.formatRelative(row.original.updated_at)}
          </span>
        ),
      },
    ],
    [labels.columns, labels.filters, labels.quickFilters, f],
  );

  const kpiLoading = portfolioCountsQuery.isLoading && !portfolioCountsQuery.data;
  const kpiItems = useMemo(() => {
    const total = Math.max(0, stats.total);
    const inProgressShare = percent(stats.inProgress, total);
    const pendingShare = percent(stats.pendingApproval, total);
    const approvedShare = percent(stats.approved, total);
    return [
      {
        id: 'total',
        label: labels.stats.total,
        value: stats.total,
        theme: 'primary' as const,
        icon: ShieldQuestion,
        description: labels.statDetails.registerScope,
        progress: total > 0 ? 100 : 0,
        progressLabel: labels.statDetails.workloadShare,
        detail: labels.statDetails.visiblePortfolio,
        detailValue: f.formatNumber(stats.total),
        loading: tableProps.isLoading && rows.length === 0,
        onAction: () => applySavedView({}),
        pressed: selectedServerPresetId === 'portfolio' && !activeLoadedView,
      },
      {
        id: 'in-progress',
        label: labels.stats.inProgress,
        value: stats.inProgress,
        theme: 'amber' as const,
        icon: Search,
        description: labels.statDetails.activeFactGathering,
        progress: inProgressShare,
        progressLabel: labels.statDetails.activeShare,
        detail: labels.quickFilters.server.inProgress,
        detailValue: `${f.formatNumber(inProgressShare)}%`,
        loading: kpiLoading,
        onAction: () => applySavedView({ status: ['in_progress', 'results_recorded'] }),
        pressed: selectedServerPresetId === 'in-progress' && !activeLoadedView,
      },
      {
        id: 'pending-approval',
        label: labels.stats.pendingApproval,
        value: stats.pendingApproval,
        theme: 'teal' as const,
        icon: ClipboardCheck,
        description: labels.statDetails.approvalQueue,
        progress: pendingShare,
        progressLabel: labels.statDetails.approvalShare,
        detail: labels.quickFilters.server.pendingApproval,
        detailValue: `${f.formatNumber(pendingShare)}%`,
        loading: kpiLoading,
        onAction: () => applySavedView({ status: 'pending_approval' }),
        pressed: selectedServerPresetId === 'pending-approval' && !activeLoadedView,
      },
      {
        id: 'approved',
        label: labels.stats.approved,
        value: stats.approved,
        theme: 'emerald' as const,
        icon: CheckCircle2,
        description: labels.statDetails.closedOrApproved,
        progress: approvedShare,
        progressLabel: labels.statDetails.completionShare,
        detail: labels.statDetails.completionShare,
        detailValue: `${f.formatNumber(approvedShare)}%`,
        loading: kpiLoading,
        onAction: () => applySavedView({ status: ['approved', 'closed'] }),
      },
    ];
  }, [
    f,
    activeLoadedView,
    applySavedView,
    kpiLoading,
    labels.quickFilters.server.inProgress,
    labels.quickFilters.server.pendingApproval,
    labels.statDetails,
    labels.stats.approved,
    labels.stats.inProgress,
    labels.stats.pendingApproval,
    labels.stats.total,
    rows.length,
    stats.approved,
    stats.inProgress,
    stats.pendingApproval,
    stats.total,
    tableProps.isLoading,
    selectedServerPresetId,
  ]);

  return (
    <LexRouteGuard route="/lex/investigations">
      <LexListShell
        dir={direction === 'rtl' ? 'rtl' : 'ltr'}
        eyebrow={labels.eyebrow}
        title={labels.pageTitle}
        description={labels.pageDescription}
        actions={
          canWrite ? (
            <Button type="button" onClick={() => setCreateOpen(true)} className="gap-2 motion-safe:duration-fast">
              <Plus className="h-4 w-4" aria-hidden />
              {labels.create}
            </Button>
          ) : undefined
        }
        kpi={<LexKpiStrip items={kpiItems} columns={4} accent />}
        filters={
          <div className="space-y-5" lang={locale}>
            <section aria-labelledby="investigation-workspaces-heading" className="space-y-2">
              <div>
                <h2
                  id="investigation-workspaces-heading"
                  className="text-sm font-semibold text-foreground"
                >
                  {locale === 'ar' ? 'مساحات العمل' : 'Workspaces'}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {locale === 'ar'
                    ? 'انتقل إلى قائمة عمل متخصصة ومحددة النطاق.'
                    : 'Navigate to a specialized, scoped work register.'}
                </p>
              </div>
              <nav
                aria-label={
                  locale === 'ar'
                    ? 'مساحات التحقيق المتخصصة'
                    : 'Specialized investigation workspaces'
                }
                className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
              >
                {INVESTIGATION_WORKSPACE_LINKS.map((workspace) => {
                  const Icon = workspace.icon;
                  return (
                    <Link
                      key={workspace.href}
                      href={workspace.href}
                      className="group flex min-h-16 items-center gap-3 rounded-xl border border-border/70 bg-card px-3 py-2.5 shadow-sm transition hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground group-hover:text-primary">
                          {locale === 'ar' ? workspace.ar : workspace.en}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {locale === 'ar' ? workspace.descriptionAr : workspace.descriptionEn}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </section>

            <section aria-labelledby="investigation-quick-filters-heading" className="space-y-2">
              <div>
                <h2
                  id="investigation-quick-filters-heading"
                  className="text-sm font-semibold text-foreground"
                >
                  {locale === 'ar' ? 'عوامل التصفية السريعة' : 'Quick filters'}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {locale === 'ar'
                    ? 'بدّل عوامل التصفية دون مغادرة سجل التحقيقات.'
                    : 'Toggle portfolio filters without leaving this register.'}
                </p>
              </div>
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={locale === 'ar' ? 'عوامل تصفية الخادم' : 'Portfolio filters'}
              >
                {serverPresets.map((preset) => (
                  <PresetButton
                    key={preset.id}
                    icon={preset.icon}
                    label={preset.label}
                    title={preset.description}
                    active={selectedServerPresetId === preset.id && !activeLoadedView}
                    onClick={() => applySavedView(preset.filters)}
                  />
                ))}
              </div>

              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={
                  locale === 'ar' ? 'عوامل تصفية السجلات المحملة' : 'Loaded record filters'
                }
              >
                {loadedPresets.map((preset) => (
                  <PresetButton
                    key={preset.id}
                    icon={preset.icon}
                    label={preset.label}
                    title={preset.description}
                    active={activeLoadedView === preset.id}
                    onClick={() =>
                      setActiveLoadedView((current) => (current === preset.id ? null : preset.id))
                    }
                  />
                ))}
                {activeLoadedView ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => setActiveLoadedView(null)}
                  >
                    <X className="me-1.5 h-3.5 w-3.5" />
                    {labels.clearLoadedView}
                  </Button>
                ) : null}

                <div className="ms-auto inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-0.5">
                  <Button
                    type="button"
                    variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1.5"
                    aria-pressed={viewMode === 'table'}
                    onClick={() => setViewMode('table')}
                  >
                    <Table2 className="h-4 w-4" aria-hidden />
                    {labels.view.table}
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === 'board' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8 gap-1.5"
                    aria-pressed={viewMode === 'board'}
                    onClick={() => setViewMode('board')}
                  >
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                    {labels.view.board}
                  </Button>
                </div>
              </div>
            </section>

            <SavedViewsBar
              namespace="lex-investigations"
              activeFilters={activeFilters}
              onApply={applySavedView}
              labels={labels.savedViews}
            />

            <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
              <Search className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{labels.searchHint}</span>
            </div>
          </div>
        }
        framedBody={false}
      >
        {viewMode === 'board' ? (
          <InvestigationBoardSurface
            dir={direction === 'rtl' ? 'rtl' : 'ltr'}
            title={labels.view.board}
            count={f.formatNumber(activeLoadedView ? displayedRows.length : totalRows)}
            loading={Boolean(tableProps.isLoading) && rows.length === 0}
            error={tableProps.error}
            errorMessage={labels.loadError}
            onRetry={tableProps.onRetry}
            empty={!tableProps.isLoading && !loadedViewLoading && !tableProps.error && displayedRows.length === 0}
            emptyIcon={ShieldQuestion}
            emptyTitle={labels.emptyTitle}
            emptyDescription={labels.emptyDescription}
            onCreate={
              canWrite && !activeFilters.status && !activeFilters.priority && !searchValue
                ? () => setCreateOpen(true)
                : undefined
            }
            createLabel={labels.createFirst}
            createIcon={Plus}
          >
            <InvestigationBoard
              investigations={displayedRows}
              canWrite={canWrite}
              dir={direction}
              onAdvance={
                canWrite
                  ? (investigation, status) => boardMoveMutation.mutate({ id: investigation.id, status })
                  : undefined
              }
              isMoving={boardMoveMutation.isPending}
            />
          </InvestigationBoardSurface>
        ) : (
          <DataTable
            {...tableProps}
            data={displayedRows}
            totalRows={activeLoadedView ? displayedRows.length : totalRows}
            columns={columns}
            filters={filters}
            striped
            stickyHeader
            enableDensityToggle
            enableColumnToggle
            tableId="lex-investigations"
            getRowId={(row) => row.id}
            onRowClick={setPreviewInvestigation}
            isLoading={tableProps.isLoading || loadedViewLoading}
            searchSlot={
              <SearchInput
                value={searchValue}
                onChange={setSearch}
                placeholder={labels.searchPlaceholder}
                loading={tableProps.isLoading}
              />
            }
            emptyState={{
              icon: ShieldQuestion,
              title: labels.emptyTitle,
              description: labels.emptyDescription,
              action:
                canWrite && !activeFilters.status && !activeFilters.priority && !searchValue
                  ? {
                      label: labels.createFirst,
                      onClick: () => setCreateOpen(true),
                      icon: Plus,
                    }
                  : undefined,
            }}
          />
        )}

        <InvestigationPreviewDrawer
          investigation={previewInvestigation}
          onClose={() => setPreviewInvestigation(null)}
        />

        <InvestigationFormDialog
          open={createOpen}
          workspace={createWorkspace}
          onOpenChange={setCreateOpen}
          onSaved={(investigation) => router.push(`/lex/investigations/${investigation.id}`)}
        />
      </LexListShell>
    </LexRouteGuard>
  );
}

function PresetButton({
  icon: Icon,
  label,
  title,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'outline'}
      size="sm"
      className={cn('h-8 gap-1.5 px-2.5 text-xs', active && 'border-primary/30')}
      title={title}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );
}
