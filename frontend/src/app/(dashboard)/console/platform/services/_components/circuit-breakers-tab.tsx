'use client';

// Service & Infra Ops — Circuit breakers (§E.5 #7, G18).
//
// Reads all breaker states (GET /api/v1/gateway/admin/circuit) and exposes the
// destructive force open/close/reset controls (POST .../circuit/{service}). Every
// control routes through a destructive ConfirmDialog and is gated on
// `platform:gateway:admin` server-side; the UI also hides the controls when the
// operator lacks it and surfaces the gating in copy.

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Activity,
  PlayCircle,
  StopCircle,
  RotateCcw,
} from 'lucide-react';
import { useT } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useCircuitBreakers, useSetCircuitBreaker } from '@/hooks/use-platform';
import type { CircuitBreakerState, CircuitAction } from '@/types/platform';
import { SimpleTable } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorState, detectVariant } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { showBackendError, showSuccess } from '@/lib/toast';
import type { StatusConfig } from '@/lib/status-configs';

const GATEWAY_ADMIN_PERM = 'platform:gateway:admin';

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type BreakerRow = CircuitBreakerState & Record<string, unknown>;

interface PendingAction {
  service: string;
  action: CircuitAction;
}

export function CircuitBreakersTab() {
  const t = useT();
  const { hasPermission } = useAuth();
  const canAdmin = hasPermission(GATEWAY_ADMIN_PERM);
  const { data, isLoading, isError, error, refetch } = useCircuitBreakers();
  const setBreaker = useSetCircuitBreaker();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const circuitConfig: StatusConfig = {
    closed: { label: t('platformConsole.services.circuitClosed'), color: 'green', icon: CheckCircle2 },
    open: { label: t('platformConsole.services.circuitOpen'), color: 'red', icon: AlertTriangle },
    'half-open': { label: t('platformConsole.services.circuitHalfOpen'), color: 'orange', icon: Activity },
  };

  const actionLabel: Record<CircuitAction, string> = {
    open: t('platformConsole.services.forceOpen'),
    close: t('platformConsole.services.forceClose'),
    reset: t('platformConsole.services.reset'),
  };

  const confirmAction = async () => {
    if (!pending) return;
    try {
      await setBreaker.mutateAsync(pending);
      showSuccess(
        `${actionLabel[pending.action]} — ${pending.service}`,
        t('platformConsole.services.breakerUpdated'),
      );
      setPending(null);
    } catch (e) {
      showBackendError(e, t('platformConsole.services.breakerUpdateError'));
      throw e; // keep the dialog open for retry
    }
  };

  if (isLoading) {
    return <SimpleTable<BreakerRow> columns={[]} data={[]} loading />;
  }

  if (isError) {
    return (
      <ErrorState
        error={error}
        variant={detectVariant(error)}
        onRetry={() => refetch()}
        message={t('platformConsole.services.breakerReadError')}
      />
    );
  }

  const breakers = data ?? [];

  const columns = [
    {
      key: 'service',
      header: t('platformConsole.services.colService'),
      render: (b: CircuitBreakerState) => (
        <span className="font-medium text-foreground">{b.service}</span>
      ),
    },
    {
      key: 'state',
      header: t('platformConsole.services.colState'),
      render: (b: CircuitBreakerState) => (
        <StatusBadge status={b.state} config={circuitConfig} />
      ),
    },
    {
      key: 'failures',
      header: t('platformConsole.services.colFailures'),
      align: 'right' as const,
      render: (b: CircuitBreakerState) => (
        <span className="tabular-nums">{b.failures ?? '—'}</span>
      ),
    },
    {
      key: 'last_changed_at',
      header: t('platformConsole.services.colLastChanged'),
      render: (b: CircuitBreakerState) => (
        <span className="text-muted-foreground">{b.last_changed_at ?? '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: t('platformConsole.services.colActions'),
      align: 'right' as const,
      render: (b: CircuitBreakerState) =>
        canAdmin ? (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={b.state === 'open'}
              aria-label={`${t('platformConsole.services.forceOpen')} — ${b.service}`}
              onClick={() => setPending({ service: b.service, action: 'open' })}
            >
              <StopCircle className="me-1 h-3.5 w-3.5" aria-hidden />
              {t('platformConsole.services.forceOpen')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={b.state === 'closed'}
              aria-label={`${t('platformConsole.services.forceClose')} — ${b.service}`}
              onClick={() => setPending({ service: b.service, action: 'close' })}
            >
              <PlayCircle className="me-1 h-3.5 w-3.5" aria-hidden />
              {t('platformConsole.services.forceClose')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${t('platformConsole.services.reset')} — ${b.service}`}
              onClick={() => setPending({ service: b.service, action: 'reset' })}
            >
              <RotateCcw className="me-1 h-3.5 w-3.5" aria-hidden />
              {t('platformConsole.services.reset')}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('platformConsole.services.requiresAdmin')}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t('platformConsole.services.breakerHelp')}{' '}
        <code className="font-mono">{GATEWAY_ADMIN_PERM}</code>
      </p>

      {breakers.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={t('platformConsole.services.noBreakers')}
          description={t('platformConsole.services.noBreakersDesc')}
        />
      ) : (
        <SimpleTable<BreakerRow>
          columns={columns}
          data={breakers as BreakerRow[]}
          getRowKey={(b) => b.service}
          onSortChange={() => undefined}
          ariaLabel={t('platformConsole.services.circuitBreakers')}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        variant="destructive"
        title={pending ? `${actionLabel[pending.action]} — ${pending.service}` : ''}
        description={
          pending
            ? `${actionLabel[pending.action]} — ${pending.service}. ${t('platformConsole.services.breakerConfirmDesc')}`
            : ''
        }
        confirmLabel={pending ? actionLabel[pending.action] : t('platformConsole.services.confirm')}
        typeToConfirm={pending?.service}
        loading={setBreaker.isPending}
        onConfirm={confirmAction}
      />
    </div>
  );
}
