'use client';

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  FileStack,
  PencilLine,
  Play,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { StatTile } from '@/components/shared/stat-tile';
import { DataTable } from '@/components/shared/data-table/data-table';
import { selectColumn } from '@/components/shared/data-table/columns/common-columns';
import { SearchInput } from '@/components/shared/forms/search-input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import { showApiError, showSuccess } from '@/lib/toast';
import { apiPost } from '@/lib/api';
import type { BulkAction, FilterConfig, RowAction } from '@/types/table';
import { lexAdminApi, LEX_ADMIN_ENDPOINTS, type AttachmentPolicy } from '@/lib/lex/admin';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { AdminDatasetActions } from '../_components/admin-dataset-actions';
import { formatBytes } from '../_lib/admin-feature-utils';
import { useAdminCommonLabels, useAttachmentLabels, type AttachmentLabels } from '../_lib/admin-labels';
import { AttachmentPolicyFormDialog } from './_components/attachment-policy-form-dialog';

interface AttachmentPolicyEvaluation {
  policy_id: string;
  request_type: string;
  service_code: string;
  required_count: number;
  max_allowed_count: number;
  provided_count: number;
  count_satisfied: boolean;
  count_exceeded: boolean;
  missing_slots: string[];
  slots_satisfied: boolean;
  complete: boolean;
  evaluated_at_unix: number;
}

interface EvaluatorState {
  requestType: string;
  serviceCode: string;
  providedSlots: string;
  providedCount: string;
}

function buildAttachmentFilters(t: AttachmentLabels): FilterConfig[] {
  return [
    { key: 'request_type', label: t.filters.requestType, type: 'text', placeholder: 'legal_opinion' },
    { key: 'service_code', label: t.filters.serviceCode, type: 'text', placeholder: 'LEX-OPINION' },
    {
      key: 'active',
      label: t.filters.status,
      type: 'select',
      options: [{ label: t.filters.activeOnly, value: 'true' }],
    },
  ];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolValue(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function stringArrayValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    // fall through to comma splitting
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function localizedValue(row: Record<string, unknown>, field: string): { ar: string; en: string } {
  const value = row[field];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const localized = value as Record<string, unknown>;
    return { ar: stringValue(localized.ar), en: stringValue(localized.en) };
  }
  return { ar: stringValue(row[`${field}_ar`]), en: stringValue(row[`${field}_en`]) || stringValue(value) };
}

function slotRows(value: unknown): AttachmentPolicy['slots'] {
  const raw =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return [];
          }
        })()
      : value;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((slot): slot is Record<string, unknown> => !!slot && typeof slot === 'object')
    .map((slot, index) => ({
      key: stringValue(slot.key),
      label: localizedValue(slot, 'label'),
      required: boolValue(slot.required, false),
      sort_order: numberValue(slot.sort_order) || index,
      allowed_content_types: stringArrayValue(slot.allowed_content_types),
    }))
    .filter((slot) => slot.key.length > 0);
}

function providedSlotList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((slot) => slot.trim().toLowerCase())
    .filter(Boolean);
}

function policyLabel(policy: AttachmentPolicy, locale: AppLocale): string {
  return resolveLocalized(policy.name, locale) || policy.service_code || policy.request_type || policy.id.slice(0, 8);
}

function policyPrecedence(policy: AttachmentPolicy): number {
  if (policy.service_code) return 1;
  if (policy.request_type) return 2;
  return 3;
}

function findApplicablePolicy(
  rows: AttachmentPolicy[],
  requestType: string,
  serviceCode: string,
): AttachmentPolicy | undefined {
  const service = serviceCode.trim().toUpperCase();
  const request = requestType.trim();
  return [...rows]
    .filter((policy) => policy.active)
    .filter((policy) => (service && policy.service_code === service) || (request && policy.request_type === request))
    .sort(
      (a, b) => policyPrecedence(a) - policyPrecedence(b) || Date.parse(b.updated_at) - Date.parse(a.updated_at),
    )[0];
}

