'use client';

import * as React from 'react';
import {
  CalendarCheck2,
  CheckCircle2,
  CircleSlash,
  ClipboardList,
  Clock4,
  Gauge,
  ListChecks,
  ShieldCheck,
  Timer,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricTile } from '@/components/shared/metric-tile';
import { IconBadge } from '@/components/shared/icon-badge';
import { ListRow } from '@/components/shared/list-row';
import { EmptyState } from '@/components/common/empty-state';
import { StatusChip, type StatusChipProps } from '@/components/shared/status-chip';
import { BarChart } from '@/components/shared/charts/bar-chart';
import { chartVar } from '@/lib/design-tokens';
import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import type {
  DRAttestation,
  DRFailoverRun,
  DRFailoverStep,
} from '@/types/clario-dr';
import { formatDuration, formatRatioPercent, formatTimestamp } from './format';

/**
 * PostImplementationReviewPanel
 * =============================
 * A post-implementation review (PIR) for a completed recovery event. It reads
 * the real failover-run + attestation contract and renders:
 *
 *   1. an objective-vs-achieved scorecard (RTO objective vs RTA actual, RPO),
 *   2. a four-gate outcome strip (Validate / Approve / Execute / Attest)
 *      derived from the run's gate steps,
 *   3. a chronological timeline of the run's steps (gate1.validate …
 *      gate4.attest, boot order, teardown) with pass/fail status,
 *   4. operator-authored issues/notes and follow-up action items.
 *
 * Real contract: `DRFailoverRun` (id, mode, status, rto_objective_seconds,
 * rto_actual_seconds, initiated/approved/completed metadata), `DRFailoverStep`
 * (step, status, started/finished), and `DRAttestation` (rto/rpo/validation
 * ratio + content hash). The RTO/RPO comparison chart is dynamically imported so
 * recharts stays out of the base bundle.
 *
 * All content arrives via props (issues, actions, labels) so the panel is
 * bilingual-ready; tokens only; RTL-aware.
 */

/** The four recovery gates, in order. */
export type PIRGateKey = 'validate' | 'approve' | 'execute' | 'attest';
export type PIRGateOutcome = 'passed' | 'failed' | 'skipped' | 'pending';

export interface PIRGate {
  key: PIRGateKey;
  outcome: PIRGateOutcome;
  /** Optional human note for the gate (e.g. approver, reason for failure). */
  detail?: string;
}

/** A free-form observation captured during the review. */
export interface PIRIssue {
  id: string;
  /** Drives the icon + chip tone; not the only signal (a label is always shown). */
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description?: string;
}

/** A tracked follow-up item with an owner and lifecycle status. */
export interface PIRActionItem {
  id: string;
  title: string;
  owner?: string;
  status: 'open' | 'in_progress' | 'done';
  dueLabel?: string;
}

export interface PIRLabels {
  panelTitle: string;
  /** Section headings. */
  objectivesHeading: string;
  gatesHeading: string;
  timelineHeading: string;
  issuesHeading: string;
  actionsHeading: string;
  /** Metric tile labels. */
  rtoObjectiveLabel: string;
  rtoActualLabel: string;
  rpoAchievedLabel: string;
  validationRatioLabel: string;
  /** RTO verdict chips. */
  rtoMet: string;
  rtoMissed: string;
  /** Gate labels. */
  gateValidate: string;
  gateApprove: string;
  gateExecute: string;
  gateAttest: string;
  /** Gate outcome labels. */
  outcomePassed: string;
  outcomeFailed: string;
  outcomeSkipped: string;
  outcomePending: string;
  /** Run metadata labels. */
  initiatedByLabel: string;
  approvedByLabel: string;
  completedAtLabel: string;
  attestationHashLabel: string;
  /** Action-item status labels. */
  actionOpen: string;
  actionInProgress: string;
  actionDone: string;
  /** Chart. */
  chartTitle: string;
  chartObjectiveSeries: string;
  chartAchievedSeries: string;
  chartRtoCategory: string;
  chartRpoCategory: string;
  /** Empty states. */
  noStepsTitle: string;
  noStepsDescription: string;
  noIssuesTitle: string;
  noIssuesDescription: string;
  noActionsTitle: string;
  noActionsDescription: string;
}

export interface PostImplementationReviewPanelProps {
  /** The completed (or terminal) failover run under review. */
  run: DRFailoverRun;
  /** Immutable attestation for the run (RTO/RPO/validation + content hash). */
  attestation?: DRAttestation;
  /** Ordered gate steps emitted by the failover driver. */
  steps?: DRFailoverStep[];
  /** Four-gate outcome summary (Validate / Approve / Execute / Attest). */
  gates: PIRGate[];
  /** Operator-authored observations from the review. */
  issues?: PIRIssue[];
  /** Tracked follow-up actions. */
  actionItems?: PIRActionItem[];
  /** Optional RPO objective in seconds (sites carry it; runs do not). */
  rpoObjectiveSeconds?: number;
  /** Bilingual content. Defaults to English. */
  labels?: Partial<PIRLabels>;
  /** Human-readable step labels keyed by backend step name. */
  stepLabels?: Record<string, string>;
  className?: string;
}

