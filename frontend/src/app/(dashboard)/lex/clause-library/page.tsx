'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Archive,
  BookMarked,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  FilePlus2,
  GitCompareArrows,
  Library,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { DataTable } from '@/components/shared/data-table/data-table';
import { selectColumn } from '@/components/shared/data-table/columns/common-columns';
import { SearchInput } from '@/components/shared/forms/search-input';
import { SectionCard } from '@/components/suites/section-card';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import {
  LexStatusChip,
  LexSeverityChip,
} from '@/components/lex/status-chip';
import { LexActivityTimeline, type LexActivityEvent } from '@/components/lex/activity-timeline';
import { rowAccentClass } from '@/components/lex/row-accents';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { parseApiError } from '@/lib/format';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showError, showSuccess } from '@/lib/toast';
import type { BulkAction, FilterConfig, RowAction } from '@/types/table';
import type {
  JsonObject,
  LexClauseLibraryEntry,
  LexClausePlaybook,
  LexRegulation,
  LexGovernanceDecision,
  LexGovernanceDecisionRequest,
} from '@/types/suites';
import {
  type ClauseLibraryLabels,
  useClauseLibraryLabels,
} from './_components/clause-content-labels';
import { useClauseTaxonomyLabels } from './_components/clause-taxonomy-labels';
import { ClauseFormDialog, type ClauseFormPrefill } from './_components/clause-form-dialog';
import { ClauseSearchPanel } from './_components/clause-search-panel';
import { useLexLabels } from '../_lib/lex-i18n';
import {
  GovernanceStatusBadge,
  normalizeGovernanceStatus,
} from '../_components/governance-badge';
import { consumeClausePrefill } from '../drafting/_components/clause-prefill';

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

type GovernanceActionIntent = LexGovernanceDecision | 'request_changes';

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
  entry: LexClauseLibraryEntry;
  action: GovernanceActionConfig;
}

interface ClauseSavedView {
  id: string;
  name: string;
  search: string;
  filters: Record<string, string | string[]>;
  created_at: string;
}

interface ClauseQualityIssue {
  id: string;
  entry: LexClauseLibraryEntry;
  severity: 'critical' | 'warning' | 'info';
  label: string;
}

const CLAUSE_PIN_KEY = 'clario360.lex.clause-library.pins';
const CLAUSE_SAVED_VIEWS_KEY = 'clario360.lex.clause-library.saved-views';
const STALE_DRAFT_DAYS = 60;

const CLAUSE_TYPE_OPTIONS = [
  'indemnification',
  'termination',
  'limitation_of_liability',
  'confidentiality',
  'ip_ownership',
  'non_compete',
  'payment_terms',
  'warranty',
  'force_majeure',
  'dispute_resolution',
  'data_protection',
  'governing_law',
  'assignment',
  'insurance',
  'audit_rights',
  'sla',
  'auto_renewal',
  'representations',
  'non_solicitation',
  'other',
] as const;

const RISK_LEVEL_OPTIONS = ['none', 'low', 'medium', 'high', 'critical'] as const;

