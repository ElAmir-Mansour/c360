"use client";

import { useMemo, useState } from "react";
import { Clock, Plus, Trash2, UserCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/page-header";
import { DataTable } from "@/components/shared/data-table/data-table";
import { KpiCard } from "@/components/shared/kpi-card";
import { SearchInput } from "@/components/shared/forms/search-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
import { UserAvatar } from "@/components/shared/user-avatar";
import { CopyButton } from "@/components/shared/copy-button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { userStatusConfig } from "@/lib/status-configs";
import { useDataTable } from "@/hooks/use-data-table";
import { cn } from "@/lib/utils";
import api from "@/lib/api";
import type { ColumnDef } from "@tanstack/react-table";
import type { User } from "@/types/models";
import type { PaginatedResponse } from "@/types/api";
import type { FilterConfig, BulkAction } from "@/types/table";
import { UserCreateDialog } from "./_components/user-create-dialog";
import { UserEditDialog } from "./_components/user-edit-dialog";
import { UserDetailPanel } from "./_components/user-detail-panel";
import { UserRoleAssignDialog } from "./_components/user-role-assign-dialog";
import { CheckCircle, Ban, ShieldCheck } from "lucide-react";
import { useAdminT } from "../_lib/admin-i18n";

/**
 * BadgeGroup — small reusable inline overflow group for table cells.
 *
 * Renders up to `max` token-styled `Badge`s and collapses the remainder into a
 * single "+N more" chip (with an accessible title listing the hidden labels).
 * Falls back to a muted `emptyLabel` when there are no items. Token-driven type
 * ramp + motion only; no hardcoded sizes or colours.
 */
function BadgeGroup({
  items,
  max = 2,
  emptyLabel = "None",
  moreLabel = "more",
  className,
}: {
  items: string[];
  max?: number;
  emptyLabel?: string;
  moreLabel?: string;
  className?: string;
}) {
  if (items.length === 0) {
    return <span className="text-caption text-muted-foreground">{emptyLabel}</span>;
  }

  const visible = items.slice(0, max);
  const overflow = items.slice(max);

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {visible.map((label) => (
        <Badge
          key={label}
          variant="secondary"
          className="max-w-[8rem] truncate normal-case tracking-normal"
        >
          {label}
        </Badge>
      ))}
      {overflow.length > 0 && (
        <span
          className="text-caption font-medium text-muted-foreground transition-colors duration-fast ease-standard"
          title={overflow.join(", ")}
        >
          +{overflow.length} {moreLabel}
        </span>
      )}
    </div>
  );
}

async function fetchUsers(params: {
  page: number;
  per_page: number;
  sort?: string;
  order?: string;
  search?: string;
  filters?: Record<string, string | string[]>;
}): Promise<PaginatedResponse<User>> {
  const { data } = await api.get<PaginatedResponse<User>>("/api/v1/users", {
    params: {
      page: params.page,
      per_page: params.per_page,
      sort: params.sort,
      order: params.order,
      search: params.search || undefined,
      status: params.filters?.status,
    },
  });
  return data;
}

