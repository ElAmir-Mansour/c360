'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Boxes, Plus } from 'lucide-react';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState } from '@/components/common/error-state';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useT } from '@/components/providers/locale-provider';
import { useLicensePlans, useCreatePlan } from '../_lib/use-license-plans';
import { planStatusConfig } from '../_lib/license-state';
import type { LicensePlan } from '../_lib/types';
import { CreatePlanDialog } from './create-plan-dialog';

// Widen for the lightweight SimpleTable's Record<string, unknown> row constraint.
type PlanRow = LicensePlan & Record<string, unknown>;

export function PlansTab() {
  const t = useT();
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useLicensePlans();
  const createPlan = useCreatePlan();
  const [createOpen, setCreateOpen] = useState(false);

  const planConfig = planStatusConfig(t);

  const columns: Column<LicensePlan>[] = [
    {
      key: 'name',
      header: t('platformConsole.licensing.colPlan'),
      render: (p) => (
        <div className="min-w-0">
          <div className="font-medium text-foreground">{p.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{p.key}</div>
        </div>
      ),
    },
    {
      key: 'description',
      header: t('platformConsole.licensing.colDescription'),
      render: (p) => (
        <span className="line-clamp-1 text-sm text-muted-foreground">
          {p.description || '—'}
        </span>
      ),
    },
    {
      key: 'entitlements',
      header: t('platformConsole.licensing.colEntitlements'),
      align: 'right',
      render: (p) => (
        <span className="tabular-nums">{p.entitlements?.length ?? 0}</span>
      ),
    },
    {
      key: 'source',
      header: t('platformConsole.licensing.colSource'),
      render: (p) => (
        <span className="text-sm text-muted-foreground">{p.source || '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('platformConsole.licensing.colStatus'),
      render: (p) => <StatusBadge status={p.status} config={planConfig} />,
    },
  ];

  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        message={t('platformConsole.licensing.plansError')}
      />
    );
  }

  const plans = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('platformConsole.licensing.plansHint')}
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="me-1.5 h-4 w-4" aria-hidden />
          {t('platformConsole.licensing.newPlan')}
        </Button>
      </div>

      {!isLoading && plans.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={t('platformConsole.licensing.plansEmptyTitle')}
          description={t('platformConsole.licensing.plansEmptyDesc')}
          action={{ label: t('platformConsole.licensing.newPlan'), onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <SimpleTable<PlanRow>
          columns={columns as Column<PlanRow>[]}
          data={plans as PlanRow[]}
          loading={isLoading}
          getRowKey={(p) => p.key}
          onRowClick={(p) =>
            router.push(`/platform/licensing/plans/${encodeURIComponent(p.key)}`)
          }
          ariaLabel={t('platformConsole.licensing.plansTableAria')}
          emptyMessage={t('platformConsole.licensing.plansEmptyTitle')}
        />
      )}

      <CreatePlanDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (input) => {
          await createPlan.mutateAsync(input);
        }}
      />
    </div>
  );
}
