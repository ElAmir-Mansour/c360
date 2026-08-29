'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, Eye, Layers, Mail, PencilLine, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { StatTile } from '@/components/shared/stat-tile';
import { DataTable } from '@/components/shared/data-table/data-table';
import { SearchInput } from '@/components/shared/forms/search-input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import type { FilterConfig, RowAction } from '@/types/table';
import {
  ELIGIBILITY_RULE_TYPES,
  LEX_ADMIN_ENDPOINTS,
  SERVICE_CHANNELS,
  lexAdminApi,
  type EligibilityRuleType,
  type ServiceCatalogEntry,
  type ServiceChannel,
  type ServiceEligibilityRulePayload,
  type SLATarget,
} from '@/lib/lex/admin';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { useAdminCommonLabels, useServiceCatalogLabels } from '../_lib/admin-labels';
import { AdminDatasetActions } from '../_components/admin-dataset-actions';
import { ServiceFormDialog } from './_components/service-form-dialog';
import { ServiceCatalogAdminPanels } from './_components/service-catalog-admin-panels';
import { MailboxAdminSection } from './_components/mailbox-admin-section';

type ServiceCreatePayload = Parameters<typeof lexAdminApi.createServiceCatalogEntry>[0];

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function ServiceCatalogPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = useServiceCatalogLabels();
  const common = useAdminCommonLabels();
  const qc = useQueryClient();
  const canWrite = hasPermission('lex:catalog:manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceCatalogEntry | null>(null);
  const [cloning, setCloning] = useState<ServiceCatalogEntry | null>(null);
  const [deleting, setDeleting] = useState<ServiceCatalogEntry | null>(null);

  const { tableProps, totalRows, searchValue, setSearch } = useDataTable<ServiceCatalogEntry>({
    queryKey: 'lex-admin-service-catalog',
    fetchFn: (params) => fetchSuitePaginated<ServiceCatalogEntry>(LEX_ADMIN_ENDPOINTS.SERVICE_CATALOG, params),
    defaultPageSize: 25,
    defaultSort: { column: 'code', direction: 'asc' },
    wsTopics: ['lex.service-catalog'],
  });

  const rows = tableProps.data;
  const allServicesQuery = useQuery({
    queryKey: ['lex-admin-service-catalog', 'all-options'],
    queryFn: () => lexAdminApi.listServiceCatalog({ page: 1, per_page: 500, sort: 'code', order: 'asc' }),
  });
  const allServices = allServicesQuery.data?.data ?? rows;

  const slaTargetsQuery = useQuery({
    queryKey: ['lex-admin-sla-targets', 'service-catalog-health'],
    queryFn: () => lexAdminApi.listSLATargets({ page: 1, per_page: 500, sort: 'service_code', order: 'asc' }),
  });
  const slaTargets = slaTargetsQuery.data?.data ?? [];

  const orgEntitiesQuery = useQuery({
    queryKey: ['lex-admin-org-entities', 'service-catalog-form-options'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 500, sort: 'code', order: 'asc' }),
    enabled: canWrite,
  });
  const orgEntities = orgEntitiesQuery.data?.data ?? [];

  // Shares the `lex-admin-intake-mailboxes` query-key prefix with the mailbox
  // admin section's mutations, so create/edit/rotate/delete refresh both this
  // health detector and the section table in one invalidation.
  const mailboxesQuery = useQuery({
    queryKey: ['lex-admin-intake-mailboxes', 'service-catalog'],
    queryFn: () => lexAdminApi.listIntakeMailboxes({ page: 1, per_page: 500, sort: 'address', order: 'asc' }),
  });
  const mailboxes = mailboxesQuery.data?.data ?? [];

  const stats = useMemo(() => {
    let active = 0;
    let email = 0;
    for (const r of rows) {
      if (r.active) active += 1;
      if (r.channel === 'email' || r.channel === 'both') email += 1;
    }
    return { total: totalRows, active, email };
  }, [rows, totalRows]);
  const activeShare = percent(stats.active, stats.total);
  const emailShare = percent(stats.email, stats.total);
  const kpiCopy =
    locale === 'ar'
      ? {
          currentCatalog: 'الكتالوج الحالي',
          serviceShare: 'النسبة من الكتالوج',
          services: 'خدمات',
        }
      : {
          currentCatalog: 'Current catalog',
          serviceShare: 'Share of catalog',
          services: 'Services',
        };

  const del = useMutation({
    mutationFn: (id: string) => lexAdminApi.deleteServiceCatalogEntry(id),
    onSuccess: async () => {
      showSuccess(common.toast.deleted);
      await qc.invalidateQueries({ queryKey: ['lex-admin-service-catalog'] });
      setDeleting(null);
    },
    onError: showApiError,
  });

  const publish = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      lexAdminApi.updateServiceCatalogEntry(id, { active }),
    onSuccess: async (_, variables) => {
      showSuccess(variables.active ? t.toast.published : t.toast.movedToDraft);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['lex-admin-service-catalog'] }),
        qc.invalidateQueries({ queryKey: ['lex-admin-service-catalog', 'all-options'] }),
      ]);
    },
    onError: showApiError,
  });

  const importRows = useMutation({
    mutationFn: async (records: Record<string, unknown>[]) => {
      for (const record of records) {
        const payload = serviceImportPayload(record);
        await lexAdminApi.createServiceCatalogEntry(payload);
      }
    },
    onSuccess: async () => {
      showSuccess(t.toast.imported);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['lex-admin-service-catalog'] }),
        qc.invalidateQueries({ queryKey: ['lex-admin-service-catalog', 'all-options'] }),
      ]);
    },
    onError: showApiError,
  });

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'active',
        label: t.columns.status,
        type: 'select',
        options: [
          { label: common.active, value: 'true' },
          { label: common.inactive, value: 'false' },
        ],
      },
      {
        key: 'channel',
        label: t.columns.channel,
        type: 'select',
        options: SERVICE_CHANNELS.map((channel) => ({
          label: t.channels[channel],
          value: channel,
        })),
      },
      {
        key: 'request_type',
        label: t.columns.requestType,
        type: 'text',
        placeholder: 'contract_review',
      },
    ],
    [common.active, common.inactive, t.channels, t.columns.channel, t.columns.requestType, t.columns.status],
  );

  const requestTypeOptions = useMemo(
    () => Array.from(new Set(allServices.map((service) => service.request_type).filter(Boolean))).sort(),
    [allServices],
  );

  const exportRows = useMemo(
    () =>
      rows.map((row) => ({
        code: row.code,
        request_type: row.request_type,
        name_en: row.name.en,
        name_ar: row.name.ar,
        channel: row.channel,
        intake_email: row.intake_email ?? '',
        active: row.active,
        requester_approval_required: row.requester_approval_required,
        provider_approval_required: row.provider_approval_required,
        available_to: row.available_to.join('|'),
        eligibility_rules: JSON.stringify(row.eligibility_rules ?? []),
        updated_at: row.updated_at,
      })),
    [rows],
  );

  const datasetFilters = useMemo(
    () => ({ ...(tableProps.activeFilters ?? {}), search: searchValue }),
    [searchValue, tableProps.activeFilters],
  );

  const columns: ColumnDef<ServiceCatalogEntry>[] = [
    {
      id: 'name',
      header: t.columns.name,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{resolveLocalized(row.original.name, locale) || row.original.code}</p>
          <p className="text-xs text-muted-foreground">{row.original.request_type}</p>
        </div>
      ),
    },
    {
      id: 'code',
      accessorKey: 'code',
      header: t.columns.code,
      enableSorting: true,
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>,
    },
    {
      id: 'channel',
      accessorKey: 'channel',
      header: t.columns.channel,
      cell: ({ row }) => <Badge variant="secondary">{t.channels[row.original.channel] ?? row.original.channel}</Badge>,
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

  const rowActions: RowAction<ServiceCatalogEntry>[] = [
    {
      label: t.rowActions.details,
      icon: Eye,
      onClick: (row) => router.push(`/lex/admin/service-catalog/${row.id}`),
    },
    ...(canWrite
      ? [
          { label: common.edit, icon: PencilLine, onClick: (row: ServiceCatalogEntry) => setEditing(row) },
          { label: t.rowActions.clone, icon: Copy, onClick: (row: ServiceCatalogEntry) => setCloning(row) },
          {
            label: t.rowActions.publish,
            icon: Power,
            hidden: (row: ServiceCatalogEntry) => row.active,
            disabled: () => publish.isPending,
            onClick: (row: ServiceCatalogEntry) => publish.mutate({ id: row.id, active: true }),
          },
          {
            label: t.rowActions.moveToDraft,
            icon: PowerOff,
            hidden: (row: ServiceCatalogEntry) => !row.active,
            disabled: () => publish.isPending,
            onClick: (row: ServiceCatalogEntry) => publish.mutate({ id: row.id, active: false }),
          },
          {
            label: common.delete,
            icon: Trash2,
            variant: 'destructive' as const,
            onClick: (row: ServiceCatalogEntry) => setDeleting(row),
          },
        ]
      : []),
  ];

  return (
    <LexAccessGuard routeKey="/lex/admin/service-catalog" resourceName={t.pageTitle}>
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

        <div className="service-catalog-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label={t.stats.total}
            value={stats.total}
            themeClass="kpi-theme-primary"
            icon={Layers}
            loading={tableProps.isLoading}
            detail={kpiCopy.currentCatalog}
            detailValue={kpiCopy.services}
            size="md"
            appearance="operational"
            className="service-catalog-kpi-card"
            href="/lex/admin/service-catalog"
          />
          <StatTile
            label={t.stats.active}
            value={stats.active}
            themeClass="kpi-theme-emerald"
            icon={CheckCircle2}
            loading={tableProps.isLoading}
            progress={activeShare}
            progressLabel={kpiCopy.serviceShare}
            detail={kpiCopy.currentCatalog}
            detailValue={`${activeShare}%`}
            size="md"
            appearance="operational"
            className="service-catalog-kpi-card"
            href="/lex/admin/service-catalog?active=true"
          />
          <StatTile
            label={t.stats.email}
            value={stats.email}
            themeClass="kpi-theme-amber"
            icon={Mail}
            loading={tableProps.isLoading}
            progress={emailShare}
            progressLabel={kpiCopy.serviceShare}
            detail={kpiCopy.currentCatalog}
            detailValue={`${emailShare}%`}
            size="md"
            appearance="operational"
            className="service-catalog-kpi-card"
            href="/lex/admin/service-catalog?channel=email&channel=both"
          />
        </div>

        <ServiceCatalogAdminPanels
          services={allServices}
          slaTargets={slaTargets as SLATarget[]}
          mailboxes={mailboxes}
          locale={locale}
          loading={allServicesQuery.isLoading || slaTargetsQuery.isLoading || mailboxesQuery.isLoading}
        />

        <MailboxAdminSection
          mailboxes={mailboxes}
          services={allServices}
          orgEntities={orgEntities}
          requestTypeOptions={requestTypeOptions}
          canWrite={canWrite}
          locale={locale}
          loading={mailboxesQuery.isLoading}
        />

        <AdminDatasetActions
          namespace="lex-admin-service-catalog"
          filename="lex-service-catalog"
          rows={exportRows}
          activeFilters={datasetFilters}
          labels={{
            savedView: 'Save service view',
            importTitle: 'Import services',
            importDescription: 'Preview CSV or JSON rows before creating service catalog entries.',
          }}
          onImportRows={canWrite ? (records) => importRows.mutateAsync(records) : undefined}
        />

        <DataTable
          {...tableProps}
          columns={columns}
          filters={filters}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={common.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
          emptyState={{ icon: Layers, title: t.emptyTitle, description: t.emptyDescription }}
        />

        {canWrite ? (
          <>
            <ServiceFormDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              requestTypeOptions={requestTypeOptions}
              orgEntities={orgEntities}
            />
            <ServiceFormDialog
              service={editing}
              mode="edit"
              open={editing !== null}
              onOpenChange={(o) => !o && setEditing(null)}
              requestTypeOptions={requestTypeOptions}
              orgEntities={orgEntities}
            />
            <ServiceFormDialog
              service={cloning}
              mode="clone"
              open={cloning !== null}
              onOpenChange={(o) => !o && setCloning(null)}
              requestTypeOptions={requestTypeOptions}
              orgEntities={orgEntities}
            />
            <ConfirmDialog
              open={deleting !== null}
              onOpenChange={(o) => !o && setDeleting(null)}
              title={common.confirm.deleteTitle}
              description={common.confirm.deleteDescription(
                deleting ? resolveLocalized(deleting.name, locale) || deleting.code : '',
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

function stringValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function boolValue(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function listValue(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string')
    return value
      .split(/[|,;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

function localizedValue(record: Record<string, unknown>, key: string): { ar: string; en: string } {
  const value = record[key];
  const fromObject =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    ar: stringValue(record, `${key}_ar`) || (typeof fromObject.ar === 'string' ? fromObject.ar : ''),
    en:
      stringValue(record, `${key}_en`) ||
      (typeof fromObject.en === 'string' ? fromObject.en : stringValue(record, key)),
  };
}

function eligibilityRulesValue(record: Record<string, unknown>): ServiceEligibilityRulePayload[] {
  const value = record.eligibility_rules;
  const parsed = typeof value === 'string' && value.trim().startsWith('[') ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item): ServiceEligibilityRulePayload | null => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const ruleType = String(row.rule_type ?? '').trim() as EligibilityRuleType;
      if (!ELIGIBILITY_RULE_TYPES.includes(ruleType)) return null;
      return { rule_type: ruleType, value: String(row.value ?? '').trim() };
    })
    .filter((item): item is ServiceEligibilityRulePayload => item !== null);
}

function channelValue(record: Record<string, unknown>): ServiceChannel {
  const raw = stringValue(record, 'channel') as ServiceChannel;
  return SERVICE_CHANNELS.includes(raw) ? raw : 'platform';
}

function serviceImportPayload(record: Record<string, unknown>): ServiceCreatePayload {
  const code = stringValue(record, 'code');
  const requestType = stringValue(record, 'request_type');
  const name = localizedValue(record, 'name');
  if (!code || !requestType || (!name.ar && !name.en)) {
    throw new Error('Each service row must include code, request_type, and name/name_en/name_ar.');
  }
  return {
    code,
    request_type: requestType,
    name,
    description: localizedValue(record, 'description'),
    channel: channelValue(record),
    intake_email: stringValue(record, 'intake_email') || null,
    requester_approval_required: boolValue(record, 'requester_approval_required', false),
    provider_approval_required: boolValue(record, 'provider_approval_required', false),
    active: boolValue(record, 'active', true),
    available_to: listValue(record, 'available_to'),
    eligibility_rules: eligibilityRulesValue(record),
  };
}
