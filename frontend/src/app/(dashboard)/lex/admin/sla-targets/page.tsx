'use client';

import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, PencilLine, Play, Plus, Send, Timer, Trash2, Zap } from 'lucide-react';
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
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import { apiPost } from '@/lib/api';
import type { BulkAction, FilterConfig, RowAction } from '@/types/table';
import {
  lexAdminApi,
  LEX_ADMIN_ENDPOINTS,
  type OrgEntity,
  type ServiceCatalogEntry,
  type SLATarget,
} from '@/lib/lex/admin';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { AdminDatasetActions } from '../_components/admin-dataset-actions';
import { addWorkingDays } from '../_lib/admin-feature-utils';
import { useAdminCommonLabels, useSLALabels } from '../_lib/admin-labels';
import { SLAClockMonitor } from './_components/sla-clock-monitor';
import { SLATargetFormDialog } from './_components/sla-target-form-dialog';

const slaFilters: FilterConfig[] = [
  {
    key: 'active',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'Active', value: 'true' },
      { label: 'Inactive', value: 'false' },
    ],
  },
  {
    key: 'priority',
    label: 'Priority',
    type: 'select',
    options: [
      { label: 'Urgent', value: 'urgent' },
      { label: 'Normal', value: 'normal' },
    ],
  },
  { key: 'service_code', label: 'Service code', type: 'text', placeholder: 'CONSULTATION' },
];

function pairKey(target: Pick<SLATarget, 'service_code' | 'priority'>): string {
  return `${target.service_code}:${target.priority}`;
}

function formatPreviewDate(date: Date, includeTime = false): string {
  return new Intl.DateTimeFormat(
    undefined,
    includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
  ).format(date);
}

function duePreview(days: number): string {
  return formatPreviewDate(addWorkingDays(new Date(), days));
}

function ackDuePreview(target: Pick<SLATarget, 'ack_window_unit' | 'ack_window_value'>): string {
  const now = new Date();
  if (target.ack_window_unit === 'working_hours') {
    const due = new Date(now);
    due.setHours(due.getHours() + target.ack_window_value);
    return formatPreviewDate(due, true);
  }
  return formatPreviewDate(addWorkingDays(now, target.ack_window_value));
}