export default function AttachmentPoliciesPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = useAttachmentLabels();
  const common = useAdminCommonLabels();
  const qc = useQueryClient();
  const canWrite = hasPermission('lex:catalog:manage');
  const attachmentFilters = useMemo(() => buildAttachmentFilters(t), [t]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AttachmentPolicy | null>(null);
  const [deleting, setDeleting] = useState<AttachmentPolicy | null>(null);
  const [evaluation, setEvaluation] = useState<AttachmentPolicyEvaluation | null>(null);
  const [evaluator, setEvaluator] = useState<EvaluatorState>({
    requestType: '',
    serviceCode: '',
    providedSlots: '',
    providedCount: '0',
  });

  const { tableProps, totalRows, searchValue, setSearch } = useDataTable<AttachmentPolicy>({
    queryKey: 'lex-admin-attachment-policies',
    fetchFn: (params) => fetchSuitePaginated<AttachmentPolicy>(LEX_ADMIN_ENDPOINTS.ATTACHMENT_POLICIES, params),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['lex.attachment-policies'],
  });

  const rows = tableProps.data;
  const exportRows = useMemo<Record<string, unknown>[]>(
    () =>
      rows.map((policy) => ({
        id: policy.id,
        request_type: policy.request_type,
        service_code: policy.service_code,
        name_en: policy.name?.en ?? '',
        name_ar: policy.name?.ar ?? '',
        description_en: policy.description?.en ?? '',
        description_ar: policy.description?.ar ?? '',
        min_attachment_count: policy.min_attachment_count,
        max_attachment_count: policy.max_attachment_count,
        max_file_size_bytes: policy.max_file_size_bytes,
        allowed_content_types: policy.allowed_content_types,
        active: policy.active,
        slots: policy.slots,
        created_at: policy.created_at,
        updated_at: policy.updated_at,
      })),
    [rows],
  );
  const activeFilters = useMemo(
    () => ({ ...tableProps.activeFilters, ...(searchValue ? { search: searchValue } : {}) }),
    [searchValue, tableProps.activeFilters],
  );
  const stats = useMemo(() => {
    let active = 0;
    let slots = 0;
    let inconsistent = 0;
    for (const r of rows) {
      if (r.active) active += 1;
      slots += r.slots?.length ?? 0;
      const required = r.slots?.filter((slot) => slot.required).length ?? 0;
      if (
        (r.max_attachment_count > 0 && r.min_attachment_count > r.max_attachment_count) ||
        required > r.min_attachment_count
      ) {
        inconsistent += 1;
      }
    }
    return { total: totalRows, active, slots, inconsistent };
  }, [rows, totalRows]);
  const activeShare = percent(stats.active, stats.total);
  const kpiCopy =
    locale === 'ar'
      ? {
          total: 'سياسات المرفقات المطابقة للفلاتر الحالية.',
          active: 'السياسات المنشورة والمستخدمة في التحقق من الطلبات.',
          slots: 'خانات المستندات المطلوبة عبر السياسات المعروضة.',
          currentRegistry: 'السجل الحالي',
          activeShare: 'نشط من إجمالي السياسات',
          policies: 'سياسات',
          slotRules: 'قواعد خانات',
        }
      : {
          total: 'Attachment policies matching the current filters.',
          active: 'Published policies used during request validation.',
          slots: 'Required document slots across the visible policies.',
          currentRegistry: 'Current registry',
          activeShare: 'Active share of policies',
          policies: 'Policies',
          slotRules: 'Slot rules',
        };

  const precedenceRows = useMemo(
    () =>
      [...rows]
        .filter((policy) => policy.active)
        .sort(
          (a, b) => policyPrecedence(a) - policyPrecedence(b) || Date.parse(b.updated_at) - Date.parse(a.updated_at),
        )
        .slice(0, 6),
    [rows],
  );

  const providedSlots = useMemo(() => providedSlotList(evaluator.providedSlots), [evaluator.providedSlots]);
  const previewPolicy = useMemo(() => {
    if (evaluation?.policy_id) return rows.find((policy) => policy.id === evaluation.policy_id);
    return findApplicablePolicy(rows, evaluator.requestType, evaluator.serviceCode);
  }, [evaluation, evaluator.requestType, evaluator.serviceCode, rows]);

  const del = useMutation({
    mutationFn: (id: string) => lexAdminApi.deleteAttachmentPolicy(id),
    onSuccess: async () => {
      showSuccess(common.toast.deleted);
      await qc.invalidateQueries({ queryKey: ['lex-admin-attachment-policies'] });
      setDeleting(null);
    },
    onError: showApiError,
  });

  const evaluate = useMutation({
    mutationFn: () =>
      apiPost<{ data: AttachmentPolicyEvaluation }>('/api/v1/lex/attachment-policies/evaluate', {
        request_type: evaluator.requestType,
        service_code: evaluator.serviceCode,
        provided_slots: providedSlots,
        provided_count: numberValue(evaluator.providedCount),
      }).then((res) => res.data),
    onSuccess: (result) => setEvaluation(result),
    onError: showApiError,
  });

  const bulkSetActive = async (ids: string[], active: boolean) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => lexAdminApi.updateAttachmentPolicy(id, { active })));
    showSuccess(active ? t.toast.activated : t.toast.deactivated);
    await qc.invalidateQueries({ queryKey: ['lex-admin-attachment-policies'] });
  };

  const bulkDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => lexAdminApi.deleteAttachmentPolicy(id)));
    showSuccess(t.toast.deleted(ids.length));
    await qc.invalidateQueries({ queryKey: ['lex-admin-attachment-policies'] });
  };

  const bulkActions: BulkAction[] = [
    { label: t.bulk.activate, icon: ToggleRight, onClick: (ids) => bulkSetActive(ids, true) },
    { label: t.bulk.deactivate, icon: ToggleLeft, onClick: (ids) => bulkSetActive(ids, false) },
    { label: t.bulk.delete, icon: Trash2, variant: 'destructive', onClick: bulkDelete },
  ];

  const importRows = async (incoming: Record<string, unknown>[]) => {
    for (const row of incoming) {
      const payload = {
        request_type: stringValue(row.request_type),
        service_code: stringValue(row.service_code),
        name: localizedValue(row, 'name'),
        description: localizedValue(row, 'description'),
        min_attachment_count: numberValue(row.min_attachment_count),
        max_attachment_count: numberValue(row.max_attachment_count),
        slots: slotRows(row.slots).map((slot, index) => ({
          key: slot.key,
          label: slot.label,
          required: slot.required,
          sort_order: slot.sort_order ?? index,
          allowed_content_types: slot.allowed_content_types ?? [],
        })),
        allowed_content_types: stringArrayValue(row.allowed_content_types),
        max_file_size_bytes: numberValue(row.max_file_size_bytes),
        active: boolValue(row.active, true),
      };
      const id = stringValue(row.id);
      if (id) await lexAdminApi.updateAttachmentPolicy(id, payload);
      else await lexAdminApi.createAttachmentPolicy(payload);
    }
    await qc.invalidateQueries({ queryKey: ['lex-admin-attachment-policies'] });
  };

  const appliesTo = (p: AttachmentPolicy): string => {
    if (p.request_type) return t.appliesToRequestType(p.request_type);
    if (p.service_code) return t.appliesToService(p.service_code);
    return t.appliesToAny;
  };

  const columns: ColumnDef<AttachmentPolicy>[] = [
    selectColumn<AttachmentPolicy>(),
    {
      id: 'name',
      header: t.columns.name,
      cell: ({ row }) => (
        <p className="font-medium">{resolveLocalized(row.original.name, locale) || appliesTo(row.original)}</p>
      ),
    },
    {
      id: 'appliesTo',
      header: t.columns.appliesTo,
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{appliesTo(row.original)}</span>,
    },
    {
      id: 'minCount',
      accessorKey: 'min_attachment_count',
      header: t.columns.minCount,
      enableSorting: true,
      cell: ({ row }) => <span className="text-sm">{row.original.min_attachment_count}</span>,
    },
    {
      id: 'slots',
      header: t.columns.slots,
      cell: ({ row }) => (
        <div className="space-y-1">
          <span className="text-sm text-muted-foreground">{t.slotCount(row.original.slots?.length ?? 0)}</span>
          <p className="text-xs text-muted-foreground">
            {(row.original.slots ?? []).filter((slot) => slot.required).length} required
          </p>
        </div>
      ),
    },
    {
      id: 'fileSize',
      accessorKey: 'max_file_size_bytes',
      header: 'Max file size',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.max_file_size_bytes ? formatBytes(row.original.max_file_size_bytes) : 'No cap'}
        </span>
      ),
    },
    {
      id: 'status',
      accessorKey: 'active',
      header: t.columns.status,
      cell: ({ row }) => (
        <Badge variant={row.original.active ? 'default' : 'outline'}>
          {row.original.active ? common.active : common.inactive}
        </Badge>
      ),
    },
  ];

  const rowActions: RowAction<AttachmentPolicy>[] = [
    { label: common.edit, icon: PencilLine, onClick: (row) => setEditing(row) },
    { label: common.delete, icon: Trash2, variant: 'destructive', onClick: (row) => setDeleting(row) },
  ];

  return (
    <LexAccessGuard routeKey="/lex/admin/attachment-policies" resourceName={t.pageTitle}>
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          title={t.pageTitle}
          description={t.pageDescription}
          actions={
            canWrite ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="me-1.5 h-4 w-4" />
                {t.create}
              </Button>
            ) : undefined
          }
        />

        <div className="attachment-policy-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile
            label={t.stats.total}
            value={stats.total}
            themeClass="kpi-theme-primary"
            icon={FileStack}
            loading={tableProps.isLoading}
            detail={kpiCopy.currentRegistry}
            detailValue={kpiCopy.policies}
            size="md"
            appearance="operational"
            className="attachment-policy-kpi-card"
            href="/lex/admin/attachment-policies"
          />
          <StatTile
            label={t.stats.active}
            value={stats.active}
            themeClass="kpi-theme-emerald"
            icon={CheckCircle2}
            loading={tableProps.isLoading}
            progress={activeShare}
            progressLabel={kpiCopy.activeShare}
            detail={kpiCopy.currentRegistry}
            detailValue={`${activeShare}%`}
            size="md"
            appearance="operational"
            className="attachment-policy-kpi-card"
            href="/lex/admin/attachment-policies?active=true"
          />
          <StatTile
            label={t.stats.slots}
            value={stats.slots}
            themeClass="kpi-theme-amber"
            icon={Boxes}
            loading={tableProps.isLoading}
            detail={kpiCopy.currentRegistry}
            detailValue={kpiCopy.slotRules}
            size="md"
            appearance="operational"
            className="attachment-policy-kpi-card"
            href="#attachment-policy-records"
          />
        </div>

        <AdminDatasetActions
          namespace="lex-admin-attachment-policies"
          filename="lex-attachment-policies"
          rows={exportRows}
          activeFilters={activeFilters}
          labels={{
            savedView: t.savedView,
            importTitle: t.importTitle,
            importDescription: t.importDescription,
          }}
          onImportRows={canWrite ? importRows : undefined}
        />

        <div id="attachment-policy-records" className="scroll-mt-24">
          <DataTable
            {...tableProps}
            columns={columns}
            filters={attachmentFilters}
            getRowId={(row) => row.id}
            enableSelection={canWrite}
            bulkActions={canWrite ? bulkActions : undefined}
            rowActions={canWrite ? rowActions : undefined}
            searchSlot={
              <SearchInput
                value={searchValue}
                onChange={setSearch}
                placeholder={common.searchPlaceholder}
                loading={tableProps.isLoading}
              />
            }
            emptyState={{ icon: FileStack, title: t.emptyTitle, description: t.emptyDescription }}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard
            title={t.evaluator.title}
            description={t.evaluator.description}
            actions={
              <Button size="sm" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
                <Play className="me-1.5 h-3.5 w-3.5" />
                {t.evaluator.evaluate}
              </Button>
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Input
                  value={evaluator.requestType}
                  onChange={(event) => setEvaluator((current) => ({ ...current, requestType: event.target.value }))}
                  placeholder={t.evaluator.requestTypePlaceholder}
                />
                <Input
                  value={evaluator.serviceCode}
                  onChange={(event) =>
                    setEvaluator((current) => ({ ...current, serviceCode: event.target.value.toUpperCase() }))
                  }
                  placeholder={t.evaluator.serviceCodePlaceholder}
                />
                <Input
                  value={evaluator.providedCount}
                  onChange={(event) => setEvaluator((current) => ({ ...current, providedCount: event.target.value }))}
                  type="number"
                  min={0}
                  placeholder={t.evaluator.providedCountPlaceholder}
                />
              </div>
              <Textarea
                value={evaluator.providedSlots}
                onChange={(event) => setEvaluator((current) => ({ ...current, providedSlots: event.target.value }))}
                placeholder={t.evaluator.providedSlotsPlaceholder}
              />
              {evaluation ? (
                <div className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={evaluation.complete ? 'default' : 'destructive'}>
                      {evaluation.complete ? t.evaluator.complete : t.evaluator.incomplete}
                    </Badge>
                    <Badge variant={evaluation.count_satisfied ? 'secondary' : 'destructive'}>
                      {t.evaluator.count(evaluation.provided_count, evaluation.required_count)}
                    </Badge>
                    {evaluation.max_allowed_count > 0 ? (
                      <Badge variant={evaluation.count_exceeded ? 'destructive' : 'outline'}>
                        {t.evaluator.max(evaluation.max_allowed_count)}
                      </Badge>
                    ) : null}
                  </div>
                  {evaluation.missing_slots.length > 0 ? (
                    <p className="mt-2 text-sm text-destructive">
                      {t.evaluator.missingSlots(evaluation.missing_slots.join(', '))}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">{t.evaluator.allSatisfied}</p>
                  )}
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title={t.checklist.title} description={t.checklist.description}>
            {previewPolicy ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{policyLabel(previewPolicy, locale)}</Badge>
                  <Badge variant="outline">{appliesTo(previewPolicy)}</Badge>
                  <Badge variant="outline">
                    {previewPolicy.max_file_size_bytes
                      ? formatBytes(previewPolicy.max_file_size_bytes)
                      : t.checklist.noFileCap}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {[...previewPolicy.slots]
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((slot) => {
                      const satisfied = providedSlots.includes(slot.key);
                      return (
                        <div
                          key={slot.key}
                          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-medium">{resolveLocalized(slot.label, locale) || slot.key}</p>
                            <p className="text-xs text-muted-foreground">
                              {(slot.allowed_content_types?.length
                                ? slot.allowed_content_types
                                : previewPolicy.allowed_content_types
                              ).join(', ') || t.checklist.anyMime}
                            </p>
                          </div>
                          <Badge variant={satisfied ? 'default' : slot.required ? 'destructive' : 'outline'}>
                            {satisfied
                              ? t.checklist.provided
                              : slot.required
                                ? t.checklist.required
                                : t.checklist.optional}
                          </Badge>
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 p-3 text-sm text-warning-700 dark:text-warning-300">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                {t.checklist.emptyHint}
              </div>
            )}
          </SectionCard>
        </div>

        <SectionCard title={t.precedence.title} description={t.precedence.description}>
          {precedenceRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.precedence.empty}</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {precedenceRows.map((policy, index) => (
                <div key={policy.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{policyLabel(policy, locale)}</p>
                    <Badge variant={index === 0 ? 'default' : 'outline'}>#{index + 1}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{appliesTo(policy)}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{t.precedence.requiredSlots(policy.slots.filter((slot) => slot.required).length)}</span>
                    <span>{t.precedence.min(policy.min_attachment_count)}</span>
                    <span>{t.precedence.max(policy.max_attachment_count || t.precedence.unbounded)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {stats.inconsistent > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <ClipboardCheck className="mt-0.5 h-4 w-4" />
            {t.inconsistencyWarning(stats.inconsistent)}
          </div>
        ) : null}

        {canWrite ? (
          <>
            <AttachmentPolicyFormDialog open={createOpen} onOpenChange={setCreateOpen} />
            <AttachmentPolicyFormDialog
              policy={editing}
              open={editing !== null}
              onOpenChange={(o) => !o && setEditing(null)}
            />
            <ConfirmDialog
              open={deleting !== null}
              onOpenChange={(o) => !o && setDeleting(null)}
              title={common.confirm.deleteTitle}
              description={common.confirm.deleteDescription(
                deleting ? resolveLocalized(deleting.name, locale) || appliesTo(deleting) : '',
              )}
              confirmLabel={common.delete}
              variant="destructive"
              loading={del.isPending}
              onConfirm={async () => {
                if (deleting) await del.mutateAsync(deleting.id);
              }}
            />
          </>
        ) : null}
      </div>
    </LexAccessGuard>
  );
}
