'use client';

/**
 * ClarioDR design-system PROOF PAGE — Recovery Operations Dashboard.
 * =================================================================
 * A public, production-grade operator dashboard that composes the Phase-3
 * ClarioDR product layer end-to-end on the adopted design system. It proves the
 * full vertical: live single-event recovery, concurrent runbooks, the runbook
 * task DAG, the recovery topology, the tamper-evident attestation ledger, the
 * post-incident review, and the integration surface.
 *
 * Every component is composed with the committed, typed sample exports (no
 * hand-rolled DR object literals) and every visible token is design-system
 * driven — no hardcoded colour/spacing/type/radius/shadow/motion. The chrome is
 * a semantic header + main with a skip link, mirroring the landing proof page's
 * idiom; theme + locale (light/dark, EN/AR RTL) switch live from the app bar.
 */

import * as React from 'react';

import { ThemeLocaleSwitcher } from '@/components/layout/theme-locale-switcher';

import {
  RecoveryDashboard,
  MultiRunbookDashboard,
  RunbookTaskFlow,
  NodeMap,
  AuditTrailTable,
  PostImplementationReviewPanel,
  IntegrationCardsGrid,
  topologyToGraph,
  type IntegrationDescriptor,
} from '@/components/product';
import type { DRFailoverRun } from '@/lib/clario-dr';

import {
  sampleTopology,
  nodeMapLabelsEn,
  statusLabelEn,
} from '@/components/product/nodemap/node-map-fixtures';
import {
  sampleRunbookTasks,
  sampleTaskRuns,
  sampleProjection,
  runbookTaskFlowLabelsEn,
} from '@/components/product/runbook/runbook-fixtures';
import {
  sampleStreams,
  sampleRecoveryPoint,
  sampleGroupSummary,
  sampleActiveRun,
  sampleRuns,
  sampleAnalytics,
  recoveryDashboardLabelsEn,
  multiRunbookLabelsEn,
} from '@/components/product/dashboard/dashboard.gallery';
import {
  sampleLedgerEntries,
  sampleIntactVerification,
  sampleFailoverRun,
  sampleAttestation,
  sampleSteps,
  sampleGates,
  sampleIssues,
  sampleActions,
  sampleIntegrations,
} from '@/components/product/records/records.gallery';

/* -------------------------------------------------------------------------- */
/* Section scaffold — keeps heading order + landmark grammar consistent.       */
/* -------------------------------------------------------------------------- */