function escalationDuePreview(days: number): string {
  return formatPreviewDate(addWorkingDays(new Date(), days));
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function SLATargetsPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = useSLALabels();
  const common = useAdminCommonLabels();
  const qc = useQueryClient();
  const canWrite = hasPermission('lex:sla:manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SLATarget | null>(null);
  const [deleting, setDeleting] = useState<SLATarget | null>(null);
  const [simService, setSimService] = useState('');
  const [dispatching, setDispatching] = useState(false);

  const { tableProps, totalRows, searchValue, setSearch, activeFilters } = useDataTable<SLATarget>({
    queryKey: 'lex-admin-sla-targets',
    fetchFn: (params) => fetchSuitePaginated<SLATarget>(LEX_ADMIN_ENDPOINTS.SLA_TARGETS, params),
    defaultPageSize: 25,
    defaultSort: { column: 'service_code', direction: 'asc' },
    wsTopics: ['lex.sla-targets'],
  });

  const targets = tableProps.data;
  const servicesQuery = useQuery({
    queryKey: ['lex-admin-sla-targets', 'service-options'],
    queryFn: () => lexAdminApi.listServiceCatalog({ page: 1, per_page: 500, sort: 'code', order: 'asc' }),
  });
  const orgsQuery = useQuery({
    queryKey: ['lex-admin-sla-targets', 'org-preview'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 500, sort: 'code', order: 'asc' }),
  });
  const services = servicesQuery.data?.data ?? [];
  const orgs = useMemo(() => orgsQuery.data?.data ?? [], [orgsQuery.data]);
  const stats = useMemo(() => {
    let active = 0;
    let urgent = 0;
    for (const row of targets) {
      if (row.active) active += 1;
      if (row.priority === 'urgent') urgent += 1;
    }
    return { total: totalRows, active, urgent };
  }, [targets, totalRows]);
  const activeShare = percent(stats.active, stats.total);
  const urgentShare = percent(stats.urgent, stats.total);
  const kpiCopy =
    locale === 'ar'
      ? {
          total: 'كل أهداف اتفاقية مستوى الخدمة المطابقة للفلاتر الحالية.',
          active: 'الأهداف المنشورة التي يمكن استخدامها في حسابات المواعيد.',
          urgent: 'أهداف الأولوية العاجلة ضمن الكتالوج الحالي.',
          currentCatalog: 'الكتالوج الحالي',
          activeShare: 'نشط من إجمالي الأهداف',
          urgentShare: 'عاجل من إجمالي الأهداف',
          policies: 'الأهداف',
        }
      : {
          total: 'All SLA targets matching the current filters.',
          active: 'Published targets available for due-date calculations.',
          urgent: 'Urgent-priority targets in the current catalog.',
          currentCatalog: 'Current catalog',
          activeShare: 'Active share of all targets',
          urgentShare: 'Urgent share of all targets',
          policies: 'Targets',
        };

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const target of targets.filter((row) => row.active)) {
      counts.set(pairKey(target), (counts.get(pairKey(target)) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [targets]);

  const matrix = useMemo(() => {
    const byService = new Map<string, Partial<Record<SLATarget['priority'], SLATarget>>>();
    for (const target of targets) {
      byService.set(target.service_code, { ...(byService.get(target.service_code) ?? {}), [target.priority]: target });
    }
    return [...byService.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [targets]);

  const exportRows = useMemo<Record<string, unknown>[]>(
    () =>
      targets.map((target) => ({
        id: target.id,
        service_code: target.service_code,
        priority: target.priority,
        turnaround_working_days: target.turnaround_working_days,
        ack_window_value: target.ack_window_value,
        ack_window_unit: target.ack_window_unit,
        escalation_l1_days: target.escalation_l1_days,
        escalation_l2_days: target.escalation_l2_days,
        escalation_l3_days: target.escalation_l3_days,
        active: target.active,
        created_at: target.created_at,
        updated_at: target.updated_at,
      })),
    [targets],
  );

  const simTargets = useMemo(
    () => targets.filter((target) => !simService || target.service_code === simService),
    [simService, targets],
  );

  const roleCoverage = useMemo(() => {
    const needed = ['section_supervisor', 'department_manager', 'shared_services_manager'];
    const roleKeys = new Set(orgs.flatMap((org) => (org.roles ?? []).map((role) => role.role_key)));
    return needed.map((role) => ({ role, covered: roleKeys.has(role as never) }));
  }, [orgs]);

  const del = useMutation({
    mutationFn: (id: string) => lexAdminApi.deleteSLATarget(id),
    onSuccess: async () => {
      showSuccess(common.toast.deleted);
      await qc.invalidateQueries({ queryKey: ['lex-admin-sla-targets'] });
      setDeleting(null);
    },
    onError: showApiError,
  });

  const bulkActions: BulkAction[] = [
    {
      label: t.bulk.activate,
      icon: CheckCircle2,
      onClick: async (ids) => {
        await Promise.all(ids.map((id) => lexAdminApi.updateSLATarget(id, { active: true })));
        showSuccess(t.toast.activated);
        await qc.invalidateQueries({ queryKey: ['lex-admin-sla-targets'] });
      },
    },
    {
      label: t.bulk.deactivate,
      icon: Trash2,
      onClick: async (ids) => {
        await Promise.all(ids.map((id) => lexAdminApi.updateSLATarget(id, { active: false })));
        showSuccess(t.toast.deactivated);
        await qc.invalidateQueries({ queryKey: ['lex-admin-sla-targets'] });
      },
    },
    {
      label: t.bulk.delete,
      icon: Trash2,
      variant: 'destructive',
      onClick: async (ids) => {
        await Promise.all(ids.map((id) => lexAdminApi.deleteSLATarget(id)));
        showSuccess(t.toast.deleted);
        await qc.invalidateQueries({ queryKey: ['lex-admin-sla-targets'] });
      },
    },
  ];

  const importRows = async (rows: Record<string, unknown>[]) => {
    await Promise.all(
      rows.map((row) =>
        lexAdminApi.createSLATarget({
          service_code: String(row.service_code ?? '')
            .trim()
            .toUpperCase(),
          priority: row.priority === 'urgent' ? 'urgent' : 'normal',
          turnaround_working_days: Number(row.turnaround_working_days ?? 1),
          ack_window_value: Number(row.ack_window_value ?? 1),
          ack_window_unit: row.ack_window_unit === 'working_hours' ? 'working_hours' : 'working_days',
          escalation_l1_days: Number(row.escalation_l1_days ?? 0),
          escalation_l2_days: Number(row.escalation_l2_days ?? 0),
          escalation_l3_days: Number(row.escalation_l3_days ?? 0),
          active: row.active !== false && row.active !== 'false',
        }),
      ),
    );
    await qc.invalidateQueries({ queryKey: ['lex-admin-sla-targets'] });
  };

  const columns: ColumnDef<SLATarget>[] = [
    selectColumn<SLATarget>(),
    {
      id: 'service_code',
      accessorKey: 'service_code',
      header: t.columns.service,
      enableSorting: true,
      cell: ({ row }) => <span className="font-medium">{row.original.service_code}</span>,
    },
    {
      id: 'priority',
      accessorKey: 'priority',
      header: t.columns.priority,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={row.original.priority === 'urgent' ? 'destructive' : 'secondary'}>
            {t.priorities[row.original.priority] ?? row.original.priority}
          </Badge>
          {duplicateKeys.has(pairKey(row.original)) ? (
            <Badge variant="destructive">
              <AlertTriangle className="me-1 h-3 w-3" />
              {t.duplicate}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: 'turnaround',
      header: t.columns.turnaround,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {t.daysSuffix(row.original.turnaround_working_days)}
          <span className="ms-1 text-xs">({duePreview(row.original.turnaround_working_days)})</span>
        </span>
      ),
    },
    {
      id: 'ack',
      header: t.columns.ack,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {t.ackValue(
            row.original.ack_window_value,
            t.ackUnits[row.original.ack_window_unit] ?? row.original.ack_window_unit,
          )}
        </span>
      ),
    },
    {
      id: 'escalation',
      header: t.columns.escalation,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {t.escalationValue(
            row.original.escalation_l1_days,
            row.original.escalation_l2_days,
            row.original.escalation_l3_days,
          )}
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

  const rowActions: RowAction<SLATarget>[] = canWrite
    ? [
        { label: common.edit, icon: PencilLine, onClick: (row) => setEditing(row) },
        { label: common.delete, icon: Trash2, variant: 'destructive', onClick: (row) => setDeleting(row) },
      ]
    : [];

  const dispatchOutbox = async () => {
    setDispatching(true);
    try {
      await apiPost('/api/v1/lex/sla/outbox/dispatch', {});
      showSuccess(t.toast.dispatched);
    } catch (error) {
      showApiError(error);
    } finally {
      setDispatching(false);
    }
  };

  return (
    <LexAccessGuard routeKey="/lex/admin/sla-targets" resourceName={t.pageTitle}>
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

        <div className="sla-target-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile
            label={t.stats.total}
            value={stats.total}
            themeClass="kpi-theme-primary"
            icon={Timer}
            loading={tableProps.isLoading}
            detail={kpiCopy.currentCatalog}
            detailValue={kpiCopy.policies}
            size="md"
            appearance="operational"
            className="sla-target-kpi-card"
            href="/lex/admin/sla-targets"
          />
          <StatTile
            label={t.stats.active}
            value={stats.active}
            themeClass="kpi-theme-emerald"
            icon={CheckCircle2}
            loading={tableProps.isLoading}
            progress={activeShare}
            progressLabel={kpiCopy.activeShare}
            detail={kpiCopy.currentCatalog}
            detailValue={`${activeShare}%`}
            size="md"
            appearance="operational"
            className="sla-target-kpi-card"
            href="/lex/admin/sla-targets?active=true"
          />
          <StatTile
            label={t.stats.urgent}
            value={stats.urgent}
            themeClass="kpi-theme-red"
            icon={Zap}
            loading={tableProps.isLoading}
            progress={urgentShare}
            progressLabel={kpiCopy.urgentShare}
            detail={kpiCopy.currentCatalog}
            detailValue={`${urgentShare}%`}
            size="md"
            appearance="operational"
            className="sla-target-kpi-card"
            href="/lex/admin/sla-targets?priority=urgent"
          />
        </div>

        <AdminDatasetActions
          namespace="lex-admin-sla-targets"
          filename="lex-sla-targets"
          rows={exportRows}
          activeFilters={activeFilters}
          labels={{ savedView: t.savedView, importTitle: t.importTitle }}
          onImportRows={canWrite ? importRows : undefined}
          extraActions={
            canWrite ? (
              <Button type="button" variant="outline" size="sm" onClick={dispatchOutbox} disabled={dispatching}>
                <Send className="me-1.5 h-3.5 w-3.5" />
                {t.dispatchOutbox}
              </Button>
            ) : undefined
          }
        />

        <div className="grid gap-4 xl:grid-cols-3">
          <SectionCard title={t.matrixPanel.title} description={t.matrixPanel.description}>
            <div className="space-y-2">
              {matrix.slice(0, 8).map(([service, priorities]) => (
                <div
                  key={service}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{service}</span>
                  <Badge variant={priorities.normal ? 'secondary' : 'outline'}>
                    {t.matrixPanel.normal(priorities.normal?.turnaround_working_days ?? t.matrixPanel.missing)}
                  </Badge>
                  <Badge variant={priorities.urgent ? 'destructive' : 'outline'}>
                    {t.matrixPanel.urgent(priorities.urgent?.turnaround_working_days ?? t.matrixPanel.missing)}
                  </Badge>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title={t.simulatorPanel.title} description={t.simulatorPanel.description}>
            <div className="space-y-3">
              <Input
                value={simService}
                onChange={(e) => setSimService(e.target.value.toUpperCase())}
                placeholder={t.simulatorPanel.filterPlaceholder}
              />
              {simTargets.slice(0, 4).map((target) => (
                <div key={target.id} className="space-y-2 rounded-md border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {target.service_code} · {target.priority}
                    </span>
                    <Badge variant="secondary">
                      {t.simulatorPanel.due(duePreview(target.turnaround_working_days))}
                    </Badge>
                  </div>
                  <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>
                      {t.simulatorPanel.ack(
                        target.ack_window_value,
                        t.ackUnits[target.ack_window_unit] ?? target.ack_window_unit,
                        ackDuePreview(target),
                      )}
                    </span>
                    <span>
                      {t.simulatorPanel.escalation(
                        escalationDuePreview(target.escalation_l1_days),
                        escalationDuePreview(target.escalation_l2_days),
                        escalationDuePreview(target.escalation_l3_days),
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title={t.readinessPanel.title} description={t.readinessPanel.description}>
            <div className="space-y-2">
              {roleCoverage.map((item) => (
                <div key={item.role} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{item.role}</span>
                  <Badge variant={item.covered ? 'default' : 'destructive'}>
                    {item.covered ? t.readinessPanel.covered : t.readinessPanel.missing}
                  </Badge>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SLAClockMonitor canWrite={canWrite} />

        <DataTable
          {...tableProps}
          columns={columns}
          filters={slaFilters}
          getRowId={(row) => row.id}
          enableSelection={canWrite}
          bulkActions={canWrite ? bulkActions : undefined}
          rowActions={canWrite ? rowActions : undefined}
          enableDensityToggle
          enableColumnToggle
          stickyHeader
          searchSlot={
            <SearchInput
              value={searchValue}
              onChange={setSearch}
              placeholder={common.searchPlaceholder}
              loading={tableProps.isLoading}
            />
          }
          emptyState={{ icon: Timer, title: t.emptyTitle, description: t.emptyDescription }}
        />

        {canWrite ? (
          <>
            <SLATargetFormDialog
              services={services as ServiceCatalogEntry[]}
              open={createOpen}
              onOpenChange={setCreateOpen}
            />
            <SLATargetFormDialog
              target={editing}
              services={services as ServiceCatalogEntry[]}
              open={editing !== null}
              onOpenChange={(o) => !o && setEditing(null)}
            />
            <ConfirmDialog
              open={deleting !== null}
              onOpenChange={(o) => !o && setDeleting(null)}
              title={common.confirm.deleteTitle}
              description={common.confirm.deleteDescription(
                deleting ? `${deleting.service_code} · ${t.priorities[deleting.priority]}` : '',
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
