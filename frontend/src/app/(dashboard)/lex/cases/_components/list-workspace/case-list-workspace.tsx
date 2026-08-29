'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarDays,
  Columns3,
  Download,
  Eye,
  Flag,
  Gavel,
  History,
  Inbox,
  List,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  Tags,
  UserCheck,
  UserRound,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { selectColumn } from '@/components/shared/data-table/columns/common-columns';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { OrgEntityUserPicker } from '@/components/shared/forms/org-entity-user-picker';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { BoardView, type BoardColumn } from '@/components/shared/board-view';
import { LexStatusChip, LexPriorityChip } from '@/components/lex/status-chip';
import { rowAccentClass } from '@/components/lex/row-accents';
import { EventCalendar } from '@/components/shared/event-calendar';
import { RelativeTime } from '@/components/shared/relative-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { downloadBlob } from '@/lib/format';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { useAuth } from '@/hooks/use-auth';
import type { User } from '@/types/models';
import {
  CASE_COMPANY_STATUS_OPTIONS,
  CASE_STATUS_OPTIONS,
  CASE_STATUS_TRANSITIONS,
  CASE_STRENGTH_OPTIONS,
  LEGAL_PRIORITY_OPTIONS,
  casesApi,
  formatCaseToken,
  type CaseStatus,
  type LegalPriority,
  type LegalCase,
  type UpdateLegalCasePayload,
} from '@/lib/lex/cases';
import type { DataTableControlledProps, FilterConfig, BulkAction } from '@/types/table';
import { useLocale } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { resolveCaseTypeLabel } from '../../[id]/_components/case-enums-i18n';
import { useCaseLabels, type CaseLabels } from '../labels';
import { ClassificationPicker } from '../classification-picker';
import { CasePreviewSheet } from './case-preview-sheet';
import {
  buildDeadlinePortfolio,
  collectCaseDeadlines,
  deadlineToCalendarEvent,
  summarizeCaseDeadlines,
  type CaseDeadlineSummary,
} from './deadline-utils';

interface CaseListWorkspaceProps {
  tableProps: DataTableControlledProps<LegalCase>;
}

type CaseViewMode = 'table' | 'pipeline' | 'calendar';

interface BulkStatusDialogState {
  ids: string[];
  status: CaseStatus;
  reason: string;
  lateJustification?: string;
  source: 'bulk' | 'pipeline' | 'archive';
}

interface BulkPriorityDialogState {
  ids: string[];
  priority: LegalPriority;
  reason: string;
}

interface BulkAssignmentDialogState {
  ids: string[];
  handlingOfficerId: string;
  department: string;
  mode: 'assign' | 'notify';
}

interface BulkClassificationDialogState {
  ids: string[];
  classificationId: string | null;
}

type PresetId = 'portfolio' | 'plaintiff' | 'defendant' | 'intake' | 'critical';

const PRESETS: Array<{ id: PresetId; params: Record<string, string> }> = [
  { id: 'portfolio', params: {} },
  { id: 'plaintiff', params: { company_status: 'plaintiff' } },
  { id: 'defendant', params: { company_status: 'defendant' } },
  { id: 'intake', params: { status: 'intake' } },
  { id: 'critical', params: { priority: 'critical' } },
];

const STATUS_ACCENT: Record<string, string> = {
  // Early lifecycle stages ride the brand teals, progressing deeper.
  intake: 'bg-brand-teal-400/70',
  phase1: 'bg-brand-primary-500/70',
  phase2: 'bg-brand-primary-600/70',
  open: 'bg-success-500/70',
  under_procedure: 'bg-warning-500/70',
  // Paused/hold keeps a caution (amber) read, on the warning token.
  on_hold: 'bg-warning-300/70',
  closed: 'bg-muted-foreground/50',
  // Cancelled is a terminal negative state — semantic error.
  cancelled: 'bg-error-500/60',
};

const EMPTY_FILTERS: Record<string, string | string[]> = {};
const WORKSPACE_QUERY_KEYS = new Set(['view', 'preview']);

type WorkspaceQueryValue = string | string[] | null | undefined;

interface CaseCommandCardConfig {
  id: string;
  label: string;
  value: number;
  description: string;
  actionLabel: string;
  icon: LucideIcon;
  tone: 'teal' | 'amber' | 'red' | 'emerald' | 'slate';
  disabled?: boolean;
  onClick: () => void;
}

function firstFilterValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value || undefined;
}

function normalizeViewMode(value: string | null | undefined): CaseViewMode {
  return value === 'pipeline' || value === 'calendar' || value === 'table' ? value : 'table';
}

function stripWorkspaceQueryFilters(
  filters: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> {
  if (!filters) {
    return EMPTY_FILTERS;
  }
  const next: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!WORKSPACE_QUERY_KEYS.has(key)) {
      next[key] = value;
    }
  }
  return next;
}

function normalizeMatchValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function currentUserDisplayName(user: User | null | undefined, fallback: string): string {
  if (!user) {
    return fallback;
  }
  return user.full_name || `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email || fallback;
}

function currentUserTextTokens(user: User | null | undefined): string[] {
  if (!user) {
    return [];
  }
  return [
    user.full_name,
    `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim(),
    user.email,
  ]
    .map(normalizeMatchValue)
    .filter((value, index, values) => value.length > 1 && values.indexOf(value) === index);
}

function textMatchesCurrentUser(value: string | null | undefined, user: User | null | undefined): boolean {
  const normalized = normalizeMatchValue(value);
  if (!normalized) {
    return false;
  }
  return currentUserTextTokens(user).some(
    (token) => normalized === token || normalized.includes(token) || token.includes(normalized),
  );
}

function hasCaseOwner(legalCase: LegalCase): boolean {
  return Boolean(
    legalCase.responsible_lawyer?.trim() ||
      legalCase.section_manager_id ||
      legalCase.supervisor_id ||
      legalCase.handling_officer_id,
  );
}

/** Resolves whether a bulk selection can share one entity-scoped user list. */
export function resolveBulkAssignmentEntity(
  ids: readonly string[],
  rows: readonly LegalCase[],
): { entityId?: string; mixed: boolean } {
  const selectedRows = rows.filter((row) => ids.includes(row.id));
  if (selectedRows.length !== ids.length) return { mixed: true };
  const entityKeys = new Set(
    selectedRows.map((row) => {
      const value = row.metadata?.beneficiary_entity_id;
      return typeof value === 'string' ? value.trim() : '';
    }),
  );
  if (entityKeys.size > 1) return { mixed: true };
  return { entityId: [...entityKeys][0] || undefined, mixed: false };
}

function isCaseAssignedToUser(legalCase: LegalCase, user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }
  const userId = user.id;
  return Boolean(
    legalCase.section_manager_id === userId ||
      legalCase.supervisor_id === userId ||
      legalCase.handling_officer_id === userId ||
      legalCase.tasks?.some((task) => task.assignee_id === userId) ||
      textMatchesCurrentUser(legalCase.responsible_lawyer, user),
  );
}

