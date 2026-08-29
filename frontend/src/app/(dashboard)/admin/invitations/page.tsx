"use client";

import { useState } from "react";
import {
  Mail,
  Plus,
  Send,
  Trash2,
  Users,
  Clock,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { DataTable } from "@/components/shared/data-table/data-table";
import { SearchInput } from "@/components/shared/forms/search-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
import { KpiCard } from "@/components/shared/kpi-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { invitationStatusConfig } from "@/lib/status-configs";
import { useFormat } from "@/lib/format/index";
import { useDataTable } from "@/hooks/use-data-table";
import {
  useInvitationStats,
  useResendInvitation,
  useDeleteInvitation,
} from "@/hooks/use-invitations";
import api from "@/lib/api";
import { useLocaleOrDefault, useT } from "@/components/providers/locale-provider";
import type { ColumnDef } from "@tanstack/react-table";
import type { PaginatedResponse } from "@/types/api";
import type { Invitation } from "@/types/invitation";
import type { FilterConfig } from "@/types/table";
import { InviteUserDialog } from "./_components/invite-user-dialog";
import "../_lib/admin-i18n";

const ROLE_LABELS = {
  en: {
    admin: "Admin",
    analyst: "Analyst",
    viewer: "Viewer",
    "tenant-admin": "Tenant Admin",
    "security-manager": "Security Manager",
    "security-analyst": "Security Analyst",
    "data-steward": "Data Steward",
    "data-analyst": "Data Analyst",
    ciso: "CISO",
    "legal-counsel": "Legal Counsel",
  },
  ar: {
    admin: "مسؤول",
    analyst: "محلّل",
    viewer: "مُشاهد",
    "tenant-admin": "مسؤول المستأجر",
    "security-manager": "مدير الأمن",
    "security-analyst": "محلّل أمني",
    "data-steward": "مشرف البيانات",
    "data-analyst": "محلّل بيانات",
    ciso: "مسؤول أمن المعلومات",
    "legal-counsel": "مستشار قانوني",
  },
} as const;

function normalizeRoleKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function roleLabel(invitation: Invitation, locale: "en" | "ar"): string {
  const labels = ROLE_LABELS[locale];
  const bySlug = labels[normalizeRoleKey(invitation.role_slug) as keyof typeof labels];
  if (bySlug) return bySlug;
  const byName = labels[normalizeRoleKey(invitation.role_name) as keyof typeof labels];
  return byName ?? invitation.role_name;
}

async function fetchInvitations(params: {
  page: number;
  per_page: number;
  sort?: string;
  order?: string;
  search?: string;
  filters?: Record<string, string | string[]>;
}): Promise<PaginatedResponse<Invitation>> {
  const { data } = await api.get<PaginatedResponse<Invitation>>("/api/v1/invitations", {
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

export default function InvitationsPage() {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const formatter = useFormat();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteInvite, setDeleteInvite] = useState<Invitation | null>(null);

  const { data: stats, isLoading: statsLoading } = useInvitationStats();
  const resendMutation = useResendInvitation();
  const deleteMutation = useDeleteInvitation();

  const { tableProps, refetch } = useDataTable<Invitation>({
    fetchFn: fetchInvitations,
    queryKey: "invitations",
    defaultPageSize: 25,
    defaultSort: { column: "created_at", direction: "desc" },
  });

  const invitationStatusLabels: Record<Invitation["status"], string> = {
    pending: t('inv.optPending'),
    accepted: t('inv.optAccepted'),
    expired: t('inv.optExpired'),
    cancelled: t('inv.optCancelled'),
    revoked: t('inv.optRevoked'),
  };

  const filters: FilterConfig[] = [
    {
      key: "status",
      label: t('c.status'),
      type: "multi-select",
      options: [
        { label: t('inv.optPending'), value: "pending" },
        { label: t('inv.optAccepted'), value: "accepted" },
        { label: t('inv.optExpired'), value: "expired" },
        { label: t('inv.optCancelled'), value: "cancelled" },
        { label: t('inv.optRevoked'), value: "revoked" },
      ],
    },
  ];

  const columns: ColumnDef<Invitation>[] = [
    {
      id: "email",
      header: t('inv.colEmail'),
      accessorKey: "email",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.email}</span>
      ),
    },
    {
      id: "role_name",
      header: t('iu.role'),
      accessorKey: "role_name",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="inline-flex items-center rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-xs font-medium">
          {roleLabel(row.original, locale)}
        </span>
      ),
    },
    {
      id: "status",
      header: t('c.status'),
      accessorKey: "status",
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={invitationStatusConfig}
          label={invitationStatusLabels[row.original.status]}
          size="sm"
        />
      ),
    },
    {
      id: "invited_by_name",
      header: t('inv.colInvitedBy'),
      accessorKey: "invited_by_name",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.invited_by_name}</span>
      ),
    },
    {
      id: "expires_at",
      header: t('inv.colExpires'),
      accessorKey: "expires_at",
      enableSorting: true,
      cell: ({ row }) => <RelativeTime date={row.original.expires_at} />,
    },
    {
      id: "created_at",
      header: t('inv.colSent'),
      accessorKey: "created_at",
      enableSorting: true,
      cell: ({ row }) => <RelativeTime date={row.original.created_at} />,
    },
  ];

  const rowActions = (invitation: Invitation) => {
    const actions: Array<{
      label: string;
      icon?: typeof Send;
      variant?: "destructive";
      onClick: (inv: Invitation) => void;
      hidden?: (inv: Invitation) => boolean;
    }> = [];

    if (invitation.status === "pending") {
      actions.push({
        label: t('inv.resend'),
        icon: Send,
        onClick: async (inv: Invitation) => {
          await resendMutation.mutateAsync(inv.id);
        },
      });
    }

    if (invitation.status === "pending" || invitation.status === "expired") {
      actions.push({
        label: t('c.cancel'),
        icon: Trash2,
        variant: "destructive",
        onClick: (inv: Invitation) => setDeleteInvite(inv),
      });
    }

    return actions;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('inv.title')}
        description={t('inv.desc')}
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="me-2 h-4 w-4" />
            {t('iu.title')}
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title={t('inv.kpiTotalSent')}
          value={formatter.formatNumber(stats?.total_sent ?? 0)}
          icon={Mail}
          tone="sky"
          loading={statsLoading}
        />
        <KpiCard
          title={t('inv.kpiPending')}
          value={formatter.formatNumber(stats?.pending ?? 0)}
          icon={Clock}
          tone="gold"
          loading={statsLoading}
        />
        <KpiCard
          title={t('inv.kpiAccepted')}
          value={formatter.formatNumber(stats?.accepted ?? 0)}
          icon={CheckCircle}
          tone="emerald"
          loading={statsLoading}
        />
        <KpiCard
          title={t('inv.kpiAcceptanceRate')}
          value={stats ? formatter.formatPercent(stats.acceptance_rate, { maximumFractionDigits: 1 }) : "—"}
          icon={Users}
          tone="emerald"
          loading={statsLoading}
        />
      </div>

      <DataTable
        {...tableProps}
        columns={columns}
        filters={filters}
        rowActions={rowActions}
        searchSlot={
          <SearchInput
            value={tableProps.searchValue ?? ""}
            onChange={tableProps.onSearchChange ?? (() => {})}
            placeholder={t('inv.searchPlaceholder')}
            loading={tableProps.isLoading}
          />
        }
        emptyState={{
          icon: Mail,
          title: t('inv.emptyTitle'),
          description: t('inv.emptyDesc'),
          action: { label: t('iu.title'), onClick: () => setInviteOpen(true) },
        }}
      />

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onSuccess={refetch}
      />

      {deleteInvite && (
        <ConfirmDialog
          open={!!deleteInvite}
          onOpenChange={(o) => !o && setDeleteInvite(null)}
          title={t('inv.cancelTitle')}
          description={t('inv.cancelDesc', { email: deleteInvite.email })}
          confirmLabel={t('inv.cancelInvitation')}
          variant="destructive"
          loading={deleteMutation.isPending}
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deleteInvite.id);
            refetch();
          }}
        />
      )}
    </div>
  );
}