interface SectionProps {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

function DashboardSection({ id, eyebrow, title, description, children }: SectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-gutter">
      <div className="flex flex-col gap-1">
        <p className="text-overline font-semibold uppercase tracking-caps text-brand-teal-500">
          {eyebrow}
        </p>
        <h2 id={headingId} className="text-h2 font-semibold text-content-primary">
          {title}
        </h2>
        <p className="max-w-3xl text-body text-content-secondary">{description}</p>
      </div>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Page.                                                                       */
/* -------------------------------------------------------------------------- */

export default function RecoveryDashboardProofPage() {
  // Recovery topology → laid-out graph (typed nodes/edges) for the NodeMap.
  const { nodes, edges } = React.useMemo(() => topologyToGraph(sampleTopology), []);

  // Concurrent-runbook drill-down: track the selected run for a visible caption.
  const [selectedRun, setSelectedRun] = React.useState<DRFailoverRun | null>(
    sampleActiveRun,
  );
  const handleSelectRun = React.useCallback((run: DRFailoverRun) => {
    setSelectedRun(run);
  }, []);

  // Integration drill-down: track the last-configured integration for a caption.
  const [selectedIntegration, setSelectedIntegration] =
    React.useState<IntegrationDescriptor | null>(null);
  const handleConfigure = React.useCallback((integration: IntegrationDescriptor) => {
    setSelectedIntegration(integration);
  }, []);

  return (
    <div className="min-h-screen bg-bg-page text-content-primary">
      <a
        href="#recovery-main"
        className="sr-only rounded-button bg-surface-card px-4 py-2 text-body-sm font-semibold text-content-primary shadow-elevation-2 focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:outline-none focus:ring-2 focus:ring-outline-focus"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-outline-subtle bg-surface-overlay/95 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-gutter px-section-x py-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 items-center justify-center rounded-card bg-brand-primary-600 text-body-sm font-bold text-content-on-primary shadow-elevation-1"
            >
              DR
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-body font-bold tracking-label text-content-primary">
                ClarioDR
              </span>
              <span className="text-caption text-content-muted">
                Recovery operations console
              </span>
            </div>
          </div>
          <ThemeLocaleSwitcher />
        </div>
      </header>

      <main
        id="recovery-main"
        className="flex w-full flex-col gap-section-y px-section-x py-section-y"
      >
        <div className="flex flex-col gap-3">
          <p className="text-overline font-semibold uppercase tracking-caps-wide text-brand-gold-400">
            Sovereign disaster recovery
          </p>
          <h1 className="text-display font-bold text-content-primary">
            Recovery operations dashboard
          </h1>
          <p className="max-w-3xl text-body-lg text-content-secondary">
            One operator surface for every recovery event — live failover
            progress, concurrent runbooks, the executable task flow, the recovery
            topology, and the evidence trail your auditors verify. Switch theme
            and language from the app bar to see the system render light, dark,
            and right-to-left.
          </p>
        </div>

        <DashboardSection
          id="live-recovery"
          eyebrow="In flight"
          title="Live recovery"
          description="Real-time posture for the active event: runbook gate progress, RTO-vs-RTA, replication lag, and the latest validated recovery point."
        >
          <RecoveryDashboard
            summary={sampleGroupSummary}
            activeRun={sampleActiveRun}
            streams={sampleStreams}
            recoveryPoint={sampleRecoveryPoint}
            analyticsData={sampleAnalytics}
            labels={recoveryDashboardLabelsEn}
          />
        </DashboardSection>

        <DashboardSection
          id="concurrent-runbooks"
          eyebrow="Across events"
          title="Concurrent runbooks"
          description="Manage every active and recent failover from one list. Select a run to focus it — the selection drives the highlighted row and the caption below."
        >
          <MultiRunbookDashboard
            runs={sampleRuns}
            selectedRunId={selectedRun?.id ?? null}
            onSelectRun={handleSelectRun}
            labels={multiRunbookLabelsEn}
          />
          <p
            aria-live="polite"
            className="text-body-sm text-content-secondary"
          >
            {selectedRun ? (
              <>
                Focused run:{' '}
                <span className="font-semibold text-content-primary">
                  {selectedRun.id}
                </span>{' '}
                <span className="text-content-muted">
                  ({selectedRun.group_id} · {selectedRun.mode} · {selectedRun.status})
                </span>
              </>
            ) : (
              <span className="text-content-muted">
                Select a run to focus it.
              </span>
            )}
          </p>
        </DashboardSection>

        <DashboardSection
          id="runbook-task-flow"
          eyebrow="The plan, executing"
          title="Runbook task flow"
          description="The authored recovery DAG with live execution: ownership, planned-vs-actual timing, dependencies, and the critical path that sets the floor on recovery time."
        >
          <RunbookTaskFlow
            tasks={sampleRunbookTasks}
            taskRuns={sampleTaskRuns}
            projection={sampleProjection}
            labels={runbookTaskFlowLabelsEn}
          />
        </DashboardSection>

        <DashboardSection
          id="recovery-topology"
          eyebrow="Dependency-aware"
          title="Recovery topology"
          description="The recovery process graph — services, their dependencies, and the boot order ClarioDR honours during failover, with the critical path made visible."
        >
          <NodeMap
            nodes={nodes}
            edges={edges}
            statusLabel={statusLabelEn}
            labels={nodeMapLabelsEn}
          />
        </DashboardSection>

        <DashboardSection
          id="attestation-ledger"
          eyebrow="Tamper-evident"
          title="Attestation ledger"
          description="The hash-chained record of every recovery action. Cryptographic verification confirms the chain is intact and unaltered since seal."
        >
          <AuditTrailTable
            entries={sampleLedgerEntries}
            verification={sampleIntactVerification}
          />
        </DashboardSection>

        <DashboardSection
          id="post-incident-review"
          eyebrow="After the event"
          title="Post-incident review"
          description="The closed-out review for a completed failover: the four-gate outcome, the immutable attestation, observed issues, and tracked follow-up actions."
        >
          <PostImplementationReviewPanel
            run={sampleFailoverRun}
            attestation={sampleAttestation}
            steps={sampleSteps}
            gates={sampleGates}
            issues={sampleIssues}
            actionItems={sampleActions}
          />
        </DashboardSection>

        <DashboardSection
          id="integrations"
          eyebrow="Connected systems"
          title="Integrations"
          description="Where ClarioDR sends recovery signal — notifications, ticketing, on-call, and custom endpoints. Configure a connection to see it reflected below."
        >
          <IntegrationCardsGrid
            integrations={sampleIntegrations}
            onConfigure={handleConfigure}
          />
          <p
            aria-live="polite"
            className="text-body-sm text-content-secondary"
          >
            {selectedIntegration ? (
              <>
                Configuring:{' '}
                <span className="font-semibold text-content-primary">
                  {selectedIntegration.name}
                </span>{' '}
                <span className="text-content-muted">
                  ({selectedIntegration.category} · {selectedIntegration.status})
                </span>
              </>
            ) : (
              <span className="text-content-muted">
                Select an integration to configure it.
              </span>
            )}
          </p>
        </DashboardSection>
      </main>
    </div>
  );
}
