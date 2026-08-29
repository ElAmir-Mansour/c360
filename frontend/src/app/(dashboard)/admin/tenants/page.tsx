"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { DataTable } from "@/components/shared/data-table/data-table";
import { SearchInput } from "@/components/shared/forms/search-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { tenantStatusConfig, tenantPlanConfig } from "@/lib/status-configs";
import { parseApiError } from "@/lib/format";
import { useDataTable } from "@/hooks/use-data-table";
import { useDeprovisionTenant } from "@/hooks/use-tenants";
import { useT } from "@/components/providers/locale-provider";
import api from "@/lib/api";
import type { ColumnDef } from "@tanstack/react-table";
import type { PaginatedResponse } from "@/types/api";
import type { Tenant } from "@/types/tenant";
import type { FilterConfig } from "@/types/table";

async function fetchTenants(params: {
  page: number;
  per_page: number;
  sort?: string;
  order?: string;
  search?: string;
  filters?: Record<string, string | string[]>;
}): Promise<PaginatedResponse<Tenant>> {
  const { data } = await api.get<PaginatedResponse<Tenant>>("/api/v1/tenants", {
    params: {
      page: params.page,
      per_page: params.per_page,
      sort: params.sort,
      order: params.order,
      search: params.search || undefined,
      status: params.filters?.status,
      subscription_tier: params.filters?.subscription_tier,
    },
  });
  return data;
}

