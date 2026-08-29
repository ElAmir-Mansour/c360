'use client';

import * as React from 'react';
import { AlertTriangle, ChevronDown, Info, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

import { DashboardPrimitiveState } from './dashboard-primitive-state';
import { PanelShell } from './panel-shell';
import { PanelActionLink } from './panel-action-link';
import type {
  WorkforceMetricValue,
  WorkforceReport,
  WorkforceTeamMember,
} from './workforce-contract';
import { useWorkforceLabels } from './workforce-i18n';
import { workforceDomainHref } from '../dashboard-drilldowns';

export type WorkforceTeamPanelProps =
  | { state: 'loading' }
  | { state: 'empty' }
  | { state: 'error'; onRetry: () => void }
  | { state: 'ready' | 'zero' | 'unavailable'; report: WorkforceReport }
  | { state: 'degraded'; report: WorkforceReport; onRetry: () => void };

type MetricKind = 'count' | 'percent' | 'days' | 'hours';

const MONOGRAM_TINTS = [
  'bg-[var(--wt-domain-blue)]',
  'bg-[var(--wt-domain-green)]',
  'bg-[var(--wt-domain-teal)]',
  'bg-[var(--wt-domain-amber)]',
  'bg-[var(--wt-domain-grey)]',
] as const;

function monogramTint(userId: string): string {
  const hash = Array.from(userId).reduce((total, character) => total + character.codePointAt(0)!, 0);
  return MONOGRAM_TINTS[hash % MONOGRAM_TINTS.length];
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const selected = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return selected.map((word) => Array.from(word)[0] ?? '').join('').toLocaleUpperCase();
}

function MetricCell({
  metric,
  kind,
  onAction,
}: {
  metric: WorkforceMetricValue;
  kind: MetricKind;
  onAction: () => void;
}) {
  const format = useLexFormat();
  const labels = useWorkforceLabels();

  if (!metric.available || metric.value === null) {
    const reason = labels.reason(metric);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tabIndex={0}
            aria-label={`${labels.values.unavailable}: ${reason}`}
            className="size-6 cursor-help gap-1 bg-transparent p-0 font-semibold text-[color:var(--wt-teal-700)] shadow-none hover:bg-transparent"
          >
            <span aria-hidden="true">—</span>
            <Info className="size-3.5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    );
  }

  const numeric = format.formatNumber(metric.value, { maximumFractionDigits: 1 });
  let rendered = numeric;
  if (kind === 'percent') {
    rendered = format.formatPercent(metric.value, { fromPercent: true, maximumFractionDigits: 1 });
  } else if (kind === 'days') {
    rendered = labels.values.days(numeric);
  } else if (kind === 'hours') {
    rendered = labels.values.hours(numeric);
  }
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onAction}
      className="h-auto rounded-sm p-0 whitespace-nowrap font-semibold tabular-nums outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      {rendered}
    </Button>
  );
}

function localizedTitle(member: WorkforceTeamMember, locale: string): string | undefined {
  if (!member.title) return undefined;
  return member.title[locale] || member.title.en || member.title.ar || undefined;
}

function IdentityMarkers({ member }: { member: WorkforceTeamMember }) {
  const labels = useWorkforceLabels();
  const markers: { key: string; label: string; critical: boolean }[] = [];
  if (member.userStatus !== 'active') {
    markers.push({ key: 'inactive', label: labels.identity.inactive, critical: true });
  }
  if (member.identityStatus === 'unverified') {
    markers.push({ key: 'unverified', label: labels.identity.unverified, critical: false });
  } else if (member.identityStatus === 'unknown') {
    markers.push({ key: 'unknown', label: labels.identity.unknown, critical: false });
  }
  if (markers.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {markers.map((marker) => (
        <span
          key={marker.key}
          className={cn(
            'inline-flex items-center gap-1 rounded-[var(--wt-radius-pill)] border-[length:var(--wt-card-border-width)] px-2 py-0.5 font-bold',
            'text-[length:var(--wt-font-size-caption)] leading-[var(--wt-line-height-caption)]',
            marker.critical
              ? 'border-[color:var(--wt-critical)] bg-[var(--wt-critical-050)] text-[color:var(--wt-critical)]'
              : 'border-[color:var(--wt-teal-300)] bg-[var(--wt-warn-050)] text-[color:var(--wt-teal-900)]',
          )}
        >
          {marker.critical ? <AlertTriangle className="size-3" aria-hidden="true" /> : <Info className="size-3" aria-hidden="true" />}
          {marker.label}
        </span>
      ))}
    </span>
  );
}

