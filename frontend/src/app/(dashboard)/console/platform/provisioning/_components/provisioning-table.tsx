'use client';

// Live, expandable table of in-flight tenants for Provisioning Oversight
// (§E.5(9), G24). Each row shows status / progress_pct / current_step; expanding
// a row mounts <StepList/>, which fetches the per-tenant 12-step detail. The
// shared lightweight DataTable has no row-expansion affordance, so this renders a
// purpose-fit `.table-premium` table (same design-system surface) with a chevron
// toggle — kept local to this route per the foundation contract.

import { useMemo, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime, parseApiError } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/status-badge';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useT } from '@/components/providers/locale-provider';
import { showSuccess, showError } from '@/lib/toast';
import type { ProvisioningItem } from '@/types/platform';
import { StepList } from './step-list';
import { buildProvisioningStatusConfig } from './provisioning-status-config';

interface ProvisioningTableProps {
  items: ProvisioningItem[];
  /** Re-fetch the queue + any open detail panes after a retry. */
  onRetried?: () => void;
}

const IN_FLIGHT = new Set(['pending', 'provisioning']);

export function ProvisioningTable({ items, onRetried }: ProvisioningTableProps) {
  const t = useT();
  const statusConfig = useMemo(() => buildProvisioningStatusConfig(t), [t]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retryTarget, setRetryTarget] = useState<ProvisioningItem | null>(null);
  const [retrying, setRetrying] = useState(false);

  const toggle = (tenantId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(tenantId)) next.delete(tenantId);
      else next.add(tenantId);
      return next;
    });
  };

  // Retry == reprovision the failed tenant (POST .../reprovision — EXISTS,
  // admin_handler.go:96). Inline mutation via the shared axios client keeps the
  // shared use-platform hook file untouched (foundation contract).
  const handleRetry = async () => {
    if (!retryTarget) return;
    setRetrying(true);
    try {
      const { default: api } = await import('@/lib/api');
      await api.post(`/api/v1/admin/tenants/${retryTarget.tenant_id}/reprovision`, {});
      showSuccess(
        t('platformConsole.provisioning.retrySuccess'),
        retryTarget.tenant_name,
      );
      setRetryTarget(null);
      onRetried?.();
    } catch (err) {
      showError(t('platformConsole.provisioning.retryError'), parseApiError(err));
      throw err;
    } finally {
      setRetrying(false);
    }
  };

  return (
    <>
      <div className="table-premium overflow-x-auto">
        <table className="w-full">
          <caption className="sr-only">
            {t('platformConsole.provisioning.tableCaption')}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-10">
                <span className="sr-only">
                  {t('platformConsole.provisioning.colExpand')}
                </span>
              </th>
              <th scope="col" className="text-start">
                {t('platformConsole.provisioning.colTenant')}
              </th>
              <th scope="col" className="text-start">
                {t('platformConsole.provisioning.colStatus')}
              </th>
              <th scope="col" className="text-start">
                {t('platformConsole.provisioning.colProgress')}
              </th>
              <th scope="col" className="text-start">
                {t('platformConsole.provisioning.colCurrentStep')}
              </th>
              <th scope="col" className="text-start">
                {t('platformConsole.provisioning.colStarted')}
              </th>
              <th scope="col" className="text-end">
                {t('platformConsole.provisioning.colActions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isOpen = expanded.has(item.tenant_id);
              const inFlight = IN_FLIGHT.has(item.status);
              const currentStep =
                item.steps?.find((s) => s.status === 'running')?.name ??
                (item.status === 'failed'
                  ? item.steps?.find((s) => s.status === 'failed')?.name
                  : undefined);
              return (
                <FragmentRow
                  key={item.tenant_id}
                  item={item}
                  isOpen={isOpen}
                  inFlight={inFlight}
                  currentStep={currentStep}
                  statusConfig={statusConfig}
                  onToggle={() => toggle(item.tenant_id)}
                  onRetry={() => setRetryTarget(item)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={retryTarget !== null}
        onOpenChange={(open) => !open && setRetryTarget(null)}
        title={t('platformConsole.provisioning.retryTitle')}
        description={
          retryTarget
            ? `${t('platformConsole.provisioning.retryConfirmPrefix')} ${retryTarget.tenant_name}. ${t('platformConsole.provisioning.retryConfirmSuffix')}`
            : ''
        }
        confirmLabel={t('platformConsole.provisioning.retry')}
        cancelLabel={t('platformConsole.provisioning.cancel')}
        onConfirm={handleRetry}
        loading={retrying}
      />
    </>
  );
}

interface FragmentRowProps {
  item: ProvisioningItem;
  isOpen: boolean;
  inFlight: boolean;
  currentStep?: string;
  statusConfig: ReturnType<typeof buildProvisioningStatusConfig>;
  onToggle: () => void;
  onRetry: () => void;
}

function FragmentRow({
  item,
  isOpen,
  inFlight,
  currentStep,
  statusConfig,
  onToggle,
  onRetry,
}: FragmentRowProps) {
  const t = useT();
  return (
    <>
      <tr className="cursor-pointer" onClick={onToggle} aria-expanded={isOpen}>
        <td>
          <button
            type="button"
            className="flex items-center justify-center"
            aria-label={
              isOpen
                ? t('platformConsole.provisioning.collapseRow')
                : t('platformConsole.provisioning.expandRow')
            }
            aria-expanded={isOpen}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform rtl:-scale-x-100',
                isOpen && 'rotate-90 rtl:rotate-90',
              )}
              aria-hidden
            />
          </button>
        </td>
        <td>
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{item.tenant_name}</span>
            {item.tenant_slug ? (
              <span className="font-mono text-xs text-muted-foreground">
                {item.tenant_slug}
              </span>
            ) : null}
          </div>
        </td>
        <td>
          <StatusBadge status={item.status} config={statusConfig} size="sm" />
        </td>
        <td>
          <ProgressBar pct={item.progress_pct} status={item.status} />
        </td>
        <td>
          <span className="text-sm text-muted-foreground">{currentStep ?? '—'}</span>
        </td>
        <td>
          <span className="text-sm text-muted-foreground">
            {item.started_at ? formatRelativeTime(item.started_at) : '—'}
          </span>
        </td>
        <td className="text-end" onClick={(e) => e.stopPropagation()}>
          {item.status === 'failed' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              aria-label={`${t('platformConsole.provisioning.retry')} — ${item.tenant_name}`}
            >
              <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {t('platformConsole.provisioning.retry')}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
      </tr>
      {isOpen ? (
        <tr className="bg-secondary/30">
          <td colSpan={7} className="p-0">
            <StepList tenantId={item.tenant_id} inFlight={inFlight} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ProgressBar({ pct, status }: { pct: number; status: string }) {
  const t = useT();
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const barColor =
    status === 'failed'
      ? 'bg-destructive'
      : status === 'completed'
        ? 'bg-primary'
        : 'bg-info-500';
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('platformConsole.provisioning.colProgress')}
      >
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-end font-mono text-xs tabular-nums text-muted-foreground">
        {clamped}%
      </span>
    </div>
  );
}