function daysUntilDate(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const parsedStart = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()).getTime();
  return Math.ceil((parsedStart - todayStart) / 86_400_000);
}

function countUpcomingHearings(legalCase: LegalCase): number {
  return (
    legalCase.hearings?.filter((hearing) => {
      const delta = daysUntilDate(hearing.hearing_date);
      return delta !== null && delta >= 0 && delta <= 30;
    }).length ?? 0
  );
}

function exportCasesCsv(rows: LegalCase[], filenamePrefix = 'cases-export') {
  const headers = [
    'case_number',
    'title',
    'case_type',
    'company_status',
    'status',
    'priority',
    'strength',
    'department',
    'responsible_lawyer',
    'updated_at',
  ];
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      [
        row.case_number,
        row.title?.en || row.title?.ar,
        row.case_type,
        row.company_status,
        row.status,
        row.priority,
        row.strength,
        row.department,
        row.responsible_lawyer,
        row.updated_at,
      ]
        .map(escape)
        .join(','),
    ),
  ].join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`);
}

function activePresetId(activeFilters: Record<string, string | string[]>): string | undefined {
  return PRESETS.find((preset) => {
    const keys = Object.keys(preset.params);
    const activeKeys = Object.keys(activeFilters);
    if (keys.length !== activeKeys.length) {
      return false;
    }
    return keys.every((key) => firstFilterValue(activeFilters[key]) === preset.params[key]);
  })?.id;
}

export function CaseListWorkspace({ tableProps }: CaseListWorkspaceProps) {
  const labels = useCaseLabels();
  const w = labels.workspace;
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const { hasPermission, user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // §9 — case list edit-style bulk actions gate on lex:case:edit; the
  // assign/notify actions gate on the dedicated lex:case:assign verb.
  const canWrite = hasPermission('lex:case:edit');
  const canAssign = hasPermission('lex:case:assign');
  const viewMode = normalizeViewMode(searchParams?.get('view'));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [statusDialog, setStatusDialog] = useState<BulkStatusDialogState | null>(null);
  const [priorityDialog, setPriorityDialog] = useState<BulkPriorityDialogState | null>(null);
  const [assignmentDialog, setAssignmentDialog] = useState<BulkAssignmentDialogState | null>(null);
  const [classificationDialog, setClassificationDialog] = useState<BulkClassificationDialogState | null>(null);

  const rows = tableProps.data;
  const activeFilters = useMemo(
    () => stripWorkspaceQueryFilters(tableProps.activeFilters),
    [tableProps.activeFilters],
  );
  const searchValue = tableProps.searchValue ?? '';
  const setSearch = tableProps.onSearchChange ?? (() => {});
  const selectedPresetId = activePresetId(activeFilters);

  const invalidateWorkspace = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['lex-cases'] });
  }, [queryClient]);

  const statusMutation = useMutation({
    mutationFn: async (state: BulkStatusDialogState) => {
      await Promise.all(
        state.ids.map((id) =>
          casesApi.updateCaseStatus(id, {
            status: state.status,
            reason: state.reason,
            ...(state.lateJustification?.trim()
              ? { late_justification: state.lateJustification.trim() }
              : {}),
          }),
        ),
      );
    },
    onSuccess: async (_data, state) => {
      showSuccess(state.ids.length === 1 ? w.statusUpdatedOne : w.statusUpdatedMany);
      setStatusDialog(null);
      await invalidateWorkspace();
    },
    onError: showApiError,
  });

  const priorityMutation = useMutation({
    mutationFn: async (state: BulkPriorityDialogState) => {
      await Promise.all(
        state.ids.map((id) => casesApi.setCasePriority(id, { priority: state.priority, reason: state.reason })),
      );
    },
    onSuccess: async (_data, state) => {
      showSuccess(state.ids.length === 1 ? w.priorityUpdatedOne : w.priorityUpdatedMany);
      setPriorityDialog(null);
      await invalidateWorkspace();
    },
    onError: showApiError,
  });

  const assignmentMutation = useMutation({
    mutationFn: async (state: BulkAssignmentDialogState) => {
      await Promise.all(
        state.ids.map(async (id) => {
          if (state.mode === 'assign') {
            await casesApi.assignOfficer(id, {
              handling_officer_id: state.handlingOfficerId,
              reason: 'Bulk assignment from the case workspace',
            });
          }
          if (state.department.trim()) {
            await casesApi.updateCase(id, { department: state.department.trim() });
          }
        }),
      );
    },
    onSuccess: async (_data, state) => {
      const single = state.ids.length === 1;
      showSuccess(
        state.mode === 'notify'
          ? single
            ? w.departmentRouteUpdatedOne
            : w.departmentRouteUpdatedMany
          : single
            ? w.assignmentUpdatedOne
            : w.assignmentUpdatedMany,
      );
      setAssignmentDialog(null);
      await invalidateWorkspace();
    },
    onError: showApiError,
  });

  const classificationMutation = useMutation({
    mutationFn: async (state: BulkClassificationDialogState) => {
      await Promise.all(
        state.ids.map((id) =>
          casesApi.updateCase(id, {
            classification_id: state.classificationId,
          }),
        ),
      );
    },
    onSuccess: async (_data, state) => {
      showSuccess(state.ids.length === 1 ? w.classificationUpdatedOne : w.classificationUpdatedMany);
      setClassificationDialog(null);
      await invalidateWorkspace();
    },
    onError: showApiError,
  });

  const deadlinePortfolio = useMemo(
    () => buildDeadlinePortfolio(rows, locale, labels.list.untitled, labels.deadlines),
    [rows, locale, labels.list.untitled, labels.deadlines],
  );

  const pushSearchParams = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      router.push(query ? `${pathname ?? ''}?${query}` : pathname ?? '');
    },
    [router, pathname],
  );

  const updateWorkspaceParams = useCallback(
    (updates: Record<string, WorkspaceQueryValue>) => {
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      for (const [key, value] of Object.entries(updates)) {
        next.delete(key);
        if (Array.isArray(value)) {
          value.filter(Boolean).forEach((entry) => next.append(key, entry));
        } else if (value) {
          next.set(key, value);
        }
      }
      pushSearchParams(next);
    },
    [pushSearchParams, searchParams],
  );

  const setWorkspaceViewMode = useCallback(
    (mode: CaseViewMode) => {
      updateWorkspaceParams({ view: mode });
    },
    [updateWorkspaceParams],
  );

  const clearListFilters = useCallback(() => {
    const next = new URLSearchParams();
    for (const key of ['per_page', 'sort', 'order', 'search', 'view', 'preview'] as const) {
      const values = searchParams?.getAll(key) ?? [];
      values.forEach((value) => next.append(key, value));
    }
    next.set('page', '1');
    pushSearchParams(next);
  }, [pushSearchParams, searchParams]);

  const applySavedView = useCallback(
    (params: Record<string, string | string[]>) => {
      const next = new URLSearchParams();
      for (const key of ['per_page', 'sort', 'order', 'search', 'view', 'preview'] as const) {
        const values = searchParams?.getAll(key) ?? [];
        values.forEach((value) => next.append(key, value));
      }
      next.set('page', '1');
      for (const [key, value] of Object.entries(params)) {
        next.delete(key);
        if (Array.isArray(value)) {
          value.filter(Boolean).forEach((entry) => next.append(key, entry));
        } else if (value) {
          next.set(key, value);
        }
      }
      pushSearchParams(next);
    },
    [pushSearchParams, searchParams],
  );

  const toggleSelected = useCallback((caseId: string) => {
    setSelectedIds((current) =>
      current.includes(caseId) ? current.filter((id) => id !== caseId) : [...current, caseId],
    );
  }, []);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds],
  );
  const previewCaseId = searchParams?.get('preview') ?? null;
  const previewCase = useMemo(
    () => (previewCaseId ? rows.find((row) => row.id === previewCaseId) ?? null : null),
    [previewCaseId, rows],
  );

  const bulkActions = useMemo<BulkAction[]>(
    () => {
      const actions: BulkAction[] = [
        {
          label: w.bulkActions.exportCenter,
          icon: Download,
          onClick: async (ids) => {
            if (ids.length > 0) {
              setSelectedIds(ids);
            }
            setExportDialogOpen(true);
          },
        },
      ];

      if (!canWrite) {
        return actions;
      }

      actions.push(
        {
          label: w.bulkActions.setStatus,
          icon: RefreshCw,
          onClick: async (ids) => {
            const targetIds = ids.length > 0 ? ids : selectedIds;
            if (targetIds.length === 0) return;
            setStatusDialog({ ids: targetIds, status: 'open', reason: '', source: 'bulk' });
          },
        },
        {
          label: w.bulkActions.setPriority,
          icon: Flag,
          onClick: async (ids) => {
            const targetIds = ids.length > 0 ? ids : selectedIds;
            if (targetIds.length === 0) return;
            setPriorityDialog({ ids: targetIds, priority: 'high', reason: '' });
          },
        },
        ...(canAssign
          ? [
              {
                label: w.bulkActions.assignLawyer,
                icon: UserRound,
                onClick: async (ids: string[]) => {
                  const targetIds = ids.length > 0 ? ids : selectedIds;
                  if (targetIds.length === 0) return;
                  setAssignmentDialog({ ids: targetIds, handlingOfficerId: '', department: '', mode: 'assign' });
                },
              },
              {
                label: w.bulkActions.notifyDepartment,
                icon: Bell,
                onClick: async (ids: string[]) => {
                  const targetIds = ids.length > 0 ? ids : selectedIds;
                  if (targetIds.length === 0) return;
                  setAssignmentDialog({ ids: targetIds, handlingOfficerId: '', department: '', mode: 'notify' });
                },
              },
            ]
          : []),
        {
          label: w.bulkActions.archiveSelected,
          icon: Archive,
          onClick: async (ids) => {
            const targetIds = ids.length > 0 ? ids : selectedIds;
            if (targetIds.length === 0) return;
            setStatusDialog({
              ids: targetIds,
              status: 'closed',
              reason: w.archiveReason,
              source: 'archive',
            });
          },
        },
        {
          label: w.bulkActions.classifyTag,
          icon: Tags,
          onClick: async (ids) => {
            const targetIds = ids.length > 0 ? ids : selectedIds;
            if (targetIds.length === 0) return;
            setClassificationDialog({ ids: targetIds, classificationId: null });
          },
        },
      );

      return actions;
    },
    [canWrite, canAssign, selectedIds, w],
  );

  const filters: FilterConfig[] = useMemo(
    () => [
      {
        key: 'status',
        label: labels.filters.status,
        type: 'select',
        options: CASE_STATUS_OPTIONS.map((value) => ({
          label: labels.filters.statusOptions[value] ?? formatCaseToken(value),
          value,
        })),
      },
      {
        key: 'company_status',
        label: labels.filters.companyStatus,
        type: 'select',
        options: CASE_COMPANY_STATUS_OPTIONS.map((value) => ({
          label: labels.filters.companyStatusOptions[value] ?? formatCaseToken(value),
          value,
        })),
      },
      {
        key: 'strength',
        label: labels.filters.strength,
        type: 'select',
        options: CASE_STRENGTH_OPTIONS.map((value) => ({
          label: labels.filters.strengthOptions[value] ?? formatCaseToken(value),
          value,
        })),
      },
      {
        key: 'priority',
        label: labels.filters.priority,
        type: 'select',
        options: LEGAL_PRIORITY_OPTIONS.map((value) => ({
          label: labels.filters.priorityOptions[value] ?? formatCaseToken(value),
          value,
        })),
      },
      {
        key: 'case_type',
        label: labels.filters.type,
        type: 'text',
        placeholder: labels.filters.typePlaceholder,
      },
      {
        key: 'department',
        label: w.departmentFilter,
        type: 'text',
        placeholder: w.departmentFilterPlaceholder,
      },
    ],
    [labels.filters, w],
  );

  const deadlineByCase = useMemo(() => {
    const map = new Map<string, CaseDeadlineSummary>();
    for (const row of rows) {
      map.set(
        row.id,
        summarizeCaseDeadlines(collectCaseDeadlines(row, locale, labels.list.untitled, labels.deadlines), labels.deadlines),
      );
    }
    return map;
  }, [rows, locale, labels.list.untitled, labels.deadlines]);

  const commandCards = useMemo<CaseCommandCardConfig[]>(() => {
    const assignedRows = rows.filter((row) => isCaseAssignedToUser(row, user));
    const unassignedCriticalRows = rows.filter(
      (row) =>
        row.priority === 'critical' &&
        row.status !== 'closed' &&
        row.status !== 'cancelled' &&
        !hasCaseOwner(row),
    );
    const overdueRows = rows.filter((row) => (deadlineByCase.get(row.id)?.overdue ?? 0) > 0);
    const upcomingHearingRows = rows.filter((row) => countUpcomingHearings(row) > 0);
    const upcomingHearingCount = upcomingHearingRows.reduce((count, row) => count + countUpcomingHearings(row), 0);
    const weakRows = rows.filter((row) => row.strength === 'weak');
    const intakeRows = rows.filter((row) => row.status === 'intake');
    const userLabel = currentUserDisplayName(user, w.cards.assigned);
    const userSearch = user?.full_name || `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || user?.email;
    let assignedFilter: Record<string, string> = { view: 'table' };
    if (user?.id && rows.some((row) => row.handling_officer_id === user.id)) {
      assignedFilter = { handling_officer_id: user.id, view: 'table' };
    } else if (user?.id && rows.some((row) => row.supervisor_id === user.id)) {
      assignedFilter = { supervisor_id: user.id, view: 'table' };
    } else if (user?.id && rows.some((row) => row.section_manager_id === user.id)) {
      assignedFilter = { section_manager_id: user.id, view: 'table' };
    } else if (userSearch) {
      assignedFilter = { search: userSearch, view: 'table' };
    }

    return [
      {
        id: 'assigned',
        label: w.cards.assigned,
        value: assignedRows.length,
        description: user ? w.cards.assignedDescription(userLabel) : w.cards.assignedNoUser,
        actionLabel: w.cards.focusTable,
        icon: UserCheck,
        tone: 'teal',
        disabled: !user,
        onClick: () => applySavedView(assignedFilter),
      },
      {
        id: 'unassigned-critical',
        label: w.cards.unassignedCritical,
        value: unassignedCriticalRows.length,
        description: w.cards.unassignedCriticalDescription,
        actionLabel: w.cards.filterCritical,
        icon: UserX,
        tone: 'red',
        onClick: () => applySavedView({ priority: 'critical', view: 'table' }),
      },
      {
        id: 'overdue',
        label: w.cards.overdue,
        value: deadlinePortfolio.overdue,
        description: w.cards.overdueDescription(f.formatNumber(overdueRows.length)),
        actionLabel: w.cards.openCalendar,
        icon: ShieldAlert,
        tone: deadlinePortfolio.overdue > 0 ? 'red' : 'slate',
        onClick: () => setWorkspaceViewMode('calendar'),
      },
      {
        id: 'hearings',
        label: w.cards.hearings,
        value: upcomingHearingCount,
        description: w.cards.hearingsDescription(f.formatNumber(upcomingHearingRows.length)),
        actionLabel: w.cards.openCalendar,
        icon: Gavel,
        tone: 'amber',
        onClick: () => setWorkspaceViewMode('calendar'),
      },
      {
        id: 'weak',
        label: w.cards.weak,
        value: weakRows.length,
        description: w.cards.weakDescription,
        actionLabel: w.cards.filterWeak,
        icon: Scale,
        tone: weakRows.length > 0 ? 'amber' : 'slate',
        onClick: () => applySavedView({ strength: 'weak', view: 'table' }),
      },
      {
        id: 'intake',
        label: w.cards.intake,
        value: intakeRows.length,
        description: w.cards.intakeDescription,
        actionLabel: w.cards.openIntake,
        icon: Inbox,
        tone: 'emerald',
        onClick: () => applySavedView({ status: 'intake', view: 'table' }),
      },
    ];
  }, [applySavedView, deadlineByCase, deadlinePortfolio.overdue, f, rows, setWorkspaceViewMode, user, w]);

  const columns: ColumnDef<LegalCase>[] = useMemo(
    () => [
      selectColumn<LegalCase>(),
      {
        id: 'title',
        accessorKey: 'title',
        header: labels.list.columns.case,
        enableSorting: false,
        cell: ({ row }) => {
          const title = resolveLocalized(row.original.title, locale) || labels.list.untitled;
          return (
            <div className="min-w-[15rem]">
              <Link
                href={`/lex/cases/${row.original.id}`}
                className="font-medium hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {row.original.case_number} • {resolveCaseTypeLabel(row.original.case_type, locale)}
              </p>
            </div>
          );
        },
      },
      {
        id: 'company_status',
        accessorKey: 'company_status',
        header: labels.list.columns.companyStatus,
        cell: ({ row }) => (
          <Badge variant={row.original.company_status === 'plaintiff' ? 'success' : 'warning'}>
            {labels.filters.companyStatusOptions[row.original.company_status] ??
              formatCaseToken(row.original.company_status)}
          </Badge>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: labels.list.columns.status,
        enableSorting: true,
        cell: ({ row }) => (
          <LexStatusChip
            value={row.original.status}
            domain="case"
            labels={labels.filters.statusOptions}
            size="sm"
          />
        ),
      },
      {
        id: 'deadline_risk',
        header: w.deadlineRiskColumn,
        enableSorting: false,
        cell: ({ row }) => <DeadlineRiskCell summary={deadlineByCase.get(row.original.id)} emptyLabels={labels.deadlines} />,
      },
      {
        id: 'strength',
        accessorKey: 'strength',
        header: labels.list.columns.strength,
        cell: ({ row }) =>
          row.original.strength ? (
            <Badge variant={row.original.strength === 'strong' ? 'success' : 'destructive'}>
              {labels.filters.strengthOptions[row.original.strength]}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">{labels.list.noStrength}</span>
          ),
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: labels.list.columns.priority,
        cell: ({ row }) => (
          <LexPriorityChip
            value={row.original.priority}
            labels={labels.filters.priorityOptions}
            size="sm"
          />
        ),
      },
      {
        id: 'updated_at',
        accessorKey: 'updated_at',
        header: labels.list.columns.updated,
        enableSorting: true,
        cell: ({ row }) => <RelativeTime date={row.original.updated_at} />,
      },
    ],
    [deadlineByCase, labels, locale, w.deadlineRiskColumn],
  );

  const boardColumns = useMemo<BoardColumn[]>(
    () =>
      CASE_STATUS_OPTIONS.map((status) => ({
        id: status,
        label: labels.filters.statusOptions[status] ?? formatCaseToken(status),
        colorClass: STATUS_ACCENT[status],
      })),
    [labels.filters.statusOptions],
  );

  const calendarEvents = useMemo(
    () => deadlinePortfolio.deadlines.map(deadlineToCalendarEvent),
    [deadlinePortfolio.deadlines],
  );
  const deadlineByEventId = useMemo(
    () => new Map(deadlinePortfolio.deadlines.map((deadline) => [deadline.id, deadline])),
    [deadlinePortfolio.deadlines],
  );

  const openPreviewById = useCallback(
    (caseId: string) => {
      updateWorkspaceParams({ preview: caseId });
    },
    [updateWorkspaceParams],
  );
  const openPreviewCase = useCallback(
    (legalCase: LegalCase) => {
      openPreviewById(legalCase.id);
    },
    [openPreviewById],
  );

  const onSelectCalendarEvent = useCallback(
    (eventId: string) => {
      const deadline = deadlineByEventId.get(eventId);
      if (deadline) {
        openPreviewById(deadline.caseId);
      }
    },
    [deadlineByEventId, openPreviewById],
  );

  return (
    <div className="space-y-5">
      <CaseCommandCenter
        cards={commandCards}
        visibleCount={rows.length}
        totalRows={tableProps.totalRows}
        loading={tableProps.isLoading && rows.length === 0}
        labels={w}
      />

      <div className="surface-card space-y-3 rounded-3xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant={selectedPresetId === preset.id ? 'secondary' : 'outline'}
                size="sm"
                className="h-8"
                aria-pressed={selectedPresetId === preset.id}
                onClick={() => applySavedView(preset.params)}
              >
                {w.presets[preset.id]}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8" asChild>
              <Link href="/lex/inbox">
                <Inbox className="me-2 h-4 w-4" aria-hidden />
                {w.inbox}
              </Link>
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setExportDialogOpen(true)}>
              <Download className="me-2 h-4 w-4" aria-hidden />
              {w.export}
            </Button>
            <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5" role="group" aria-label={w.viewModeAria}>
              <ViewModeButton icon={List} label={w.viewTable} active={viewMode === 'table'} onClick={() => setWorkspaceViewMode('table')} />
              <ViewModeButton icon={Columns3} label={w.viewPipeline} active={viewMode === 'pipeline'} onClick={() => setWorkspaceViewMode('pipeline')} />
              <ViewModeButton icon={CalendarDays} label={w.viewCalendar} active={viewMode === 'calendar'} onClick={() => setWorkspaceViewMode('calendar')} />
            </div>
            <Button type="button" variant="outline" size="sm" className="h-8" asChild>
              <Link href="/lex/case-timeline/portfolio">
                <History className="me-2 h-4 w-4" aria-hidden />
                {w.timeline}
              </Link>
            </Button>
          </div>
        </div>

        <SavedViewsBar
          namespace="lex-cases"
          activeFilters={activeFilters}
          onApply={applySavedView}
          labels={{
            save: w.savedViewSave,
            saved: w.savedViewSaved,
            empty: w.savedViewEmpty,
          }}
        />

        <div className="flex items-start gap-2 rounded-2xl border border-border/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          <Search className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{w.searchHint}</span>
        </div>
      </div>

      {viewMode === 'table' ? (
        <DataTable
          {...tableProps}
          columns={columns}
          filters={filters}
          activeFilters={activeFilters}
          onClearFilters={clearListFilters}
          enableSelection
          getRowId={(row) => row.id}
          onSelectionChange={setSelectedIds}
          bulkActions={bulkActions}
          onRowClick={openPreviewCase}
          searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={w.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
          emptyState={{
            icon: Gavel,
            title: labels.list.emptyTitle,
            description: labels.list.emptyDescription,
          }}
        />
      ) : viewMode === 'pipeline' ? (
        <div className="space-y-3">
          <SelectedCaseActionTray
            selectedCount={selectedRows.length}
            labels={w}
            onExport={() => setExportDialogOpen(true)}
            onClear={() => setSelectedIds([])}
          />
          <BoardView<LegalCase>
            columns={boardColumns}
            items={rows}
            getItemId={(legalCase) => legalCase.id}
            getItemColumnId={(legalCase) => legalCase.status}
            dir={direction}
            emptyColumnLabel={w.pipelineEmptyColumn}
            onMove={
              canWrite
                ? (caseId, status) => {
                    setStatusDialog({
                      ids: [caseId],
                      status: status as CaseStatus,
                      reason: '',
                      source: 'pipeline',
                    });
                  }
                : undefined
            }
            isMoving={statusMutation.isPending}
            renderCard={(legalCase) => (
              <PipelineCaseCard
                legalCase={legalCase}
                locale={locale}
                labels={labels}
                selected={selectedIds.includes(legalCase.id)}
                deadlineSummary={deadlineByCase.get(legalCase.id)}
                onToggleSelected={toggleSelected}
                onPreview={openPreviewCase}
              />
            )}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <SelectedCaseActionTray
            selectedCount={selectedRows.length}
            labels={w}
            onExport={() => setExportDialogOpen(true)}
            onClear={() => setSelectedIds([])}
          />
          <div className="surface-card rounded-3xl p-4">
            <EventCalendar
              events={calendarEvents}
              onSelectEvent={onSelectCalendarEvent}
              initialView="agenda"
              dir={direction}
              locale={locale}
            />
            {calendarEvents.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">{w.calendarEmptyHint}</p>
            ) : null}
          </div>
        </div>
      )}

      <BulkStatusDialog
        state={statusDialog}
        labels={labels}
        rows={rows}
        loading={statusMutation.isPending}
        onChange={setStatusDialog}
        onCancel={() => setStatusDialog(null)}
        onConfirm={(state) => statusMutation.mutate(state)}
      />
      <BulkPriorityDialog
        state={priorityDialog}
        labels={labels}
        rows={rows}
        loading={priorityMutation.isPending}
        onChange={setPriorityDialog}
        onCancel={() => setPriorityDialog(null)}
        onConfirm={(state) => priorityMutation.mutate(state)}
      />
      <BulkAssignmentDialog
        state={assignmentDialog}
        rows={rows}
        labels={labels}
        loading={assignmentMutation.isPending}
        onChange={setAssignmentDialog}
        onCancel={() => setAssignmentDialog(null)}
        onConfirm={(state) => assignmentMutation.mutate(state)}
      />
      <BulkClassificationDialog
        state={classificationDialog}
        rows={rows}
        labels={labels}
        loading={classificationMutation.isPending}
        onChange={setClassificationDialog}
        onCancel={() => setClassificationDialog(null)}
        onConfirm={(state) => classificationMutation.mutate(state)}
      />

      <ExportCenterDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        selectedRows={selectedRows}
        currentPageRows={rows}
        totalRows={tableProps.totalRows}
        searchValue={searchValue}
        activeFilters={activeFilters}
        labels={labels}
      />

      <CasePreviewSheet
        legalCase={previewCase}
        open={!!previewCase}
        onOpenChange={(open) => {
          if (!open) {
            updateWorkspaceParams({ preview: null });
          }
        }}
        locale={locale}
        labels={labels}
        selected={previewCase ? selectedIds.includes(previewCase.id) : false}
        onToggleSelected={toggleSelected}
      />
    </div>
  );
}

