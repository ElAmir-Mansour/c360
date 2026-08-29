'use client';

// Service & Infra Ops — Rate limits (§E.5 #7, G20).
//
// Reads runtime rate-limit config (GET /api/v1/gateway/admin/ratelimits) — the
// global default plus any per-tenant overrides — and writes the global or a
// per-tenant tier override (PUT .../ratelimits[/tenants/{id}]). Edits route
// through a destructive ConfirmDialog because a too-low limit can throttle live
// tenant traffic. Writes are gated on `platform:gateway:admin` server-side.

import { useState } from 'react';
import { Gauge, Pencil } from 'lucide-react';
import { useT } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useRateLimits, useSetRateLimit } from '@/hooks/use-platform';
import type { RateLimitConfig, SubscriptionTier } from '@/types/platform';
import { SimpleTable } from '@/components/shared/simple-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailPanel } from '@/components/shared/detail-panel';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { PlatformTenantPicker } from '@/components/shared/forms/platform-tenant-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showBackendError, showSuccess } from '@/lib/toast';

const GATEWAY_ADMIN_PERM = 'platform:gateway:admin';
const TIERS: SubscriptionTier[] = ['free', 'starter', 'professional', 'enterprise'];

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type RateLimitRow = RateLimitConfig & Record<string, unknown>;

interface EditState {
  /** The row being edited (or a fresh per-tenant override). */
  original?: RateLimitConfig;
  tenant_id: string;
  tenant_name?: string;
  tier?: SubscriptionTier;
  requests_per_second: string;
  burst: string;
  /** true == editing the global default (tenant_id blank). */
  isGlobal: boolean;
}