export default function TenantsPage() {
  const t = useT("admin");
  const router = useRouter();
  const [deprovisionTenant, setDeprovisionTenant] = useState<Tenant | null>(null);
  const deprovisionMutation = useDeprovisionTenant();

  const { tableProps, refetch } = useDataTable<Tenant>({
    fetchFn: fetchTenants,
    queryKey: "tenants",
    defaultPageSize: 25,
    defaultSort: { column: "created_at", direction: "desc" },
  });

  const tenantStatusLabels: Record<Tenant["status"], string> = {
    active: t("tnp.stActive"),
    inactive: t("tnp.stInactive"),
    suspended: t("tnp.stSuspended"),
    trial: t("tnp.stTrial"),
    onboarding: t("tnp.stOnboarding"),
    deprovisioned: t("tnp.stDeprovisioned"),
  };

  const tenantPlanLabels: Record<Tenant["subscription_tier"], string> = {
    free: t("tnp.planFree"),
    starter: t("tnp.planStarter"),
    professional: t("tnp.planProfessional"),
    enterprise: t("tnp.planEnterprise"),
  };

  const filters: FilterConfig[] = [
    {
      key: "status",
      label: t("tnp.filterStatus"),
      type: "multi-select",
      options: [
        { label: t("tnp.stActive"), value: "active" },
        { label: t("tnp.stInactive"), value: "inactive" },
        { label: t("tnp.stSuspended"), value: "suspended" },
        { label: t("tnp.stTrial"), value: "trial" },
        { label: t("tnp.stOnboarding"), value: "onboarding" },
        { label: t("tnp.stDeprovisioned"), value: "deprovisioned" },
      ],
    },
    {
      key: "subscription_tier",
      label: t("tnp.filterPlan"),
      type: "multi-select",
      options: [
        { label: t("tnp.planFree"), value: "free" },
        { label: t("tnp.planStarter"), value: "starter" },
        { label: t("tnp.planProfessional"), value: "professional" },
        { label: t("tnp.planEnterprise"), value: "enterprise" },
      ],
    },
  ];

  const columns: ColumnDef<Tenant>[] = [
    {
      id: "name",
      header: t("tnp.colName"),
      accessorKey: "name",
      enableSorting: true,
      cell: ({ row }) => (
        <button
          className="font-medium text-sm hover:underline text-start"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/admin/tenants/${row.original.id}`);
          }}
        >
          {row.original.name}
        </button>
      ),
    },
    {
      id: "slug",
      header: t("tnp.colSlug"),
      accessorKey: "slug",
      enableSorting: true,
      cell: ({ row }) => (
        <code className="text-xs font-mono text-muted-foreground">
          {row.original.slug}
        </code>
      ),
    },
    {
      id: "status",
      header: t("tnp.colStatus"),
      accessorKey: "status",
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={tenantStatusConfig}
          label={tenantStatusLabels[row.original.status]}
          size="sm"
        />
      ),
    },
    {
      id: "subscription_tier",
      header: t("tnp.colPlan"),
      accessorKey: "subscription_tier",
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.subscription_tier}
          config={tenantPlanConfig}
          label={tenantPlanLabels[row.original.subscription_tier]}
          variant="outline"
          size="sm"
        />
      ),
    },
    {
      id: "created_at",
      header: t("tnp.colCreated"),
      accessorKey: "created_at",
      enableSorting: true,
      cell: ({ row }) => <RelativeTime date={row.original.created_at} />,
    },
  ];

  const rowActions = (tenant: Tenant) => {
    const actions = [
      {
        label: t("tnp.view"),
        onClick: (tn: Tenant) => router.push(`/admin/tenants/${tn.id}`),
      },
      {
        label: t("tnp.edit"),
        onClick: (tn: Tenant) => router.push(`/admin/tenants/${tn.id}?tab=settings`),
      },
    ];

    if (tenant.status === "active") {
      actions.push({
        label: t("tnp.suspend"),
        onClick: async (tn: Tenant) => {
          try {
            await api.put(`/api/v1/tenants/${tn.id}/status`, { status: "suspended" });
            toast.success(t("tnp.toastSuspended"));
            refetch();
          } catch (error) {
            toast.error(parseApiError(error));
          }
        },
      });
    } else if (tenant.status === "suspended") {
      actions.push({
        label: t("tnp.activate"),
        onClick: async (tn: Tenant) => {
          try {
            await api.put(`/api/v1/tenants/${tn.id}/status`, { status: "active" });
            toast.success(t("tnp.toastActivated"));
            refetch();
          } catch (error) {
            toast.error(parseApiError(error));
          }
        },
      });
    }

    if (tenant.status !== "deprovisioned") {
      actions.push({
        label: t("tnp.deprovision"),
        variant: "destructive" as const,
        onClick: (tn: Tenant) => setDeprovisionTenant(tn),
      } as { label: string; onClick: (tn: Tenant) => void; variant?: "destructive" });
    }

    return actions;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("tnp.title")}
        description={t("tnp.desc")}
        actions={
          <Button onClick={() => router.push("/admin/tenants/new")}>
            <Plus className="me-2 h-4 w-4" />
            {t("tnp.provision")}
          </Button>
        }
      />

      <DataTable
        {...tableProps}
        columns={columns}
        filters={filters}
        rowActions={rowActions}
        onRowClick={(tenant) => router.push(`/admin/tenants/${tenant.id}`)}
        searchSlot={
          <SearchInput
            value={tableProps.searchValue ?? ""}
            onChange={tableProps.onSearchChange ?? (() => {})}
            placeholder={t("tnp.searchPlaceholder")}
            loading={tableProps.isLoading}
          />
        }
        emptyState={{
          icon: Building2,
          title: t("tnp.emptyTitle"),
          description: t("tnp.emptyDesc"),
          action: {
            label: t("tnp.provision"),
            onClick: () => router.push("/admin/tenants/new"),
          },
        }}
      />

      {deprovisionTenant && (
        <ConfirmDialog
          open={!!deprovisionTenant}
          onOpenChange={(o) => !o && setDeprovisionTenant(null)}
          title={t("tnp.deprovisionTitle")}
          description={t("tnp.deprovisionDesc", { name: deprovisionTenant.name })}
          confirmLabel={t("tnp.deprovisionConfirm")}
          typeToConfirm={deprovisionTenant.name}
          variant="destructive"
          loading={deprovisionMutation.isPending}
          onConfirm={async () => {
            await deprovisionMutation.mutateAsync(deprovisionTenant.id);
            refetch();
          }}
        />
      )}
    </div>
  );
}
