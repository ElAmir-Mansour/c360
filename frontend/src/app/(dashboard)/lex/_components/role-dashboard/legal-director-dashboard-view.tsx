'use client';

import { useId, type ReactNode } from 'react';

import { useLegalDirectorDashboardLabels } from '../../_lib/role-dashboards/legal-director-i18n';
import { useLexFormat } from '@/lib/lex/ksa';

import { AiAgentPanel, type AiAgentPanelProps } from './widgets/ai-agent-panel';
import {
  DashboardCalendarPanel,
  DashboardCalendarPanelError,
  DashboardCalendarPanelLoading,
  type DashboardCalendarPanelProps,
} from './widgets/dashboard-calendar-panel';
import {
  EscalationPanel,
  EscalationPanelState,
  type EscalationPanelProps,
} from './widgets/escalation-panel';
import {
  KpiCard,
  KpiCardSkeleton,
  KpiCardUnavailable,
  type KpiCardProps,
  type KpiCardSkeletonProps,
  type KpiCardUnavailableProps,
} from './widgets/kpi-card';
import {
  LegalDomainsGrid,
  LegalDomainsGridError,
  LegalDomainsGridLoading,
  type LegalDomainsGridProps,
} from './widgets/legal-domains-grid';
import {
  ManagerTasksPanel,
  ManagerTasksPanelState,
  type ManagerTasksPanelProps,
} from './widgets/manager-tasks-panel';
import {
  ResolutionRatePanel,
  ResolutionRatePanelError,
  ResolutionRatePanelLoading,
  type ResolutionRateChartProps,
} from './widgets/resolution-rate-panel';
import {
  ServiceRequestDonut,
  ServiceRequestDonutState,
  type ServiceRequestDonutProps,
} from './widgets/service-request-donut';
import {
  WorkforceTeamPanel,
  type WorkforceTeamPanelProps,
} from './widgets/workforce-team-panel';
import styles from './legal-director-dashboard-view.module.css';

/**
 * Exact frozen §5 user display payload. `role` is presentation context only;
 * authorization and server-side data scoping must never be derived from it.
 */
export interface LegalDirectorDashboardUser {
  firstName: string;
  lastName: string;
  role: 'LEGAL_DIRECTOR';
  roleLabel: string;
}

/**
 * Three terminal KPI presentations, not two. `unavailable` exists because
 * `isAvailable: false` is a fail-soft permission (or non-retryable source)
 * signal rather than an error: without it a permission-masked position could
 * only be expressed as a skeleton, which would then never resolve.
 */
export type LegalDirectorKpiState =
  | { state: 'ready'; props: KpiCardProps }
  | { state: 'loading'; props: KpiCardSkeletonProps }
  | { state: 'unavailable'; props: KpiCardUnavailableProps };

/** The approved strip always contains the six §4.1 KPI positions. */
export type LegalDirectorKpiStrip = readonly [
  LegalDirectorKpiState,
  LegalDirectorKpiState,
  LegalDirectorKpiState,
  LegalDirectorKpiState,
  LegalDirectorKpiState,
  LegalDirectorKpiState,
];

/**
 * Pure presentation state. `onRetry` reports user intent to the caller and
 * does not imply a per-widget endpoint, request, or streaming contract.
 *
 * Exported so the caller can derive the four cases with one shared helper; the
 * mapping itself (error before loading) stays entirely on the caller's side.
 */
export type PanelState<T> =
  | { state: 'ready'; props: T }
  | { state: 'loading' }
  | { state: 'empty' }
  | { state: 'error'; onRetry: () => void };

export type LegalDirectorEscalationState = PanelState<EscalationPanelProps>;
export type LegalDirectorServiceRequestState = PanelState<ServiceRequestDonutProps>;
/**
 * The workforce panel's own union, not a `PanelState`. It is a strict superset:
 * `unavailable` (a masked domain the caller may not read) and `degraded` (a
 * partial report, e.g. no tenant calendar) carry meaning that collapsing into
 * `empty` would turn into a silent misreport of team capacity.
 */
