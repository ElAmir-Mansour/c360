'use client';

import { useMemo, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useSetOverride, useRemoveOverride } from '@/hooks/use-platform';
import { showSuccess, showBackendError } from '@/lib/toast';
import { useT } from '@/components/providers/locale-provider';
import type { AdminTenantSummary, Override } from '@/types/platform';
import type { SuiteDescriptor } from './suite-catalog';

interface SuiteTenantToggleProps {
  suite: SuiteDescriptor;
  tenant: AdminTenantSummary;
  /** This tenant's overrides (G9). Undefined while loading. */
  overrides?: Override[];
}

/**
 * Per-tenant enable/disable toggle for a single suite. Enablement maps to a
 * licensing entitlement override (§E.3):
 *   - disable  → PUT  .../overrides/{suite.entitlement} {limit: 0}  (limit 0 = revoked)
 *   - re-enable → DELETE .../overrides/{suite.entitlement}          (restore plan default)
 * Both actions are confirmed via ConfirmDialog and emit license.override_* audit
 * events (already wired to event_outbox). The override read is the source of
 * truth: a limit-0 override on this suite's key == disabled.
 */
export function SuiteTenantToggle({ suite, tenant, overrides }: SuiteTenantToggleProps) {
  const t = useT();
  const setOverride = useSetOverride();
  const removeOverride = useRemoveOverride();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // A revoking override (limit 0) on this suite's entitlement key == disabled.
  const revokeOverride = useMemo(
    () =>
      overrides?.find(
        (o) => o.key === suite.entitlement && o.limit === 0,
      ),
    [overrides, suite.entitlement],
  );
  const enabled = !revokeOverride;

  // Whether the tenant's plan even includes this suite. If not, disabling
  // creates an override the plan never had — surface that as a warning.
  const hasPlanEntitlement = useMemo(
    () => overrides?.some((o) => o.key === suite.entitlement) ?? undefined,
    [overrides, suite.entitlement],
  );

  const busy = setOverride.isPending || removeOverride.isPending;

  const handleConfirm = async () => {
    try {
      if (enabled) {
        // Disable: set a revoking override (limit 0).
        await setOverride.mutateAsync({
          tenantId: tenant.id,
          key: suite.entitlement,
          limit: 0,
          reason: `Suite ${suite.name} disabled via Platform Console`,
        });
        showSuccess(t('platformConsole.suites.disableForTenant'));
      } else {
        // Re-enable: remove the override (restore plan default).
        await removeOverride.mutateAsync({
          tenantId: tenant.id,
          key: suite.entitlement,
        });
        showSuccess(t('platformConsole.suites.enableForTenant'));
      }
    } catch (err) {
      showBackendError(err, t('platformConsole.suites.toggleError'));
      throw err; // keep the ConfirmDialog open for retry
    }
  };

  const action = enabled
    ? t('platformConsole.suites.disableForTenant')
    : t('platformConsole.suites.enableForTenant');

  // §E.3: toggling a suite a tenant has no plan for warns an override is created.
  const noPlanWarning =
    enabled && hasPlanEntitlement === false
      ? ` ${t('platformConsole.suites.noPlanWarning')}`
      : '';

  return (
    <>
      <Switch
        checked={enabled}
        disabled={busy || overrides === undefined}
        onCheckedChange={() => setConfirmOpen(true)}
        aria-label={`${action} · ${tenant.name}`}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={action}
        description={
          `${action} — ${suite.name} · ${tenant.name} (${suite.entitlement}).` +
          noPlanWarning
        }
        confirmLabel={action}
        variant={enabled ? 'destructive' : 'default'}
        onConfirm={handleConfirm}
        loading={busy}
      />
    </>
  );
}
