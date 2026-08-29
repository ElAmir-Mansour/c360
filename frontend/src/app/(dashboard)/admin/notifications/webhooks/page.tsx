'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDataTable } from '@/hooks/use-data-table';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { PageHeader } from '@/components/common/page-header';
import { DataTable } from '@/components/shared/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Webhook } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useDeleteWebhook, useTestWebhook } from '@/hooks/use-webhooks';
import { showSuccess, showError } from '@/lib/toast';
import { useT } from '@/components/providers/locale-provider';
import { CreateWebhookDialog } from './components/create-webhook-dialog';
import { WebhookSecretDialog } from './components/webhook-secret-dialog';
import { getWebhookColumns } from './components/webhook-columns';
import type { NotificationWebhook } from '@/types/models';
import type { PaginatedResponse } from '@/types/api';
import type { FetchParams, RowAction, FilterConfig } from '@/types/table';

function buildApiParams(params: FetchParams): Record<string, unknown> {
  const result: Record<string, unknown> = {
    page: params.page,
    per_page: params.per_page,
  };
  if (params.sort) result.sort = params.sort;
  if (params.order) result.order = params.order;
  if (params.search) result.search = params.search;
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      result[key] = value;
    }
  }
  return result;
}

export default function WebhooksPage() {
  const t = useT('admin');
  const router = useRouter();

  const filters: FilterConfig[] = [
    {
      key: 'status',
      label: t('whp.filterStatus'),
      type: 'select',
      options: [
        { label: t('whp.optActive'), value: 'active' },
        { label: t('whp.optInactive'), value: 'inactive' },
        { label: t('whp.optFailing'), value: 'failing' },
      ],
    },
  ];
  const [createOpen, setCreateOpen] = useState(false);
  const [secretDialogData, setSecretDialogData] = useState<{ name: string; secret: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NotificationWebhook | null>(null);
  const [testTarget, setTestTarget] = useState<NotificationWebhook | null>(null);

  const deleteMutation = useDeleteWebhook();
  const testMutation = useTestWebhook();

  const { tableProps, refetch } = useDataTable<NotificationWebhook>({
    fetchFn: (params: FetchParams) =>
      apiGet<PaginatedResponse<NotificationWebhook>>(
        API_ENDPOINTS.NOTIFICATIONS_WEBHOOKS,
        buildApiParams(params),
      ),
    queryKey: 'notification-webhooks',
    defaultSort: { column: 'created_at', direction: 'desc' },
  });

  const rowActions: RowAction<NotificationWebhook>[] = [
    {
      label: t('whp.viewDetails'),
      onClick: (row) => router.push(`/admin/notifications/webhooks/${row.id}`),
    },
    {
      label: t('whp.test'),
      onClick: (row) => setTestTarget(row),
    },
    {
      label: t('whp.edit'),
      onClick: (row) => router.push(`/admin/notifications/webhooks/${row.id}?tab=settings`),
    },
    {
      label: t('whp.delete'),
      variant: 'destructive',
      onClick: (row) => setDeleteTarget(row),
    },
  ];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
    refetch();
  };

  const handleTest = async () => {
    if (!testTarget) return;
    try {
      const result = await testMutation.mutateAsync(testTarget.id);
      if (result.success) {
        showSuccess(t('whp.testOk'), t('whp.testOkDetail', { status: result.response_status }));
      } else {
        showError(t('whp.testFail'), result.response_body);
      }
    } catch {
      // Error handled by mutation
    }
    setTestTarget(null);
  };

  const handleCreateSuccess = (name: string, secret: string) => {
    setCreateOpen(false);
    setSecretDialogData({ name, secret });
    refetch();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('whp.title')}
        description={t('whp.desc')}
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="me-2 h-4 w-4" />
            {t('whp.create')}
          </Button>
        }
      />

      <DataTable
        columns={getWebhookColumns(t)}
        {...tableProps}
        filters={filters}
        rowActions={rowActions}
        onRowClick={(row) => router.push(`/admin/notifications/webhooks/${row.id}`)}
        searchPlaceholder={t('whp.searchPlaceholder')}
        emptyState={{
          icon: Webhook,
          title: t('whp.emptyTitle'),
          description: t('whp.emptyDesc'),
          action: {
            label: t('whp.create'),
            onClick: () => setCreateOpen(true),
            icon: Plus,
          },
        }}
      />

      <CreateWebhookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={handleCreateSuccess}
      />

      <WebhookSecretDialog
        open={Boolean(secretDialogData)}
        onOpenChange={() => setSecretDialogData(null)}
        webhookName={secretDialogData?.name ?? ''}
        secret={secretDialogData?.secret ?? ''}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={() => setDeleteTarget(null)}
        title={t('whp.deleteTitle')}
        description={t('whp.deleteDesc', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('whp.deleteConfirm')}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(testTarget)}
        onOpenChange={() => setTestTarget(null)}
        title={t('whp.testTitle')}
        description={t('whp.testDesc', { name: testTarget?.name ?? '' })}
        confirmLabel={t('whp.sendTest')}
        onConfirm={handleTest}
        loading={testMutation.isPending}
      />
    </div>
  );
}
