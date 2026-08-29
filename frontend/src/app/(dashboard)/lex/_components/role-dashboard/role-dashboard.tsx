'use client';

/**
 * Per-ROLE landing dashboard orchestrator.
 *
 * Resolves the active persona's declarative config (`dashboardConfigForRole`),
 * pulls the normalized live model (`useRoleDashboardData`), and renders a
 * bespoke dashboard — welcome hero + KPI row + a two-column body of
 * list/donut/bar/alerts panels — composed from the shared command-center
 * primitives. Every KPI/panel self-hides when its source is ungated or empty,
 * so the same surface degrades gracefully for a lightly-permissioned role.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, CheckCheck, Download, FileText, Inbox, LayoutGrid, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/shared/status-badge';
import { IconBadge } from '@/components/shared/icon-badge';
import { useAuth } from '@/hooks/use-auth';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';

import {
  CommandCard,
  EmptyState,
  SectionHeader,
} from '../command-ui';
import {
  useRoleDashboardData,
  type RequestListItem,
  type RoleDashboardModel,
} from '../../_lib/role-dashboards/use-role-dashboard-data';
import {
  dashboardConfigForRole,
  DEFAULT_FULL_WIDTH,
  KPI_CATALOG,
  type WidgetSpec,
} from '../../_lib/role-dashboards/registry';
import { LEX_DOMAINS } from '../../_lib/lex-domains';
import { DomainTile } from '../domain-tile';
import {
  contractStatusLabel,
  useRoleDashboardStrings,
  type RoleDashboardT,
} from '../../_lib/role-dashboards/i18n';
import { DashboardKpiCard, DASHLET_ACCENTS } from './dashboard-kpi-card';
import { DistributionDonut } from './distribution-donut';
import { MetricBarChart } from './metric-bar-chart';
import { EscalationSeverityChart } from './escalation-severity-chart';
import {
  contractStatusDrilldownHref,
  escalationDrilldownHref,
  kpiDrilldownHref,
  resolutionDrilldownHref,
  serviceDistributionHref,
  workloadDrilldownHref,
} from './dashboard-drilldowns';
import { WorkforceTeamPanel } from './widgets/workforce-team-panel';
import { ManagerTasksPanel, ManagerTasksPanelState } from './widgets/manager-tasks-panel';
import { useManagerTasksPanel } from '../../_lib/role-dashboards/use-manager-tasks-panel';
import { LegalDirectorDashboardContainer } from './legal-director-dashboard-container';
import { InboxGroup } from '../../inbox/_components/inbox-group';
import { InboxDecisionDialog } from '../../inbox/_components/inbox-decision-dialog';
import { useInboxLabels } from '../../inbox/_lib/labels';
import type { InboxItem, InboxItemAction } from '../../inbox/_lib/use-inbox';

interface RoleDashboardProps {
  roleSlug: string | null;
  /** CSV export handler from the page (reuses the shared dashboard cache). */
  onExport?: () => void;
  exportDisabled?: boolean;
}

/** Role slugs whose landing surface is a bespoke composition, not a registry entry. */
const BESPOKE_ROLE_LEGAL_DIRECTOR = 'legal-director';

/**
 * Persona dispatcher. Deliberately holds NO hooks of its own so a bespoke
 * dashboard mounts as a whole subtree — the generic body's ~20-query fan-out
 * never runs for a persona that does not render it, and no hook order can
 * change when the active role does.
 *
 * The Legal Director surface is a bespoke composition rather than a
 * re-parameterisation of the declarative registry (whose `kpis/left/right`
 * vocabulary cannot express its six-card strip, full-width domain grid or
 * panel-scoped time window). Its `registry.ts` entry stays in place as the
 * fallback if this container is ever gated off.
 */
export function RoleDashboard(props: RoleDashboardProps) {
  if (props.roleSlug?.replace(/_/g, '-') === BESPOKE_ROLE_LEGAL_DIRECTOR) {
    return <LegalDirectorDashboardContainer />;
  }
  return <GenericRoleDashboard {...props} />;
}

