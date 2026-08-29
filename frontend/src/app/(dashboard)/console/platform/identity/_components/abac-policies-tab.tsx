'use client';

import { useState, type ReactNode } from 'react';
import { Pencil, Plus, ShieldQuestion, Trash2 } from 'lucide-react';
import { SimpleTable } from '@/components/shared/simple-table';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  useAbacPolicies,
  useDeleteAbacPolicy,
  usePatchAbacPolicy,
} from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import type { AbacPolicy } from '@/types/platform';
import { AbacPolicyEditor } from './abac-policy-editor';
import { AbacSimulateForm } from './abac-simulate-form';

// The lightweight shared SimpleTable constrains its row type to
// `Record<string, unknown>`; our typed DTO satisfies that at runtime but lacks an
// implicit index signature, so we widen for the table boundary only.
type AbacRow = AbacPolicy & Record<string, unknown>;
interface AbacColumn {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  render?: (item: AbacRow) => ReactNode;
}
type AbacColumns = AbacColumn[];

export function AbacPoliciesTab() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useAbacPolicies();
  const patch = usePatchAbacPolicy();
  const del = useDeleteAbacPolicy();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AbacPolicy | null>(null);
  const [toDelete, setToDelete] = useState<AbacPolicy | null>(null);

  const policies = data ?? [];

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (p: AbacPolicy) => {
    setEditing(p);
    setEditorOpen(true);
  };

  const toggleEnabled = async (p: AbacPolicy) => {
    try {
      await patch.mutateAsync({ id: p.id, data: { enabled: !p.enabled } });
      showSuccess(
        p.enabled
          ? t('platformConsole.identity.policyDisabled')
          : t('platformConsole.identity.policyEnabled'),
      );
    } catch (err) {
      showApiError(err);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await del.mutateAsync({ id: toDelete.id });
      showSuccess(t('platformConsole.identity.policyDeleted'));
      setToDelete(null);
    } catch (err) {
      showApiError(err);
      throw err; // keep the dialog open for retry
    }
  };

  const columns = [
    {
      key: 'name',
      header: t('platformConsole.identity.colName'),
      render: (p: AbacPolicy) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{p.name}</p>
          {p.description && (
            <p className="truncate text-xs text-muted-foreground">
              {p.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'effect',
      header: t('platformConsole.identity.effect'),
      render: (p: AbacPolicy) => (
        <Badge variant={p.effect === 'allow' ? 'success' : 'destructive'}>
          {p.effect === 'allow'
            ? t('platformConsole.identity.effectAllow')
            : t('platformConsole.identity.effectDeny')}
        </Badge>
      ),
    },
    {
      key: 'action',
      header: t('platformConsole.identity.action'),
      render: (p: AbacPolicy) => (
        <code className="font-mono text-xs text-foreground/80">{p.action}</code>
      ),
    },
    {
      key: 'resource_type',
      header: t('platformConsole.identity.resourceType'),
      render: (p: AbacPolicy) => (
        <code className="font-mono text-xs text-foreground/80">
          {p.resource_type}
        </code>
      ),
    },
    {
      key: 'priority',
      header: t('platformConsole.identity.priority'),
      align: 'right' as const,
      render: (p: AbacPolicy) => (
        <span className="tabular-nums">{p.priority}</span>
      ),
    },
    {
      key: 'enabled',
      header: t('platformConsole.identity.enabled'),
      align: 'center' as const,
      render: (p: AbacPolicy) => (
        <Switch
          checked={p.enabled}
          onCheckedChange={() => toggleEnabled(p)}
          aria-label={t('platformConsole.identity.toggleAria').replace(
            '{name}',
            p.name,
          )}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      render: (p: AbacPolicy) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('platformConsole.identity.editAria').replace(
              '{name}',
              p.name,
            )}
            onClick={(e) => {
              e.stopPropagation();
              openEdit(p);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('platformConsole.identity.deleteAria').replace(
              '{name}',
              p.name,
            )}
            onClick={(e) => {
              e.stopPropagation();
              setToDelete(p);
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {t('platformConsole.identity.abacPolicies')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('platformConsole.identity.abacPoliciesHint')}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="me-1.5 h-4 w-4" aria-hidden />
          {t('platformConsole.identity.newPolicy')}
        </Button>
      </div>

      {isError ? (
        <ErrorState
          variant={detectVariant(error)}
          error={error}
          message={t('platformConsole.identity.policiesError')}
          onRetry={() => refetch()}
        />
      ) : !isLoading && policies.length === 0 ? (
        <EmptyState
          icon={ShieldQuestion}
          title={t('platformConsole.identity.noPoliciesTitle')}
          description={t('platformConsole.identity.noPoliciesHint')}
          action={{
            label: t('platformConsole.identity.newPolicy'),
            onClick: openCreate,
          }}
        />
      ) : (
        <SimpleTable<AbacRow>
          columns={columns as AbacColumns}
          data={policies as AbacRow[]}
          loading={isLoading}
          getRowKey={(p) => p.id}
          ariaLabel={t('platformConsole.identity.policiesTableCaption')}
          emptyMessage={t('platformConsole.identity.noPoliciesTitle')}
        />
      )}

      <div className="border-t border-border pt-6">
        <AbacSimulateForm />
      </div>

      <AbacPolicyEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        policy={editing}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('platformConsole.identity.deletePolicyTitle')}
        description={
          toDelete
            ? t('platformConsole.identity.deletePolicyConfirm').replace(
                '{name}',
                toDelete.name,
              )
            : ''
        }
        variant="destructive"
        confirmLabel={t('platformConsole.identity.deletePolicyConfirmLabel')}
        typeToConfirm={toDelete?.name}
        onConfirm={confirmDelete}
        loading={del.isPending}
      />
    </div>
  );
}