export type LegalDirectorTeamWorkloadState = WorkforceTeamPanelProps;
export type LegalDirectorResolutionRateState = PanelState<ResolutionRateChartProps>;
export type LegalDirectorManagerTasksState = PanelState<ManagerTasksPanelProps>;
export type LegalDirectorDomainsState = PanelState<LegalDomainsGridProps>;
export type LegalDirectorCalendarState = PanelState<DashboardCalendarPanelProps>;
/**
 * The assistant's own union, with no absent case: "the caller has no assistant"
 * is expressed by omitting the prop, not by a state that renders nothing.
 */
export type LegalDirectorAiAgentState = AiAgentPanelProps;

export interface LegalDirectorDashboardViewProps {
  user: LegalDirectorDashboardUser;
  kpis: LegalDirectorKpiStrip;
  escalation: LegalDirectorEscalationState;
  serviceRequests: LegalDirectorServiceRequestState;
  teamWorkload: LegalDirectorTeamWorkloadState;
  /**
   * Control rendered with — and scoped to — the Team Workload panel. The
   * dashboard's time window only reaches the workforce report, so the control
   * that sets it sits beside that panel instead of over the whole surface,
   * where it would imply filtering five sources that accept no date range.
   */
  teamWorkloadControl?: ReactNode;
  resolutionRate: LegalDirectorResolutionRateState;
  /**
   * Task Management band. OPTIONAL and omitted rather than emptied: a caller who
   * can neither assign nor receive a task has no task board, and rendering an
   * empty one would imply their department simply has no work assigned.
   */
  managerTasks?: LegalDirectorManagerTasksState;
  legalDomains: LegalDirectorDomainsState;
  calendar: LegalDirectorCalendarState;
  /**
   * "My AI Agent" band — OPTIONAL, and omitted rather than emptied. The
   * assistant is a separately permissioned (`lex:ai:use`), feature-flagged
   * surface, so a caller without it is not looking at a dashboard with a broken
   * panel; they are looking at a dashboard that has no such panel. Passing an
   * error or an empty box here would claim otherwise.
   */
  aiAgent?: LegalDirectorAiAgentState;
}

function EscalationSlot({ value }: { value: LegalDirectorEscalationState }) {
  if (value.state === 'ready') return <EscalationPanel {...value.props} />;
  if (value.state === 'error') {
    return <EscalationPanelState state="error" onRetry={value.onRetry} />;
  }
  return <EscalationPanelState state={value.state} />;
}

function ServiceRequestSlot({ value }: { value: LegalDirectorServiceRequestState }) {
  if (value.state === 'ready') return <ServiceRequestDonut {...value.props} />;
  if (value.state === 'error') {
    return <ServiceRequestDonutState state="error" onRetry={value.onRetry} />;
  }
  return <ServiceRequestDonutState state={value.state} />;
}

function TeamWorkloadSlot({
  value,
  control,
}: {
  value: LegalDirectorTeamWorkloadState;
  control?: ReactNode;
}) {
  return (
    <div className={styles.teamWorkload} data-legal-director-team-workload="">
      {control ? <div className={styles.teamWorkloadControl}>{control}</div> : null}
      <WorkforceTeamPanel {...value} />
    </div>
  );
}

function ResolutionRateSlot({ value }: { value: LegalDirectorResolutionRateState }) {
  if (value.state === 'ready') return <ResolutionRatePanel {...value.props} />;
  if (value.state === 'loading') return <ResolutionRatePanelLoading />;
  if (value.state === 'error') return <ResolutionRatePanelError onRetry={value.onRetry} />;
  return <ResolutionRatePanel bars={[]} />;
}

function ManagerTasksSlot({ value }: { value?: LegalDirectorManagerTasksState }) {
  // No band at all for a caller with no task board — see the prop's doc comment.
  if (!value) return null;
  if (value.state === 'ready') return <ManagerTasksPanel {...value.props} />;
  if (value.state === 'error') {
    return <ManagerTasksPanelState state="error" onRetry={value.onRetry} />;
  }
  return <ManagerTasksPanelState state={value.state} />;
}

