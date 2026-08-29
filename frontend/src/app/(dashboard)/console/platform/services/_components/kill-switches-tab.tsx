'use client';

// Service & Infra Ops — Kill switches / feature flags (§E.5 #7, G19).
//
// Lists Redis-backed kill switches (GET /api/v1/gateway/admin/killswitch),
// supports creating/enabling and disabling them (POST .../killswitch). Enabling a
// kill switch is the destructive action (it disables platform functionality), so
// it routes through a destructive ConfirmDialog. All writes are gated on
// `platform:gateway:admin` server-side.

import { useState } from 'react';
import { Power, PowerOff, Plus, ShieldAlert } from 'lucide-react';
import { useT } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useKillSwitches, useSetKillSwitch } from '@/hooks/use-platform';
import type { KillSwitch } from '@/types/platform';
import { SimpleTable } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailPanel } from '@/components/shared/detail-panel';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { showBackendError, showSuccess } from '@/lib/toast';
import type { StatusConfig } from '@/lib/status-configs';

const GATEWAY_ADMIN_PERM = 'platform:gateway:admin';

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type KillSwitchRow = KillSwitch & Record<string, unknown>;

interface ToggleTarget {
  key: string;
  enabled: boolean; // the target state being applied
  reason?: string;
}

export function KillSwitchesTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const canAdmin = hasPermission(GATEWAY_ADMIN_PERM);
  const { data, isLoading, isError, error, refetch } = useKillSwitches();
  const setKill = useSetKillSwitch();

  const [toggle, setToggle] = useState<ToggleTarget | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newReason, setNewReason] = useState('');

  const stateConfig: StatusConfig = {
    enabled: { label: t('platformConsole.services.ksEngaged'), color: 'red', icon: ShieldAlert },
    disabled: { label: t('platformConsole.services.ksInactive'), color: 'gray', icon: PowerOff },
  };

  const applyToggle = async () => {
    if (!toggle) return;
    try {
      await setKill.mutateAsync({
        key: toggle.key,
        enabled: toggle.enabled,
        reason: toggle.reason,
      });
      showSuccess(
        toggle.enabled
          ? t('platformConsole.services.ksEngagedToast')
          : t('platformConsole.services.ksReleasedToast'),
        toggle.key,
      );
      setToggle(null);
    } catch (e) {
      showBackendError(e, t('platformConsole.services.ksUpdateError'));
      throw e;
    }
  };

  const createSwitch = async () => {
    const key = newKey.trim();
    if (!key) return;
    try {
      await setKill.mutateAsync({ key, enabled: true, reason: newReason.trim() || undefined });
      showSuccess(t('platformConsole.services.ksCreatedToast'), key);
      setCreateOpen(false);
      setNewKey('');
      setNewReason('');
    } catch (e) {
      showBackendError(e, t('platformConsole.services.ksCreateError'));
    }
  };

  if (isLoading) {
    return <SimpleTable<KillSwitchRow> columns={[]} data={[]} loading />;
  }

  if (isError) {
    return (
      <ErrorState
        error={error}
        variant={detectVariant(error)}
        onRetry={() => refetch()}
        message={t('platformConsole.services.ksReadError')}
      />
    );
  }

  const switches = data ?? [];

  const columns = [
    {
      key: 'key',
      header: t('platformConsole.services.ksKey'),
      render: (k: KillSwitch) => (
        <span className="font-mono text-sm text-foreground">{k.key}</span>
      ),
    },
    {
      key: 'enabled',
      header: t('platformConsole.services.colState'),
      render: (k: KillSwitch) => (
        <StatusBadge status={k.enabled ? 'enabled' : 'disabled'} config={stateConfig} />
      ),
    },
    {
      key: 'reason',
      header: t('platformConsole.services.reason'),
      render: (k: KillSwitch) => (
        <span className="text-muted-foreground">{k.reason || '—'}</span>
      ),
    },
    {
      key: 'set_by',
      header: t('platformConsole.services.setBy'),
      render: (k: KillSwitch) => (
        <span className="text-muted-foreground">{k.set_by || '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: t('platformConsole.services.colActions'),
      align: 'right' as const,
      render: (k: KillSwitch) =>
        canAdmin ? (
          k.enabled ? (
            <Button
              size="sm"
              variant="outline"
              aria-label={`${t('platformConsole.services.ksRelease')} — ${k.key}`}
              onClick={() => setToggle({ key: k.key, enabled: false })}
            >
              <Power className="me-1 h-3.5 w-3.5" aria-hidden />
              {t('platformConsole.services.ksRelease')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              aria-label={`${t('platformConsole.services.ksEngage')} — ${k.key}`}
              onClick={() => setToggle({ key: k.key, enabled: true, reason: k.reason })}
            >
              <PowerOff className="me-1 h-3.5 w-3.5" aria-hidden />
              {t('platformConsole.services.ksEngage')}
            </Button>
          )
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('platformConsole.services.requiresAdmin')}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t('platformConsole.services.ksHelp')}{' '}
          <code className="font-mono">{GATEWAY_ADMIN_PERM}</code>
        </p>
        {canAdmin && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="me-1 h-3.5 w-3.5" aria-hidden />
            {t('platformConsole.services.ksNew')}
          </Button>
        )}
      </div>

      {switches.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={t('platformConsole.services.ksNone')}
          description={t('platformConsole.services.ksNoneDesc')}
          action={
            canAdmin
              ? { label: t('platformConsole.services.ksNew'), onClick: () => setCreateOpen(true) }
              : undefined
          }
        />
      ) : (
        <SimpleTable<KillSwitchRow>
          columns={columns}
          data={switches as KillSwitchRow[]}
          getRowKey={(k) => k.key}
          onSortChange={() => undefined}
          ariaLabel={t('platformConsole.services.killSwitches')}
        />
      )}

      {/* Engage/release confirmation (destructive). */}
      <ConfirmDialog
        open={toggle !== null}
        onOpenChange={(o) => !o && setToggle(null)}
        variant="destructive"
        title={
          toggle
            ? toggle.enabled
              ? `${t('platformConsole.services.ksEngage')} — ${toggle.key}`
              : `${t('platformConsole.services.ksRelease')} — ${toggle.key}`
            : ''
        }
        description={
          toggle
            ? toggle.enabled
              ? t('platformConsole.services.ksEngageDesc')
              : t('platformConsole.services.ksReleaseDesc')
            : ''
        }
        confirmLabel={
          toggle?.enabled
            ? t('platformConsole.services.ksEngage')
            : t('platformConsole.services.ksRelease')
        }
        typeToConfirm={toggle?.enabled ? toggle.key : undefined}
        loading={setKill.isPending}
        onConfirm={applyToggle}
      />

      {/* Create new kill switch. */}
      <DetailPanel
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) {
            setNewKey('');
            setNewReason('');
          }
        }}
        title={t('platformConsole.services.ksNew')}
        description={t('platformConsole.services.ksNewDesc')}
        width="md"
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ks-key">{t('platformConsole.services.ksKey')}</Label>
            <Input
              id="ks-key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={t('platformConsole.services.ksKeyPlaceholder')}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ks-reason">{t('platformConsole.services.reason')}</Label>
            <Textarea
              id="ks-reason"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder={t('platformConsole.services.reasonPlaceholder')}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={setKill.isPending}
            >
              {t('platformConsole.services.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={createSwitch}
              disabled={!newKey.trim() || setKill.isPending}
            >
              {setKill.isPending
                ? t('platformConsole.services.creating')
                : t('platformConsole.services.ksCreateEngage')}
            </Button>
          </div>
        </div>
      </DetailPanel>
    </div>
  );
}
