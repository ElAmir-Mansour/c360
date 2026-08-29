'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  BookMarked,
  CalendarClock,
  ClipboardCheck,
  FileText,
  GitBranch,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { RelativeTime } from '@/components/shared/relative-time';
import { IconBadge } from '@/components/shared/icon-badge';
import { AreaChart } from '@/components/shared/charts/area-chart';
import { LifecyclePipeline } from '@/components/lex/dashboard/lifecycle-pipeline';
import { ListRow } from '@/components/shared/list-row';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { StatusBadge } from '@/components/shared/status-badge';
import { contractStatusConfig } from '@/lib/status-configs';
import { chartVar, severityVar } from '@/lib/design-tokens';
import { enterpriseApi } from '@/lib/enterprise';
import { parseApiError } from '@/lib/format';
import { getRenewalWarning } from '@/lib/lex-watheeq';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLexFormat } from '@/lib/lex/ksa';
import { useLexLabels, type LexOverviewLabels } from '../_lib/lex-i18n';
import { humanizeLexToken } from '../_lib/humanize-lex-token';
import {
  useContractTypeLabels,
  useContractStatusTokenLabels,
  useContractComplianceAlertStatusLabels,
  useRegulationStatusLabels,
  useRegulationAuthorityLabel,
} from '../contracts/_lib/contracts-labels';
import type { LexComplianceAlert, LexRegulation, LexWorkflowSummary } from '@/types/suites';
import {
  CommandCard,
  SectionHeader,
  StatBlock,
  SeverityRow,
  EmptyState,
  type RowSeverity,
} from './command-ui';

type BulkWorkflowDecision = 'approve' | 'request_changes' | 'reject';

/**
 * Wrapper section copy for the relocated contract analytics region. Kept local
 * (rather than added to the shared {@link LexOverviewLabels} bundle) so this
 * component stays self-contained — the overview agent owns the i18n file. Only
 * the tiny eyebrow is net-new; the title/description mirror the shared voice.
 */
const CONTRACT_ANALYTICS_TITLE: Record<'en' | 'ar', { eyebrow: string; title: string; description: string }> = {
  en: {
    eyebrow: 'Contracts',
    title: 'Contract analytics',
    description: 'Contract lifecycle, review queue, renewals, and compliance signals.',
  },
  ar: {
    eyebrow: 'العقود',
    title: 'تحليلات العقود',
    description: 'دورة حياة العقود، وقائمة المراجعة، والتجديدات، ومؤشرات الامتثال.',
  },
};

/**
 * Monthly-activity series definitions. Colours ride the design-token CSS vars
 * (`chartVar` / `severityVar`) — recharts resolves `hsl(var(--x))` in SVG
 * presentation attributes at paint time, so the series re-theme in dark mode
 * with NO ad-hoc hex. `expired` intentionally reads on the critical ramp so the
 * "contracts lost" series is unmistakable.
 */
function activitySeries(series: LexOverviewLabels['monthlyActivity']['series']) {
  return [
    { key: 'created', label: series.created, color: chartVar(0) },
    { key: 'activated', label: series.activated, color: chartVar(1) },
    { key: 'renewed', label: series.renewed, color: chartVar(4) },
    { key: 'expired', label: series.expired, color: severityVar('critical') },
  ];
}

function workflowSelectionKey(workflow: Pick<LexWorkflowSummary, 'workflow_instance_id' | 'task_id'>): string {
  return `${workflow.workflow_instance_id}:${workflow.task_id ?? ''}`;
}

function bulkWorkflowDecisionNote(decision: BulkWorkflowDecision): string {
  if (decision === 'approve') {
    return 'Bulk approved from Lex overview.';
  }
  if (decision === 'reject') {
    return 'Bulk rejected from Lex overview.';
  }
  return 'Bulk request changes from Lex overview.';
}

function contractActivityHref(month: string, series: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return '/lex/contracts';

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString().slice(0, 10);
  const params = new URLSearchParams();
  if (series === 'created') {
    params.set('created_from', start);
    params.set('created_to', end);
  } else {
    params.set('status', series === 'activated' ? 'active' : series);
    params.set('status_changed_from', start);
    params.set('status_changed_to', end);
  }
  return `/lex/contracts?${params.toString()}`;
}

/** Map a raw compliance-alert severity onto the SeverityRow tone vocabulary. */
function alertRowSeverity(value: string): RowSeverity {
  switch (value) {
    case 'critical':
    case 'high':
      return 'critical';
    case 'medium':
      return 'warning';
    case 'low':
      return 'info';
    default:
      return 'info';
  }
}