function CaseCommandCenter({
  cards,
  visibleCount,
  totalRows,
  loading,
  labels,
}: {
  cards: CaseCommandCardConfig[];
  visibleCount: number;
  totalRows: number;
  loading?: boolean;
  labels: CaseLabels['workspace'];
}) {
  const f = useLexFormat();
  return (
    <section className="space-y-2" aria-label={labels.commandCenterAria}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{labels.commandCenter}</h2>
          <p className="text-xs text-muted-foreground">
            {labels.commandCenterSubtitle(f.formatNumber(visibleCount), f.formatNumber(totalRows))}
          </p>
        </div>
        {loading ? (
          <Badge variant="secondary">{labels.loading}</Badge>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {cards.map((card) => (
          <CommandCenterCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

function CommandCenterCard({ card }: { card: CaseCommandCardConfig }) {
  const f = useLexFormat();
  const toneClass =
    card.tone === 'red'
      ? 'border-error-100 bg-error-50/80 text-error-700 hover:border-error-300'
      : card.tone === 'amber'
        ? 'border-warning-100 bg-warning-50/80 text-warning-700 dark:text-warning-300 hover:border-warning-300'
        : card.tone === 'emerald'
          ? 'border-success-100 bg-success-50/80 text-success-700 hover:border-success-300'
          : card.tone === 'teal'
            ? 'border-brand-teal-200 bg-brand-teal-50/80 text-brand-teal-950 hover:border-brand-teal-300'
            : 'border-border bg-card text-foreground hover:border-muted-foreground/40';

  return (
    <button
      type="button"
      disabled={card.disabled}
      onClick={card.onClick}
      className={cn(
        'rounded-lg border px-4 py-3 text-start shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55',
        toneClass,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide opacity-75">{card.label}</p>
          <p className="mt-1 text-2xl font-semibold leading-none">{f.formatNumber(card.value)}</p>
        </div>
        <card.icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      </div>
      <p className="mt-2 line-clamp-2 min-h-10 text-body-sm opacity-80">{card.description}</p>
      <span className="mt-2 inline-flex text-xs font-semibold">{card.actionLabel}</span>
    </button>
  );
}

function ExportCenterDialog({
  open,
  onOpenChange,
  selectedRows,
  currentPageRows,
  totalRows,
  searchValue,
  activeFilters,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedRows: LegalCase[];
  currentPageRows: LegalCase[];
  totalRows: number;
  searchValue: string;
  activeFilters: Record<string, string | string[]>;
  labels: CaseLabels;
}) {
  const w = labels.workspace;
  const activeFilterCount = Object.values(activeFilters).filter(
    (value) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0),
  ).length;
  const activeScopeCount = activeFilterCount + (searchValue.trim() ? 1 : 0);
  const filteredIsCurrentPage = totalRows <= currentPageRows.length;

  const exportAndClose = (targetRows: LegalCase[], prefix: string) => {
    if (targetRows.length === 0) {
      return;
    }
    exportCasesCsv(targetRows, prefix);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{w.exportCenterTitle}</DialogTitle>
          <DialogDescription>{w.exportCenterDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ExportOption
            title={w.exportSelectedTitle}
            count={selectedRows.length}
            description={w.exportSelectedDescription}
            badge={selectedRows.length > 0 ? w.exportSelectedReady : w.exportSelectedEmpty}
            disabled={selectedRows.length === 0}
            exportCsvLabel={w.exportCsv}
            onClick={() => exportAndClose(selectedRows, 'cases-selected')}
          />
          <ExportOption
            title={w.exportCurrentTitle}
            count={currentPageRows.length}
            description={w.exportCurrentDescription}
            badge={w.exportCurrentBadge}
            disabled={currentPageRows.length === 0}
            exportCsvLabel={w.exportCsv}
            onClick={() => exportAndClose(currentPageRows, 'cases-current-page')}
          />
          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{w.exportFilteredTitle}</p>
                  <Badge variant={filteredIsCurrentPage ? 'warning' : 'outline'}>
                    {filteredIsCurrentPage ? w.exportFilteredCurrentPage : w.exportFilteredUnavailable}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {w.exportFilteredDescription(totalRows, activeScopeCount)}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" disabled>
                {w.backendExportUnavailable}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {w.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportOption({
  title,
  count,
  description,
  badge,
  disabled,
  exportCsvLabel,
  onClick,
}: {
  title: string;
  count: number;
  description: string;
  badge: string;
  disabled: boolean;
  exportCsvLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{title}</p>
            <Badge variant={disabled ? 'outline' : 'secondary'}>{badge}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">{count}</span>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>
            <Download className="me-2 h-4 w-4" aria-hidden />
            {exportCsvLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ViewModeButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      className="h-8 gap-1.5"
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Button>
  );
}

function selectedCasesLabel(count: number, w: CaseLabels['workspace']) {
  return w.casesCount(count);
}

function BulkOperationSummary({
  ids,
  rows,
  intent,
  destructive,
  w,
}: {
  ids: string[];
  rows: LegalCase[];
  intent: string;
  destructive?: boolean;
  w: CaseLabels['workspace'];
}) {
  const idSet = new Set(ids);
  const loadedRows = rows.filter((row) => idSet.has(row.id));
  const closedOrCancelled = loadedRows.filter((row) => row.status === 'closed' || row.status === 'cancelled');
  const missingOwner = loadedRows.filter((row) => !hasCaseOwner(row));
  const needsReview = destructive || ids.length > 1 || closedOrCancelled.length > 0 || missingOwner.length > 0;

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{intent}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {w.bulkSummarySelected(ids.length, loadedRows.length)}
          </p>
        </div>
        {needsReview ? (
          <Badge variant={destructive ? 'destructive' : 'warning'}>{w.bulkSummaryReview}</Badge>
        ) : (
          <Badge variant="secondary">{w.bulkSummarySingle}</Badge>
        )}
      </div>
      {closedOrCancelled.length > 0 || missingOwner.length > 0 || destructive ? (
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          {destructive ? (
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error-500" aria-hidden />
              <span>{w.bulkSummaryDestructive}</span>
            </div>
          ) : null}
          {closedOrCancelled.length > 0 ? (
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-700 dark:text-warning-300" aria-hidden />
              <span>{w.bulkSummaryClosed(closedOrCancelled.length)}</span>
            </div>
          ) : null}
          {missingOwner.length > 0 ? (
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-700 dark:text-warning-300" aria-hidden />
              <span>{w.bulkSummaryNoOwner(missingOwner.length)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BulkStatusDialog({
  state,
  labels,
  rows,
  loading,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: BulkStatusDialogState | null;
  labels: CaseLabels;
  rows: LegalCase[];
  loading: boolean;
  onChange: Dispatch<SetStateAction<BulkStatusDialogState | null>>;
  onCancel: () => void;
  onConfirm: (state: BulkStatusDialogState) => void;
}) {
  const w = labels.workspace;
  const { locale } = useLocale();
  const casesLabel = selectedCasesLabel(state?.ids.length ?? 0, w);

  // F26: bulk "Change status" must only offer targets EVERY selected case can
  // actually transition into. Derive the option set from the FSM
  // (CASE_STATUS_TRANSITIONS) intersected over the selection instead of the raw
  // CASE_STATUS_OPTIONS vocabulary (which included intake/phase1/phase2 — states
  // with no in-edge, so each apply 409'd). on_hold is excluded here: it requires a
  // delay category the bulk dialog cannot collect (use the detail status dialog).
  const availableStatuses = useMemo<CaseStatus[]>(() => {
    const ids = state?.ids ?? [];
    if (ids.length === 0) return [];
    const currentStatuses = ids
      .map((id) => rows.find((row) => row.id === id)?.status)
      .filter((status): status is CaseStatus => Boolean(status));
    if (currentStatuses.length === 0) return [];
    let common: CaseStatus[] | null = null;
    for (const current of currentStatuses) {
      const targets: CaseStatus[] = (CASE_STATUS_TRANSITIONS[current] ?? []).filter(
        (target) => target !== 'on_hold',
      );
      common = common === null ? [...targets] : common.filter((target) => targets.includes(target));
    }
    return common ?? [];
  }, [rows, state?.ids]);

  const noCommonTarget = Boolean(state) && availableStatuses.length === 0;
  const requiresLateJustification = Boolean(
    state &&
      (state.status === 'closed' || state.status === 'cancelled') &&
      state.ids.some((id) => {
        const deadline = rows.find((row) => row.id === id)?.sla_turnaround_due_at;
        return Boolean(deadline && Date.now() > new Date(deadline).getTime());
      }),
  );

  // Keep the selected target valid: a preset (bulk default 'open') or a board-drag
  // target that isn't a common transition falls back to the first available one.
  useEffect(() => {
    if (!state || availableStatuses.length === 0) return;
    if (availableStatuses.includes(state.status)) return;
    const next = availableStatuses[0];
    onChange((current) => (current ? { ...current, status: next } : current));
  }, [availableStatuses, onChange, state]);

  return (
    <Dialog
      open={Boolean(state)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {state?.source === 'pipeline'
              ? w.statusDialogMove
              : state?.source === 'archive'
                ? w.statusDialogArchive
                : w.statusDialogSet}
          </DialogTitle>
          <DialogDescription>
            {state?.source === 'archive'
              ? w.statusDialogArchiveDescription(casesLabel)
              : w.statusDialogSetDescription(casesLabel)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <BulkOperationSummary
            ids={state?.ids ?? []}
            rows={rows}
            w={w}
            intent={state?.source === 'archive' ? w.archiveIntent : w.statusIntent}
            destructive={state?.source === 'archive' || state?.status === 'closed' || state?.status === 'cancelled'}
          />
          <div className="space-y-1.5">
            <Label>{w.statusLabel}</Label>
            <Select
              value={state && availableStatuses.includes(state.status) ? state.status : ''}
              disabled={noCommonTarget}
              onValueChange={(value) =>
                onChange((current) => (current ? { ...current, status: value as CaseStatus } : current))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {labels.filters.statusOptions[status] ?? formatCaseToken(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {noCommonTarget ? (
              <p className="text-xs text-muted-foreground">
                {locale === 'ar'
                  ? 'لا توجد حالة مشتركة يمكن نقل جميع القضايا المحددة إليها. عدّل التحديد.'
                  : 'The selected cases share no common status they can all move to. Adjust the selection.'}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>{w.reasonLabel}</Label>
            <Textarea
              value={state?.reason ?? ''}
              rows={3}
              placeholder={w.statusReasonPlaceholder}
              onChange={(event) =>
                onChange((current) => (current ? { ...current, reason: event.target.value } : current))
              }
            />
          </div>
          {requiresLateJustification ? (
            <div className="space-y-1.5">
              <Label>{locale === 'ar' ? 'مبرر تجاوز اتفاقية مستوى الخدمة' : 'SLA delay justification'}</Label>
              <Textarea
                value={state?.lateJustification ?? ''}
                rows={4}
                placeholder={
                  locale === 'ar'
                    ? 'اشرح سبب إنهاء السجل بعد الموعد المحدد في اتفاقية مستوى الخدمة.'
                    : 'Explain why the record ended after its SLA deadline.'
                }
                onChange={(event) =>
                  onChange((current) =>
                    current ? { ...current, lateJustification: event.target.value } : current,
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                {locale === 'ar'
                  ? 'يظهر هذا المبرر فقط للمدير القانوني ومدير القضايا القانونية.'
                  : 'Visible only to the Legal Director and Legal Cases Manager.'}
              </p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {labels.form.cancel}
          </Button>
          <Button
            type="button"
            disabled={
              !state?.reason.trim() ||
              (requiresLateJustification && !state?.lateJustification?.trim()) ||
              loading ||
              noCommonTarget ||
              !(state && availableStatuses.includes(state.status))
            }
            onClick={() => {
              if (state) onConfirm(state);
            }}
          >
            {loading ? <RefreshCw className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {state?.source === 'archive' ? w.archiveButton : w.applyStatus}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkPriorityDialog({
  state,
  labels,
  rows,
  loading,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: BulkPriorityDialogState | null;
  labels: CaseLabels;
  rows: LegalCase[];
  loading: boolean;
  onChange: Dispatch<SetStateAction<BulkPriorityDialogState | null>>;
  onCancel: () => void;
  onConfirm: (state: BulkPriorityDialogState) => void;
}) {
  const w = labels.workspace;
  return (
    <Dialog
      open={Boolean(state)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{w.priorityDialogTitle}</DialogTitle>
          <DialogDescription>
            {w.priorityDialogDescription(selectedCasesLabel(state?.ids.length ?? 0, w))}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <BulkOperationSummary ids={state?.ids ?? []} rows={rows} w={w} intent={w.priorityIntent} />
          <div className="space-y-1.5">
            <Label>{w.priorityLabel}</Label>
            <Select
              value={state?.priority ?? 'high'}
              onValueChange={(value) =>
                onChange((current) => (current ? { ...current, priority: value as LegalPriority } : current))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEGAL_PRIORITY_OPTIONS.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {labels.filters.priorityOptions[priority] ?? formatCaseToken(priority)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{w.reasonLabel}</Label>
            <Textarea
              value={state?.reason ?? ''}
              rows={3}
              placeholder={w.priorityReasonPlaceholder}
              onChange={(event) =>
                onChange((current) => (current ? { ...current, reason: event.target.value } : current))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {labels.form.cancel}
          </Button>
          <Button
            type="button"
            disabled={!state?.reason.trim() || loading}
            onClick={() => {
              if (state) onConfirm(state);
            }}
          >
            {loading ? <RefreshCw className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {w.applyPriority}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkAssignmentDialog({
  state,
  rows,
  labels,
  loading,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: BulkAssignmentDialogState | null;
  rows: LegalCase[];
  labels: CaseLabels;
  loading: boolean;
  onChange: Dispatch<SetStateAction<BulkAssignmentDialogState | null>>;
  onCancel: () => void;
  onConfirm: (state: BulkAssignmentDialogState) => void;
}) {
  const w = labels.workspace;
  const notifyMode = state?.mode === 'notify';
  const assignmentEntity = resolveBulkAssignmentEntity(state?.ids ?? [], rows);
  const mixedEntities = !notifyMode && assignmentEntity.mixed;
  const sharedEntityId = !mixedEntities ? assignmentEntity.entityId : undefined;
  const hasAssignment = notifyMode
    ? Boolean(state?.department.trim())
    : Boolean(state?.handlingOfficerId && !mixedEntities);
  const casesLabel = selectedCasesLabel(state?.ids.length ?? 0, w);
  return (
    <Dialog
      open={Boolean(state)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{notifyMode ? w.assignDialogNotify : w.assignDialogAssign}</DialogTitle>
          <DialogDescription>
            {notifyMode
              ? w.assignDialogNotifyDescription(casesLabel)
              : w.assignDialogAssignDescription(casesLabel)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <BulkOperationSummary
            ids={state?.ids ?? []}
            rows={rows}
            w={w}
            intent={notifyMode ? w.departmentRouteIntent : w.assignmentIntent}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!notifyMode ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{w.responsibleLawyerLabel}</Label>
              {mixedEntities ? (
                <div className="flex gap-2 rounded-lg border border-amber-500/35 bg-amber-500/5 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{w.assignmentMixedEntities}</span>
                </div>
              ) : (
                <OrgEntityUserPicker
                  ariaLabel={w.responsibleLawyerLabel}
                  entityId={sharedEntityId}
                  value={state?.handlingOfficerId ?? ''}
                  onChange={(handlingOfficerId) =>
                    onChange((current) =>
                      current ? { ...current, handlingOfficerId } : current,
                    )
                  }
                  required
                  disabled={loading}
                  labels={{
                    select: w.responsibleLawyerPlaceholder,
                    search: w.responsibleLawyerSearch,
                    loading: w.responsibleLawyerLoading,
                    empty: w.responsibleLawyerEmpty,
                    loadError: w.responsibleLawyerLoadError,
                    retry: w.responsibleLawyerRetry,
                  }}
                  className="w-full"
                />
              )}
            </div>
          ) : null}
            <div className="space-y-1.5">
              <Label>{w.departmentLabel}</Label>
              <Input
                value={state?.department ?? ''}
                placeholder={w.departmentPlaceholder}
                onChange={(event) =>
                  onChange((current) => (current ? { ...current, department: event.target.value } : current))
                }
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {labels.form.cancel}
          </Button>
          <Button
            type="button"
            disabled={!hasAssignment || loading || mixedEntities}
            onClick={() => {
              if (state) onConfirm(state);
            }}
          >
            {loading ? <RefreshCw className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {notifyMode ? w.applyDepartmentRoute : w.applyAssignment}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkClassificationDialog({
  state,
  rows,
  labels,
  loading,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: BulkClassificationDialogState | null;
  rows: LegalCase[];
  labels: CaseLabels;
  loading: boolean;
  onChange: Dispatch<SetStateAction<BulkClassificationDialogState | null>>;
  onCancel: () => void;
  onConfirm: (state: BulkClassificationDialogState) => void;
}) {
  const w = labels.workspace;
  return (
    <Dialog
      open={Boolean(state)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{w.classifyDialogTitle}</DialogTitle>
          <DialogDescription>
            {w.classifyDialogDescription(selectedCasesLabel(state?.ids.length ?? 0, w))}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <BulkOperationSummary ids={state?.ids ?? []} rows={rows} w={w} intent={w.classificationIntent} />
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {w.classifyHint}
          </div>
          <ClassificationPicker
            value={state?.classificationId ?? null}
            onChange={(classificationId) =>
              onChange((current) => (current ? { ...current, classificationId } : current))
            }
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {labels.form.cancel}
          </Button>
          <Button
            type="button"
            disabled={loading}
            onClick={() => {
              if (state) onConfirm(state);
            }}
          >
            {loading ? <RefreshCw className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {w.applyClassification}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeadlineRiskCell({ summary, emptyLabels }: { summary?: CaseDeadlineSummary; emptyLabels: CaseLabels['deadlines'] }) {
  const resolved = summary ?? summarizeCaseDeadlines([], emptyLabels);
  const dotClass =
    resolved.risk === 'overdue'
      ? 'bg-error-500'
      : resolved.risk === 'urgent'
        ? 'bg-warning-500'
        : resolved.risk === 'soon'
          ? 'bg-warning-500'
          : resolved.risk === 'scheduled'
            ? 'bg-brand-teal-500'
            : 'bg-muted-foreground/40';

  return (
    <div className="min-w-[10rem]">
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', dotClass)} aria-hidden />
        <span className="text-sm font-medium">{resolved.label}</span>
      </div>
      {resolved.nextDeadline ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          <RelativeTime date={resolved.nextDeadline.date} />
        </p>
      ) : (
        <p className="mt-1 truncate text-xs text-muted-foreground">{resolved.description}</p>
      )}
    </div>
  );
}

function PipelineCaseCard({
  legalCase,
  locale,
  labels,
  selected,
  deadlineSummary,
  onToggleSelected,
  onPreview,
}: {
  legalCase: LegalCase;
  locale: AppLocale;
  labels: CaseLabels;
  selected: boolean;
  deadlineSummary?: CaseDeadlineSummary;
  onToggleSelected: (caseId: string) => void;
  onPreview: (legalCase: LegalCase) => void;
}) {
  const title = resolveLocalized(legalCase.title, locale) || labels.list.untitled;
  return (
    <div className={cn('space-y-3 p-3', rowAccentClass('status', legalCase.status))}>
      <div className="flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelected(legalCase.id)}
          aria-label={labels.workspace.selectRowAria(title)}
          onClick={(event) => event.stopPropagation()}
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/lex/cases/${legalCase.id}`}
            className="line-clamp-2 text-sm font-medium leading-snug hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {title}
          </Link>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {legalCase.case_number} • {resolveCaseTypeLabel(legalCase.case_type, locale)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={(event) => {
            event.stopPropagation();
            onPreview(legalCase);
          }}
          aria-label={labels.workspace.previewAria(title)}
        >
          <Eye className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={legalCase.company_status === 'plaintiff' ? 'success' : 'warning'}>
          {labels.filters.companyStatusOptions[legalCase.company_status] ?? formatCaseToken(legalCase.company_status)}
        </Badge>
        <LexPriorityChip value={legalCase.priority} labels={labels.filters.priorityOptions} size="sm" />
      </div>
      <DeadlineRiskCell summary={deadlineSummary} emptyLabels={labels.deadlines} />
    </div>
  );
}

function SelectedCaseActionTray({
  selectedCount,
  labels,
  onExport,
  onClear,
}: {
  selectedCount: number;
  labels: CaseLabels['workspace'];
  onExport: () => void;
  onClear: () => void;
}) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/10 bg-primary/5 px-3 py-2.5">
      <span className="text-sm font-medium">{labels.selected(selectedCount)}</span>
      <div className="ms-auto flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={onExport}>
          <Download className="me-2 h-4 w-4" aria-hidden />
          {labels.export}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onClear}>
          {labels.clear}
        </Button>
      </div>
    </div>
  );
}
