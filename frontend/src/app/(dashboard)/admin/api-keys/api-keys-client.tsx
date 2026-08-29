"use client";

import { useState } from "react";
import {
  Key,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { DataTable } from "@/components/shared/data-table/data-table";
import { SearchInput } from "@/components/shared/forms/search-input";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { apiKeyStatusConfig } from "@/lib/status-configs";
import { useDataTable } from "@/hooks/use-data-table";
import { useRevokeApiKey, useRotateApiKey } from "@/hooks/use-api-keys";
import { useT } from "@/components/providers/locale-provider";
import api from "@/lib/api";
import type { ColumnDef } from "@tanstack/react-table";
import type { PaginatedResponse } from "@/types/api";
import type { ApiKey } from "@/types/api-key";
import type { FilterConfig } from "@/types/table";
import { CreateKeyDialog } from "./_components/create-key-dialog";
import { KeySecretDialog } from "./_components/key-secret-dialog";
import "../_lib/admin-i18n";

async function fetchApiKeys(params: {
  page: number;
  per_page: number;
  sort?: string;
  order?: string;
  search?: string;
  filters?: Record<string, string | string[]>;
}): Promise<PaginatedResponse<ApiKey>> {
  const { data } = await api.get<PaginatedResponse<ApiKey>>("/api/v1/api-keys", {
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

/**
 * Interactive body of the API Keys admin screen. Owns every client hook
 * (data-table state, revoke/rotate mutations, dialog state) so the server
 * `page.tsx` shell stays static. See docs/frontend/rsc-shell-pattern.md.
 */
export function ApiKeysClient() {
  const [createOpen, setCreateOpen] = useState(false);
  const [secretValue, setSecretValue] = useState<string | null>(null);
  const [revokeKey, setRevokeKey] = useState<ApiKey | null>(null);
  const [rotateKey, setRotateKey] = useState<ApiKey | null>(null);

  const t = useT('admin');
  const revokeMutation = useRevokeApiKey();
  const rotateMutation = useRotateApiKey();

  const { tableProps, refetch } = useDataTable<ApiKey>({
    fetchFn: fetchApiKeys,
    queryKey: "api-keys-admin",
    defaultPageSize: 25,
    defaultSort: { column: "created_at", direction: "desc" },
  });

  const apiKeyStatusLabels: Record<ApiKey["status"], string> = {
    active: t('c.active'),
    revoked: t('akc.optRevoked'),
    expired: t('akc.optExpired'),
  };

  const filters: FilterConfig[] = [
    {
      key: "status",
      label: t('c.status'),
      type: "multi-select",
      options: [
        { label: t('c.active'), value: "active" },
        { label: t('akc.optRevoked'), value: "revoked" },
        { label: t('akc.optExpired'), value: "expired" },
      ],
    },
  ];

  const columns: ColumnDef<ApiKey>[] = [
    {
      id: "name",
      header: t('c.name'),
      accessorKey: "name",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-medium text-sm">{row.original.name}</span>
      ),
    },
    {
      id: "prefix",
      header: t('akc.colKey'),
      accessorKey: "prefix",
      enableSorting: false,
      cell: ({ row }) => (
        <code className="text-xs font-mono text-muted-foreground">
          {row.original.prefix}••••••••
        </code>
      ),
    },
    {
      id: "scopes",
      header: t('akc.colScopes'),
      enableSorting: false,
      cell: ({ row }) => {
        const scopes = row.original.scopes;
        const displayed = scopes.slice(0, 3);
        const extra = scopes.length - 3;
        return (
          <div className="flex flex-wrap gap-1 max-w-[160px] sm:max-w-[250px]">
            {displayed.map((scope) => (
              <span
                key={scope}
                className="inline-flex items-center rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-xs font-mono"
              >
                {scope}
              </span>
            ))}
            {extra > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('akc.moreN', { n: extra })}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "status",
      header: t('c.status'),
      accessorKey: "status",
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={apiKeyStatusConfig}
          label={apiKeyStatusLabels[row.original.status]}
          size="sm"
        />
      ),
    },
    {
      id: "last_used_at",
      header: t('akc.colLastUsed'),
      accessorKey: "last_used_at",
      enableSorting: true,
      cell: ({ row }) =>
        row.original.last_used_at ? (
          <RelativeTime date={row.original.last_used_at} />
        ) : (
          <span className="text-xs text-muted-foreground">{t('c.never')}</span>
        ),
    },
    {
      id: "expires_at",
      header: t('akc.colExpires'),
      accessorKey: "expires_at",
      enableSorting: true,
      cell: ({ row }) =>
        row.original.expires_at ? (
          <RelativeTime date={row.original.expires_at} />
        ) : (
          <span className="text-xs text-muted-foreground">{t('c.never')}</span>
        ),
    },
  ];

  const rowActions = (key: ApiKey) => {
    const actions: { label: string; icon: typeof Trash2; onClick: (k: ApiKey) => void; variant?: "destructive" }[] = [];

    if (key.status === "active") {
      actions.push(
        {
          label: t('akc.rotate'),
          icon: RotateCw,
          onClick: (k: ApiKey) => setRotateKey(k),
        },
        {
          label: t('akc.revoke'),
          icon: Trash2,
          variant: "destructive" as const,
          onClick: (k: ApiKey) => setRevokeKey(k),
        },
      );
    }

    return actions;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('akc.title')}
        description={t('akc.desc')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="me-2 h-4 w-4" />
            {t('ak.title')}
          </Button>
        }
      />

      <DataTable
        {...tableProps}
        columns={columns}
        filters={filters}
        rowActions={rowActions}
        searchSlot={
          <SearchInput
            value={tableProps.searchValue ?? ""}
            onChange={tableProps.onSearchChange ?? (() => {})}
            placeholder={t('akc.searchPlaceholder')}
            loading={tableProps.isLoading}
          />
        }
        emptyState={{
          icon: Key,
          title: t('akc.emptyTitle'),
          description: t('akc.emptyDesc'),
          action: { label: t('ak.title'), onClick: () => setCreateOpen(true) },
        }}
      />

      <CreateKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(secret) => {
          setSecretValue(secret);
          refetch();
        }}
      />

      <KeySecretDialog
        open={!!secretValue}
        onOpenChange={(o) => !o && setSecretValue(null)}
        secret={secretValue ?? ""}
      />

      {revokeKey && (
        <ConfirmDialog
          open={!!revokeKey}
          onOpenChange={(o) => !o && setRevokeKey(null)}
          title={t('akc.revokeTitle')}
          description={t('akc.revokeDesc', { name: revokeKey.name })}
          confirmLabel={t('akc.revoke')}
          variant="destructive"
          loading={revokeMutation.isPending}
          onConfirm={async () => {
            await revokeMutation.mutateAsync(revokeKey.id);
            refetch();
          }}
        />
      )}

      {rotateKey && (
        <ConfirmDialog
          open={!!rotateKey}
          onOpenChange={(o) => !o && setRotateKey(null)}
          title={t('akc.rotateTitle')}
          description={t('akc.rotateDesc', { name: rotateKey.name })}
          confirmLabel={t('akc.rotate')}
          variant="default"
          loading={rotateMutation.isPending}
          onConfirm={async () => {
            const result = await rotateMutation.mutateAsync(rotateKey.id);
            setSecretValue(result.secret);
            setRotateKey(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}