/**
 * Self-contained contract analytics region for the Lex command center.
 *
 * Owns its own react-query queries but **reuses the same query keys** as the
 * hero/KPI surfaces (`['lex-overview', 'dashboard'|'contracts'|'regulations'|
 * 'alerts'|'workflows'|'renewal-warnings']`) so react-query dedupes — no
 * duplicate fetching. Renders a contract-scoped KPI strip, the lifecycle
 * pipeline, monthly-activity area chart, renewals list, the review queue with
 * bulk approve/reject/request-changes, compliance alerts, recent contracts, and
 * regulations.
 *
 * Does NOT render the compliance gauge/score history — that lives in the hero.
 */
export default function ContractAnalytics() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const { overview: t, commonActions } = useLexLabels();
  const contractStatusTokenLabels = useContractStatusTokenLabels();
  const typeLabels = useContractTypeLabels();
  const alertStatusLabels = useContractComplianceAlertStatusLabels();
  const regulationStatusLabels = useRegulationStatusLabels();
  const regulationAuthorityLabel = useRegulationAuthorityLabel();
  const wrapperLabels = CONTRACT_ANALYTICS_TITLE[locale === 'ar' ? 'ar' : 'en'];
  const [selectedWorkflowTaskKeys, setSelectedWorkflowTaskKeys] = useState<Set<string>>(() => new Set());
  const [lateJustification, setLateJustification] = useState('');

  const dashboardQuery = useQuery({
    queryKey: ['lex-overview', 'dashboard'],
    queryFn: () => enterpriseApi.lex.getDashboard(),
  });
  const contractsQuery = useQuery({
    queryKey: ['lex-overview', 'contracts'],
    queryFn: () => enterpriseApi.lex.listContracts({ page: 1, per_page: 6, order: 'desc' }),
  });
  const regulationsQuery = useQuery({
    queryKey: ['lex-overview', 'regulations'],
    queryFn: () => enterpriseApi.lex.listRegulations({ page: 1, per_page: 6, order: 'desc' }),
  });
  const alertsQuery = useQuery({
    queryKey: ['lex-overview', 'alerts'],
    queryFn: () => enterpriseApi.lex.listComplianceAlerts({ page: 1, per_page: 6, order: 'desc' }),
  });
  const workflowsQuery = useQuery({
    queryKey: ['lex-overview', 'workflows'],
    queryFn: () => enterpriseApi.lex.listWorkflows({ page: 1, per_page: 6, order: 'desc' }),
  });
  const renewalWarningsQuery = useQuery({
    queryKey: ['lex-overview', 'renewal-warnings'],
    queryFn: () => enterpriseApi.lex.getContractRenewalWarnings({ horizon_days: 60, lead_days: 30 }),
  });

  const bulkDecisionMutation = useMutation({
    mutationFn: ({ decision, items }: { decision: BulkWorkflowDecision; items: Array<{ workflow_instance_id: string; task_id: string }> }) =>
      enterpriseApi.lex.bulkDecideWorkflowTasks({
        decision,
        notes: bulkWorkflowDecisionNote(decision),
        metadata: { source: 'lex_overview' },
        ...(lateJustification.trim()
          ? { late_justification: lateJustification.trim() }
          : {}),
        items,
      }),
    onSuccess: async (result) => {
      setSelectedWorkflowTaskKeys(new Set(result.errors.map((error) => `${error.workflow_instance_id}:${error.task_id}`)));
      await queryClient.invalidateQueries({ queryKey: ['lex-overview'] });
      await queryClient.refetchQueries({ queryKey: ['lex-overview', 'workflows'] });

      if (result.failed > 0) {
        toast.error(t.reviewQueue.toastPartialTitle, {
          description: t.reviewQueue.toastPartialDescription(result.succeeded, result.failed),
        });
        return;
      }

      toast.success(t.reviewQueue.toastSuccessTitle, {
        description: t.reviewQueue.toastSuccessDescription(result.succeeded),
      });
    },
    onError: (error) => {
      toast.error(t.reviewQueue.toastErrorTitle, {
        description: parseApiError(error),
      });
    },
  });

  const header = (
    <SectionHeader
      eyebrow={wrapperLabels.eyebrow}
      title={wrapperLabels.title}
      description={wrapperLabels.description}
      icon={Activity}
      tone="primary"
    />
  );

  if (
    dashboardQuery.isLoading &&
    contractsQuery.isLoading &&
    regulationsQuery.isLoading &&
    alertsQuery.isLoading &&
    workflowsQuery.isLoading &&
    renewalWarningsQuery.isLoading
  ) {
    return (
      <CommandCard
        accent="teal"
        className="bg-gradient-to-br from-card via-card to-primary/[0.035]"
      >
        <div className="space-y-4" dir={direction} lang={locale}>
          {header}
          <LoadingSkeleton variant="card" count={4} />
        </div>
      </CommandCard>
    );
  }

  if (
    dashboardQuery.error &&
    contractsQuery.error &&
    regulationsQuery.error &&
    alertsQuery.error &&
    workflowsQuery.error &&
    renewalWarningsQuery.error
  ) {
    return (
      <CommandCard
        accent="teal"
        className="bg-gradient-to-br from-card via-card to-primary/[0.035]"
      >
        <div className="space-y-4" dir={direction} lang={locale}>
          {header}
          <ErrorState
            message={t.loadError}
            onRetry={() => {
              void dashboardQuery.refetch();
              void contractsQuery.refetch();
              void regulationsQuery.refetch();
              void alertsQuery.refetch();
              void workflowsQuery.refetch();
              void renewalWarningsQuery.refetch();
            }}
          />
        </div>
      </CommandCard>
    );
  }

  const dashboard = dashboardQuery.data;
  const kpis = dashboard?.kpis;
  const recentContracts = contractsQuery.data?.data ?? [];
  const recentAlerts = alertsQuery.data?.data ?? [];
  const regulations = regulationsQuery.data?.data ?? [];
  const workflows = workflowsQuery.data?.data ?? [];
  const renewalWarnings = renewalWarningsQuery.data;
  const renewalWarningItems = renewalWarnings?.items ?? [];
  const contractsByStatus = dashboard?.contracts_by_status ?? {};
  const monthlyActivity = dashboard?.monthly_activity ?? [];

  const selectableWorkflows = workflows.filter((workflow) => Boolean(workflow.task_id));
  const selectedWorkflowItems = workflows.reduce<Array<{ workflow_instance_id: string; task_id: string }>>((items, workflow) => {
    if (workflow.task_id && selectedWorkflowTaskKeys.has(workflowSelectionKey(workflow))) {
      items.push({ workflow_instance_id: workflow.workflow_instance_id, task_id: workflow.task_id });
    }
    return items;
  }, []);
  const selectedVisibleWorkflowCount = selectableWorkflows.filter((workflow) => selectedWorkflowTaskKeys.has(workflowSelectionKey(workflow))).length;
  const selectedHasLateWorkflow = workflows.some(
    (workflow) =>
      selectedWorkflowTaskKeys.has(workflowSelectionKey(workflow)) &&
      Boolean(workflow.sla_deadline && Date.now() > new Date(workflow.sla_deadline).getTime()),
  );
  const allVisibleWorkflowTasksSelected = selectableWorkflows.length > 0 && selectedVisibleWorkflowCount === selectableWorkflows.length;

  const toggleWorkflowTaskSelection = (workflow: LexWorkflowSummary, checked: boolean) => {
    if (!workflow.task_id) {
      return;
    }
    setSelectedWorkflowTaskKeys((current) => {
      const next = new Set(current);
      const key = workflowSelectionKey(workflow);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const toggleVisibleWorkflowTasks = (checked: boolean) => {
    setSelectedWorkflowTaskKeys((current) => {
      const next = new Set(current);
      selectableWorkflows.forEach((workflow) => {
        const key = workflowSelectionKey(workflow);
        if (checked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      });
      return next;
    });
  };

  const submitBulkDecision = (decision: BulkWorkflowDecision) => {
    if (selectedWorkflowItems.length === 0) {
      toast.error(t.reviewQueue.selectFirstError);
      return;
    }
    if (selectedHasLateWorkflow && !lateJustification.trim()) {
      toast.error(locale === 'ar' ? 'مبرر تجاوز اتفاقية مستوى الخدمة مطلوب.' : 'A late SLA justification is required.');
      return;
    }
    bulkDecisionMutation.mutate({ decision, items: selectedWorkflowItems });
  };

  return (
    <CommandCard
      accent="teal"
      className="bg-gradient-to-br from-card via-card to-primary/[0.035]"
    >
      <div className="space-y-6" dir={direction} lang={locale}>
        {header}

        {/* Contract-scoped KPI strip — accurate aggregates from the dashboard
            (not the capped list previews). Locale-aware pre-formatted values. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatBlock
            label={t.kpis.activeContracts}
            value={f.formatNumber(kpis?.active_contracts ?? 0)}
            icon={FileText}
            tone="primary"
            tinted
            isLoading={dashboardQuery.isLoading}
            href="/lex/contracts?status=active"
          />
          <StatBlock
            label={t.kpis.activeValue}
            value={f.formatCurrencyCompact(kpis?.total_active_value ?? 0)}
            icon={Wallet}
            tone="success"
            tinted
            isLoading={dashboardQuery.isLoading}
            href="/lex/contracts?status=active"
          />
          <StatBlock
            label={t.kpis.pendingReview}
            value={f.formatNumber(kpis?.pending_review ?? 0)}
            icon={ClipboardCheck}
            tone="info"
            tinted
            isLoading={dashboardQuery.isLoading}
            href="/lex/contracts?status=internal_review%2Clegal_review"
          />
          <StatBlock
            label={t.kpis.openComplianceAlerts}
            value={f.formatNumber(kpis?.open_compliance_alerts ?? 0)}
            icon={ShieldAlert}
            tone="error"
            tinted
            isLoading={dashboardQuery.isLoading}
            href="/lex/compliance?status=open"
          />
        </div>

        <CommandCard
          accent="gold"
          className="bg-gradient-to-br from-card via-card to-brand-gold/[0.04]"
        >
          <div className="space-y-4">
            <SectionHeader title={t.lifecycle.title} description={t.lifecycle.description} icon={GitBranch} tone="primary" />
            <LifecyclePipeline countsByStatus={contractsByStatus} />
          </div>
        </CommandCard>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
          <CommandCard>
            <div className="space-y-4">
              <SectionHeader title={t.monthlyActivity.title} description={t.monthlyActivity.description} icon={Activity} tone="info" />
              <AreaChart
                data={monthlyActivity as unknown as Array<Record<string, unknown>>}
                xKey="month"
                yKeys={activitySeries(t.monthlyActivity.series)}
                yFormatter={(value) => f.formatCompact(value)}
                onItemSelect={(datum, seriesKey) =>
                  router.push(contractActivityHref(String(datum.month ?? ''), seriesKey))
                }
                height={260}
              />
            </div>
          </CommandCard>

          <CommandCard>
            <div className="space-y-4">
              <SectionHeader title={t.renewals.title} description={t.renewals.description} icon={CalendarClock} tone="warning" />
              <div className="space-y-2">
                {renewalWarningsQuery.isLoading ? (
                  <LoadingSkeleton variant="list-item" count={3} />
                ) : renewalWarningsQuery.isError ? (
                  <ErrorState
                    message={t.renewals.loadError}
                    onRetry={() => void renewalWarningsQuery.refetch()}
                  />
                ) : renewalWarningItems.length === 0 ? (
                  <EmptyState icon={CalendarClock} title={t.renewals.emptyTitle} description={t.renewals.emptyDescription} />
                ) : (
                  renewalWarningItems.slice(0, 5).map((contract) => (
                    <SeverityRow
                      key={contract.contract_id}
                      severity={contract.severity === 'urgent' ? 'critical' : 'warning'}
                      href={`/lex/contracts/${contract.contract_id}`}
                      title={contract.title}
                      meta={[contract.counterparty, contract.owner, humanizeLexToken(contract.reason, locale)]
                        .filter(Boolean)
                        .join(' • ')}
                      trailing={
                        <Badge variant={contract.severity === 'urgent' ? 'destructive' : 'warning'}>
                          {t.renewals.daysShort(contract.days_until_trigger)}
                        </Badge>
                      }
                    />
                  ))
                )}
              </div>
            </div>
          </CommandCard>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
          <CommandCard>
            <div className="space-y-4">
              <SectionHeader
                title={t.reviewQueue.title}
                description={t.reviewQueue.description}
                icon={ClipboardCheck}
                tone="info"
                action={
                  workflows.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-caption text-muted-foreground tabular-nums">
                        {t.reviewQueue.selected(selectedWorkflowItems.length)}
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => submitBulkDecision('reject')}
                        disabled={selectedWorkflowItems.length === 0 || bulkDecisionMutation.isPending || (selectedHasLateWorkflow && !lateJustification.trim())}
                      >
                        <XCircle className="me-1.5 h-3.5 w-3.5" />
                        {bulkDecisionMutation.isPending ? commonActions.applying : commonActions.reject}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => submitBulkDecision('request_changes')}
                        disabled={selectedWorkflowItems.length === 0 || bulkDecisionMutation.isPending || (selectedHasLateWorkflow && !lateJustification.trim())}
                      >
                        <GitBranch className="me-1.5 h-3.5 w-3.5" />
                        {bulkDecisionMutation.isPending ? commonActions.applying : commonActions.requestChanges}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => submitBulkDecision('approve')}
                        disabled={selectedWorkflowItems.length === 0 || bulkDecisionMutation.isPending || (selectedHasLateWorkflow && !lateJustification.trim())}
                      >
                        <ShieldCheck className="me-1.5 h-3.5 w-3.5" />
                        {bulkDecisionMutation.isPending ? commonActions.applying : commonActions.approve}
                      </Button>
                    </div>
                  ) : null
                }
              />
              {selectedHasLateWorkflow ? (
                <div className="space-y-2 rounded-soft border border-warning-300 bg-warning-50/60 p-3 dark:bg-warning-700/10">
                  <Textarea
                    value={lateJustification}
                    onChange={(event) => setLateJustification(event.target.value)}
                    placeholder={locale === 'ar' ? 'اشرح سبب اعتماد السجلات بعد الموعد المحدد.' : 'Explain why the selected records ended after their SLA deadline.'}
                    rows={3}
                  />
                  <p className="text-caption text-muted-foreground">
                    {locale === 'ar'
                      ? 'مطلوب للتحديدات المتأخرة ويظهر فقط لمدير الإدارة القانونية ومدير العقود.'
                      : 'Required for late selections; visible only to the Legal Director and Contracts Manager.'}
                  </p>
                </div>
              ) : null}
              <div className="space-y-2">
                {workflows.length === 0 ? (
                  <EmptyState icon={ClipboardCheck} title={t.reviewQueue.emptyTitle} description={t.reviewQueue.emptyDescription} />
                ) : (
                  <>
                    {selectableWorkflows.length > 0 ? (
                      <div className="flex items-center justify-between gap-3 rounded-soft border border-dashed border-border bg-muted/30 px-4 py-2">
                        <label className="flex min-w-0 items-center gap-2 text-body-sm">
                          <Checkbox
                            aria-label={t.reviewQueue.selectVisibleAria}
                            checked={allVisibleWorkflowTasksSelected ? true : selectedVisibleWorkflowCount > 0 ? 'indeterminate' : false}
                            onCheckedChange={(checked) => toggleVisibleWorkflowTasks(checked === true)}
                            disabled={bulkDecisionMutation.isPending}
                          />
                          <span>{t.reviewQueue.selectVisible}</span>
                        </label>
                        <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                          {t.reviewQueue.selectionCount(selectedVisibleWorkflowCount, selectableWorkflows.length)}
                        </span>
                      </div>
                    ) : null}
                    {workflows.map((workflow) => {
                      const selectable = Boolean(workflow.task_id);
                      const selected = selectable && selectedWorkflowTaskKeys.has(workflowSelectionKey(workflow));
                      return (
                        <ListRow
                          key={workflowSelectionKey(workflow)}
                          className="items-start"
                          selected={selected}
                          leading={
                            <Checkbox
                              className="mt-1"
                              aria-label={t.reviewQueue.selectRowAria(workflow.contract_title)}
                              checked={selected}
                              onCheckedChange={(checked) => toggleWorkflowTaskSelection(workflow, checked === true)}
                              disabled={!selectable || bulkDecisionMutation.isPending}
                            />
                          }
                          title={
                            <Link href={`/lex/contracts/${workflow.contract_id}`} className="hover:underline">
                              {workflow.contract_title}
                            </Link>
                          }
                          subtitle={`${workflow.assignee_role ?? t.reviewQueue.unassigned} • ${humanizeLexToken(workflow.workflow_status, locale)}`}
                          trailing={
                            <StatusBadge
                              status={workflow.contract_status}
                              config={contractStatusConfig}
                              label={contractStatusTokenLabels[workflow.contract_status] ?? undefined}
                              size="sm"
                            />
                          }
                        >
                          <span className="mt-2 block text-caption text-muted-foreground">
                            {t.reviewQueue.startedPrefix} <RelativeTime date={workflow.started_at} />
                          </span>
                        </ListRow>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          </CommandCard>

          <CommandCard>
            <div className="space-y-4">
              <SectionHeader
                title={t.complianceAlerts.title}
                description={t.complianceAlerts.description}
                icon={ShieldAlert}
                tone="error"
                action={
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/lex/compliance">
                      {commonActions.viewAll}
                      <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                    </Link>
                  </Button>
                }
              />
              <div className="space-y-2">
                {recentAlerts.length === 0 ? (
                  <EmptyState icon={ShieldAlert} title={t.complianceAlerts.emptyTitle} description={t.complianceAlerts.emptyDescription} />
                ) : (
                  recentAlerts.map((alert: LexComplianceAlert) => (
                    <SeverityRow
                      key={alert.id}
                      severity={alertRowSeverity(alert.severity)}
                      href={`/lex/compliance/alerts/${alert.id}`}
                      title={alert.title}
                      meta={alert.description}
                      trailing={
                        <span className="flex flex-col items-end gap-0.5 text-caption text-muted-foreground">
                          <span className="capitalize">{alertStatusLabels[alert.status] ?? alert.status.replace(/_/g, ' ')}</span>
                          <RelativeTime date={alert.created_at} />
                        </span>
                      }
                    />
                  ))
                )}
              </div>
            </div>
          </CommandCard>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <CommandCard>
            <div className="space-y-4">
              <SectionHeader
                title={t.recentContracts.title}
                description={t.recentContracts.description}
                icon={FileText}
                tone="primary"
                action={
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/lex/contracts">
                      {commonActions.viewAll}
                      <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                    </Link>
                  </Button>
                }
              />
              <div className="space-y-2">
                {recentContracts.length === 0 ? (
                  <EmptyState icon={FileText} title={t.recentContracts.emptyTitle} description={t.recentContracts.emptyDescription} />
                ) : (
                  recentContracts.map((contract) => (
                    <ListRow
                      key={contract.id}
                      href={`/lex/contracts/${contract.id}`}
                      className="items-start"
                      leading={<IconBadge icon={FileText} tone="muted" size="sm" />}
                      title={contract.title}
                      subtitle={<span className="capitalize">{typeLabels[contract.type] ?? contract.type.replace(/_/g, ' ')}</span>}
                      trailing={
                        <StatusBadge
                          status={contract.status}
                          config={contractStatusConfig}
                          label={contractStatusTokenLabels[contract.status] ?? undefined}
                          size="sm"
                        />
                      }
                    >
                      <span className="mt-2 flex flex-wrap gap-3 text-caption text-muted-foreground tabular-nums">
                        <span>{t.recentContracts.valuePrefix} {contract.total_value != null ? f.formatCurrency(contract.total_value, { currency: contract.currency || 'SAR' }) : t.recentContracts.valueUndisclosed}</span>
                        <span>{contract.expiry_date ? t.recentContracts.expiresPrefix(f.formatDual(contract.expiry_date)) : t.recentContracts.noExpiry}</span>
                        <span>{getRenewalWarning(contract, undefined, locale).label}</span>
                      </span>
                    </ListRow>
                  ))
                )}
              </div>
            </div>
          </CommandCard>

          <CommandCard>
            <div className="space-y-4">
              <SectionHeader
                title={t.regulations.title}
                description={t.regulations.description}
                icon={BookMarked}
                tone="neutral"
                action={
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/lex/regulations">
                      {commonActions.viewAll}
                      <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
                    </Link>
                  </Button>
                }
              />
              <div className="space-y-2">
                {regulations.length === 0 ? (
                  <EmptyState icon={BookMarked} title={t.regulations.emptyTitle} description={t.regulations.emptyDescription} />
                ) : (
                  regulations.map((regulation: LexRegulation) => (
                    <SeverityRow
                      key={regulation.id}
                      severity="neutral"
                      icon={BookMarked}
                      href={`/lex/regulations?search=${encodeURIComponent(regulation.code)}`}
                      title={
                        resolveLocalized(
                          { en: regulation.title_en, ar: regulation.title_ar },
                          locale,
                        ) || regulation.title_en
                      }
                      meta={[regulationAuthorityLabel(regulation.authority), regulation.code].filter(Boolean).join(' • ') || t.regulations.fallbackSubtitle}
                      trailing={
                        <>
                          {regulation.jurisdiction ? <Badge variant="outline">{regulation.jurisdiction}</Badge> : null}
                          <StatusBadge
                            status={regulation.status}
                            label={regulationStatusLabels[regulation.status] ?? regulation.status.replace(/_/g, ' ')}
                            size="sm"
                          />
                        </>
                      }
                    />
                  ))
                )}
              </div>
            </div>
          </CommandCard>
        </div>
      </div>
    </CommandCard>
  );
}