function ScopeNotices({ report, onRetry }: { report: WorkforceReport; onRetry?: () => void }) {
  const labels = useWorkforceLabels();
  const format = useLexFormat();
  const scopeMessage = report.scope.reason === 'no_org_role'
    ? labels.scope.no_org_role
    : report.scope.reason === 'roster_not_configured'
      ? labels.scope.roster_not_configured
      : undefined;
  const staleMessage = report.scope.warning === 'roster_stale'
    ? labels.scope.roster_stale(format.formatNumber(report.scope.staleDays ?? 0))
    : undefined;
  if (!scopeMessage && !staleMessage && !report.degraded) return null;

  return (
    <div className="space-y-2" aria-live="polite">
      {scopeMessage ? (
        <div className="flex items-start gap-2 rounded-[var(--wt-radius-card)] border-[length:var(--wt-card-border-width)] border-[color:var(--wt-high)] bg-[var(--wt-warn-050)] p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p dir="auto">{scopeMessage}</p>
        </div>
      ) : null}
      {staleMessage ? (
        <div className="flex items-start gap-2 rounded-[var(--wt-radius-card)] border-[length:var(--wt-card-border-width)] border-[color:var(--wt-high)] bg-[var(--wt-warn-050)] p-3">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p dir="auto">{staleMessage}</p>
        </div>
      ) : null}
      {report.degraded ? (
        <div className="rounded-[var(--wt-radius-card)] border-[length:var(--wt-card-border-width)] border-[color:var(--wt-critical)] bg-[var(--wt-critical-050)] p-3">
          <p className="flex items-center gap-2 font-bold">
            <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
            {labels.degraded.title}
          </p>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {report.errors.map((error, index) => (
              <li key={`${error.domain}:${error.kind}:${index}`} dir="auto">
                {labels.degraded[error.kind](labels.domain(error.domain))}
              </li>
            ))}
          </ul>
          {onRetry && report.errors.some((error) => error.kind === 'query_error') ? (
            <Button type="button" size="sm" variant="outline" className="mt-3 shadow-none" onClick={onRetry}>
              {labels.actions.retry}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkforceTable({ report }: { report: WorkforceReport }) {
  const labels = useWorkforceLabels();
  const format = useLexFormat();
  const disclosureIdPrefix = React.useId().replace(/:/g, '');
  const [expandedMembers, setExpandedMembers] = React.useState<Set<string>>(() => new Set());
  const columns = [
    { key: 'member', label: labels.columns.member },
    { key: 'active-workload', label: labels.columns.activeWorkload },
    { key: 'load-index', label: labels.columns.loadIndexPct },
    { key: 'utilisation', label: labels.columns.utilisationPct },
    {
      key: 'completion-rate',
      label: labels.columns.completionRatePct,
      anchor: labels.anchors.completionRatePct,
    },
    { key: 'on-time', label: labels.columns.onTimePct },
    { key: 'median-cycle', label: labels.columns.medianCycleDays },
    { key: 'approval-latency', label: labels.columns.approvalLatencyHrs },
    {
      key: 'obligation-discharge',
      label: labels.columns.obligationDischargePct,
      anchor: labels.anchors.obligationDischargePct,
    },
    { key: 'overdue', label: labels.columns.overdueCount },
    { key: 'idle-assignment', label: labels.columns.idleAssignmentPct },
  ] as const;
  const maxActive = Math.max(
    0,
    ...report.team.map((member) =>
      member.metrics.activeWorkload.available ? (member.metrics.activeWorkload.value ?? 0) : 0,
    ),
  );

  return (
    <TooltipProvider delayDuration={150}>
        <Table className="min-w-full text-start" scrollRegionLabel={labels.description}>
          <TableCaption className="sr-only">{labels.description}</TableCaption>
          <TableHeader>
            <TableRow className="transition-none hover:bg-[var(--wt-surface)]">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  scope="col"
                  className={cn(
                    'h-auto border-b-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)] bg-[var(--wt-surface)] px-3 py-3 text-start font-bold normal-case text-[color:var(--wt-teal-900)] shadow-none backdrop-blur-none',
                    'anchor' in column ? 'min-w-56 whitespace-normal' : 'whitespace-nowrap',
                  )}
                >
                  <span className="block">{column.label}</span>
                  {'anchor' in column ? (
                    <span className="mt-1 block text-[length:var(--wt-font-size-caption)] font-normal leading-[var(--wt-line-height-caption)] text-[color:var(--wt-teal-700)]">
                      {column.anchor}
                    </span>
                  ) : null}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.team.map((member, memberIndex) => {
              const title = localizedTitle(member, format.locale);
              const active = member.metrics.activeWorkload.value ?? 0;
              const progress = maxActive > 0 ? Math.min(Math.max((active / maxActive) * 100, 0), 100) : 0;
              const expanded = expandedMembers.has(member.userId);
              const triggerId = `${disclosureIdPrefix}-member-${memberIndex}`;
              const detailId = `${triggerId}-details`;
              const toggleBreakdown = () => {
                setExpandedMembers((current) => {
                  const next = new Set(current);
                  if (next.has(member.userId)) {
                    next.delete(member.userId);
                  } else {
                    next.add(member.userId);
                  }
                  return next;
                });
              };
              return (
                <React.Fragment key={member.userId}>
                  <TableRow data-user-status={member.userStatus} data-identity-status={member.identityStatus} className="transition-none hover:bg-[var(--wt-surface)]">
                  <TableHead
                    scope="row"
                    className="static z-auto h-auto min-w-64 border-b-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)] bg-[var(--wt-surface)] px-3 py-4 text-start font-normal normal-case text-[color:var(--wt-teal-900)] shadow-none backdrop-blur-none"
                  >
                    <Button
                      id={triggerId}
                      type="button"
                      variant="ghost"
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      aria-label={expanded
                        ? labels.actions.hideBreakdown(member.displayName)
                        : labels.actions.showBreakdown(member.displayName)}
                      className="h-auto min-h-11 w-full items-start justify-start gap-3 whitespace-normal rounded-[var(--wt-radius-card)] bg-transparent p-0 text-start shadow-none hover:bg-transparent"
                      onClick={toggleBreakdown}
                    >
                      <Avatar className="size-10 shrink-0" role="img" aria-label={member.displayName}>
                        {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" className="object-cover" /> : null}
                        <AvatarFallback className={cn(monogramTint(member.userId), 'font-bold text-[color:var(--wt-teal-900)]')}>
                          {initialsFor(member.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block break-words font-bold" dir="auto">{member.displayName}</span>
                        {title ? <span className="block break-words text-[color:var(--wt-teal-700)]" dir="auto">{title}</span> : null}
                        <IdentityMarkers member={member} />
                      </span>
                      <ChevronDown
                        className={cn('ms-auto mt-1 size-4 shrink-0 transition-transform', expanded && 'rotate-180')}
                        aria-hidden="true"
                      />
                    </Button>
                  </TableHead>
                  <TableCell className="min-w-44 border-b-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)] px-3 py-4">
                    <MetricCell metric={member.metrics.activeWorkload} kind="count" onAction={toggleBreakdown} />
                    {member.metrics.activeWorkload.available ? (
                      <div
                        role="progressbar"
                        aria-label={labels.columns.activeWorkload}
                        aria-valuemin={0}
                        aria-valuemax={maxActive}
                        aria-valuenow={active}
                        className="mt-2 h-2 overflow-hidden rounded-[var(--wt-radius-pill)] bg-[var(--wt-track)]"
                      >
                        <span className="block h-full bg-[var(--wt-teal-600)]" style={{ inlineSize: `${progress}%` }} />
                      </div>
                    ) : null}
                    {member.linkedCount > 0 ? (
                      <span className="mt-1 block whitespace-nowrap text-[color:var(--wt-teal-700)]">
                        {labels.values.linked(format.formatNumber(member.linkedCount))}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    data-workforce-metric="load-index"
                    className="px-3 py-4 text-[color:var(--wt-teal-900)]"
                  >
                    <MetricCell metric={member.metrics.loadIndexPct} kind="percent" onAction={toggleBreakdown} />
                  </TableCell>
                  <TableCell className="px-3 py-4"><MetricCell metric={member.metrics.utilisationPct} kind="percent" onAction={toggleBreakdown} /></TableCell>
                  <TableCell className="px-3 py-4"><MetricCell metric={member.metrics.completionRatePct} kind="percent" onAction={toggleBreakdown} /></TableCell>
                  <TableCell className="px-3 py-4"><MetricCell metric={member.metrics.onTimePct} kind="percent" onAction={toggleBreakdown} /></TableCell>
                  <TableCell className="px-3 py-4"><MetricCell metric={member.metrics.medianCycleDays} kind="days" onAction={toggleBreakdown} /></TableCell>
                  <TableCell className="px-3 py-4"><MetricCell metric={member.metrics.approvalLatencyHrs} kind="hours" onAction={toggleBreakdown} /></TableCell>
                  <TableCell className="px-3 py-4"><MetricCell metric={member.metrics.obligationDischargePct} kind="percent" onAction={toggleBreakdown} /></TableCell>
                  <TableCell className="px-3 py-4"><MetricCell metric={member.metrics.overdueCount} kind="count" onAction={toggleBreakdown} /></TableCell>
                  <TableCell className="px-3 py-4"><MetricCell metric={member.metrics.idleAssignmentPct} kind="percent" onAction={toggleBreakdown} /></TableCell>
                  </TableRow>
                  {expanded ? (
                    <TableRow className="transition-none hover:bg-[var(--wt-surface)]">
                      <TableCell
                        colSpan={columns.length}
                        className="border-b-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)] bg-[var(--wt-surface)] px-3 py-4"
                      >
                        <div id={detailId} role="region" aria-labelledby={triggerId}>
                          {member.byDomain.length > 0 ? (
                            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                              {member.byDomain.map((breakdown) => (
                                <li key={`${breakdown.domain}:${breakdown.rel}:${breakdown.attributionPath}`}>
                                  <Link
                                    href={workforceDomainHref(breakdown.domain)}
                                    className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--wt-radius-card)] border-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)] bg-[var(--wt-canvas)] px-3 py-2 font-semibold text-[color:var(--wt-teal-900)] outline-none hover:bg-[var(--wt-track)] focus-visible:ring-2 focus-visible:ring-[color:var(--wt-teal-600)] focus-visible:ring-offset-2"
                                  >
                                    <span dir="auto">{labels.domain(breakdown.domain)}</span>
                                    <span className="flex shrink-0 gap-3 text-[color:var(--wt-teal-700)]">
                                      <span>{labels.values.open}: <span className="tabular-nums">{format.formatNumber(breakdown.open)}</span></span>
                                      <span>{labels.values.resolved}: <span className="tabular-nums">{format.formatNumber(breakdown.resolved)}</span></span>
                                    </span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-[color:var(--wt-teal-700)]">{labels.values.noBreakdown}</p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
    </TooltipProvider>
  );
}

function ReportContent({ report, unavailable, onRetry }: { report: WorkforceReport; unavailable: boolean; onRetry?: () => void }) {
  const labels = useWorkforceLabels();
  const format = useLexFormat();
  const scopeMode = labels.scope.modes[report.scope.mode];
  const stableDateOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } as const;
  const periodFrom = format.formatDate(`${report.period.from}T00:00:00Z`, stableDateOptions);
  const periodTo = format.formatDate(`${report.period.to}T00:00:00Z`, stableDateOptions);
  const coveragePercent = format.formatPercent(report.coverage.attributionPct, { fromPercent: true });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[color:var(--wt-teal-700)]">
        <span className="rounded-[var(--wt-radius-pill)] border-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)] px-3 py-1 font-bold">
          {labels.scope.label}: {scopeMode}
        </span>
        <span>{labels.scope.memberCount(format.formatNumber(report.scope.memberCount))}</span>
        <span aria-hidden="true">·</span>
        <span>{labels.period.label(periodFrom, periodTo)}</span>
        <span aria-hidden="true">·</span>
        <span>{labels.period[report.period.calendarSource]}</span>
        {report.period.calendarSource === 'tenant' && report.period.workingDays.available && report.period.workingDays.value !== null ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{labels.period.workingDays(format.formatNumber(report.period.workingDays.value))}</span>
          </>
        ) : null}
      </div>
      <p className="text-[color:var(--wt-teal-700)]">{labels.period.asOfNow}</p>
      <ScopeNotices report={report} onRetry={onRetry} />
      {unavailable ? (
        <div className="flex items-start gap-2 rounded-[var(--wt-radius-card)] border-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)] bg-[var(--wt-warn-050)] p-3" role="status">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{labels.states.unavailable}</p>
        </div>
      ) : null}
      <WorkforceTable report={report} />
      <footer className="flex flex-wrap gap-x-2 gap-y-1 border-t-[length:var(--wt-card-border-width)] border-[color:var(--wt-teal-300)] pt-3 text-[color:var(--wt-teal-700)]">
        <span>
          {labels.coverage.summary(
            format.formatNumber(report.coverage.itemsAttributed),
            format.formatNumber(report.coverage.itemsTotal),
            coveragePercent,
          )}
        </span>
        {report.coverage.rowsTruncated > 0 ? (
          <span>{labels.coverage.truncated(format.formatNumber(report.coverage.rowsTruncated))}</span>
        ) : null}
      </footer>
    </div>
  );
}

/** Presentation-only workforce surface; production data is supplied by the dashboard header. */
export function WorkforceTeamPanel(props: WorkforceTeamPanelProps) {
  const labels = useWorkforceLabels();
  if (props.state === 'loading') {
    return (
      <PanelShell title={labels.title} description={labels.description}>
        <DashboardPrimitiveState state="loading" label={labels.states.loading} />
      </PanelShell>
    );
  }
  if (props.state === 'empty') {
    return (
      <PanelShell title={labels.title} description={labels.description}>
        <DashboardPrimitiveState state="empty" title={labels.states.empty} />
      </PanelShell>
    );
  }
  if (props.state === 'error') {
    return (
      <PanelShell title={labels.title} description={labels.description}>
        <DashboardPrimitiveState state="error" title={labels.states.error} retryLabel={labels.actions.retry} onRetry={props.onRetry} />
      </PanelShell>
    );
  }
  return (
    <PanelShell
      title={labels.title}
      description={labels.description}
      data-workforce-state={props.state}
      action={<PanelActionLink href="/lex/reports" label={labels.actions.viewReports} />}
    >
      <ReportContent
        report={props.report}
        unavailable={props.state === 'unavailable'}
        onRetry={props.state === 'degraded' ? props.onRetry : undefined}
      />
    </PanelShell>
  );
}
