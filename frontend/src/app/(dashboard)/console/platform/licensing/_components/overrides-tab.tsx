'use client';

import { useState } from 'react';
import { SlidersHorizontal, Plus, Pencil, Trash2, MoreHorizontal } from 'lucide-react';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { parseApiError } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import { useTenantOverrides, useRemoveOverride } from '@/hooks/use-platform';
import type { Override } from '@/types/platform';
import { formatLimit } from '../_lib/license-state';
import { TenantPicker } from './tenant-picker';
import { SetOverrideDialog } from './set-override-dialog';

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type OverrideRow = Override & Record<string, unknown>;

export function OverridesTab() {
  const t = useT();
  const [tenantId, setTenantId] = useState('');
  const [tenantLabel, setTenantLabel] = useState('');

  const { data, isLoading, isError, error, refetch } = useTenantOverrides(
    tenantId,
    tenantId !== '',
  );
  const removeOverride = useRemoveOverride();

  const [setOpen, setSetOpen] = useState(false);
  const [editOverride, setEditOverride] = useState<Override | null>(null);
  const [removeFor, setRemoveFor] = useState<Override | null>(null);

  const overrides = data ?? [];

  const columns: Column<Override>[] = [
    {
      key: 'key',
      header: t('platformConsole.licensing.colEntitlement'),
      render: (o) => <span className="font-mono text-sm">{o.key}</span>,
    },
    {
      key: 'limit',
      header: t('platformConsole.licensing.colLimit'),
      align: 'right',
      render: (o) => (
        <span
          className={
            o.limit === 0 ? 'tabular-nums font-medium text-destructive' : 'tabular-nums'
          }
        >
          {formatLimit(o.limit, t)}
        </span>
      ),
    },
    {
      key: 'reason',
      header: t('platformConsole.licensing.colReason'),
      render: (o) => (
        <span className="line-clamp-1 text-sm text-muted-foreground">
          {o.reason || '—'}
        </span>
      ),
    },
    {
      key: 'set_at',
      header: t('platformConsole.licensing.colUpdated'),
      render: (o) =>
        o.set_at ? (
          <span className="text-sm text-muted-foreground">
            {new Date(o.set_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (o) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t('platformConsole.licensing.overrideActionsAria').replace('{key}', o.key)}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditOverride(o)}>
              <Pencil className="me-2 h-4 w-4" aria-hidden />
              {t('platformConsole.licensing.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setRemoveFor(o)}
            >
              <Trash2 className="me-2 h-4 w-4" aria-hidden />
              {t('platformConsole.licensing.removeRestoreDefault')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TenantPicker
          value={tenantId}
          onChange={(id, label) => {
            setTenantId(id);
            setTenantLabel(label);
          }}
          className="w-64"
        />
        {tenantId && (
          <Button size="sm" onClick={() => setSetOpen(true)}>
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {t('platformConsole.licensing.setOverride')}
          </Button>
        )}
      </div>

      {tenantId === '' ? (
        <EmptyState
          icon={SlidersHorizontal}
          title={t('platformConsole.licensing.selectTenantTitle')}
          description={t('platformConsole.licensing.selectTenantOverridesDesc')}
        />
      ) : isError ? (
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          message={t('platformConsole.licensing.overridesError')}
        />
      ) : !isLoading && overrides.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title={t('platformConsole.licensing.overridesEmptyTitle')}
          description={t('platformConsole.licensing.overridesEmptyDesc')}
          action={{ label: t('platformConsole.licensing.setOverride'), onClick: () => setSetOpen(true) }}
        />
      ) : (
        <SimpleTable<OverrideRow>
          columns={columns as Column<OverrideRow>[]}
          data={overrides as OverrideRow[]}
          loading={isLoading}
          getRowKey={(o) => o.key}
          ariaLabel={t('platformConsole.licensing.overrides')}
          emptyMessage={t('platformConsole.licensing.overridesEmptyTitle')}
        />
      )}

      <SetOverrideDialog
        open={setOpen}
        onOpenChange={setSetOpen}
        tenantId={tenantId}
        tenantLabel={tenantLabel}
      />

      <SetOverrideDialog
        open={editOverride !== null}
        onOpenChange={(o) => !o && setEditOverride(null)}
        tenantId={tenantId}
        tenantLabel={tenantLabel}
        editKey={editOverride?.key}
        editLimit={editOverride?.limit}
      />

      <ConfirmDialog
        open={removeFor !== null}
        onOpenChange={(o) => !o && setRemoveFor(null)}
        title={t('platformConsole.licensing.removeOverride')}
        description={t('platformConsole.licensing.removeOverrideConfirm').replace(
          '{key}',
          removeFor?.key ?? '',
        )}
        confirmLabel={t('platformConsole.licensing.remove')}
        variant="destructive"
        loading={removeOverride.isPending}
        onConfirm={async () => {
          if (!removeFor) return;
          try {
            await removeOverride.mutateAsync({ tenantId, key: removeFor.key });
            toast.success(t('platformConsole.licensing.overrideRemovedToast'));
            setRemoveFor(null);
          } catch (e) {
            toast.error(parseApiError(e));
            throw e;
          }
        }}
      />
    </div>
  );
}
