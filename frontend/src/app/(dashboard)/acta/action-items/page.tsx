'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CheckSquare, KanbanSquare, ListTodo } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DataTable } from '@/components/shared/data-table/data-table';
import { KpiCard } from '@/components/shared/kpi-card';
import { SearchInput } from '@/components/shared/forms/search-input';
import { Button } from '@/components/ui/button';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { ActaActionItem } from '@/types/suites';
import { actionItemColumns } from './_components/action-item-columns';
import { ActionItemKanban } from './_components/action-item-kanban';
import { CompleteActionDialog } from './_components/complete-action-dialog';
import { CreateActionItemDialog } from './_components/create-action-item-dialog';
import { ExtendDueDateDialog } from './_components/extend-due-date-dialog';
import { useActaListLabels } from '../_lib/acta-i18n';

export default function ActaActionItemsPage() {
  const t = useActaListLabels().actionItems;
  const queryClient = useQueryClient();
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [scope, setScope] = useState<'all' | 'my' | 'overdue' | 'completed'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortColumn, setSortColumn] = useState<'due_date' | 'updated_at'>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [completeItem, setCompleteItem] = useState<ActaActionItem | null>(null);
  const [extendItem, setExtendItem] = useState<ActaActionItem | null>(null);

  const actionsQuery = useQuery({
    queryKey: ['acta-action-items', scope],
    queryFn: async () => {
      switch (scope) {
        case 'my':
          return enterpriseApi.acta.listMyActionItems();
        case 'overdue':
          return enterpriseApi.acta.listOverdueActionItems();
        case 'completed': {
          const response = await enterpriseApi.acta.listActionItems({
            page: 1,
            per_page: 200,
            order: 'desc',
            filters: { status: 'completed' },
          });
          return response.data;
        }
        default: {
          const response = await enterpriseApi.acta.listActionItems({
            page: 1,
            per_page: 200,
            order: 'desc',
          });
          return response.data;
        }
      }
    },
  });
  const committeesQuery = useQuery({
    queryKey: ['acta-action-item-committees'],
    queryFn: () => enterpriseApi.acta.listCommittees({ page: 1, per_page: 100, order: 'asc' }),
  });
  const meetingsQuery = useQuery({
    queryKey: ['acta-action-item-meetings'],
    queryFn: () => enterpriseApi.acta.listMeetings({ page: 1, per_page: 200, order: 'desc' }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ item, status }: { item: ActaActionItem; status: ActaActionItem['status'] }) =>
      enterpriseApi.acta.updateActionItemStatus(item.id, { status }),
    onSuccess: async () => {
      showSuccess(t.toastUpdatedTitle, t.toastUpdatedBody);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['acta-action-items'] }),
        queryClient.invalidateQueries({ queryKey: ['acta-dashboard'] }),
      ]);
    },
    onError: showApiError,
  });

  const filtered = useMemo(() => {
    const items = actionsQuery.data ?? [];
    const query = search.trim().toLowerCase();
    const sorted = [...items].sort((left, right) => {
      const leftValue = left[sortColumn];
      const rightValue = right[sortColumn];
      if (leftValue === rightValue) {
        return 0;
      }
      if (sortDirection === 'asc') {
        return String(leftValue).localeCompare(String(rightValue));
      }
      return String(rightValue).localeCompare(String(leftValue));
    });
    if (!query) {
      return sorted;
    }
    return sorted.filter((item) =>
      [item.title, item.description, item.assignee_name, item.meeting_title ?? '']
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [actionsQuery.data, search, sortColumn, sortDirection]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Tonal summary tiles derived from the items already loaded for the active
  // scope (no extra query). Open = pending/in_progress; overdue covers the
  // explicit status plus any past-due item not yet completed or cancelled.
  const actionStats = useMemo(() => {
    const items = actionsQuery.data ?? [];
    const now = Date.now();
    let open = 0;
    let overdue = 0;
    let completed = 0;
    for (const item of items) {
      if (item.status === 'pending' || item.status === 'in_progress') open += 1;
      if (item.status === 'completed') completed += 1;
      if (item.status === 'overdue') {
        overdue += 1;
      } else if (
        item.status !== 'completed' &&
        item.status !== 'cancelled' &&
        item.due_date
      ) {
        const dueAt = new Date(item.due_date).getTime();
        if (!Number.isNaN(dueAt) && dueAt < now) overdue += 1;
      }
    }
    return { open, overdue, completed };
  }, [actionsQuery.data]);

  return (
    <PermissionRedirect permission="acta:read">
      <div className="space-y-6">
        <PageHeader
          title={t.title}
          description={t.description}
          actions={
            <>
              <div className="flex rounded-lg border p-1">
                <Button variant={view === 'table' ? 'default' : 'ghost'} size="sm" onClick={() => setView('table')}>
                  <ListTodo className="me-1.5 h-4 w-4" />
                  {t.viewTable}
                </Button>
                <Button variant={view === 'kanban' ? 'default' : 'ghost'} size="sm" onClick={() => setView('kanban')}>
                  <KanbanSquare className="me-1.5 h-4 w-4" />
                  {t.viewKanban}
                </Button>
              </div>
              <Button onClick={() => setCreateOpen(true)}>
                <CheckSquare className="me-1.5 h-4 w-4" />
                {t.create}
              </Button>
            </>
          }
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <KpiCard
            title={t.kpiOpen}
            value={actionStats.open}
            tone="sky"
            icon={ListTodo}
            loading={actionsQuery.isLoading && (actionsQuery.data ?? []).length === 0}
          />
          <KpiCard
            title={t.kpiOverdue}
            value={actionStats.overdue}
            tone="rose"
            icon={AlertTriangle}
            loading={actionsQuery.isLoading && (actionsQuery.data ?? []).length === 0}
          />
          <KpiCard
            title={t.kpiCompleted}
            value={actionStats.completed}
            tone="emerald"
            icon={CheckCircle2}
            loading={actionsQuery.isLoading && (actionsQuery.data ?? []).length === 0}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            ['all', t.tabAll],
            ['my', t.tabMy],
            ['overdue', t.tabOverdue],
            ['completed', t.tabCompleted],
          ] as const).map(([tab, label]) => (
            <Button
              key={tab}
              variant={scope === tab ? 'default' : 'outline'}
              size="sm"
              onClick={() => setScope(tab)}
            >
              {label}
            </Button>
          ))}
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t.searchPlaceholder}
          loading={actionsQuery.isLoading}
        />

        {view === 'table' ? (
          <DataTable
            columns={actionItemColumns({
              onComplete: (item) => setCompleteItem(item),
              onExtend: (item) => setExtendItem(item),
            })}
            data={paged}
            totalRows={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSortChange={(column, direction) => {
              if (column === 'due_date' || column === 'updated_at') {
                setSortColumn(column);
                setSortDirection(direction);
              }
            }}
            searchValue={search}
            onSearchChange={setSearch}
            isLoading={actionsQuery.isLoading}
            error={actionsQuery.error ? t.loadError : null}
            onRetry={() => void actionsQuery.refetch()}
            emptyState={{
              icon: CheckSquare,
              title: t.emptyTitle,
              description: t.emptyDescription,
            }}
          />
        ) : (
          <ActionItemKanban
            items={filtered}
            onMove={(item, nextStatus) => {
              if (nextStatus === 'completed') {
                setCompleteItem(item);
                return;
              }
              statusMutation.mutate({ item, status: nextStatus });
            }}
          />
        )}

        <CreateActionItemDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          committees={committeesQuery.data?.data ?? []}
          meetings={meetingsQuery.data?.data ?? []}
        />
        <CompleteActionDialog
          open={Boolean(completeItem)}
          onOpenChange={(open) => !open && setCompleteItem(null)}
          item={completeItem}
        />
        <ExtendDueDateDialog
          open={Boolean(extendItem)}
          onOpenChange={(open) => !open && setExtendItem(null)}
          item={extendItem}
        />
      </div>
    </PermissionRedirect>
  );
}
