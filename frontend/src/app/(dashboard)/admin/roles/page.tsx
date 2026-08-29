"use client";

import { useState } from "react";
import { Plus, Shield, Lock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/common/error-state";
import { PageHeader } from "@/components/common/page-header";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SearchInput } from "@/components/shared/forms/search-input";
import { showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { RoleFormDialog } from "./_components/role-form-dialog";
import { RoleCard, RoleCardSkeleton } from "./_components/role-card";
import { RoleDetailDialog } from "./_components/role-detail-dialog";
import { useApiQuery } from "@/hooks/use-api";
import api from "@/lib/api";
import type { Role } from "@/types/models";
import { useAdminT } from "../_lib/admin-i18n";

type TypeFilter = "all" | "system" | "custom";

export default function RoleManagementPage() {
  const labels = useAdminT();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [deleteRole, setDeleteRole] = useState<Role | null>(null);
  const [viewRole, setViewRole] = useState<Role | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const { data, isLoading, error, refetch } = useApiQuery<Role[]>(
    ["roles"],
    "/api/v1/roles"
  );

  const roles = data ?? [];
  const systemCount = roles.filter((r) => r.is_system).length;
  const customCount = roles.length - systemCount;

  const header = (
    <PageHeader
      title={labels.roles.title}
      description={labels.roles.description}
      tags={[
        {
          label: `${roles.length} ${roles.length === 1 ? labels.roles.roleSingular : labels.roles.rolePlural}`,
          icon: <Shield className="h-3.5 w-3.5" aria-hidden />,
          tone: "primary",
        },
        {
          label: `${systemCount} ${labels.roles.systemTag}`,
          icon: <Lock className="h-3.5 w-3.5" aria-hidden />,
          tone: "neutral",
        },
      ]}
      actions={
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="me-2 h-4 w-4" />
          {labels.roles.createRole}
        </Button>
      }
    />
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <RoleCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          error={error}
          message={labels.roles.failedToLoad}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = roles.filter((r) => {
    if (typeFilter === "system" && !r.is_system) return false;
    if (typeFilter === "custom" && r.is_system) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.slug.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q) ||
      r.permissions.some((p) => p.toLowerCase().includes(q))
    );
  });

  const segments: { key: TypeFilter; label: string; count: number }[] = [
    { key: "all", label: labels.roles.all, count: roles.length },
    { key: "system", label: labels.roles.system, count: systemCount },
    { key: "custom", label: labels.roles.custom, count: customCount },
  ];

  const showCreateTile = typeFilter !== "system" && !q;

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={labels.roles.searchRoles}
          aria-label={labels.roles.searchRoles}
          className="w-full sm:max-w-xs"
        />
        <div
          role="group"
          aria-label={labels.roles.colType}
          className="inline-flex items-center gap-1 self-start rounded-2xl border border-border/60 bg-muted/40 p-1 sm:self-auto"
        >
          {segments.map((s) => {
            const active = typeFilter === s.key;
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={active}
                onClick={() => setTypeFilter(s.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {s.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-overline font-semibold leading-5 tabular-nums",
                    active
                      ? "bg-brand-primary-500/15 text-brand-primary-600 dark:text-brand-primary-300"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {s.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted/60">
            <Search className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">{labels.roles.noMatchingRoles}</p>
            <p className="text-sm text-muted-foreground">{labels.roles.noRolesDescription}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setSearch("");
              setTypeFilter("all");
            }}
          >
            {labels.roles.clearFilters}
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((role) => (
            <RoleCard
              key={role.id}
              role={role}
              onView={() => setViewRole(role)}
              onEdit={() => setEditRole(role)}
              onDelete={() => setDeleteRole(role)}
            />
          ))}

          {showCreateTile && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex min-h-[11rem] flex-col items-center justify-center gap-2 rounded-[var(--ds-radius-card)] border-2 border-dashed border-muted-foreground/25 p-8 text-muted-foreground outline-none transition-[color,background-color,border-color,box-shadow] duration-normal ease-standard hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-6 w-6" aria-hidden />
              <span className="text-sm font-medium">{labels.roles.createNewRole}</span>
            </button>
          )}
        </div>
      )}

      <RoleFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={refetch}
      />

      {editRole && (
        <RoleFormDialog
          role={editRole}
          open={!!editRole}
          onOpenChange={(o) => !o && setEditRole(null)}
          onSuccess={refetch}
        />
      )}

      {viewRole && (
        <RoleDetailDialog
          role={viewRole}
          open={!!viewRole}
          onOpenChange={(o) => !o && setViewRole(null)}
          onEdit={
            viewRole.is_system
              ? undefined
              : () => {
                  const r = viewRole;
                  setViewRole(null);
                  setEditRole(r);
                }
          }
        />
      )}

      {deleteRole && (
        <ConfirmDialog
          open={!!deleteRole}
          onOpenChange={(o) => !o && setDeleteRole(null)}
          title={labels.roles.deleteRoleTitle}
          description={labels.roles.deleteShortDescription(deleteRole.name)}
          confirmLabel={labels.common.delete}
          variant="destructive"
          onConfirm={async () => {
            await api.delete(`/api/v1/roles/${deleteRole.id}`);
            showSuccess(labels.roles.roleDeleted);
            refetch();
          }}
        />
      )}
    </div>
  );
}