function GenericRoleDashboard({ roleSlug, onExport, exportDisabled }: RoleDashboardProps) {
  const { user } = useAuth();
  const { t } = useRoleDashboardStrings();
  const config = dashboardConfigForRole(roleSlug);
  const model = useRoleDashboardData(roleSlug);

  const firstName =
    (user?.first_name?.trim() || user?.full_name?.trim().split(/\s+/)[0] || '') ||
    (user?.email ? user.email.split('@')[0] : '');

  return (
    <div className="space-y-6">
      {/* Welcome hero */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-caption font-medium uppercase tracking-wide text-muted-foreground">
            {t(config.eyebrowKey)}
          </p>
          <h1 className="mt-1 text-h2 font-semibold text-foreground">
            {firstName ? t('ui.welcome', { name: firstName }) : t(config.eyebrowKey)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t(config.subtitleKey)}</p>
        </div>
        {onExport ? (
          <Button type="button" variant="outline" size="sm" onClick={onExport} disabled={exportDisabled}>
            <Download className="me-1.5 h-4 w-4" />
            {t('ui.exportReports')}
          </Button>
        ) : null}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {config.kpis.map((key, index) => {
          const spec = KPI_CATALOG[key];
          const datum = model.kpis[key];
          if (!datum.isAvailable && !datum.isLoading) return null;
          return (
            <DashboardKpiCard
              key={key}
              label={t(`kpi.${key}`)}
              datum={datum}
              format={spec.format}
              href={kpiDrilldownHref(key)}
              tone={spec.tone}
              caption={model.kpiCaptions[key]}
              accent={DASHLET_ACCENTS[index % DASHLET_ACCENTS.length]}
            />
          );
        })}
      </div>

      {/* Two-column body */}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">{config.left.map((w, i) => renderWidget(w, i, model, t, roleSlug))}</div>
        <div className="space-y-6">{config.right.map((w, i) => renderWidget(w, i, model, t, roleSlug))}</div>
      </div>

      {/* Full-width sections (folded-in legal-domain navigation, etc.) */}
      <div className="space-y-6">
        {(config.full ?? DEFAULT_FULL_WIDTH).map((w, i) => renderWidget(w, i, model, t, roleSlug))}
      </div>
    </div>
  );
}

function renderWidget(
  spec: WidgetSpec,
  index: number,
  model: RoleDashboardModel,
  t: RoleDashboardT,
  roleSlug: string | null | undefined,
) {
  const key = `${spec.kind}-${index}`;
  switch (spec.kind) {
    case 'listPanel':
      return spec.source === 'recentRequests' ? (
        <RecentRequestsPanel key={key} spec={spec} model={model} t={t} />
      ) : (
        <MyWorkPanel key={key} spec={spec} model={model} t={t} />
      );
    case 'donut':
      return <DistributionPanel key={key} titleKey={spec.titleKey} model={model} t={t} />;
    case 'barChart':
      return <BarPanel key={key} spec={spec} model={model} t={t} />;
    case 'alertsFeed':
      return <EscalationsPanel key={key} titleKey={spec.titleKey} model={model} t={t} />;
    case 'domainNav':
      return <DomainNavPanel key={key} titleKey={spec.titleKey} model={model} t={t} />;
    case 'decisionQueue':
      return <DecisionQueuePanel key={key} titleKey={spec.titleKey} model={model} t={t} />;
    case 'teamPerformance':
      return <TeamPerformancePanel key={key} model={model} />;
    case 'managerTasks':
      return <ManagerTasksDashboardPanel key={key} roleSlug={roleSlug} />;
    default:
      return null;
  }
}

/**
 * Task Management band for the registry-driven manager dashboards. Renders
 * nothing at all for a role with no task board, so a persona that neither
 * assigns nor receives tasks sees no empty panel where one never belonged.
 */
function ManagerTasksDashboardPanel({ roleSlug }: { roleSlug: string | null | undefined }) {
  const tasks = useManagerTasksPanel(roleSlug);
  if (!tasks.isVisible) return null;
  if (tasks.isError) return <ManagerTasksPanelState state="error" onRetry={tasks.refetch} />;
  if (tasks.isLoading) return <ManagerTasksPanelState state="loading" />;
  if (!tasks.props || tasks.props.rows.length === 0) {
    return <ManagerTasksPanelState state="empty" />;
  }
  return <ManagerTasksPanel {...tasks.props} />;
}

/**
 * Cases Manager dashboard queue. The data is owned by
 * useRoleDashboardData(), while this panel reuses the exact inbox rows and
 * decision dialog, so deciding here has identical validation/audit semantics
 * and does not navigate away from the dashboard.
 */
function DecisionQueuePanel({
  titleKey,
  model,
  t,
}: {
  titleKey: string;
  model: RoleDashboardModel;
  t: RoleDashboardT;
}) {
  const inbox = model.decisions;
  const labels = useInboxLabels();
  const [activeAction, setActiveAction] = useState<InboxItemAction | null>(null);
  const visibleGroups = useMemo(() => {
    let remaining = 4;
    return inbox.groups.flatMap((group) => {
      if (remaining === 0) return [];
      const items = group.items.slice(0, remaining);
      remaining -= items.length;
      return items.length > 0 ? [{ ...group, items }] : [];
    });
  }, [inbox.groups]);
  const handleDecide = (item: InboxItem) => {
    if (item.action) setActiveAction(item.action);
  };

  return (
    <>
      <CommandCard>
        <SectionHeader
          title={t(titleKey)}
          icon={CheckCheck}
          tone="primary"
          action={<ViewAll href="/lex/inbox" t={t} />}
        />
        <div className="mt-4 space-y-5">
          {inbox.isLoading && inbox.items.length === 0 ? (
            <PanelSkeleton />
          ) : inbox.isError ? (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-medium text-foreground">{labels.errorTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{labels.errorDescription}</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={inbox.refetch}>
                <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                {labels.refresh}
              </Button>
            </div>
          ) : visibleGroups.length === 0 ? (
            <EmptyState icon={CheckCheck} title={labels.emptyTitle} description={labels.emptyDescription} />
          ) : (
            <>
              {inbox.isPartial ? (
                <p role="status" className="text-xs text-warning-700 dark:text-warning-300">
                  {labels.partialError}
                </p>
              ) : null}
              {visibleGroups.map((group) => (
                <InboxGroup
                  key={group.kind}
                  kind={group.kind}
                  items={group.items}
                  onDecide={handleDecide}
                />
              ))}
            </>
          )}
        </div>
      </CommandCard>
      <InboxDecisionDialog
        action={activeAction}
        onOpenChange={(open) => {
          if (!open) setActiveAction(null);
        }}
        onDecided={inbox.refetch}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

function PanelSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-12 w-full rounded-soft" />
      ))}
    </div>
  );
}

