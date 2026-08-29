'use client';

import { useState } from 'react';
import { Plus, Archive, Trash2, HardDrive, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SimpleTable } from '@/components/shared/simple-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/components/providers/locale-provider';
import {
  useAuditPartitions,
  useCreateAuditPartition,
  useArchiveAuditPartition,
  useDeleteAuditPartition,
} from '@/hooks/use-audit';
import { formatDate, formatBytes, formatNumber } from '@/lib/format';
import type { AuditPartition } from '@/types/audit';

const statusVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  archived: 'secondary',
  pending: 'outline',
};

export function AuditPartitionsTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  // G17: partition archive/delete are platform-admin gated.
  const canAdmin = hasPermission('audit:partition:admin');

  const statusLabel = (s: string): string => {
    switch (s) {
      case 'active':
        return t('platformConsole.audit.partActive');
      case 'archived':
        return t('platformConsole.audit.partArchived');
      case 'pending':
        return t('platformConsole.audit.partPending');
      default:
        return s;
    }
  };

  const { data, isLoading, error, refetch } = useAuditPartitions();
  const createMutation = useCreateAuditPartition();
  const archiveMutation = useArchiveAuditPartition();
  const deleteMutation = useDeleteAuditPartition();

  const [createOpen, setCreateOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<AuditPartition | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<AuditPartition | null>(null);

  const partitions = data ?? [];

  if (error) {
    return (
      <ErrorState
        error={error}
        variant={detectVariant(error)}
        onRetry={() => refetch()}
        title={t('platformConsole.audit.partitionsErrorTitle')}
        message={t('platformConsole.audit.partitionsErrorMessage')}
      />
    );
  }

  return (
    <div className="space-y-6">
      {!canAdmin && (
        <div
          className="flex items-center gap-2 rounded-md border border-warning-300/40 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-700/15 dark:text-warning-300"
          role="note"
        >
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('platformConsole.audit.readOnlyNotice')}
        </div>
      )}

      {partitions.length > 0 && (
        <div className="rounded-lg border p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">
            {t('platformConsole.audit.partitionCoverage')}
          </p>
          <div className="flex h-6 gap-1">
            {partitions.map((p) => (
              <div
                key={p.id}
                className={`flex flex-1 items-center justify-center truncate rounded px-1 text-overline ${
                  p.status === 'active'
                    ? 'bg-primary text-primary-foreground'
                    : p.status === 'archived'
                      ? 'bg-muted-foreground text-background'
                      : 'bg-secondary text-secondary-foreground'
                }`}
                title={`${p.name}: ${formatDate(p.date_range_start)} – ${formatDate(p.date_range_end)}`}
              >
                {p.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {canAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="me-2 h-4 w-4" aria-hidden />
            {t('platformConsole.audit.runMaintenance')}
          </Button>
        </div>
      )}

      {!isLoading && partitions.length === 0 ? (
        <EmptyState
          icon={HardDrive}
          title={t('platformConsole.audit.noPartitionsTitle')}
          description={t('platformConsole.audit.noPartitionsDescription')}
          action={
            canAdmin
              ? {
                  label: t('platformConsole.audit.runMaintenance'),
                  onClick: () => setCreateOpen(true),
                }
              : undefined
          }
        />
      ) : (
        <SimpleTable<AuditPartition & Record<string, unknown>>
          ariaLabel={t('platformConsole.audit.partitionsTableLabel')}
          loading={isLoading}
          getRowKey={(p) => p.id}
          data={partitions as Array<AuditPartition & Record<string, unknown>>}
          columns={[
            {
              key: 'name',
              header: t('platformConsole.audit.colName'),
              render: (p) => <span className="font-medium">{p.name}</span>,
            },
            {
              key: 'range',
              header: t('platformConsole.audit.colDateRange'),
              render: (p) => (
                <span className="text-sm text-muted-foreground">
                  {formatDate(p.date_range_start)} –{' '}
                  {formatDate(p.date_range_end)}
                </span>
              ),
            },
            {
              key: 'record_count',
              header: t('platformConsole.audit.colRecords'),
              align: 'right',
              render: (p) => (
                <span className="tabular-nums">
                  {formatNumber(p.record_count)}
                </span>
              ),
            },
            {
              key: 'size_bytes',
              header: t('platformConsole.audit.colSize'),
              align: 'right',
              render: (p) => (
                <span className="text-sm">{formatBytes(p.size_bytes)}</span>
              ),
            },
            {
              key: 'status',
              header: t('platformConsole.audit.colStatus'),
              render: (p) => (
                <Badge variant={statusVariant[p.status] ?? 'outline'}>
                  {statusLabel(p.status)}
                </Badge>
              ),
            },
            {
              key: 'created_at',
              header: t('platformConsole.audit.colCreated'),
              render: (p) => (
                <span className="text-sm text-muted-foreground">
                  {formatDate(p.created_at)}
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('platformConsole.audit.colActions'),
              align: 'right',
              render: (p) =>
                canAdmin ? (
                  <div className="flex items-center justify-end gap-1">
                    {p.status === 'active' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setArchiveTarget(p)}
                        aria-label={t(
                          'platformConsole.audit.archiveAria',
                        ).replace('{name}', p.name)}
                      >
                        <Archive className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                    {p.status === 'archived' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(p)}
                        aria-label={t(
                          'platformConsole.audit.deleteAria',
                        ).replace('{name}', p.name)}
                      >
                        <Trash2
                          className="h-4 w-4 text-destructive"
                          aria-hidden
                        />
                      </Button>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
          ]}
        />
      )}

      {/* Maintenance */}
      <ConfirmDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('platformConsole.audit.maintenanceTitle')}
        description={t('platformConsole.audit.maintenanceDescription')}
        confirmLabel={t('platformConsole.audit.runMaintenance')}
        cancelLabel={t('platformConsole.audit.cancel')}
        loading={createMutation.isPending}
        onConfirm={async () => {
          await createMutation.mutateAsync();
        }}
      />

      {/* Archive (destructive, type-to-confirm) */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title={t('platformConsole.audit.archiveTitle')}
        description={t('platformConsole.audit.archiveDescription').replace(
          '{name}',
          archiveTarget?.name ?? '',
        )}
        variant="destructive"
        confirmLabel={t('platformConsole.audit.archive')}
        cancelLabel={t('platformConsole.audit.cancel')}
        loading={archiveMutation.isPending}
        onConfirm={async () => {
          if (archiveTarget) {
            await archiveMutation.mutateAsync(archiveTarget.name);
            setArchiveTarget(null);
          }
        }}
      />

      {/* Delete (destructive, type-to-confirm) */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('platformConsole.audit.deleteTitle')}
        description={t('platformConsole.audit.deleteDescription').replace(
          '{name}',
          deleteTarget?.name ?? '',
        )}
        variant="destructive"
        confirmLabel={t('platformConsole.audit.delete')}
        cancelLabel={t('platformConsole.audit.cancel')}
        typeToConfirm={deleteTarget?.name}
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteMutation.mutateAsync(deleteTarget.name);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