const DEFAULT_LABELS: PIRLabels = {
  panelTitle: 'Post-implementation review',
  objectivesHeading: 'Objectives vs achieved',
  gatesHeading: 'Gate outcomes',
  timelineHeading: 'Execution timeline',
  issuesHeading: 'Issues & observations',
  actionsHeading: 'Action items',
  rtoObjectiveLabel: 'RTO objective',
  rtoActualLabel: 'RTA achieved',
  rpoAchievedLabel: 'RPO achieved',
  validationRatioLabel: 'Validation ratio',
  rtoMet: 'RTO met',
  rtoMissed: 'RTO missed',
  gateValidate: 'Validate',
  gateApprove: 'Approve',
  gateExecute: 'Execute',
  gateAttest: 'Attest',
  outcomePassed: 'Passed',
  outcomeFailed: 'Failed',
  outcomeSkipped: 'Skipped',
  outcomePending: 'Pending',
  initiatedByLabel: 'Initiated by',
  approvedByLabel: 'Approved by',
  completedAtLabel: 'Completed',
  attestationHashLabel: 'Attestation hash',
  actionOpen: 'Open',
  actionInProgress: 'In progress',
  actionDone: 'Done',
  chartTitle: 'Recovery time / point — objective vs achieved (seconds)',
  chartObjectiveSeries: 'Objective',
  chartAchievedSeries: 'Achieved',
  chartRtoCategory: 'RTO',
  chartRpoCategory: 'RPO',
  noStepsTitle: 'No step records',
  noStepsDescription: 'This run completed without per-step execution records.',
  noIssuesTitle: 'No issues recorded',
  noIssuesDescription: 'The reviewer logged no observations for this recovery event.',
  noActionsTitle: 'No action items',
  noActionsDescription: 'No follow-up actions were raised from this review.',
};

const GATE_LABEL_KEY: Record<PIRGateKey, keyof PIRLabels> = {
  validate: 'gateValidate',
  approve: 'gateApprove',
  execute: 'gateExecute',
  attest: 'gateAttest',
};

const GATE_ICON: Record<PIRGateKey, LucideIcon> = {
  validate: ShieldCheck,
  approve: CheckCircle2,
  execute: Gauge,
  attest: ClipboardList,
};

const OUTCOME_META: Record<
  PIRGateOutcome,
  { tone: NonNullable<StatusChipProps['tone']>; icon: LucideIcon; labelKey: keyof PIRLabels }
> = {
  passed: { tone: 'success', icon: CheckCircle2, labelKey: 'outcomePassed' },
  failed: { tone: 'danger', icon: XCircle, labelKey: 'outcomeFailed' },
  skipped: { tone: 'neutral', icon: CircleSlash, labelKey: 'outcomeSkipped' },
  pending: { tone: 'warning', icon: Clock4, labelKey: 'outcomePending' },
};

const ISSUE_META: Record<
  PIRIssue['severity'],
  { tone: NonNullable<StatusChipProps['tone']>; icon: LucideIcon }
> = {
  critical: { tone: 'danger', icon: TriangleAlert },
  high: { tone: 'danger', icon: TriangleAlert },
  medium: { tone: 'warning', icon: TriangleAlert },
  low: { tone: 'info', icon: TriangleAlert },
  info: { tone: 'info', icon: ClipboardList },
};

const ACTION_META: Record<
  PIRActionItem['status'],
  { tone: NonNullable<StatusChipProps['tone']>; icon: LucideIcon; labelKey: keyof PIRLabels }
> = {
  open: { tone: 'warning', icon: Clock4, labelKey: 'actionOpen' },
  in_progress: { tone: 'info', icon: ListChecks, labelKey: 'actionInProgress' },
  done: { tone: 'success', icon: CheckCircle2, labelKey: 'actionDone' },
};

const STEP_STATUS_META: Record<
  string,
  { tone: NonNullable<StatusChipProps['tone']>; icon: LucideIcon }
> = {
  passed: { tone: 'success', icon: CheckCircle2 },
  running: { tone: 'info', icon: Clock4 },
  failed: { tone: 'danger', icon: XCircle },
};

