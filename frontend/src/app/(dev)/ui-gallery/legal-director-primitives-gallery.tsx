'use client';

import { useState, type ReactNode } from 'react';

import { DashboardPrimitiveState } from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/dashboard-primitive-state';
import {
  DomainTile,
  DomainTileSkeleton,
} from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/domain-tile';
import {
  KpiCard,
  KpiCardSkeleton,
} from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/kpi-card';
import { PanelShell } from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/panel-shell';
import {
  ProgressBar,
  ProgressBarSkeleton,
} from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/progress-bar';
import {
  StatusChip,
  StatusChipSkeleton,
} from '@/app/(dashboard)/lex/_components/role-dashboard/widgets/status-chip';

interface PrimitiveSpecimensProps {
  copy: PrimitiveDevCopy;
  loading: ReactNode;
  zero: ReactNode;
  empty?: ReactNode;
  error?: ReactNode;
  frameStates?: boolean;
  onRetry: () => void;
}

interface PrimitiveDevCopy {
  name: string;
  emptyTitle: string;
  errorTitle: string;
}

interface LegalDirectorGalleryDevCopy {
  states: {
    loading: string;
    empty: string;
    error: string;
    zero: string;
  };
  sourceEmptyDescription: string;
  requestErrorDescription: string;
  retryLabel: string;
  retryCount: (count: number) => string;
  kpi: PrimitiveDevCopy & { loadingLabel: string; label: string };
  progress: PrimitiveDevCopy & { loadingLabel: string; label: string };
  status: PrimitiveDevCopy & { loadingLabel: string; zeroLabel: string };
  panel: PrimitiveDevCopy & {
    title: string;
    loadingLabel: string;
    zeroLabel: string;
  };
  domain: PrimitiveDevCopy & {
    loadingLabel: string;
    label: string;
  };
}

const DEV_COPY: LegalDirectorGalleryDevCopy = {
  states: {
    loading: 'Loading',
    empty: 'Empty',
    error: 'Error with retry',
    zero: 'Zero',
  },
  sourceEmptyDescription: 'The source returned no records.',
  requestErrorDescription: 'The request did not complete.',
  retryLabel: 'Retry',
  retryCount: (count) => `Retry interactions: ${count}`,
  kpi: {
    name: 'KPI card',
    loadingLabel: 'Loading SLA',
    label: 'SLA',
    emptyTitle: 'No KPI card data',
    errorTitle: 'Unable to load KPI card',
  },
  progress: {
    name: 'Progress bar',
    loadingLabel: 'Loading workload',
    label: 'Active workload',
    emptyTitle: 'No progress bar data',
    errorTitle: 'Unable to load progress bar',
  },
  status: {
    name: 'Status chip',
    loadingLabel: 'Loading status',
    zeroLabel: 'Optimal · 0 active',
    emptyTitle: 'No status chip data',
    errorTitle: 'Unable to load status chip',
  },
  panel: {
    name: 'Panel shell',
    title: 'Escalations',
    loadingLabel: 'Loading escalations',
    zeroLabel: '0 warnings',
    emptyTitle: 'No escalation data',
    errorTitle: 'Unable to load escalations',
  },
  domain: {
    name: 'Domain tile',
    loadingLabel: 'Loading Contracts',
    label: 'Contracts',
    emptyTitle: 'No domain tile data',
    errorTitle: 'Unable to load domain tile',
  },
};

function StateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-card border border-border bg-card p-3">
      {children}
    </div>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-caption font-semibold uppercase tracking-label text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function PrimitiveSpecimens({
  copy,
  loading,
  zero,
  empty,
  error,
  frameStates = true,
  onRetry,
}: PrimitiveSpecimensProps) {
  const wrap = (node: ReactNode) => {
    if (frameStates) return <StateFrame>{node}</StateFrame>;
    return node;
  };
  const sectionId = `legal-director-${copy.name.toLowerCase().replaceAll(' ', '-')}`;

  return (
    <section aria-labelledby={sectionId} className="space-y-3">
      <h3
        id={sectionId}
        className="text-body font-semibold text-foreground"
      >
        {copy.name}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Specimen label={DEV_COPY.states.loading}>{wrap(loading)}</Specimen>
        <Specimen label={DEV_COPY.states.empty}>
          {empty ?? (
            <StateFrame>
              <DashboardPrimitiveState
                state="empty"
                title={copy.emptyTitle}
                description={DEV_COPY.sourceEmptyDescription}
              />
            </StateFrame>
          )}
        </Specimen>
        <Specimen label={DEV_COPY.states.error}>
          {error ?? (
            <StateFrame>
              <DashboardPrimitiveState
                state="error"
                title={copy.errorTitle}
                description={DEV_COPY.requestErrorDescription}
                retryLabel={DEV_COPY.retryLabel}
                onRetry={onRetry}
              />
            </StateFrame>
          )}
        </Specimen>
        <Specimen label={DEV_COPY.states.zero}>{wrap(zero)}</Specimen>
      </div>
    </section>
  );
}

/** Internal Step 3 story surface for the Watheeq Legal Director primitives. */
export function LegalDirectorPrimitivesGallery() {
  const [retryCount, setRetryCount] = useState(0);
  const recordRetry = () => setRetryCount((current) => current + 1);

  return (
    <div className="space-y-8">
      <p aria-live="polite" className="text-caption text-muted-foreground">
        {DEV_COPY.retryCount(retryCount)}
      </p>

      <PrimitiveSpecimens
        copy={DEV_COPY.kpi}
        loading={<KpiCardSkeleton label={DEV_COPY.kpi.loadingLabel} tone="slate" />}
        zero={<KpiCard label={DEV_COPY.kpi.label} value={0} format="percent" tone="slate" />}
        frameStates={false}
        onRetry={recordRetry}
      />

      <PrimitiveSpecimens
        copy={DEV_COPY.progress}
        loading={<ProgressBarSkeleton label={DEV_COPY.progress.loadingLabel} />}
        zero={<ProgressBar label={DEV_COPY.progress.label} value={0} max={15} tone="optimal" />}
        onRetry={recordRetry}
      />

      <PrimitiveSpecimens
        copy={DEV_COPY.status}
        loading={<StatusChipSkeleton label={DEV_COPY.status.loadingLabel} />}
        zero={<StatusChip label={DEV_COPY.status.zeroLabel} tone="ok" />}
        onRetry={recordRetry}
      />

      <PrimitiveSpecimens
        copy={DEV_COPY.panel}
        loading={
          <PanelShell title={DEV_COPY.panel.title}>
            <DashboardPrimitiveState
              state="loading"
              label={DEV_COPY.panel.loadingLabel}
            />
          </PanelShell>
        }
        zero={
          <PanelShell title={DEV_COPY.panel.title}>
            <p className="text-body font-semibold tabular-nums text-foreground">
              {DEV_COPY.panel.zeroLabel}
            </p>
          </PanelShell>
        }
        empty={
          <PanelShell title={DEV_COPY.panel.title}>
            <DashboardPrimitiveState
              state="empty"
              title={DEV_COPY.panel.emptyTitle}
              description={DEV_COPY.sourceEmptyDescription}
            />
          </PanelShell>
        }
        error={
          <PanelShell title={DEV_COPY.panel.title}>
            <DashboardPrimitiveState
              state="error"
              title={DEV_COPY.panel.errorTitle}
              description={DEV_COPY.requestErrorDescription}
              retryLabel={DEV_COPY.retryLabel}
              onRetry={recordRetry}
            />
          </PanelShell>
        }
        frameStates={false}
        onRetry={recordRetry}
      />

      <PrimitiveSpecimens
        copy={DEV_COPY.domain}
        loading={<DomainTileSkeleton label={DEV_COPY.domain.loadingLabel} />}
        zero={
          <DomainTile
            tile={{
              key: 'contracts',
              label: DEV_COPY.domain.label,
              count: 0,
              tint: 'teal',
              href: '/lex/contracts',
            }}
          />
        }
        frameStates={false}
        onRetry={recordRetry}
      />
    </div>
  );
}