function TeamPerformancePanel({ model }: { model: RoleDashboardModel }) {
  const workforce = model.teamPerformance;

  // Optional SaaS capability failures deliberately collapse to no panel. A
  // server failure is different: it remains visible and retryable.
  if (workforce.isHidden) return null;
  if (workforce.isError) {
    return <WorkforceTeamPanel state="error" onRetry={workforce.refetch} />;
  }
  if (workforce.isLoading) return <WorkforceTeamPanel state="loading" />;
  if (!workforce.report) return null;
  if (workforce.report.team.length === 0) return <WorkforceTeamPanel state="empty" />;
  if (workforce.report.degraded) {
    return (
      <WorkforceTeamPanel
        state="degraded"
        report={workforce.report}
        onRetry={workforce.refetch}
      />
    );
  }

  const activeWorkloads = workforce.report.team.map(
    (member) => member.metrics.activeWorkload,
  );
  if (activeWorkloads.every((metric) => !metric.available || metric.value === null)) {
    return <WorkforceTeamPanel state="unavailable" report={workforce.report} />;
  }
  if (
    activeWorkloads.every(
      (metric) => metric.available && metric.value !== null && metric.value === 0,
    )
  ) {
    return <WorkforceTeamPanel state="zero" report={workforce.report} />;
  }
  return <WorkforceTeamPanel state="ready" report={workforce.report} />;
}