export function RateLimitsTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const canAdmin = hasPermission(GATEWAY_ADMIN_PERM);
  const { data, isLoading, isError, error, refetch } = useRateLimits();
  const setLimit = useSetRateLimit();

  const [edit, setEdit] = useState<EditState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const openEdit = (row?: RateLimitConfig) => {
    const isGlobal = !row?.tenant_id;
    setEdit({
      original: row,
      tenant_id: row?.tenant_id ?? '',
      tenant_name: row?.tenant_name,
      tier: row?.tier,
      requests_per_second: row ? String(row.requests_per_second) : '',
      burst: row ? String(row.burst) : '',
      isGlobal,
    });
  };

  const submit = async () => {
    if (!edit) return;
    const payload: RateLimitConfig = {
      tenant_id: edit.isGlobal ? undefined : edit.tenant_id.trim() || undefined,
      tier: edit.tier,
      requests_per_second: Number(edit.requests_per_second),
      burst: Number(edit.burst),
    };
    try {
      await setLimit.mutateAsync(payload);
      showSuccess(
        t('platformConsole.services.rlUpdated'),
        edit.isGlobal
          ? t('platformConsole.services.rlGlobalDefault')
          : edit.tenant_name || edit.tenant_id,
      );
      setConfirmOpen(false);
      setEdit(null);
    } catch (e) {
      showBackendError(e, t('platformConsole.services.rlUpdateError'));
      throw e;
    }
  };

  if (isLoading) {
    return <SimpleTable<RateLimitRow> columns={[]} data={[]} loading />;
  }

  if (isError) {
    return (
      <ErrorState
        error={error}
        variant={detectVariant(error)}
        onRetry={() => refetch()}
        message={t('platformConsole.services.rlReadError')}
      />
    );
  }

  const rows = data ?? [];

  const columns = [
    {
      key: 'scope',
      header: t('platformConsole.services.rlScope'),
      render: (r: RateLimitConfig) =>
        r.tenant_id ? (
          <div className="min-w-0">
            <div className="font-medium text-foreground">{r.tenant_name || r.tenant_id}</div>
            <div className="font-mono text-xs text-muted-foreground">{r.tenant_id}</div>
          </div>
        ) : (
          <span className="font-medium text-foreground">
            {t('platformConsole.services.rlGlobalDefault')}
          </span>
        ),
    },
    {
      key: 'tier',
      header: t('platformConsole.services.rlTier'),
      render: (r: RateLimitConfig) => (
        <span className="capitalize text-muted-foreground">{r.tier ?? '—'}</span>
      ),
    },
    {
      key: 'requests_per_second',
      header: t('platformConsole.services.rlReqSec'),
      align: 'right' as const,
      render: (r: RateLimitConfig) => (
        <span className="tabular-nums">{r.requests_per_second.toLocaleString()}</span>
      ),
    },
    {
      key: 'burst',
      header: t('platformConsole.services.rlBurst'),
      align: 'right' as const,
      render: (r: RateLimitConfig) => (
        <span className="tabular-nums">{r.burst.toLocaleString()}</span>
      ),
    },
    {
      key: 'actions',
      header: t('platformConsole.services.colActions'),
      align: 'right' as const,
      render: (r: RateLimitConfig) =>
        canAdmin ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`${t('platformConsole.services.rlEdit')} — ${r.tenant_name || r.tenant_id || t('platformConsole.services.rlGlobalDefault')}`}
            onClick={() => openEdit(r)}
          >
            <Pencil className="me-1 h-3.5 w-3.5" aria-hidden />
            {t('platformConsole.services.rlEdit')}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('platformConsole.services.requiresAdmin')}
          </span>
        ),
    },
  ];

  const rpsValid = edit ? Number(edit.requests_per_second) > 0 : false;
  const burstValid = edit ? Number(edit.burst) > 0 : false;
  const tenantValid = edit ? edit.isGlobal || edit.tenant_id.trim().length > 0 : false;
  const canSubmit = rpsValid && burstValid && tenantValid;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t('platformConsole.services.rlHelp')}{' '}
          <code className="font-mono">{GATEWAY_ADMIN_PERM}</code>
        </p>
        {canAdmin && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() =>
              setEdit({
                tenant_id: '',
                requests_per_second: '',
                burst: '',
                isGlobal: false,
              })
            }
          >
            <Gauge className="me-1 h-3.5 w-3.5" aria-hidden />
            {t('platformConsole.services.rlPerTenant')}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title={t('platformConsole.services.rlNone')}
          description={t('platformConsole.services.rlNoneDesc')}
        />
      ) : (
        <SimpleTable<RateLimitRow>
          columns={columns}
          data={rows as RateLimitRow[]}
          getRowKey={(r) => r.tenant_id ?? '__global__'}
          onSortChange={() => undefined}
          ariaLabel={t('platformConsole.services.rateLimits')}
        />
      )}

      {/* Editor panel. */}
      <DetailPanel
        open={edit !== null && !confirmOpen}
        onOpenChange={(o) => !o && setEdit(null)}
        title={
          edit?.isGlobal
            ? t('platformConsole.services.rlEditGlobal')
            : edit?.original
              ? t('platformConsole.services.rlEditTenant')
              : t('platformConsole.services.rlNewTenant')
        }
        description={t('platformConsole.services.rlEditorDesc')}
        width="md"
      >
        {edit && (
          <div className="space-y-4">
            {!edit.isGlobal && (
              <div className="space-y-1.5">
                <Label htmlFor="rl-tenant">
                  {t('platformConsole.licensing.selectTenantTitle')}
                </Label>
                <PlatformTenantPicker
                  id="rl-tenant"
                  value={edit.tenant_id}
                  onChange={(tenantId, option) =>
                    setEdit({
                      ...edit,
                      tenant_id: tenantId,
                      tenant_name: option?.label,
                    })
                  }
                  selectedLabel={edit.tenant_name}
                  disabled={Boolean(edit.original?.tenant_id)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="rl-tier">{t('platformConsole.services.rlTier')}</Label>
              <Select
                value={edit.tier ?? ''}
                onValueChange={(v) => setEdit({ ...edit, tier: v as SubscriptionTier })}
              >
                <SelectTrigger id="rl-tier">
                  <SelectValue placeholder={t('platformConsole.services.rlTierPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map((tier) => (
                    <SelectItem key={tier} value={tier} className="capitalize">
                      {tier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rl-rps">{t('platformConsole.services.rlReqSec')}</Label>
                <Input
                  id="rl-rps"
                  type="number"
                  min={1}
                  value={edit.requests_per_second}
                  onChange={(e) => setEdit({ ...edit, requests_per_second: e.target.value })}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rl-burst">{t('platformConsole.services.rlBurst')}</Label>
                <Input
                  id="rl-burst"
                  type="number"
                  min={1}
                  value={edit.burst}
                  onChange={(e) => setEdit({ ...edit, burst: e.target.value })}
                  className="tabular-nums"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEdit(null)} disabled={setLimit.isPending}>
                {t('platformConsole.services.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
                disabled={!canSubmit || setLimit.isPending}
              >
                {t('platformConsole.services.save')}
              </Button>
            </div>
          </div>
        )}
      </DetailPanel>

      {/* Destructive confirmation. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        variant="destructive"
        title={t('platformConsole.services.rlApplyTitle')}
        description={
          edit
            ? `${edit.isGlobal ? t('platformConsole.services.rlGlobalDefault') : edit.tenant_name || edit.tenant_id} → ${edit.requests_per_second} ${t('platformConsole.services.rlReqSec')} (${t('platformConsole.services.rlBurst')} ${edit.burst}). ${t('platformConsole.services.rlApplyDesc')}`
            : ''
        }
        confirmLabel={t('platformConsole.services.rlApply')}
        loading={setLimit.isPending}
        onConfirm={submit}
      />
    </div>
  );
}