function buildGovernanceActions(labels: ClauseLibraryLabels): GovernanceActionConfig[] {
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

export default function LexClauseLibraryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useClauseLibraryLabels();
  const taxonomy = useClauseTaxonomyLabels();
  const { commonActions } = useLexLabels();
  // §9/§13 — clause-library authoring + governance decisions are catalog/clause
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
  const [createPrefill, setCreatePrefill] = useState<ClauseFormPrefill | null>(null);
  const [editTarget, setEditTarget] = useState<LexClauseLibraryEntry | null>(null);
  const [previewTarget, setPreviewTarget] = useState<LexClauseLibraryEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LexClauseLibraryEntry | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [savedViews, setSavedViews] = useState<ClauseSavedView[]>([]);
  const [savedViewName, setSavedViewName] = useState('');

  // Closed-loop "Save to Clause Library" cross-launch: the AI drafting surface
  // stashes a generated draft in sessionStorage and routes here; pick it up
  // once on mount and open a pre-filled create dialog.
  useEffect(() => {
    if (!canWrite) {
      return;
    }
    const prefill = consumeClausePrefill();
    if (prefill && (prefill.text_en || prefill.text_ar || prefill.title_en || prefill.title_ar)) {
      setCreatePrefill(prefill);
      setCreateOpen(true);
    }
  }, [canWrite]);

  // Localized clause lifecycle status labels for the unified chip (so Arabic mode
  // shows سارية / موقوف etc. rather than the raw token).
  const clauseStatusLabels = useMemo<Record<string, string>>(
    () => ({
      draft: labels.filters.statusOptions.draft,
      active: labels.filters.statusOptions.active,
      deprecated: labels.filters.statusOptions.deprecated,
      archived: labels.filters.statusOptions.archived,
    }),
    [labels.filters.statusOptions],
  );

  const governanceActions = useMemo(() => buildGovernanceActions(labels), [labels]);
  const approveAction = governanceActions.find((action) => action.intent === 'approve');
  const requestChangesAction = governanceActions.find((action) => action.intent === 'request_changes');

  const clauseLibraryFilters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status',
        label: labels.filters.status,
        type: 'select',
        options: [
          { label: labels.filters.statusOptions.draft, value: 'draft' },
          { label: labels.filters.statusOptions.active, value: 'active' },
          { label: labels.filters.statusOptions.deprecated, value: 'deprecated' },
          { label: labels.filters.statusOptions.archived, value: 'archived' },
        ],
      },
      {
        key: 'governance_status',
        label: labels.filters.governance,
        type: 'select',
        options: [
          { label: labels.filters.governanceOptions.pending_review, value: 'pending_review' },
          { label: labels.filters.governanceOptions.in_review, value: 'in_review' },
          { label: labels.filters.governanceOptions.approved, value: 'approved' },
          { label: labels.filters.governanceOptions.rejected, value: 'rejected' },
        ],
      },
      {
        key: 'clause_type',
        label: taxonomy.filters.clauseType,
        type: 'select',
        options: CLAUSE_TYPE_OPTIONS.map((value) => ({ label: taxonomy.clauseType(value), value })),
      },
      {
        key: 'risk_level',
        label: taxonomy.filters.risk,
        type: 'select',
        options: RISK_LEVEL_OPTIONS.map((value) => ({ label: taxonomy.risk(value), value })),
      },
      {
        key: 'language',
        label: taxonomy.filters.language,
        type: 'select',
        options: [
          { label: taxonomy.language('bilingual'), value: 'bilingual' },
          { label: taxonomy.language('en'), value: 'en' },
          { label: taxonomy.language('ar'), value: 'ar' },
        ],
      },
      { key: 'jurisdiction', label: labels.columns.jurisdiction, type: 'text', placeholder: 'SA' },
      { key: 'category', label: taxonomy.filters.category, type: 'text', placeholder: 'commercial' },
      { key: 'tags', label: taxonomy.filters.tags, type: 'text', placeholder: 'msa, vendor' },
    ],
    [labels, taxonomy],
  );

  useEffect(() => {
    setPinnedIds(readStringArray(CLAUSE_PIN_KEY));
    setSavedViews(readSavedViews());
  }, []);

  const { tableProps, searchValue, setSearch, activeFilters, clearFilters, refetch } = useDataTable<LexClauseLibraryEntry>({
    queryKey: 'lex-clause-library',
    fetchFn: enterpriseApi.lex.listClauseLibrary,
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
  });

  // Lightweight summary band: one wide page fetched once, status splits derived
  // client-side (mirrors the playbooks summary pattern). Kept on its own
  // query-key so the paginated table query above is untouched.
  const summaryQuery = useQuery({
    queryKey: ['lex-clause-library-summary'],
    queryFn: () =>
      enterpriseApi.lex.listClauseLibrary({
        page: 1,
        per_page: 200,
        sort: 'updated_at',
        order: 'desc',
      }),
  });

  const summary = useMemo(() => {
    const entries = summaryQuery.data?.data ?? [];
    const total = summaryQuery.data?.meta?.total ?? entries.length;
    const active = entries.filter((entry) => entry.status === 'active').length;
    const draft = entries.filter((entry) => entry.status === 'draft').length;
    const pending = entries.filter(
      (entry) => normalizeGovernanceStatus(entry.governance_status) === 'pending_review',
    ).length;
    const inReview = entries.filter(
      (entry) => normalizeGovernanceStatus(entry.governance_status) === 'in_review',
    ).length;
    const approved = entries.filter(
      (entry) => normalizeGovernanceStatus(entry.governance_status) === 'approved',
    ).length;
    const highRisk = entries.filter((entry) => isHighRisk(entry)).length;
    // "Needs attention" = approved-but-inactive or deprecated-without-replacement;
    // a quick governance-hygiene signal computed from already-fetched data.
    const needsAttention = entries.filter((entry) => {
      const gov = normalizeGovernanceStatus(entry.governance_status);
      return (
        (gov === 'approved' && entry.status !== 'active') ||
        (entry.status === 'deprecated' && !entry.replacement_clause_id)
      );
    }).length;
    return { total, active, draft, pending, inReview, approved, highRisk, needsAttention };
  }, [summaryQuery.data]);
  const summaryEntries = useMemo(() => summaryQuery.data?.data ?? [], [summaryQuery.data]);
  const pinnedEntries = useMemo(
    () => summaryEntries.filter((entry) => pinnedIds.includes(entry.id)),
    [pinnedIds, summaryEntries],
  );
  const qualityIssues = useMemo(
    () => buildQualityIssues(summaryEntries, labels.qualityLinter.issues),
    [summaryEntries, labels.qualityLinter.issues],
  );
  const governanceQueue = useMemo(
    () =>
      summaryEntries.filter((entry) => {
        const normalized = normalizeGovernanceStatus(entry.governance_status);
        return normalized === 'pending_review' || normalized === 'in_review';
      }),
    [summaryEntries],
  );
  const pendingTotal = summary.pending + summary.inReview;
  const activeShare = percent(summary.active, summary.total);
  const pendingShare = percent(pendingTotal, summary.total);
  const approvedShare = percent(summary.approved, summary.total);
  const highRiskShare = percent(summary.highRisk, summary.total);

  // KPI strip — computed entirely from the already-fetched summary page, themed
  // with the shared palette and localized (Arabic-Indic digits in ar mode via
  // LexKpiStrip's formatNumber). The first tile links nowhere (whole library);
  // governance tiles steer the eye to risk + review work.
  const kpiItems = useMemo<LexKpiItem[]>(
    () => [
      {
        id: 'total',
        label: labels.metrics.total,
        value: summary.total,
        theme: 'primary',
        icon: Library,
        loading: summaryQuery.isLoading,
        description: labels.page.description,
        detail: labels.metrics.total,
        detailValue: summary.total,
        href: '/lex/clause-library',
      },
      {
        id: 'active',
        label: labels.metrics.active,
        value: summary.active,
        theme: 'emerald',
        icon: CheckCircle2,
        loading: summaryQuery.isLoading,
        description: labels.metrics.active,
        progress: activeShare,
        progressLabel: labels.metrics.total,
        detail: labels.metrics.total,
        detailValue: `${activeShare}%`,
        href: '/lex/clause-library?status=active',
      },
      {
        id: 'pending',
        label: labels.metrics.pending,
        value: pendingTotal,
        theme: 'amber',
        icon: Clock,
        loading: summaryQuery.isLoading,
        description: labels.metrics.pending,
        progress: pendingShare,
        progressLabel: labels.metrics.total,
        detail: labels.metrics.total,
        detailValue: `${pendingShare}%`,
        href: '/lex/clause-library?governance_status=pending_review&governance_status=in_review',
      },
      {
        id: 'approved',
        label: labels.metrics.approved,
        value: summary.approved,
        theme: 'teal',
        icon: ShieldCheck,
        loading: summaryQuery.isLoading,
        description: labels.metrics.approved,
        progress: approvedShare,
        progressLabel: labels.metrics.total,
        detail: labels.metrics.total,
        detailValue: `${approvedShare}%`,
        href: '/lex/clause-library?governance_status=approved',
      },
      {
        id: 'high-risk',
        label: labels.metrics.highRisk,
        value: summary.highRisk,
        theme: 'red',
        icon: ShieldAlert,
        trendGoodWhenDown: true,
        loading: summaryQuery.isLoading,
        description: labels.metrics.highRisk,
        progress: highRiskShare,
        progressLabel: labels.metrics.total,
        detail: labels.metrics.total,
        detailValue: `${highRiskShare}%`,
        href: '/lex/clause-library?risk_level=high',
      },
      {
        id: 'attention',
        label: labels.metrics.needsAttention,
        value: summary.needsAttention,
        theme: summary.needsAttention > 0 ? 'orange' : 'green',
        icon: Sparkles,
        trendGoodWhenDown: true,
        loading: summaryQuery.isLoading,
        description: labels.metrics.needsAttention,
        detail: labels.qualityLinter.title,
        detailValue: qualityIssues.length,
        href: '/lex/clause-library?governance_status=approved&status=draft&status=deprecated',
      },
    ],
    [
      activeShare,
      approvedShare,
      highRiskShare,
      labels.metrics,
      labels.page.description,
      labels.qualityLinter.title,
      pendingShare,
      pendingTotal,
      qualityIssues.length,
      summary,
      summaryQuery.isLoading,
    ],
  );
  const compareClauseId =
    previewTarget?.supersedes_id ??
    previewTarget?.replacement_clause_id ??
    previewTarget?.deprecated_by_id ??
    null;
  const compareQuery = useQuery({
    queryKey: ['lex-clause-library-compare', previewTarget?.id, compareClauseId],
    queryFn: () => enterpriseApi.lex.getClauseLibraryEntry(compareClauseId ?? ''),
    enabled: Boolean(compareClauseId),
  });
  const openRelatedClause = useCallback(async (clauseId?: string | null) => {
    if (!clauseId) return;
    try {
      setPreviewTarget(await enterpriseApi.lex.getClauseLibraryEntry(clauseId));
    } catch (error) {
      showApiError(error);
    }
  }, []);
  const deletePlaybooksQuery = useQuery({
    queryKey: ['lex-clause-delete-impact-playbooks', deleteTarget?.id],
    queryFn: () => enterpriseApi.lex.listPlaybooks({ page: 1, per_page: 200 }),
    enabled: Boolean(deleteTarget),
  });
  const deleteRegulationsQuery = useQuery({
    queryKey: ['lex-clause-delete-impact-regulations', deleteTarget?.id],
    queryFn: () => enterpriseApi.lex.listRegulations({ page: 1, per_page: 200 }),
    enabled: Boolean(deleteTarget),
  });
  const deleteImpact = useMemo(
    () =>
      deleteTarget
        ? buildDeleteImpact({
            entry: deleteTarget,
            clauses: summaryEntries,
            playbooks: deletePlaybooksQuery.data?.data ?? [],
            regulations: deleteRegulationsQuery.data?.data ?? [],
          })
        : { replacements: [], playbooks: [], regulations: [] },
    [deletePlaybooksQuery.data, deleteRegulationsQuery.data, deleteTarget, summaryEntries],
  );

  const refreshClauseLibrary = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['lex-clause-library'] });
    await queryClient.invalidateQueries({ queryKey: ['lex-clause-library-search'] });
    await refetch();
  }, [queryClient, refetch]);

  const defaultReviewerName = useMemo(() => userDisplayName(user), [user]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.deleteClauseLibraryEntry(id),
    onSuccess: async () => {
      showSuccess(labels.toast.deleted);
      setDeleteTarget(null);
      await refreshClauseLibrary();
    },
    onError: showApiError,
  });

  const cloneVersionMutation = useMutation({
    mutationFn: (entry: LexClauseLibraryEntry) =>
      enterpriseApi.lex.createClauseLibraryEntry({
        code: `${entry.code}-V${entry.version + 1}`,
        clause_type: entry.clause_type,
        title_en: `${entry.title_en} v${entry.version + 1}`,
        title_ar: entry.title_ar,
        text_en: entry.text_en,
        text_ar: entry.text_ar,
        category: entry.category,
        jurisdiction: entry.jurisdiction,
        source: entry.source,
        source_url: entry.source_url ?? null,
        version: entry.version + 1,
        status: 'draft',
        governance_status: 'draft',
        supersedes_id: entry.id,
        tags: entry.tags,
        metadata: {
          ...entry.metadata,
          cloned_from_clause_id: entry.id,
          cloned_from_version: entry.version,
          source_surface: 'watheeq_clause_library_page',
        },
      }),
    onSuccess: async (created) => {
      showSuccess(labels.pageToast.versionCreatedTitle, resolveLocalized({ en: created.title_en, ar: created.title_ar }, locale));
      setPreviewTarget(created);
      await refreshClauseLibrary();
    },
    onError: showApiError,
  });

  const deprecateMutation = useMutation({
    mutationFn: (entry: LexClauseLibraryEntry) =>
      enterpriseApi.lex.updateClauseLibraryEntry(entry.id, {
        status: 'deprecated',
      }),
    onSuccess: async () => {
      showSuccess(labels.pageToast.deprecatedTitle);
      setDeleteTarget(null);
      await refreshClauseLibrary();
    },
    onError: showApiError,
  });

  const copyClause = useCallback((entry: LexClauseLibraryEntry, mode: 'en' | 'ar' | 'bilingual') => {
    const text =
      mode === 'en'
        ? entry.text_en
        : mode === 'ar'
          ? entry.text_ar || entry.text_en
          : [entry.title_en, entry.text_en, entry.title_ar, entry.text_ar].filter(Boolean).join('\n\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    showSuccess(labels.pageToast.copiedTitle, entry.code);
  }, [labels.pageToast.copiedTitle]);

  const sendToDrafting = useCallback(
    (entry: LexClauseLibraryEntry) => {
      const text = [entry.title_en, entry.text_en].filter(Boolean).join('\n\n');
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        void navigator.clipboard.writeText(text);
      }
      try {
        window.sessionStorage.setItem(
          'lex.drafting.library-clause',
          JSON.stringify({
            clause_id: entry.id,
            code: entry.code,
            title_en: entry.title_en,
            title_ar: entry.title_ar,
            text_en: entry.text_en,
            text_ar: entry.text_ar,
            clause_type: entry.clause_type,
          }),
        );
      } catch {
        // Clipboard handoff still works when sessionStorage is unavailable.
      }
      showSuccess(labels.pageToast.draftingCopiedTitle, labels.pageToast.draftingCopiedBody);
      router.push('/lex/drafting');
    },
    [labels.pageToast.draftingCopiedTitle, labels.pageToast.draftingCopiedBody, router],
  );

  const togglePin = useCallback((entry: LexClauseLibraryEntry) => {
    setPinnedIds((current) => {
      const next = current.includes(entry.id) ? current.filter((id) => id !== entry.id) : [entry.id, ...current];
      writeStringArray(CLAUSE_PIN_KEY, next);
      return next;
    });
  }, []);

  const saveCurrentView = useCallback(() => {
    const name = savedViewName.trim();
    if (!name) {
      showError(labels.pageToast.nameViewFirst);
      return;
    }
    const next: ClauseSavedView[] = [
      {
        id: `${Date.now()}`,
        name,
        search: searchValue,
        filters: activeFilters,
        created_at: new Date().toISOString(),
      },
      ...savedViews.filter((view) => view.name.toLowerCase() !== name.toLowerCase()),
    ].slice(0, 8);
    setSavedViews(next);
    writeSavedViews(next);
    setSavedViewName('');
    showSuccess(labels.savedViews.toastSaved, name);
  }, [activeFilters, labels.pageToast.nameViewFirst, labels.savedViews.toastSaved, savedViewName, savedViews, searchValue]);

  const applySavedView = useCallback(
    (view: ClauseSavedView) => {
      const params = new URLSearchParams();
      if (view.search) params.set('search', view.search);
      Object.entries(view.filters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((item) => params.append(key, item));
        } else if (value) {
          params.set(key, value);
        }
      });
      params.set('page', '1');
      router.push(params.toString() ? `/lex/clause-library?${params.toString()}` : '/lex/clause-library');
    },
    [router],
  );

  const removeSavedView = useCallback((viewId: string) => {
    setSavedViews((current) => {
      const next = current.filter((view) => view.id !== viewId);
      writeSavedViews(next);
      return next;
    });
  }, []);

  const exportClauses = useCallback((entries: LexClauseLibraryEntry[]) => {
    downloadText(`clause-library-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(entries, null, 2));
  }, []);

  const bulkActions = useMemo<BulkAction[]>(
    () => [
      {
        label: labels.pageBulk.submitReview,
        icon: RefreshCw,
        onClick: async (ids) => {
          const selected = tableProps.data.filter((entry) => ids.includes(entry.id));
          await Promise.all(
            selected.map((entry) =>
              enterpriseApi.lex.decideClauseLibraryGovernance(entry.id, {
                decision: 'submit_review',
                notes: 'Bulk submitted from the clause library review queue.',
                evidence: {
                  reviewer_user_id: user?.id ?? null,
                  reviewer_name: defaultReviewerName,
                  decision_style: 'bulk_submit_review',
                  decided_at: new Date().toISOString(),
                },
              }),
            ),
          );
          showSuccess(
            labels.pageToast.bulkSubmittedTitle,
            labels.pageToast.bulkSubmittedDescription(selected.length),
          );
          await refreshClauseLibrary();
        },
      },
      {
        label: labels.pageBulk.archive,
        icon: Archive,
        variant: 'destructive',
        onClick: async (ids) => {
          const selected = tableProps.data.filter((entry) => ids.includes(entry.id));
          await Promise.all(selected.map((entry) => enterpriseApi.lex.updateClauseLibraryEntry(entry.id, { status: 'archived' })));
          showSuccess(
            labels.pageToast.bulkArchivedTitle,
            labels.pageToast.bulkArchivedDescription(selected.length),
          );
          await refreshClauseLibrary();
        },
      },
      {
        label: labels.pageBulk.export,
        icon: Download,
        onClick: async (ids) => {
          exportClauses(tableProps.data.filter((entry) => ids.includes(entry.id)));
        },
      },
      {
        label: labels.pageBulk.pin,
        icon: Pin,
        onClick: async (ids) => {
          setPinnedIds((current) => {
            const next = Array.from(new Set([...ids, ...current]));
            writeStringArray(CLAUSE_PIN_KEY, next);
            return next;
          });
          showSuccess(
            labels.pageToast.bulkPinnedTitle,
            labels.pageToast.bulkPinnedDescription(ids.length),
          );
        },
      },
    ],
    [
      defaultReviewerName,
      exportClauses,
      labels.pageBulk,
      labels.pageToast,
      refreshClauseLibrary,
      tableProps.data,
      user?.id,
    ],
  );

  const openDecisionDialog = useCallback(
    (entry: LexClauseLibraryEntry, action: GovernanceActionConfig) => {
      setDecisionDraft({ entry, action });
      setReviewerName(defaultReviewerName);
      setReviewerEmail(user?.email ?? '');
      setComment('');
      setActivateApproved(action.decision === 'approve' && entry.status !== 'active');
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

  const rowActions = useMemo<RowAction<LexClauseLibraryEntry>[]>(
    () => [
      {
        label: labels.drawer.tabPreview,
        icon: Eye,
        disabled: () => submitting || deleteMutation.isPending,
        onClick: (entry) => setPreviewTarget(entry),
      },
      {
        label: labels.actions.edit,
        icon: Pencil,
        disabled: () => submitting || deleteMutation.isPending,
        onClick: (entry) => setEditTarget(entry),
      },
      {
        label: labels.useActions.copyBilingual,
        icon: Copy,
        disabled: () => submitting,
        onClick: (entry) => copyClause(entry, 'bilingual'),
      },
      {
        label: labels.useActions.useInDrafting,
        icon: Send,
        disabled: () => submitting,
        onClick: sendToDrafting,
      },
      {
        label: labels.pageDetail.cloneVersion,
        icon: GitCompareArrows,
        disabled: () => submitting || cloneVersionMutation.isPending,
        onClick: (entry) => cloneVersionMutation.mutate(entry),
      },
      {
        label: labels.pageDetail.pin,
        icon: pinnedIds.length ? Star : Pin,
        disabled: () => submitting,
        onClick: togglePin,
      },
      ...governanceActions.map<RowAction<LexClauseLibraryEntry>>((action) => ({
        label: action.label,
        icon: action.icon,
        variant: action.variant,
        hidden: (entry) => isGovernanceActionHidden(action, entry.governance_status),
        disabled: () => submitting,
        onClick: (entry) => openDecisionDialog(entry, action),
      })),
      {
        label: labels.actions.delete,
        icon: Trash2,
        variant: 'destructive',
        disabled: () => submitting || deleteMutation.isPending,
        onClick: (entry) => setDeleteTarget(entry),
      },
    ],
    [
      cloneVersionMutation,
      copyClause,
      deleteMutation.isPending,
      governanceActions,
      labels,
      openDecisionDialog,
      pinnedIds.length,
      sendToDrafting,
      submitting,
      togglePin,
    ],
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
      await enterpriseApi.lex.decideClauseLibraryGovernance(decisionDraft.entry.id, payload);
      await refreshClauseLibrary();
      showSuccess(
        decisionDraft.action.successTitle,
        resolveLocalized({ en: decisionDraft.entry.title_en, ar: decisionDraft.entry.title_ar }, locale),
      );
      closeDecisionDialog();
    } catch (error) {
      showError(labels.governance.decisionFailedTitle, parseApiError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnDef<LexClauseLibraryEntry>[] = [
    ...(canWrite ? [selectColumn<LexClauseLibraryEntry>()] : []),
    {
      id: 'title_en',
      accessorKey: 'title_en',
      header: labels.columns.clause,
      enableSorting: true,
      cell: ({ row }) => {
        // Arabic-first: primary title resolves to the active locale; the secondary
        // line shows the opposite language, and the snippet resolves too.
        const primaryTitle = resolveLocalized({ en: row.original.title_en, ar: row.original.title_ar }, locale);
        const secondaryTitle = locale === 'ar' ? row.original.title_en : row.original.title_ar;
        const snippet = resolveLocalized({ en: row.original.text_en, ar: row.original.text_ar }, locale);
        return (
          <div className="max-w-xl">
            <div className="flex items-center gap-2">
              {pinnedIds.includes(row.original.id) ? <Star className="h-3.5 w-3.5 fill-warning-300 text-warning-700 dark:text-warning-300" aria-hidden /> : null}
              <button
                type="button"
                className="text-start font-medium hover:underline"
                dir="auto"
                onClick={() => setPreviewTarget(row.original)}
              >
                {primaryTitle || row.original.code}
              </button>
            </div>
            {secondaryTitle ? <p className="text-xs text-muted-foreground" dir="auto">{secondaryTitle}</p> : null}
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground" dir="auto">{snippet}</p>
          </div>
        );
      },
    },
    {
      id: 'clause_type',
      accessorKey: 'clause_type',
      header: labels.columns.type,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground" dir="auto">{taxonomy.clauseType(row.original.clause_type)}</span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: labels.columns.status,
      enableSorting: true,
      cell: ({ row }) => (
        <LexStatusChip
          value={String(row.original.status)}
          domain="generic"
          labels={clauseStatusLabels}
          size="sm"
        />
      ),
    },
    {
      id: 'governance_status',
      accessorKey: 'governance_status',
      header: labels.columns.governance,
      enableSorting: true,
      cell: ({ row }) => (
        <GovernanceStatusBadge
          status={row.original.governance_status}
          label={governanceStatusLabel(normalizeGovernanceStatus(row.original.governance_status), labels)}
        />
      ),
    },
    {
      id: 'jurisdiction',
      accessorKey: 'jurisdiction',
      header: labels.columns.jurisdiction,
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.jurisdiction ?? labels.columns.defaultJurisdiction}</Badge>
      ),
    },
    {
      id: 'risk_level',
      header: taxonomy.filters.risk,
      enableSorting: true,
      cell: ({ row }) => <LexSeverityChip value={getClauseRisk(row.original)} size="sm" />,
    },
    {
      id: 'version',
      accessorKey: 'version',
      header: labels.columns.version,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {labels.columns.versionPrefix(row.original.version)}
        </span>
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
    <LexRouteGuard route="/lex/clause-library">
      <div className="space-y-6 motion-safe:animate-fade-up" dir={direction} lang={locale}>
        <PageHeader
          eyebrow={labels.page.eyebrow}
          title={labels.page.title}
          description={labels.page.description}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" asChild>
                <Link href="/lex/library">
                  <Library className="me-1.5 h-4 w-4" aria-hidden />
                  {commonActions.browseLibrary}
                </Link>
              </Button>
              {canWrite ? (
                <Button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="gap-2 bg-brand-primary-600 text-white hover:bg-brand-primary-700 motion-safe:duration-fast motion-safe:ease-emphasized motion-safe:active:animate-spring-pop"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {labels.actions.create}
                </Button>
              ) : null}
            </div>
          }
        />
        <LexKpiStrip items={kpiItems} columns={6} />
        <SectionCard title={labels.savedViews.title} description={labels.savedViews.description}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={savedViewName}
                  onChange={(event) => setSavedViewName(event.target.value)}
                  placeholder={labels.savedViews.nameThisView}
                />
                <Button type="button" variant="outline" onClick={saveCurrentView}>
                  <Star className="me-1.5 h-4 w-4" aria-hidden />
                  {labels.savedViews.saveView}
                </Button>
                <Button type="button" variant="ghost" onClick={clearFilters}>
                  {labels.savedViews.clearFilters}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {savedViews.length === 0 ? (
                  <span className="text-sm text-muted-foreground">{labels.savedViews.empty}</span>
                ) : (
                  savedViews.map((view) => (
                    <span
                      key={view.id}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card/70 px-2.5 py-1 shadow-elevation-1 transition-[box-shadow] duration-fast ease-standard hover:shadow-elevation-2"
                    >
                      <Star className="h-3 w-3 text-warning-700 dark:text-warning-300" aria-hidden />
                      <button type="button" className="text-xs font-medium" onClick={() => applySavedView(view)}>
                        {view.name}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-destructive"
                        aria-label={labels.savedViews.removeView(view.name)}
                        onClick={() => removeSavedView(view.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels.savedViews.pinned}</p>
              <div className="flex flex-wrap gap-2">
                {pinnedEntries.length === 0 ? (
                  <span className="text-sm text-muted-foreground">{labels.savedViews.pinnedEmpty}</span>
                ) : (
                  pinnedEntries.slice(0, 8).map((entry) => (
                    <Button key={entry.id} type="button" variant="outline" size="sm" onClick={() => setPreviewTarget(entry)}>
                      <Pin className="me-1.5 h-3.5 w-3.5" aria-hidden />
                      {entry.code}
                    </Button>
                  ))
                )}
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard
            title={labels.qualityLinter.title}
            description={labels.qualityLinter.description}
            isLoading={summaryQuery.isLoading}
            loadingCount={4}
          >
            {summaryQuery.isError ? (
              <CardErrorState
                title={taxonomy.states.errorTitle}
                description={taxonomy.states.errorDescription}
                retryLabel={taxonomy.states.retry}
                onRetry={() => summaryQuery.refetch()}
              />
            ) : qualityIssues.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-success-100/60 bg-success-500/4 px-3 py-3 dark:border-success-700/40">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-success-500/12 text-success-600 dark:text-success-300">
                  <CheckCircle2 className="h-5 w-5" aria-hidden />
                </span>
                <p className="text-sm text-muted-foreground">{labels.qualityLinter.emptyPage}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {qualityIssues.slice(0, 8).map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 text-start',
                      rowAccentClass('severity', issue.severity),
                    )}
                    onClick={() => setPreviewTarget(issue.entry)}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" dir="auto">{issue.label}</p>
                      <p className="truncate text-xs text-muted-foreground" dir="auto">{issue.entry.code} · {resolveLocalized({ en: issue.entry.title_en, ar: issue.entry.title_ar }, locale) || issue.entry.code}</p>
                    </div>
                    <LexSeverityChip value={issue.severity} size="sm" showLabel={false} className="shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={labels.governanceQueue.title}
            description={labels.governanceQueue.description}
            isLoading={summaryQuery.isLoading}
            loadingCount={4}
          >
            {summaryQuery.isError ? (
              <CardErrorState
                title={taxonomy.states.errorTitle}
                description={taxonomy.states.errorDescription}
                retryLabel={taxonomy.states.retry}
                onRetry={() => summaryQuery.refetch()}
              />
            ) : governanceQueue.length === 0 ? (
              <p className="text-sm text-muted-foreground">{labels.governanceQueue.emptyPage}</p>
            ) : (
              <div className="space-y-2">
                {governanceQueue.slice(0, 6).map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      'rounded-lg border border-border/60 bg-card/60 px-3 py-2.5',
                      rowAccentClass('status', normalizeGovernanceStatus(entry.governance_status)),
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 text-start"
                        onClick={() => setPreviewTarget(entry)}
                      >
                        <p className="truncate text-sm font-medium hover:underline" dir="auto">{resolveLocalized({ en: entry.title_en, ar: entry.title_ar }, locale) || entry.code}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.code} · {labels.columns.versionPrefix(entry.version)} ·{' '}
                          {f.formatRelative(entry.updated_at)}
                        </p>
                      </button>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isHighRisk(entry) ? <LexSeverityChip value={getClauseRisk(entry)} size="sm" showLabel={false} /> : null}
                        <GovernanceStatusBadge
                          status={entry.governance_status}
                          label={governanceStatusLabel(normalizeGovernanceStatus(entry.governance_status), labels)}
                        />
                      </div>
                    </div>
                    {canDecideGovernance ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {approveAction ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => openDecisionDialog(entry, approveAction)}>
                            <CheckCircle2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
                            {labels.governance.queueApprove}
                          </Button>
                        ) : null}
                        {requestChangesAction ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => openDecisionDialog(entry, requestChangesAction)}>
                            <MessageSquare className="me-1.5 h-3.5 w-3.5" aria-hidden />
                            {labels.governance.queueChanges}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <ClauseSearchPanel onSelect={setPreviewTarget} />
        <DataTable
          {...tableProps}
          columns={columns}
          filters={clauseLibraryFilters}
          getRowId={(row) => row.id}
          enableSelection={canWrite}
          bulkActions={canWrite ? bulkActions : undefined}
          enableDensityToggle
          enableColumnToggle
          stickyHeader
          striped
          tableId="lex-clause-library"
          searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={labels.page.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
          emptyState={{
            icon: BookMarked,
            title: labels.page.emptyTitle,
            description: labels.page.emptyDescription,
            ...(canWrite
              ? {
                  action: {
                    label: labels.page.emptyCta,
                    icon: FilePlus2,
                    onClick: () => setCreateOpen(true),
                  },
                }
              : {}),
          }}
          rowActions={canDecideGovernance ? rowActions : undefined}
        />
        <Sheet
          open={previewTarget !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewTarget(null);
          }}
        >
          <SheetContent className="w-[calc(100vw-1rem)] overflow-hidden p-0 sm:max-w-2xl">
            {previewTarget ? (
              <div className="flex h-full flex-col">
                <SheetHeader className="border-b border-border/60 p-0">
                  {/* Brand-gradient hero band — premium detail header with key facts. */}
                  <div className="relative overflow-hidden bg-[image:var(--ds-gradient-primary)] px-6 py-5 text-primary-foreground">
                    <div className="relative flex flex-wrap items-start justify-between gap-3 pe-8">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/75">
                          {labels.columns.clause} · {previewTarget.code}
                        </p>
                        <SheetTitle className="truncate text-primary-foreground" dir="auto">{resolveLocalized({ en: previewTarget.title_en, ar: previewTarget.title_ar }, locale) || previewTarget.code}</SheetTitle>
                        {(locale === 'ar' ? previewTarget.title_en : previewTarget.title_ar) ? (
                          <p className="truncate text-sm text-primary-foreground/85" dir="auto">
                            {locale === 'ar' ? previewTarget.title_en : previewTarget.title_ar}
                          </p>
                        ) : null}
                        <SheetDescription className="text-primary-foreground/80">
                          {taxonomy.clauseType(String(previewTarget.clause_type))} ·{' '}
                          {labels.columns.versionPrefix(previewTarget.version)} ·{' '}
                          {labels.columns.jurisdiction}: {previewTarget.jurisdiction || labels.columns.defaultJurisdiction}
                        </SheetDescription>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <LexStatusChip
                          value={String(previewTarget.status)}
                          domain="generic"
                          labels={clauseStatusLabels}
                          size="sm"
                        />
                        <GovernanceStatusBadge
                          status={previewTarget.governance_status}
                          label={governanceStatusLabel(normalizeGovernanceStatus(previewTarget.governance_status), labels)}
                        />
                        <LexSeverityChip value={getClauseRisk(previewTarget)} size="sm" />
                      </div>
                    </div>
                    <div className="relative mt-4 flex flex-wrap gap-4 text-xs text-primary-foreground/85">
                      <span>
                        <span className="opacity-70">{labels.columns.updated}: </span>
                        {f.formatRelative(previewTarget.updated_at)}
                      </span>
                      <span dir="ltr">{f.formatDual(previewTarget.created_at)}</span>
                    </div>
                  </div>
                </SheetHeader>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-5 px-6 py-5">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => copyClause(previewTarget, 'en')}>
                        <Copy className="me-1.5 h-3.5 w-3.5" aria-hidden />
                        {labels.pageDetail.copyEn}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => copyClause(previewTarget, 'ar')}>
                        <Copy className="me-1.5 h-3.5 w-3.5" aria-hidden />
                        {labels.pageDetail.copyAr}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => copyClause(previewTarget, 'bilingual')}>
                        <Copy className="me-1.5 h-3.5 w-3.5" aria-hidden />
                        {labels.pageDetail.copyBilingual}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => sendToDrafting(previewTarget)}>
                        <Send className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
                        {labels.pageDetail.drafting}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => togglePin(previewTarget)}>
                        <Pin className="me-1.5 h-3.5 w-3.5" aria-hidden />
                        {pinnedIds.includes(previewTarget.id) ? labels.pageDetail.unpin : labels.pageDetail.pin}
                      </Button>
                      {canWrite ? (
                        <>
                          <Button type="button" size="sm" variant="outline" onClick={() => setEditTarget(previewTarget)}>
                            <Pencil className="me-1.5 h-3.5 w-3.5" aria-hidden />
                            {labels.pageDetail.edit}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={cloneVersionMutation.isPending}
                            onClick={() => cloneVersionMutation.mutate(previewTarget)}
                          >
                            <GitCompareArrows className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
                            {labels.pageDetail.cloneVersion}
                          </Button>
                        </>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {locale === 'ar' ? (
                        <>
                          <div className="rounded-md border p-3" dir="rtl">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels.pageDetail.arabic}</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{previewTarget.text_ar || labels.pageDetail.noArabicText}</p>
                          </div>
                          <div className="rounded-md border p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels.pageDetail.english}</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6" dir="auto">{previewTarget.text_en}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="rounded-md border p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels.pageDetail.english}</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6" dir="auto">{previewTarget.text_en}</p>
                          </div>
                          <div className="rounded-md border p-3" dir="rtl">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels.pageDetail.arabic}</p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{previewTarget.text_ar || labels.pageDetail.noArabicText}</p>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-sm font-medium">{labels.pageDetail.versionLineage}</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <LineageCard label={labels.pageDetail.lineageSupersedes} value={previewTarget.supersedes_id} noneLabel={labels.pageDetail.lineageNone} onAction={() => void openRelatedClause(previewTarget.supersedes_id)} />
                        <LineageCard label={labels.pageDetail.lineageDeprecatedBy} value={previewTarget.deprecated_by_id} noneLabel={labels.pageDetail.lineageNone} onAction={() => void openRelatedClause(previewTarget.deprecated_by_id)} />
                        <LineageCard label={labels.pageDetail.lineageReplacement} value={previewTarget.replacement_clause_id} noneLabel={labels.pageDetail.lineageNone} onAction={() => void openRelatedClause(previewTarget.replacement_clause_id)} />
                      </div>
                    </div>

                    {compareClauseId ? (
                      <div className="rounded-md border p-3">
                        <p className="text-sm font-medium">{labels.pageDetail.versionCompare}</p>
                        {compareQuery.isLoading ? (
                          <p className="mt-2 text-sm text-muted-foreground">{labels.pageDetail.loadingRelated}</p>
                        ) : compareQuery.data ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <CompareBlock
                              title={labels.pageDetail.relatedVersion(compareQuery.data.version)}
                              text={resolveLocalized({ en: compareQuery.data.text_en, ar: compareQuery.data.text_ar }, locale)}
                            />
                            <CompareBlock
                              title={labels.pageDetail.currentVersion(previewTarget.version)}
                              text={resolveLocalized({ en: previewTarget.text_en, ar: previewTarget.text_ar }, locale)}
                            />
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">{labels.pageDetail.relatedNotLoaded}</p>
                        )}
                      </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoBlock label={labels.pageDetail.category} value={previewTarget.category || labels.pageDetail.uncategorized} />
                      <InfoBlock label={labels.pageDetail.jurisdiction} value={previewTarget.jurisdiction || labels.pageDetail.defaultJurisdiction} />
                      <InfoBlock label={labels.pageDetail.source} value={previewTarget.source || labels.pageDetail.defaultSource} />
                      <InfoBlock label={labels.pageDetail.sourceUrl} value={previewTarget.source_url || labels.pageDetail.notLinked} />
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-sm font-medium">{labels.pageDetail.tags}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {previewTarget.tags.length ? (
                          previewTarget.tags.map((tag) => (
                            <Badge key={tag} variant="outline">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">{labels.pageDetail.noTags}</span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-sm font-medium">{labels.detail.activity}</p>
                      <div className="mt-3">
                        <LexActivityTimeline
                          events={buildClauseActivity(previewTarget, labels)}
                          emptyLabel={labels.detail.activityEmpty}
                        />
                      </div>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-sm font-medium">{labels.pageDetail.metadata}</p>
                      <pre className="mt-2 max-h-56 overflow-auto rounded bg-muted/40 p-3 text-xs">
                        {JSON.stringify(previewTarget.metadata ?? {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
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
                      <p className="truncate text-sm font-medium" dir="auto">{resolveLocalized({ en: decisionDraft.entry.title_en, ar: decisionDraft.entry.title_ar }, locale) || decisionDraft.entry.code}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {decisionDraft.entry.code} - {labels.governance.versionPrefix(decisionDraft.entry.version)}
                      </p>
                    </div>
                    <GovernanceStatusBadge
                      status={decisionDraft.entry.governance_status}
                      label={governanceStatusLabel(
                        normalizeGovernanceStatus(decisionDraft.entry.governance_status),
                        labels,
                      )}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="clause-governance-reviewer">{labels.governance.reviewer}</Label>
                    <Input
                      id="clause-governance-reviewer"
                      value={reviewerName}
                      onChange={(event) => setReviewerName(event.target.value)}
                      placeholder={labels.governance.reviewerPlaceholder}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clause-governance-reviewer-email">{labels.governance.reviewerEmail}</Label>
                    <Input
                      id="clause-governance-reviewer-email"
                      type="email"
                      value={reviewerEmail}
                      onChange={(event) => setReviewerEmail(event.target.value)}
                      placeholder={labels.governance.reviewerEmailPlaceholder}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="clause-governance-comment">{labels.governance.comment}</Label>
                  <Textarea
                    id="clause-governance-comment"
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
            <ClauseFormDialog
              key={createPrefill ? 'create-prefilled' : 'create-blank'}
              open={createOpen}
              prefill={createPrefill}
              onOpenChange={(open) => {
                setCreateOpen(open);
                if (!open) {
                  setCreatePrefill(null);
                }
              }}
              onSaved={refreshClauseLibrary}
            />
            {editTarget ? (
              <ClauseFormDialog
                open
                entry={editTarget}
                onOpenChange={(open) => {
                  if (!open) setEditTarget(null);
                }}
                onSaved={refreshClauseLibrary}
              />
            ) : null}
            <Dialog
              open={deleteTarget !== null}
              onOpenChange={(open) => {
                if (!open) setDeleteTarget(null);
              }}
            >
              {deleteTarget ? (
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>{labels.confirmDelete.title}</DialogTitle>
                    <DialogDescription>
                      {labels.pageDetail.deleteReviewDescription(resolveLocalized({ en: deleteTarget.title_en, ar: deleteTarget.title_ar }, locale) || deleteTarget.code)}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <ImpactMetric label={labels.pageDetail.impactVersionLinks} value={deleteImpact.replacements.length} onAction={() => scrollToImpact('clause-impact-version-links')} />
                      <ImpactMetric label={labels.pageDetail.impactPlaybooks} value={deleteImpact.playbooks.length} onAction={() => scrollToImpact('clause-impact-playbooks')} />
                      <ImpactMetric label={labels.pageDetail.impactRegulations} value={deleteImpact.regulations.length} onAction={() => scrollToImpact('clause-impact-regulations')} />
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-sm font-medium">{labels.pageDetail.loadedImpact}</p>
                      <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                        <ImpactList id="clause-impact-version-links" title={labels.pageDetail.impactVersionLinksTitle} items={deleteImpact.replacements.map((entry) => entry.code)} t={labels.pageDetail} />
                        <ImpactList id="clause-impact-playbooks" title={labels.pageDetail.impactPlaybookMatches} items={deleteImpact.playbooks.map((playbook) => playbook.name)} t={labels.pageDetail} />
                        <ImpactList id="clause-impact-regulations" title={labels.pageDetail.impactRegulationRefs} items={deleteImpact.regulations.map((regulation) => regulation.code)} t={labels.pageDetail} />
                        <p>{labels.pageDetail.impactBackendNote}</p>
                      </div>
                    </div>
                  </div>

                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                      {labels.governance.cancel}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={deprecateMutation.isPending || deleteMutation.isPending}
                      onClick={() => deprecateMutation.mutate(deleteTarget)}
                    >
                      {labels.pageDetail.deprecateInstead}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deleteMutation.isPending || deprecateMutation.isPending}
                      onClick={() => deleteMutation.mutate(deleteTarget.id)}
                    >
                      {deleteMutation.isPending ? labels.governance.submitting : labels.confirmDelete.confirmLabel}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              ) : null}
            </Dialog>
          </>
        ) : null}
      </div>
    </LexRouteGuard>
  );
}

function governanceStatusLabel(normalized: string, labels: ClauseLibraryLabels): string {
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

function userDisplayName(user?: { full_name?: string; first_name?: string; last_name?: string; email?: string } | null): string {
  if (!user) return '';
  return user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || '';
}

function readStringArray(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, value: string[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readSavedViews(): ClauseSavedView[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CLAUSE_SAVED_VIEWS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isClauseSavedView).slice(0, 8);
  } catch {
    return [];
  }
}

function writeSavedViews(views: ClauseSavedView[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CLAUSE_SAVED_VIEWS_KEY, JSON.stringify(views));
}

function isClauseSavedView(value: unknown): value is ClauseSavedView {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ClauseSavedView>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.search === 'string' &&
    Boolean(candidate.filters) &&
    typeof candidate.filters === 'object' &&
    typeof candidate.created_at === 'string'
  );
}

function getClauseRisk(entry: LexClauseLibraryEntry): string {
  const metadataRisk = entry.metadata?.risk_level;
  return String(entry.risk_level ?? (typeof metadataRisk === 'string' ? metadataRisk : 'none')).toLowerCase();
}

function isHighRisk(entry: LexClauseLibraryEntry): boolean {
  return ['high', 'critical'].includes(getClauseRisk(entry));
}

function buildQualityIssues(
  entries: LexClauseLibraryEntry[],
  issueLabels: ClauseLibraryLabels['qualityLinter']['issues'],
): ClauseQualityIssue[] {
  const now = Date.now();
  return entries.flatMap((entry) => {
    const issues: ClauseQualityIssue[] = [];
    const governanceStatus = normalizeGovernanceStatus(entry.governance_status);
    if (!entry.text_ar?.trim()) {
      issues.push({ id: `${entry.id}:missing-ar`, entry, severity: 'warning', label: issueLabels.missingArabic });
    }
    if (!entry.source_url?.trim()) {
      issues.push({ id: `${entry.id}:missing-source`, entry, severity: 'info', label: issueLabels.missingSource });
    }
    if (entry.status === 'draft' && Date.parse(entry.updated_at) < now - STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000) {
      issues.push({ id: `${entry.id}:stale-draft`, entry, severity: 'warning', label: issueLabels.staleDraft });
    }
    if (governanceStatus === 'approved' && entry.status !== 'active') {
      issues.push({ id: `${entry.id}:approved-inactive`, entry, severity: 'critical', label: issueLabels.approvedInactive });
    }
    if (entry.status === 'deprecated' && !entry.replacement_clause_id) {
      issues.push({ id: `${entry.id}:missing-replacement`, entry, severity: 'warning', label: issueLabels.missingReplacement });
    }
    if ((entry.tags ?? []).length < 2) {
      issues.push({ id: `${entry.id}:weak-tags`, entry, severity: 'info', label: issueLabels.weakTags });
    }
    if (isHighRisk(entry) && !entry.source_url?.trim()) {
      issues.push({ id: `${entry.id}:high-risk-source`, entry, severity: 'critical', label: issueLabels.highRiskSource });
    }
    return issues;
  });
}

function buildDeleteImpact({
  entry,
  clauses,
  playbooks,
  regulations,
}: {
  entry: LexClauseLibraryEntry;
  clauses: LexClauseLibraryEntry[];
  playbooks: LexClausePlaybook[];
  regulations: LexRegulation[];
}) {
  const replacements = clauses.filter(
    (candidate) =>
      candidate.id !== entry.id &&
      (candidate.supersedes_id === entry.id ||
        candidate.deprecated_by_id === entry.id ||
        candidate.replacement_clause_id === entry.id),
  );
  const playbookMatches = playbooks.filter((playbook) =>
    playbook.clauses.some(
      (clause) =>
        clause.clause_type === entry.clause_type ||
        clause.title.toLowerCase() === entry.title_en.toLowerCase() ||
        clause.standard_text.trim() === entry.text_en.trim(),
    ),
  );
  const regulationMatches = regulations.filter((regulation) =>
    (regulation.clause_references ?? []).some((reference) => reference.clause_id === entry.id),
  );
  return { replacements, playbooks: playbookMatches, regulations: regulationMatches };
}

function downloadText(filename: string, content: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function CardErrorState({
  title,
  description,
  retryLabel,
  onRetry,
}: {
  title: string;
  description: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
        <span dir="auto">{title}</span>
      </div>
      <p className="text-xs text-muted-foreground" dir="auto">{description}</p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {retryLabel}
      </Button>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm">{value}</p>
    </div>
  );
}

function LineageCard({
  label,
  value,
  noneLabel,
  onAction,
}: {
  label: string;
  value?: string | null;
  noneLabel: string;
  onAction: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      disabled={!value}
      title={statisticHint(label, Boolean(value))}
      className="rounded-md bg-muted/30 p-3 text-start transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-70"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono text-xs">{value ?? noneLabel}</p>
    </button>
  );
}

function CompareBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md bg-muted/30 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5">{text}</p>
    </div>
  );
}

function ImpactMetric({ label, value, onAction }: { label: string; value: number; onAction: () => void }) {
  return (
    <button
      type="button"
      onClick={onAction}
      title={statisticHint(label)}
      className="rounded-md border bg-muted/30 p-3 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </button>
  );
}

function ImpactList({
  id,
  title,
  items,
  t,
}: {
  id: string;
  title: string;
  items: string[];
  t: ClauseLibraryLabels['pageDetail'];
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <span className="font-medium text-foreground">{title}: </span>
      {items.length ? items.slice(0, 6).join(', ') : t.impactNone}
      {items.length > 6 ? t.impactMore(items.length - 6) : ''}
    </div>
  );
}

function scrollToImpact(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}

/**
 * Build a human-readable lifecycle story for a clause from its own audit-bearing
 * fields (created / updated / governance state / deprecation). No new endpoint —
 * just a narrative over facts already on the record, so the detail drawer reads
 * as a timeline rather than a metadata dump.
 */
function buildClauseActivity(
  entry: LexClauseLibraryEntry,
  labels: ClauseLibraryLabels,
): LexActivityEvent[] {
  const a = labels.detail.events;
  const createdActor = entry.created_by || a.systemActor;
  const updatedActor = entry.updated_by || entry.created_by || a.systemActor;
  const events: LexActivityEvent[] = [];

  events.push({
    id: `${entry.id}:created`,
    actor: { name: createdActor },
    action: a.created,
    target: entry.code,
    at: entry.created_at,
    tone: 'neutral',
  });

  const gov = normalizeGovernanceStatus(entry.governance_status);
  if (gov === 'pending_review' || gov === 'in_review') {
    events.push({
      id: `${entry.id}:submitted`,
      actor: { name: updatedActor },
      action: a.submitted,
      at: entry.updated_at,
      tone: 'warning',
    });
  } else if (gov === 'approved' || gov === 'active') {
    events.push({
      id: `${entry.id}:approved`,
      actor: { name: updatedActor },
      action: a.approved,
      at: entry.updated_at,
      tone: 'success',
    });
  } else if (gov === 'rejected') {
    events.push({
      id: `${entry.id}:rejected`,
      actor: { name: updatedActor },
      action: a.rejected,
      at: entry.updated_at,
      tone: 'danger',
    });
  } else if (entry.updated_at && entry.updated_at !== entry.created_at) {
    events.push({
      id: `${entry.id}:updated`,
      actor: { name: updatedActor },
      action: a.updated,
      at: entry.updated_at,
      tone: 'info',
    });
  }

  if (entry.status === 'deprecated' && entry.deprecated_at) {
    events.push({
      id: `${entry.id}:deprecated`,
      actor: { name: entry.deprecated_by_id || updatedActor },
      action: a.deprecated,
      at: entry.deprecated_at,
      tone: 'danger',
    });
  }

  return events;
}