/** Whether the run met its RTO: actual ≤ objective and an actual was recorded. */
function rtoWasMet(run: DRFailoverRun): boolean | null {
  if (run.rto_actual_seconds == null || run.rto_objective_seconds == null) {
    return null;
  }
  return run.rto_actual_seconds <= run.rto_objective_seconds;
}

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-h4 font-semibold text-content-primary">
      <Icon className="h-4 w-4 text-content-secondary" aria-hidden />
      {children}
    </h3>
  );
}

export function PostImplementationReviewPanel({
  run,
  attestation,
  steps = [],
  gates,
  issues = [],
  actionItems = [],
  rpoObjectiveSeconds,
  labels: labelOverrides,
  stepLabels,
  className,
}: PostImplementationReviewPanelProps) {
  const { locale } = useLocale();
  const labels = React.useMemo<PIRLabels>(
    () => ({ ...DEFAULT_LABELS, ...labelOverrides }),
    [labelOverrides],
  );

  const rtoActual = attestation?.rto_actual_seconds ?? run.rto_actual_seconds ?? null;
  const rtoObjective = run.rto_objective_seconds ?? attestation?.rto_objective_seconds ?? 0;
  const rpoAchieved = attestation?.rpo_seconds ?? null;
  const validationRatio = attestation?.validation_ratio ?? null;
  const metRto = rtoWasMet(run);

  const chartData = React.useMemo(() => {
    const rows: Array<Record<string, unknown>> = [
      {
        category: labels.chartRtoCategory,
        objective: rtoObjective,
        achieved: rtoActual ?? 0,
      },
    ];
    if (rpoObjectiveSeconds != null || rpoAchieved != null) {
      rows.push({
        category: labels.chartRpoCategory,
        objective: rpoObjectiveSeconds ?? 0,
        achieved: rpoAchieved ?? 0,
      });
    }
    return rows;
  }, [labels.chartRtoCategory, labels.chartRpoCategory, rtoObjective, rtoActual, rpoObjectiveSeconds, rpoAchieved]);

  return (
    <Card className={cn('border-outline-subtle bg-surface-card', className)}>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconBadge icon={CalendarCheck2} tone="primary" size="lg" />
            <div className="min-w-0">
              <CardTitle className="text-h3 text-content-primary">{labels.panelTitle}</CardTitle>
              <p className="mt-0.5 truncate font-mono text-caption text-content-muted" dir="ltr" title={run.id}>
                {run.id} · {run.mode}
              </p>
            </div>
          </div>
          {metRto != null && (
            <StatusChip
              tone={metRto ? 'success' : 'danger'}
              icon={metRto ? CheckCircle2 : XCircle}
              size="lg"
              label={metRto ? labels.rtoMet : labels.rtoMissed}
            />
          )}
        </div>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-caption text-content-secondary">
          <div className="flex items-center gap-1.5">
            <dt className="font-semibold uppercase tracking-caps text-content-muted">
              {labels.initiatedByLabel}
            </dt>
            <dd>{run.initiated_by}</dd>
          </div>
          {run.approved_by && (
            <div className="flex items-center gap-1.5">
              <dt className="font-semibold uppercase tracking-caps text-content-muted">
                {labels.approvedByLabel}
              </dt>
              <dd>{run.approved_by}</dd>
            </div>
          )}
          {run.completed_at && (
            <div className="flex items-center gap-1.5">
              <dt className="font-semibold uppercase tracking-caps text-content-muted">
                {labels.completedAtLabel}
              </dt>
              <dd>{formatTimestamp(run.completed_at, locale)}</dd>
            </div>
          )}
        </dl>
      </CardHeader>

      <CardContent className="flex flex-col gap-8">
        {/* 1. Objectives vs achieved scorecard. */}
        <section aria-label={labels.objectivesHeading} className="flex flex-col gap-3">
          <SectionTitle icon={Timer}>{labels.objectivesHeading}</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              icon={Timer}
              tone="muted"
              label={labels.rtoObjectiveLabel}
              value={formatDuration(rtoObjective)}
            />
            <MetricTile
              icon={Gauge}
              tone={metRto === false ? 'danger' : 'success'}
              label={labels.rtoActualLabel}
              value={rtoActual == null ? '—' : formatDuration(rtoActual)}
            />
            <MetricTile
              icon={Clock4}
              tone="info"
              label={labels.rpoAchievedLabel}
              value={rpoAchieved == null ? '—' : formatDuration(rpoAchieved)}
            />
            <MetricTile
              icon={ShieldCheck}
              tone={validationRatio != null && validationRatio >= 1 ? 'success' : 'warning'}
              label={labels.validationRatioLabel}
              value={formatRatioPercent(validationRatio, locale)}
            />
          </div>

          <BarChart
            title={labels.chartTitle}
            data={chartData}
            xKey="category"
            height={220}
            layout="horizontal"
            yKeys={[
              { key: 'objective', label: labels.chartObjectiveSeries, color: chartVar(2) },
              { key: 'achieved', label: labels.chartAchievedSeries, color: chartVar(0) },
            ]}
            yFormatter={(value) => formatDuration(value)}
          />

          {attestation?.content_hash && (
            <p className="flex flex-wrap items-center gap-1.5 text-caption text-content-muted">
              <span className="font-semibold uppercase tracking-caps">
                {labels.attestationHashLabel}
              </span>
              <span dir="ltr" className="font-mono text-content-secondary" title={attestation.content_hash}>
                {attestation.content_hash}
              </span>
            </p>
          )}
        </section>

        {/* 2. Gate outcomes. */}
        <section aria-label={labels.gatesHeading} className="flex flex-col gap-3">
          <SectionTitle icon={ShieldCheck}>{labels.gatesHeading}</SectionTitle>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {gates.map((gate) => {
              const meta = OUTCOME_META[gate.outcome];
              const GateIcon = GATE_ICON[gate.key];
              return (
                <li
                  key={gate.key}
                  className="flex flex-col gap-2 rounded-card border border-outline-subtle bg-bg-subtle p-card-padding"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <IconBadge icon={GateIcon} tone="primary" size="sm" />
                      <span className="text-body-sm font-semibold text-content-primary">
                        {labels[GATE_LABEL_KEY[gate.key]]}
                      </span>
                    </span>
                    <StatusChip tone={meta.tone} icon={meta.icon} label={labels[meta.labelKey]} />
                  </div>
                  {gate.detail && (
                    <p className="text-caption text-content-secondary">{gate.detail}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {/* 3. Execution timeline. */}
        <section aria-label={labels.timelineHeading} className="flex flex-col gap-3">
          <SectionTitle icon={ListChecks}>{labels.timelineHeading}</SectionTitle>
          {steps.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title={labels.noStepsTitle}
              description={labels.noStepsDescription}
              size="compact"
              className="border border-dashed border-outline-subtle"
            />
          ) : (
            <ol className="flex flex-col gap-2">
              {steps.map((step) => {
                const meta = STEP_STATUS_META[step.status] ?? STEP_STATUS_META.running;
                return (
                  <li key={step.id}>
                    <ListRow
                      leading={<IconBadge icon={meta.icon} tone={meta.tone === 'neutral' ? 'muted' : meta.tone} size="sm" />}
                      title={stepLabels?.[step.step] ?? step.step}
                      subtitle={`${formatTimestamp(step.started_at, locale)}${
                        step.finished_at ? ` → ${formatTimestamp(step.finished_at, locale)}` : ''
                      }`}
                      trailing={<StatusChip tone={meta.tone} label={step.status} />}
                    />
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* 4. Issues & observations. */}
        <section aria-label={labels.issuesHeading} className="flex flex-col gap-3">
          <SectionTitle icon={TriangleAlert}>{labels.issuesHeading}</SectionTitle>
          {issues.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={labels.noIssuesTitle}
              description={labels.noIssuesDescription}
              size="compact"
              className="border border-dashed border-outline-subtle"
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {issues.map((issue) => {
                const meta = ISSUE_META[issue.severity];
                return (
                  <li
                    key={issue.id}
                    className="flex items-start gap-3 rounded-card border border-outline-subtle bg-bg-subtle p-card-padding"
                  >
                    <IconBadge icon={meta.icon} tone={meta.tone === 'neutral' ? 'muted' : meta.tone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-body-sm font-semibold text-content-primary">{issue.title}</span>
                        <StatusChip tone={meta.tone} size="sm" label={issue.severity} />
                      </div>
                      {issue.description && (
                        <p className="mt-1 text-caption text-content-secondary">{issue.description}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 5. Action items. */}
        <section aria-label={labels.actionsHeading} className="flex flex-col gap-3">
          <SectionTitle icon={ClipboardList}>{labels.actionsHeading}</SectionTitle>
          {actionItems.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={labels.noActionsTitle}
              description={labels.noActionsDescription}
              size="compact"
              className="border border-dashed border-outline-subtle"
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {actionItems.map((item) => {
                const meta = ACTION_META[item.status];
                return (
                  <li key={item.id}>
                    <ListRow
                      leading={<IconBadge icon={meta.icon} tone={meta.tone === 'neutral' ? 'muted' : meta.tone} size="sm" />}
                      title={item.title}
                      subtitle={
                        [item.owner, item.dueLabel].filter(Boolean).join(' · ') || undefined
                      }
                      trailing={<StatusChip tone={meta.tone} label={labels[meta.labelKey]} />}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

export default PostImplementationReviewPanel;
