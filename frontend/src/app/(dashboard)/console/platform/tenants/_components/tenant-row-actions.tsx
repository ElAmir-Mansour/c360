'use client';

// Per-row lifecycle actions for the Platform Console tenant list (§E.2). Each
// destructive/sensitive action funnels through a type-the-slug confirm; suspend/
// deprovision/impersonate additionally require a reason for the audit trail
// (ReasonConfirmDialog), while unsuspend/reprovision/reactivate use the shared
// <ConfirmDialog/>. Impersonation mints a read-only grant (G5) — on success the
// foundation's <ImpersonationBanner/> (mounted in platform/layout.tsx) appears.

import { useState } from 'react';
import {
  MoreHorizontal,
  Eye,
  Ban,
  CheckCircle,
  RefreshCw,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { parseApiError } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import {
  useSuspendTenant,
  useUnsuspendTenant,
  useImpersonate,
} from '@/hooks/use-platform';
import {
  useReprovisionTenant,
  useAdminDeprovisionTenant,
  useReactivateTenant,
} from './use-tenant-lifecycle';
import { ReasonConfirmDialog } from './reason-confirm-dialog';
import type { AdminTenantSummary } from '@/types/platform';

type DialogKind =
  | 'suspend'
  | 'unsuspend'
  | 'reprovision'
  | 'deprovision'
  | 'reactivate'
  | 'impersonate'
  | null;

interface TenantRowActionsProps {
  tenant: AdminTenantSummary;
  onView: (tenant: AdminTenantSummary) => void;
}

const IMPERSONATE_TTL_SECONDS = 900; // hard cap ≤15 min (§E.2)

export function TenantRowActions({ tenant, onView }: TenantRowActionsProps) {
  const t = useT();
  const [dialog, setDialog] = useState<DialogKind>(null);

  const suspend = useSuspendTenant();
  const unsuspend = useUnsuspendTenant();
  const reprovision = useReprovisionTenant();
  const deprovision = useAdminDeprovisionTenant();
  const reactivate = useReactivateTenant();
  const impersonate = useImpersonate();

  const close = () => setDialog(null);

  const isDeprovisioned = tenant.status === 'deprovisioned';
  const isSuspended = tenant.status === 'suspended';
  const isActive = tenant.status === 'active' || tenant.status === 'trial';

  const viewAsLabel = t('platformConsole.impersonation.viewingAs').replace(
    '{tenant}',
    tenant.name,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t('platformConsole.tenants.actionsFor').replace('{tenant}', tenant.name)}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => onView(tenant)}>
            <Eye className="me-2 h-4 w-4" aria-hidden />
            {t('platformConsole.tenants.view')}
          </DropdownMenuItem>

          {/* Impersonate — read-only, only for live tenants. */}
          {!isDeprovisioned && (
            <DropdownMenuItem onClick={() => setDialog('impersonate')}>
              <Eye className="me-2 h-4 w-4" aria-hidden />
              {viewAsLabel}
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          {isActive && (
            <DropdownMenuItem onClick={() => setDialog('suspend')}>
              <Ban className="me-2 h-4 w-4" aria-hidden />
              {t('platformConsole.tenants.suspend')}
            </DropdownMenuItem>
          )}
          {isSuspended && (
            <DropdownMenuItem onClick={() => setDialog('unsuspend')}>
              <CheckCircle className="me-2 h-4 w-4" aria-hidden />
              {t('platformConsole.tenants.unsuspend')}
            </DropdownMenuItem>
          )}

          {!isDeprovisioned && (
            <DropdownMenuItem onClick={() => setDialog('reprovision')}>
              <RefreshCw className="me-2 h-4 w-4" aria-hidden />
              {t('platformConsole.tenants.reprovision')}
            </DropdownMenuItem>
          )}

          {/* Reactivate only valid for deprovisioned tenants within retain_until. */}
          {isDeprovisioned && (
            <DropdownMenuItem onClick={() => setDialog('reactivate')}>
              <RotateCcw className="me-2 h-4 w-4" aria-hidden />
              {t('platformConsole.tenants.reactivate')}
            </DropdownMenuItem>
          )}

          {!isDeprovisioned && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDialog('deprovision')}
              >
                <Trash2 className="me-2 h-4 w-4" aria-hidden />
                {t('platformConsole.tenants.deprovision')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Suspend (real — revokes sessions + keys, G4). Reason required. */}
      <ReasonConfirmDialog
        open={dialog === 'suspend'}
        onOpenChange={(o) => !o && close()}
        title={`${t('platformConsole.tenants.suspend')} — ${tenant.name}`}
        description={t('platformConsole.tenants.suspendDesc')}
        confirmLabel={t('platformConsole.tenants.suspend')}
        reasonLabel={t('platformConsole.impersonation.reason')}
        typeToConfirm={tenant.slug}
        variant="destructive"
        loading={suspend.isPending}
        onConfirm={async (reason) => {
          try {
            await suspend.mutateAsync({ tenantId: tenant.id, reason });
            toast.success(t('platformConsole.tenants.suspendSuccess'));
          } catch (err) {
            toast.error(parseApiError(err));
            throw err;
          }
        }}
      />

      {/* Deprovision (destructive). Reason required. */}
      <ReasonConfirmDialog
        open={dialog === 'deprovision'}
        onOpenChange={(o) => !o && close()}
        title={`${t('platformConsole.tenants.deprovision')} — ${tenant.name}`}
        description={t('platformConsole.tenants.deprovisionDesc')}
        confirmLabel={t('platformConsole.tenants.deprovision')}
        reasonLabel={t('platformConsole.impersonation.reason')}
        typeToConfirm={tenant.slug}
        variant="destructive"
        loading={deprovision.isPending}
        onConfirm={async (reason) => {
          try {
            await deprovision.mutateAsync({ tenantId: tenant.id, reason });
            toast.success(t('platformConsole.tenants.deprovisionSuccess'));
          } catch (err) {
            toast.error(parseApiError(err));
            throw err;
          }
        }}
      />

      {/* Impersonate (read-only, security-sensitive — G5). Reason required. */}
      <ReasonConfirmDialog
        open={dialog === 'impersonate'}
        onOpenChange={(o) => !o && close()}
        title={t('platformConsole.impersonation.confirmTitle')}
        description={t('platformConsole.tenants.impersonateDesc').replace('{tenant}', tenant.name)}
        confirmLabel={viewAsLabel}
        reasonLabel={t('platformConsole.impersonation.reason')}
        typeToConfirm={tenant.slug}
        loading={impersonate.isPending}
        onConfirm={async (reason) => {
          try {
            await impersonate.mutateAsync({
              tenantId: tenant.id,
              tenantName: tenant.name,
              reason,
              ttl: IMPERSONATE_TTL_SECONDS,
            });
            toast.success(viewAsLabel);
          } catch (err) {
            toast.error(parseApiError(err));
            throw err;
          }
        }}
      />

      {/* Unsuspend (G4). No reason. */}
      <ConfirmDialog
        open={dialog === 'unsuspend'}
        onOpenChange={(o) => !o && close()}
        title={`${t('platformConsole.tenants.unsuspend')} — ${tenant.name}`}
        description={t('platformConsole.tenants.unsuspendDesc')}
        confirmLabel={t('platformConsole.tenants.unsuspend')}
        typeToConfirm={tenant.slug}
        loading={unsuspend.isPending}
        onConfirm={async () => {
          try {
            await unsuspend.mutateAsync({ tenantId: tenant.id });
            toast.success(t('platformConsole.tenants.unsuspendSuccess'));
          } catch (err) {
            toast.error(parseApiError(err));
            throw err;
          }
        }}
      />

      {/* Reprovision. No reason. */}
      <ConfirmDialog
        open={dialog === 'reprovision'}
        onOpenChange={(o) => !o && close()}
        title={`${t('platformConsole.tenants.reprovision')} — ${tenant.name}`}
        description={t('platformConsole.tenants.reprovisionDesc')}
        confirmLabel={t('platformConsole.tenants.reprovision')}
        typeToConfirm={tenant.slug}
        loading={reprovision.isPending}
        onConfirm={async () => {
          try {
            await reprovision.mutateAsync({ tenantId: tenant.id });
            toast.success(t('platformConsole.tenants.reprovisionSuccess'));
          } catch (err) {
            toast.error(parseApiError(err));
            throw err;
          }
        }}
      />

      {/* Reactivate (only within retain_until). No reason. */}
      <ConfirmDialog
        open={dialog === 'reactivate'}
        onOpenChange={(o) => !o && close()}
        title={`${t('platformConsole.tenants.reactivate')} — ${tenant.name}`}
        description={t('platformConsole.tenants.reactivateDesc')}
        confirmLabel={t('platformConsole.tenants.reactivate')}
        typeToConfirm={tenant.slug}
        loading={reactivate.isPending}
        onConfirm={async () => {
          try {
            await reactivate.mutateAsync({ tenantId: tenant.id });
            toast.success(t('platformConsole.tenants.reactivateSuccess'));
          } catch (err) {
            toast.error(parseApiError(err));
            throw err;
          }
        }}
      />
    </>
  );
}
