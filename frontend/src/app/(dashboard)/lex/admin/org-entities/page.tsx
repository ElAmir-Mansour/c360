'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, MoveRight, Network, PencilLine, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { StatTile } from '@/components/shared/stat-tile';
import { DataTable } from '@/components/shared/data-table/data-table';
import { selectColumn } from '@/components/shared/data-table/columns/common-columns';
import { SearchInput } from '@/components/shared/forms/search-input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import type { BulkAction, FilterConfig, RowAction } from '@/types/table';
import { ESCALATION_ROLE_KEYS, lexAdminApi, LEX_ADMIN_ENDPOINTS, type OrgEntity } from '@/lib/lex/admin';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { AdminDatasetActions } from '../_components/admin-dataset-actions';
import { writeSnapshot } from '../_lib/admin-feature-utils';
import { useAdminCommonLabels, useOrgLabels } from '../_lib/admin-labels';
import { OrgEntityFormDialog } from './_components/org-entity-form-dialog';
import { OrgBulkDeleteImpactDialog, OrgDeleteImpactDialog } from './_components/org-delete-impact-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import OrgChartView from './_components/org-chart/org-chart-view';
import EscalationCoverageMatrix from './_components/escalation-coverage/escalation-coverage-matrix';
import EscalationWhatIfSimulator from './_components/escalation-whatif/escalation-whatif-simulator';
import ResponsibilityDirectory from './_components/people/responsibility-directory';
import OrgHealthPanel from './_components/org-health/org-health-panel';
import OrgLocalizationQa from './_components/localization-qa/org-localization-qa';
import PlatformSyncView from './_components/platform-sync/platform-sync-view';
import OrgAuditTimeline from './_components/org-audit/org-audit-timeline';
import OrgMoveDialog from './_components/reorganize/org-move-dialog';
import { OrgStructureImportDialog } from './_components/org-structure-import-dialog';

type OrgEntitySnapshot = OrgEntity & { snapshot_at?: string; snapshot_reason?: string };

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function writeOrgSnapshot(entity: OrgEntity | null | undefined, reason: string): void {
  if (!entity) return;
  try {
    writeSnapshot<OrgEntitySnapshot>('org-entities', entity.id, {
      ...entity,
      snapshot_at: new Date().toISOString(),
      snapshot_reason: reason,
    });
  } catch {
    // Local snapshots are best-effort; backend mutations remain authoritative.
  }
}