function LegalDomainsSlot({ value }: { value: LegalDirectorDomainsState }) {
  if (value.state === 'ready') return <LegalDomainsGrid {...value.props} />;
  if (value.state === 'loading') return <LegalDomainsGridLoading />;
  if (value.state === 'error') return <LegalDomainsGridError onRetry={value.onRetry} />;
  return <LegalDomainsGrid domains={[]} />;
}

function AiAgentSlot({ value }: { value?: LegalDirectorAiAgentState }) {
  // No band, no wrapper: an entitled-off caller gets no trace of the assistant
  // in the layout, not an empty grid row where one used to be.
  if (!value) return null;
  return (
    <div className={styles.aiAgent} data-legal-director-ai-agent="">
      <AiAgentPanel {...value} />
    </div>
  );
}

function ScheduleSlot({ value }: { value: LegalDirectorCalendarState }) {
  if (value.state === 'ready') return <DashboardCalendarPanel {...value.props} />;
  if (value.state === 'loading') return <DashboardCalendarPanelLoading />;
  if (value.state === 'error') return <DashboardCalendarPanelError onRetry={value.onRetry} />;
  // The ready panel owns its own empty presentation, so an empty band is an
  // empty event list rather than a second, divergent empty rendering.
  return <DashboardCalendarPanel events={[]} />;
}

/**
 * Pure Legal Director presentation composition. The caller owns contract
 * mapping and transport; this view only arranges approved primitive/panel props.
 */
export function LegalDirectorDashboardView({
  user,
  kpis,
  escalation,
  serviceRequests,
  teamWorkload,
  teamWorkloadControl,
  resolutionRate,
  managerTasks,
  legalDomains,
  calendar,
  aiAgent,
}: LegalDirectorDashboardViewProps) {
  const labels = useLegalDirectorDashboardLabels();
  const format = useLexFormat();
  const headingId = useId();
  const fullName = [user.firstName.trim(), user.lastName.trim()].filter(Boolean).join(' ');

  return (
    <section
      className={styles.dashboard}
      dir={format.direction}
      aria-labelledby={headingId}
      data-legal-director-dashboard-view=""
    >
      <header className={styles.hero}>
        <div className={styles.roleContext}>
          <p className={styles.roleEyebrow}>{labels.hero.roleEyebrow}</p>
          <p className={styles.rolePill} dir="auto">
            {user.roleLabel}
          </p>
        </div>
        <div className={styles.headingGroup}>
          <h1 id={headingId} className={styles.heading} dir="auto">
            {labels.hero.welcome(fullName)}
          </h1>
          <p className={styles.subtitle}>{labels.hero.subtitle}</p>
        </div>
      </header>

      <div className={styles.kpiStrip} data-legal-director-kpi-strip="">
        {kpis.map((kpi, index) => {
          if (kpi.state === 'ready') return <KpiCard key={index} {...kpi.props} />;
          if (kpi.state === 'unavailable') {
            return <KpiCardUnavailable key={index} {...kpi.props} />;
          }
          return <KpiCardSkeleton key={index} {...kpi.props} />;
        })}
      </div>

      <div className={styles.panelGrid} data-legal-director-panel-grid="">
        <div className={styles.panelColumn} data-panel-column="primary">
          <EscalationSlot value={escalation} />
          <TeamWorkloadSlot value={teamWorkload} control={teamWorkloadControl} />
        </div>
        <div className={styles.panelColumn} data-panel-column="secondary">
          <ServiceRequestSlot value={serviceRequests} />
          <ResolutionRateSlot value={resolutionRate} />
        </div>
      </div>

      {managerTasks ? (
        <div className={styles.managerTasks} data-legal-director-manager-tasks="">
          <ManagerTasksSlot value={managerTasks} />
        </div>
      ) : null}

      <AiAgentSlot value={aiAgent} />

      <div className={styles.schedule}>
        <ScheduleSlot value={calendar} />
      </div>

      <div className={styles.domains}>
        <LegalDomainsSlot value={legalDomains} />
      </div>

      {/*
        WLS §4.4 "View Balance Sheet →" is deliberately absent: LEX-LD-GAP-DESIGN
        G2 records that its destination page does not exist yet, and shipping a
        link to an approximate surface is worse than shipping none. The action
        arrives from the caller once /lex/reports/workforce lands.
      */}
    </section>
  );
}