function RecentRequestsPanel({
  spec,
  model,
  t,
}: {
  spec: Extract<WidgetSpec, { kind: 'listPanel' }>;
  model: RoleDashboardModel;
  t: RoleDashboardT;
}) {
  const { items, isLoading } = model.recentRequests;
  return (
    <CommandCard>
      <SectionHeader
        title={t(spec.titleKey)}
        action={spec.viewAllHref ? <ViewAll href={spec.viewAllHref} t={t} /> : undefined}
      />
      <div className="mt-4">
        {isLoading ? (
          <PanelSkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon={Inbox} title={t('empty.requests')} />
        ) : (
          <ul className="space-y-1">
            {items.map((item) => (
              <RequestRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </CommandCard>
  );
}

function RequestRow({ item }: { item: RequestListItem }) {
  return (
    <li>
      <Link
        href={item.href}
        className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconBadge icon={FileText} tone="primary" size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground" dir="auto">
            {item.title}
          </span>
          <span className="mt-0.5 block truncate text-caption text-muted-foreground">
            <span className="font-mono text-primary">#{item.reference}</span>
            {item.subtitle ? <span dir="auto"> · {item.subtitle}</span> : null}
          </span>
        </span>
        <StatusBadge status={item.status} label={item.statusLabel} size="sm" />
        <ArrowUpRight
          className="h-4 w-4 shrink-0 text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100"
          aria-hidden
        />
      </Link>
    </li>
  );
}

function MyWorkPanel({
  spec,
  model,
  t,
}: {
  spec: Extract<WidgetSpec, { kind: 'listPanel' }>;
  model: RoleDashboardModel;
  t: RoleDashboardT;
}) {
  const f = useLexFormat();
  const { items, isLoading } = model.myWork;
  return (
    <CommandCard>
      <SectionHeader
        title={t(spec.titleKey)}
        action={<ViewAll href="/lex/inbox" t={t} />}
      />
      <div className="mt-4">
        {isLoading ? (
          <PanelSkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon={FileText} title={t('empty.myWork')} />
        ) : (
          <ul className="space-y-1">
            {items.slice(0, 6).map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <IconBadge icon={FileText} tone="muted" size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground" dir="auto">
                      {item.title}
                    </span>
                    {item.status ? (
                      <span className="mt-0.5 block truncate text-caption text-muted-foreground" dir="auto">
                        {item.status}
                      </span>
                    ) : null}
                  </span>
                  {item.updatedAt ? (
                    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                      {f.formatRelative(item.updatedAt)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CommandCard>
  );
}

function DistributionPanel({
  titleKey,
  model,
  t,
}: {
  titleKey: string;
  model: RoleDashboardModel;
  t: RoleDashboardT;
}) {
  const { slices, total, isLoading } = model.distribution;
  return (
    <CommandCard>
      <SectionHeader
        title={t(titleKey)}
        action={<ViewAll href={serviceDistributionHref('all')} t={t} />}
      />
      <div className="mt-4">
        {isLoading && slices.length === 0 ? (
          <Skeleton className="h-44 w-full rounded-soft" />
        ) : total <= 0 ? (
          <EmptyState icon={FileText} title={t('empty.distribution')} />
        ) : (
          <DistributionDonut
            slices={slices}
            total={total}
            hrefFor={serviceDistributionHref}
          />
        )}
      </div>
    </CommandCard>
  );
}

function BarPanel({
  spec,
  model,
  t,
}: {
  spec: Extract<WidgetSpec, { kind: 'barChart' }>;
  model: RoleDashboardModel;
  t: RoleDashboardT;
}) {
  const source =
    spec.source === 'workloadByArea'
      ? model.workloadByArea
      : spec.source === 'resolutionRates'
        ? model.resolutionRates
        : model.contractStatusMix;
  const labelFor =
    spec.source === 'workloadByArea'
      ? (k: string) => t(`area.${k}`)
      : spec.source === 'resolutionRates'
        ? (k: string) => t(`cat.${k}`)
        : (k: string) => contractStatusLabel(t, k);
  const emptyKey = spec.source === 'resolutionRates' ? 'empty.resolutionRates' : 'empty.workload';
  const hasData = source.bars.some((b) => b.value > 0);
  const hrefFor =
    spec.source === 'workloadByArea'
      ? workloadDrilldownHref
      : spec.source === 'resolutionRates'
        ? resolutionDrilldownHref
        : contractStatusDrilldownHref;
  const viewAllHref =
    spec.source === 'contractStatusMix'
      ? serviceDistributionHref('contracts')
      : spec.source === 'workloadByArea'
        ? workloadDrilldownHref('all')
        : resolutionDrilldownHref('all');
  return (
    <CommandCard>
      <SectionHeader
        title={t(spec.titleKey)}
        action={<ViewAll href={viewAllHref} t={t} />}
      />
      <div className="mt-2">
        {source.isLoading && source.bars.length === 0 ? (
          <Skeleton className="h-44 w-full rounded-soft" />
        ) : !hasData ? (
          <EmptyState icon={FileText} title={t(emptyKey)} />
        ) : (
          <MetricBarChart bars={source.bars} labelFor={labelFor} hrefFor={hrefFor} />
        )}
      </div>
    </CommandCard>
  );
}

function EscalationsPanel({
  titleKey,
  model,
  t,
}: {
  titleKey: string;
  model: RoleDashboardModel;
  t: RoleDashboardT;
}) {
  const { bySeverity, total, isLoading } = model.escalations;
  return (
    <CommandCard>
      <SectionHeader
        title={t(titleKey)}
        icon={AlertTriangle}
        tone="warning"
        action={<ViewAll href="/lex/inbox" t={t} />}
      />
      <div className="mt-4">
        {isLoading ? (
          <PanelSkeleton />
        ) : bySeverity.length === 0 ? (
          <EmptyState icon={AlertTriangle} title={t('empty.escalations')} />
        ) : (
          <EscalationSeverityChart
            data={bySeverity}
            total={total}
            labelFor={(severity) => t(`sev.${severity}`)}
            totalLabel={t('ui.warnings')}
            hrefFor={escalationDrilldownHref}
          />
        )}
      </div>
    </CommandCard>
  );
}

const NO_DOMAIN_COUNT = { count: null, isLoading: false } as const;

/**
 * Full-width legal-domain navigation, folded into every role dashboard below the
 * two-column body. Reuses the DomainTile primitive; permission-gated per tile and
 * self-hides entirely when the persona can see no domains. Counts read from the
 * shared model (no independent fetch).
 */
function DomainNavPanel({
  titleKey,
  model,
  t,
}: {
  titleKey: string;
  model: RoleDashboardModel;
  t: RoleDashboardT;
}) {
  const { hasPermission } = useAuth();
  const visible = LEX_DOMAINS.filter((d) => hasPermission(d.permission));
  if (visible.length === 0) return null;
  return (
    <CommandCard>
      <SectionHeader title={t(titleKey)} icon={LayoutGrid} tone="primary" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {visible.map((d) => (
          <DomainTile key={d.id} domain={d} count={model.domainCounts[d.id] ?? NO_DOMAIN_COUNT} />
        ))}
      </div>
    </CommandCard>
  );
}

function ViewAll({ href, t }: { href: string; t: RoleDashboardT }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium text-primary',
        'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-soft',
      )}
    >
      {t('ui.viewAll')}
      <ArrowUpRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
    </Link>
  );
}