export default function OrgEntitiesPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = useOrgLabels();
  const common = useAdminCommonLabels();
  const qc = useQueryClient();
  const canWrite = hasPermission('lex:security:manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OrgEntity | null>(null);
  const [moving, setMoving] = useState<OrgEntity | null>(null);
  const [deleting, setDeleting] = useState<OrgEntity | null>(null);
  const [bulkDeletingIds, setBulkDeletingIds] = useState<string[]>([]);

  const { tableProps, totalRows, searchValue, setSearch, activeFilters } = useDataTable<OrgEntity>({
    queryKey: 'lex-admin-org-entities',
    fetchFn: (params) => fetchSuitePaginated<OrgEntity>(LEX_ADMIN_ENDPOINTS.ORG_ENTITIES, params),
    defaultPageSize: 25,
    defaultSort: { column: 'code', direction: 'asc' },
    wsTopics: ['lex.org-entities'],
  });

  // Parent options for the create/edit dialog (wide list, lightweight).
  const parentsQuery = useQuery({
    queryKey: ['lex-admin-org-entities', 'parent-options'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 200 }),
    enabled: canWrite,
  });
  const parents = parentsQuery.data?.data ?? [];

  const rows = tableProps.data;
  const loadedOrgRows = parents.length ? parents : rows;
  const orgFilters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'active',
        label: t.filters.status,
        type: 'select',
        options: [
          { label: t.filters.active, value: 'true' },
          { label: t.filters.inactive, value: 'false' },
        ],
      },
      {
        key: 'entity_type',
        label: t.filters.entityType,
        type: 'select',
        options: Object.entries(t.entityTypes).map(([value, label]) => ({ value, label })),
      },
      {
        key: 'parent_id',
        label: t.filters.parent,
        type: 'select',
        options: loadedOrgRows.map((entity) => ({
          value: entity.id,
          label: `${entity.code} — ${resolveLocalized(entity.name, locale) || entity.code}`,
        })),
      },
    ],
    [loadedOrgRows, locale, t.entityTypes, t.filters],
  );
  const bulkDeletingEntities = useMemo(
    () => rows.filter((entity) => bulkDeletingIds.includes(entity.id)),
    [bulkDeletingIds, rows],
  );
  const exportRows = useMemo<Record<string, unknown>[]>(
    () =>
      rows.map((entity) => ({
        id: entity.id,
        parent_id: entity.parent_id ?? '',
        entity_type: entity.entity_type,
        code: entity.code,
        name_en: entity.name?.en ?? '',
        name_ar: entity.name?.ar ?? '',
        platform_org_unit_id: entity.platform_org_unit_id ?? '',
        active: entity.active,
        roles: entity.roles,
        created_at: entity.created_at,
        updated_at: entity.updated_at,
      })),
    [rows],
  );
  const stats = useMemo(() => {
    let active = 0;
    let departments = 0;
    for (const r of rows) {
      if (r.active) active += 1;
      if (r.entity_type === 'department') departments += 1;
    }
    return { total: totalRows, active, departments };
  }, [rows, totalRows]);
  const activeShare = percent(stats.active, stats.total);
  const departmentShare = percent(stats.departments, stats.total);
  const kpiCopy =
    locale === 'ar'
      ? {
          currentRegistry: 'السجل الحالي',
          orgShare: 'النسبة من الهيكل',
          entities: 'كيانات',
        }
      : {
          currentRegistry: 'Current registry',
          orgShare: 'Share of org structure',
          entities: 'Entities',
        };

  const del = useMutation({
    mutationFn: (id: string) => lexAdminApi.deleteOrgEntity(id),
    onSuccess: async () => {
      showSuccess(common.toast.deleted);
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-entities'] });
      setDeleting(null);
    },
    onError: showApiError,
  });

  const bulkDelete = useMutation({
    mutationFn: async (entities: OrgEntity[]) => {
      entities.forEach((entity) => writeOrgSnapshot(entity, 'before_bulk_delete'));
      await Promise.all(entities.map((entity) => lexAdminApi.deleteOrgEntity(entity.id)));
    },
    onSuccess: async () => {
      showSuccess(t.toast.deleted);
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-entities'] });
      setBulkDeletingIds([]);
    },
    onError: showApiError,
  });

  const bulkActions: BulkAction[] = [
    {
      label: t.bulk.activate,
      icon: CheckCircle2,
      onClick: async (ids) => {
        ids.forEach((id) =>
          writeOrgSnapshot(
            rows.find((entity) => entity.id === id),
            'before_bulk_activate',
          ),
        );
        await Promise.all(ids.map((id) => lexAdminApi.updateOrgEntity(id, { active: true })));
        showSuccess(t.toast.activated);
        await qc.invalidateQueries({ queryKey: ['lex-admin-org-entities'] });
      },
    },
    {
      label: t.bulk.deactivate,
      icon: Trash2,
      onClick: async (ids) => {
        ids.forEach((id) =>
          writeOrgSnapshot(
            rows.find((entity) => entity.id === id),
            'before_bulk_deactivate',
          ),
        );
        await Promise.all(ids.map((id) => lexAdminApi.updateOrgEntity(id, { active: false })));
        showSuccess(t.toast.deactivated);
        await qc.invalidateQueries({ queryKey: ['lex-admin-org-entities'] });
      },
    },
    {
      label: t.bulk.delete,
      icon: Trash2,
      variant: 'destructive',
      onClick: async (ids) => {
        setBulkDeletingIds(ids);
      },
    },
  ];

  const columns: ColumnDef<OrgEntity>[] = [
    selectColumn<OrgEntity>(),
    {
      id: 'name',
      header: t.columns.name,
      cell: ({ row }) => (
        <Link href={`/lex/admin/org-entities/${row.original.id}`} className="font-medium hover:underline">
          {resolveLocalized(row.original.name, locale) || row.original.code}
        </Link>
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
      id: 'type',
      accessorKey: 'entity_type',
      header: t.columns.type,
      cell: ({ row }) => (
        <Badge variant="secondary">{t.entityTypes[row.original.entity_type] ?? row.original.entity_type}</Badge>
      ),
    },
    {
      id: 'roles',
      header: t.columns.roles,
      cell: ({ row }) => {
        const roleKeys = new Set((row.original.roles ?? []).map((role) => role.role_key));
        const missing = ESCALATION_ROLE_KEYS.filter((role) => !roleKeys.has(role));
        return (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-sm text-muted-foreground">{t.rolesCount(row.original.roles?.length ?? 0)}</span>
            {missing.length ? (
              <Link
                href={`/lex/admin/org-entities/${row.original.id}?focus=escalation-roles`}
                title={t.escalationHint.chipTooltip(
                  missing.map((role) => t.roleKeys[role] ?? role).join(locale === 'ar' ? '، ' : ', '),
                )}
                aria-label={t.escalationHint.chipTooltip(
                  missing.map((role) => t.roleKeys[role] ?? role).join(locale === 'ar' ? '، ' : ', '),
                )}
              >
                <Badge
                  variant="outline"
                  className="cursor-pointer border-warning-300/50 bg-warning-50 text-warning-700 transition-colors hover:bg-warning-300/30 dark:border-warning-700/50 dark:bg-warning-700/10 dark:text-warning-300 dark:hover:bg-warning-700/25"
                >
                  {t.escalationMissing(missing.length)}
                </Badge>
              </Link>
            ) : (
              <Badge variant="secondary">{t.escalationReady}</Badge>
            )}
          </div>
        );
      },
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

  const rowActions: RowAction<OrgEntity>[] = [
    { label: common.edit, icon: PencilLine, onClick: (row) => setEditing(row) },
    { label: locale === 'ar' ? 'نقل' : 'Move', icon: MoveRight, onClick: (row) => setMoving(row) },
    { label: common.delete, icon: Trash2, variant: 'destructive', onClick: (row) => setDeleting(row) },
  ];

  return (
    <LexAccessGuard routeKey="/lex/admin/org-entities" resourceName={t.pageTitle}>
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

        <div className="org-entity-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            label={t.stats.total}
            value={stats.total}
            themeClass="kpi-theme-primary"
            icon={Network}
            loading={tableProps.isLoading}
            detail={kpiCopy.currentRegistry}
            detailValue={kpiCopy.entities}
            size="md"
            appearance="operational"
            className="org-entity-kpi-card"
            href="/lex/admin/org-entities"
          />
          <StatTile
            label={t.stats.active}
            value={stats.active}
            themeClass="kpi-theme-emerald"
            icon={CheckCircle2}
            loading={tableProps.isLoading}
            progress={activeShare}
            progressLabel={kpiCopy.orgShare}
            detail={kpiCopy.currentRegistry}
            detailValue={`${activeShare}%`}
            size="md"
            appearance="operational"
            className="org-entity-kpi-card"
            href="/lex/admin/org-entities?active=true"
          />
          <StatTile
            label={t.stats.departments}
            value={stats.departments}
            themeClass="kpi-theme-amber"
            icon={Building2}
            loading={tableProps.isLoading}
            progress={departmentShare}
            progressLabel={kpiCopy.orgShare}
            detail={kpiCopy.currentRegistry}
            detailValue={`${departmentShare}%`}
            size="md"
            appearance="operational"
            className="org-entity-kpi-card"
            href="/lex/admin/org-entities?entity_type=department"
          />
        </div>

        <Tabs defaultValue="registry" className="space-y-6">
          <TabsList className="flex h-auto flex-wrap justify-start gap-1">
            <TabsTrigger value="registry">{locale === 'ar' ? 'السجل' : 'Registry'}</TabsTrigger>
            <TabsTrigger value="chart">{locale === 'ar' ? 'المخطط التنظيمي' : 'Org chart'}</TabsTrigger>
            <TabsTrigger value="escalation">{locale === 'ar' ? 'التصعيد' : 'Escalation'}</TabsTrigger>
            <TabsTrigger value="people">{locale === 'ar' ? 'الأشخاص' : 'People'}</TabsTrigger>
            <TabsTrigger value="quality">{locale === 'ar' ? 'الصحة والجودة' : 'Health & QA'}</TabsTrigger>
            <TabsTrigger value="platform">{locale === 'ar' ? 'مزامنة المنصة' : 'Platform sync'}</TabsTrigger>
            <TabsTrigger value="audit">{locale === 'ar' ? 'التدقيق' : 'Audit'}</TabsTrigger>
          </TabsList>

          <TabsContent value="registry" className="space-y-6">
            <AdminDatasetActions
              namespace="lex-admin-org-entities"
              filename="lex-org-entities"
              rows={exportRows}
              activeFilters={activeFilters}
              labels={{ savedView: 'Save org view', importTitle: 'Org entity import preview' }}
              extraActions={canWrite ? <OrgStructureImportDialog /> : undefined}
            />
            <DataTable
              {...tableProps}
              columns={columns}
              filters={orgFilters}
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
              emptyState={{ icon: Network, title: t.emptyTitle, description: t.emptyDescription }}
            />
          </TabsContent>

          <TabsContent value="chart">
            <OrgChartView canWrite={canWrite} />
          </TabsContent>

          <TabsContent value="escalation" className="space-y-6">
            <EscalationCoverageMatrix canWrite={canWrite} />
            <EscalationWhatIfSimulator />
          </TabsContent>

          <TabsContent value="people">
            <ResponsibilityDirectory canWrite={canWrite} />
          </TabsContent>

          <TabsContent value="quality" className="space-y-6">
            <OrgHealthPanel />
            <OrgLocalizationQa />
          </TabsContent>

          <TabsContent value="platform">
            <PlatformSyncView canWrite={canWrite} />
          </TabsContent>

          <TabsContent value="audit">
            <OrgAuditTimeline />
          </TabsContent>
        </Tabs>

        {canWrite ? (
          <>
            <OrgEntityFormDialog
              open={createOpen}
              parents={parents}
              onOpenChange={setCreateOpen}
              onSaved={(e) => router.push(`/lex/admin/org-entities/${e.id}`)}
            />
            <OrgEntityFormDialog
              entity={editing}
              parents={parents}
              open={editing !== null}
              onOpenChange={(o) => !o && setEditing(null)}
            />
            <OrgMoveDialog
              entity={moving}
              open={moving !== null}
              onOpenChange={(o) => !o && setMoving(null)}
              onMoved={() => setMoving(null)}
            />
            <OrgDeleteImpactDialog
              entity={deleting}
              open={deleting !== null}
              loadedEntities={loadedOrgRows}
              loading={del.isPending}
              locale={locale}
              cancelLabel={common.cancel}
              deleteLabel={common.delete}
              onOpenChange={(o) => !o && setDeleting(null)}
              onConfirm={async () => {
                if (!deleting) return;
                writeOrgSnapshot(deleting, 'before_delete');
                await del.mutateAsync(deleting.id);
              }}
            />
            <OrgBulkDeleteImpactDialog
              entities={bulkDeletingEntities}
              open={bulkDeletingIds.length > 0}
              loadedEntities={loadedOrgRows}
              loading={bulkDelete.isPending}
              locale={locale}
              cancelLabel={common.cancel}
              deleteLabel={common.delete}
              onOpenChange={(o) => !o && setBulkDeletingIds([])}
              onConfirm={async () => {
                await bulkDelete.mutateAsync(bulkDeletingEntities);
              }}
            />
          </>
        ) : null}
      </div>
    </LexAccessGuard>
  );
}