export default function UserManagementPage() {
  const labels = useAdminT();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [detailUser, setDetailUser] = useState<User | null>(null);
  const [assignRoleUser, setAssignRoleUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const { tableProps, refetch } = useDataTable<User>({
    fetchFn: fetchUsers,
    queryKey: "users",
    defaultPageSize: 25,
    defaultSort: { column: "created_at", direction: "desc" },
  });

  // Tonal summary tiles from already-loaded rows. `total` uses the server-side
  // count; active/pending are derived from the loaded page (no new query).
  const userStats = useMemo(() => {
    const users = tableProps.data;
    let active = 0;
    let pending = 0;
    for (const user of users) {
      if (user.status === "active") active += 1;
      if (user.status === "pending_verification") pending += 1;
    }
    return { total: tableProps.totalRows, active, pending };
  }, [tableProps.data, tableProps.totalRows]);

  const userStatusLabels: Record<User["status"], string> = {
    active: labels.users.statusActive,
    suspended: labels.users.statusSuspended,
    inactive: labels.users.statusInactive,
    pending_verification: labels.users.statusPending,
  };

  const filters: FilterConfig[] = [
    {
      key: "status",
      label: labels.users.colStatus,
      type: "multi-select",
      options: [
        { label: labels.users.statusActive, value: "active" },
        { label: labels.users.statusSuspended, value: "suspended" },
        { label: labels.users.statusInactive, value: "inactive" },
        { label: labels.users.statusPending, value: "pending_verification" },
      ],
    },
  ];

  const columns: ColumnDef<User>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input accent-primary outline-none transition-shadow duration-fast ease-standard focus-visible:shadow-focus-ring"
          checked={table.getIsAllPageRowsSelected()}
          onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
          aria-label={labels.users.selectAll}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input accent-primary outline-none transition-shadow duration-fast ease-standard focus-visible:shadow-focus-ring"
          checked={row.getIsSelected()}
          onChange={(e) => row.toggleSelected(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          aria-label={labels.users.selectRow}
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
    },
    {
      id: "name",
      header: labels.users.colName,
      enableSorting: true,
      cell: ({ row }) => {
        const user = row.original;
        return (
          <div className="flex items-center gap-2">
            <UserAvatar user={user} size="sm" />
            <button
              className="text-start text-body-sm font-medium transition-colors duration-fast ease-standard hover:text-primary hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setDetailUser(user);
              }}
            >
              {user.first_name} {user.last_name}
            </button>
          </div>
        );
      },
    },
    {
      id: "email",
      header: labels.users.colEmail,
      accessorKey: "email",
      enableSorting: true,
      cell: ({ row }) => (
        <div className="group flex items-center gap-1">
          <span className="text-body-sm text-muted-foreground">{row.original.email}</span>
          <CopyButton value={row.original.email} label={labels.users.copyEmail} />
        </div>
      ),
    },
    {
      id: "roles",
      header: labels.users.colRoles,
      enableSorting: false,
      cell: ({ row }) => (
        <BadgeGroup
          items={(row.original.roles ?? []).map((role) => role.name)}
          max={2}
          emptyLabel={labels.users.noRoles}
          moreLabel={labels.common.more}
          className="max-w-[120px] sm:max-w-[200px]"
        />
      ),
    },
    {
      id: "status",
      header: labels.users.colStatus,
      accessorKey: "status",
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={userStatusConfig}
          label={userStatusLabels[row.original.status]}
          size="sm"
        />
      ),
    },
    {
      id: "mfa_enabled",
      header: labels.users.colMfa,
      accessorKey: "mfa_enabled",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.mfa_enabled ? (
          <CheckCircle className="h-4 w-4 text-primary" aria-label={labels.users.mfaEnabled} />
        ) : (
          <span className="text-caption text-muted-foreground">—</span>
        ),
    },
    {
      id: "last_login_at",
      header: labels.users.colLastLogin,
      accessorKey: "last_login_at",
      enableSorting: true,
      cell: ({ row }) =>
        row.original.last_login_at ? (
          <RelativeTime date={row.original.last_login_at} />
        ) : (
          <span className="text-caption text-muted-foreground">{labels.users.never}</span>
        ),
    },
  ];

  const rowActions = (user: User) => [
    {
      label: labels.users.edit,
      icon: undefined,
      onClick: (u: User) => setEditUser(u),
    },
    {
      label: labels.users.assignRoles,
      icon: ShieldCheck,
      onClick: (u: User) => setAssignRoleUser(u),
    },
    {
      label: user.status === "active" ? labels.users.suspend : labels.users.activate,
      icon: user.status === "active" ? Ban : CheckCircle,
      variant: user.status === "active" ? ("destructive" as const) : ("default" as const),
      onClick: async (u: User) => {
        const newStatus = u.status === "active" ? "suspended" : "active";
        try {
          await api.put(`/api/v1/users/${u.id}/status`, { status: newStatus });
          toast.success(
            newStatus === "active" ? labels.users.userActivated : labels.users.userSuspended
          );
          refetch();
        } catch {
          toast.error(labels.users.statusUpdateFailed);
        }
      },
    },
    {
      label: labels.users.delete,
      icon: Trash2,
      variant: "destructive" as const,
      onClick: (u: User) => setDeleteUser(u),
    },
  ];

  const bulkActions: BulkAction[] = [
    {
      label: labels.users.suspendSelected,
      icon: Ban,
      variant: "destructive",
      onClick: async (ids) => {
        await Promise.all(
          ids.map((id) =>
            api.put(`/api/v1/users/${id}/status`, { status: "suspended" })
          )
        );
        toast.success(labels.users.usersSuspended(ids.length));
        refetch();
      },
    },
    {
      label: labels.users.deleteSelected,
      icon: Trash2,
      variant: "destructive",
      onClick: async () => {
        setBulkDeleteOpen(true);
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={labels.users.title}
        description={labels.users.description}
        tags={[
          {
            label: labels.users.tagIdentity,
            icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
            tone: "primary",
          },
        ]}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="me-2 h-4 w-4" />
            {labels.users.addUser}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          title={labels.users.totalUsers}
          value={userStats.total}
          tone="sky"
          icon={Users}
          loading={tableProps.isLoading && tableProps.data.length === 0}
        />
        <KpiCard
          title={labels.users.activeUsers}
          value={userStats.active}
          tone="emerald"
          icon={UserCheck}
          loading={tableProps.isLoading && tableProps.data.length === 0}
        />
        <KpiCard
          title={labels.users.pendingInvites}
          value={userStats.pending}
          tone="gold"
          icon={Clock}
          loading={tableProps.isLoading && tableProps.data.length === 0}
        />
      </div>

      <DataTable
        {...tableProps}
        columns={columns}
        filters={filters}
        savedViews={{ routeKey: "admin-users" }}
        enableSelection
        onSelectionChange={setSelectedIds}
        rowActions={rowActions}
        onRowClick={(user) => setDetailUser(user)}
        searchSlot={
          <SearchInput
            value={tableProps.searchValue ?? ""}
            onChange={tableProps.onSearchChange ?? (() => {})}
            placeholder={labels.users.searchUsers}
            loading={tableProps.isLoading}
          />
        }
        bulkActions={bulkActions}
        enableExport
        onExport={(format) => {
          toast.info(labels.users.exporting(format.toUpperCase()));
        }}
        emptyState={{
          icon: Users,
          title: labels.users.noUsersTitle,
          description: labels.users.noUsersDescription,
          action: { label: labels.users.addUser, onClick: () => setCreateOpen(true) },
        }}
      />

      <UserCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={refetch}
      />

      {editUser && (
        <UserEditDialog
          user={editUser}
          open={!!editUser}
          onOpenChange={(o) => !o && setEditUser(null)}
          onSuccess={refetch}
        />
      )}

      {detailUser && (
        <UserDetailPanel
          user={detailUser}
          open={!!detailUser}
          onClose={() => setDetailUser(null)}
          onEdit={() => { setEditUser(detailUser); setDetailUser(null); }}
          onAssignRoles={() => { setAssignRoleUser(detailUser); setDetailUser(null); }}
        />
      )}

      {assignRoleUser && (
        <UserRoleAssignDialog
          user={assignRoleUser}
          open={!!assignRoleUser}
          onOpenChange={(o) => { if (!o) setAssignRoleUser(null); }}
          onSuccess={refetch}
        />
      )}

      {deleteUser && (
        <ConfirmDialog
          open={!!deleteUser}
          onOpenChange={(o) => !o && setDeleteUser(null)}
          title={labels.users.deleteUserTitle}
          description={labels.users.deleteUserDescription(
            `${deleteUser.first_name} ${deleteUser.last_name}`
          )}
          confirmLabel={labels.common.delete}
          typeToConfirm="DELETE"
          variant="destructive"
          onConfirm={async () => {
            await api.delete(`/api/v1/users/${deleteUser.id}`);
            toast.success(labels.users.userDeleted);
            refetch();
          }}
        />
      )}

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={labels.users.deleteUsersTitle(selectedIds.length)}
        description={labels.users.deleteUsersDescription}
        confirmLabel={labels.users.deleteAll}
        typeToConfirm="DELETE"
        variant="destructive"
        onConfirm={async () => {
          await Promise.all(selectedIds.map((id) => api.delete(`/api/v1/users/${id}`)));
          toast.success(labels.users.usersDeleted(selectedIds.length));
          refetch();
        }}
      />
    </div>
  );
}
