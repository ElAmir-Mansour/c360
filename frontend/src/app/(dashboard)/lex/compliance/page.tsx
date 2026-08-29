'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { type ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Download, Loader2, Play, Plus, Scale, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DataTable } from '@/components/shared/data-table/data-table';
import { ErrorState } from '@/components/common/error-state';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { SeverityIndicator } from '@/components/shared/severity-indicator';
import { TrendSparkline } from '@/components/shared/trend-sparkline';
import { FormField } from '@/components/shared/forms/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SectionCard } from '@/components/suites/section-card';
import { useAuth } from '@/hooks/use-auth';
import { useDataTable } from '@/hooks/use-data-table';
import { useLocale } from '@/components/providers/locale-provider';
import { shapeDigits, useLexFormat } from '@/lib/lex/ksa';
import { API_ENDPOINTS } from '@/lib/constants';
import {
  enterpriseApi,
  lexComplianceRuleSchema,
  type LexComplianceRuleFormValues,
} from '@/lib/enterprise';
import { downloadBlob } from '@/lib/format';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LexComplianceAlert, LexComplianceRule, LexComplianceRunResult } from '@/types/suites';
import {
  type ComplianceScorePoint,
  readComplianceScoreHistory,
  recordComplianceScore,
} from '../_lib/compliance-score-history';
import { type ComplianceLabels, useComplianceLabels } from './_lib/compliance-labels';
import { CompliancePartialError, useComplianceChromeLabels } from './_components/compliance-page-chrome';
import { AlertDetailPanel } from './_components/alert-detail-panel';
import { AlertBulkActionBar, selectionColumn, useBulkActionBarLabels } from './_components/bulk-action-bar';
import { ComplianceBreakdownCharts, ComplianceScoreGauge } from './_components/compliance-charts';
import { RuleConfigFields, type RuleConfig } from './_components/rule-config-fields';
import { RuleLibrary } from './_components/rule-library';
import { RuleTemplateGallery } from './_components/rule-templates';
import { LastRunBadge, RunSummaryDialog } from './_components/run-summary-dialog';
import { AlertAgeCell, compareAlertAge } from './_lib/alert-aging';
import {
  COMPLIANCE_SAVED_VIEWS,
  useComplianceAlertFilters,
  useComplianceSavedViews,
} from './_lib/use-compliance-alert-filters';

// ---------------------------------------------------------------------------
// Compliance rule form dialog (create + edit)
// ---------------------------------------------------------------------------

const RULE_TYPES = [
  'expiry_warning', 'missing_clause', 'risk_threshold', 'review_overdue',
  'unsigned_contract', 'value_threshold', 'jurisdiction_check',
  'data_protection_required', 'custom',
] as const;

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

interface RuleFormDialogProps {
  open: boolean;
  rule?: LexComplianceRule | null;
  onOpenChange: (open: boolean) => void;
  labels: ComplianceLabels;
}

function RuleFormDialog({ open, rule, onOpenChange, labels }: RuleFormDialogProps) {
  const isEdit = Boolean(rule);
  const t = labels.ruleForm;
  const queryClient = useQueryClient();

  const form = useForm<LexComplianceRuleFormValues>({
    resolver: zodResolver(lexComplianceRuleSchema),
    defaultValues: rule
      ? {
          name: rule.name,
          description: rule.description,
          rule_type: rule.rule_type,
          severity: rule.severity,
          config: rule.config ?? {},
          contract_types: rule.contract_types ?? [],
          enabled: rule.enabled,
        }
      : {
          name: '',
          description: '',
          rule_type: 'expiry_warning',
          severity: 'medium',
          config: {},
          contract_types: [],
          enabled: true,
        },
  });

  const saveMutation = useMutation({
    mutationFn: (values: LexComplianceRuleFormValues) =>
      isEdit && rule
        ? enterpriseApi.lex.updateComplianceRule(rule.id, values)
        : enterpriseApi.lex.createComplianceRule(values),
    onSuccess: async () => {
      showSuccess(
        isEdit ? labels.toasts.ruleUpdatedTitle : labels.toasts.ruleCreatedTitle,
        labels.toasts.ruleSavedDescription,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-rules'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-command'] }),
      ]);
      onOpenChange(false);
    },
    onError: showApiError,
  });

  const ruleType = form.watch('rule_type');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>{isEdit ? t.editDescription : t.createDescription}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))}>
            <FormField name="name" label={t.name} required>
              <Input id="name" {...form.register('name')} placeholder={t.namePlaceholder} />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField name="rule_type" label={t.ruleType} required>
                <Select
                  value={form.watch('rule_type')}
                  onValueChange={(v) => {
                    form.setValue('rule_type', v as LexComplianceRuleFormValues['rule_type'], { shouldValidate: true });
                    // Reset config so stale keys from the previous rule type don't linger.
                    form.setValue('config', {}, { shouldDirty: true, shouldValidate: true });
                  }}
                >
                  <SelectTrigger id="rule_type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RULE_TYPES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {labels.enums.ruleTypes[value] ?? value.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="severity" label={t.severity} required>
                <Select
                  value={form.watch('severity')}
                  onValueChange={(v) =>
                    form.setValue('severity', v as LexComplianceRuleFormValues['severity'], { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="severity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>{labels.enums.severities[s] ?? s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <FormField name="description" label={t.description} required>
              <Textarea
                id="description"
                {...form.register('description')}
                rows={3}
                placeholder={t.descriptionPlaceholder}
              />
            </FormField>
            <div className="space-y-2 rounded-lg border px-4 py-4">
              <RuleConfigFields
                ruleType={ruleType}
                value={(form.watch('config') ?? {}) as RuleConfig}
                onChange={(next) => form.setValue('config', next, { shouldDirty: true, shouldValidate: true })}
              />
            </div>
            <div className="rounded-lg border px-4 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{t.enabled}</p>
                  <p className="text-xs text-muted-foreground">{t.enabledHint}</p>
                </div>
                <Switch
                  checked={form.watch('enabled')}
                  onCheckedChange={(v) => form.setValue('enabled', v, { shouldValidate: true })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {isEdit ? t.save : t.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Alert status update dialog
// ---------------------------------------------------------------------------

const ALERT_STATUSES = ['open', 'acknowledged', 'investigating', 'resolved', 'dismissed'] as const;

interface AlertStatusDialogProps {
  open: boolean;
  alert: LexComplianceAlert | null;
  onOpenChange: (open: boolean) => void;
  labels: ComplianceLabels;
}

function AlertStatusDialog({ open, alert, onOpenChange, labels }: AlertStatusDialogProps) {
  const queryClient = useQueryClient();
  const t = labels.alertDialog;
  const [nextStatus, setNextStatus] = useState<string>(alert?.status ?? 'open');
  const [notes, setNotes] = useState('');

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!alert) throw new Error('no alert selected');
      return enterpriseApi.lex.updateComplianceAlertStatus(alert.id, {
        status: nextStatus,
        resolution_notes: notes.trim() || '',
      });
    },
    onSuccess: async () => {
      showSuccess(labels.toasts.alertUpdatedTitle, labels.toasts.alertUpdatedDescription);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-command'] }),
      ]);
      onOpenChange(false);
    },
    onError: showApiError,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription><span dir="auto">{alert?.title}</span></DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t.newStatus}</label>
            <Select value={nextStatus} onValueChange={setNextStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALERT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{labels.enums.alertStatuses[s] ?? s.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t.resolutionNotes}</label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.resolutionNotesPlaceholder}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.cancel}</Button>
          <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {t.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main compliance page
// ---------------------------------------------------------------------------

function buildAlertFilters(labels: ComplianceLabels) {
  return [
    {
      key: 'status',
      label: labels.filters.status,
      type: 'select' as const,
      options: ALERT_STATUSES.map((s) => ({
        label: labels.enums.alertStatuses[s] ?? s.replace(/_/g, ' '),
        value: s,
      })),
    },
    {
      key: 'severity',
      label: labels.filters.severity,
      type: 'select' as const,
      options: SEVERITIES.map((s) => ({ label: labels.enums.severities[s] ?? s, value: s })),
    },
  ];
}

export default function LexCompliancePage() {
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  const { locale, direction } = useLocale();
  // KSA formatting: Arabic mode renders Arabic-Indic digits + Hijri dates.
  const f = useLexFormat();
  const labels = useComplianceLabels();
  const chrome = useComplianceChromeLabels();
  const bulkLabels = useBulkActionBarLabels();
  const savedViewLabels = useComplianceSavedViews();
  // §6/§21.4 — the compliance domain is read-only for auditors (page gated on
  // lex:audit:read). Rule authoring + alert mutation is compliance/catalog
  // configuration, so gate the write controls on lex:catalog:manage — which an
  // auditor (audit:read only) does NOT hold, so they see no mutation controls.
  const canWrite = hasPermission('lex:catalog:manage');

  const [createRuleOpen, setCreateRuleOpen] = useState(false);
  const [editRuleTarget, setEditRuleTarget] = useState<LexComplianceRule | null>(null);
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<LexComplianceRule | null>(null);
  const [alertTarget, setAlertTarget] = useState<LexComplianceAlert | null>(null);
  const [detailTarget, setDetailTarget] = useState<LexComplianceAlert | null>(null);
  const [selectedAlertIds, setSelectedAlertIds] = useState<string[]>([]);
  const [runResult, setRunResult] = useState<LexComplianceRunResult | null>(null);
  const [previousScore, setPreviousScore] = useState<number | undefined>(undefined);
  const [ruleScope, setRuleScope] = useState<'all' | 'enabled'>('all');
  const [ruleTypeScope, setRuleTypeScope] = useState<string | null>(null);

  const dashboardQuery = useQuery({
    queryKey: ['lex-compliance-dashboard'],
    queryFn: () => enterpriseApi.lex.getComplianceDashboard(),
  });

  const rulesQuery = useQuery({
    queryKey: ['lex-compliance-rules'],
    queryFn: () => enterpriseApi.lex.listComplianceRules({ page: 1, per_page: 100, order: 'asc' }),
  });

  // URL-synced alert filters + saved-view presets (Feature 5).
  const { filters, setFilter, clearFilters, activeView, applyView } = useComplianceAlertFilters();

  const { tableProps } = useDataTable<LexComplianceAlert>({
    queryKey: 'lex-compliance-alerts',
    fetchFn: (params) => fetchSuitePaginated<LexComplianceAlert>(API_ENDPOINTS.LEX_COMPLIANCE_ALERTS, params),
    defaultPageSize: 25,
    defaultSort: { column: 'created_at', direction: 'desc' },
    // Feature 10 (realtime): refetch the alerts table when the gateway publishes
    // a 'lex-compliance-alerts' topic event via the shared realtime registry.
    wsTopics: ['lex-compliance-alerts'],
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.lex.deleteComplianceRule(id),
    onSuccess: async () => {
      showSuccess(labels.toasts.ruleDeletedTitle, labels.toasts.ruleDeletedDescription);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-rules'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-command'] }),
      ]);
      setDeleteRuleTarget(null);
    },
    onError: showApiError,
  });

  const score = dashboardQuery.data?.compliance_score;

  const runMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.runCompliance({}),
    onMutate: () => {
      setPreviousScore(typeof score === 'number' ? Math.round(score) : undefined);
    },
    onSuccess: async (result) => {
      showSuccess(
        labels.toasts.runTitle,
        labels.toasts.runDescription(result.alerts_created, Math.round(result.score)),
      );
      setRunResult(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-compliance-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-command'] }),
      ]);
    },
    onError: showApiError,
  });

  const scoreHistory = useComplianceScoreHistory(user?.tenant_id ?? 'default', score);
  const trendData = useMemo(
    () =>
      scoreHistory.map((point) => ({
        // KSA: Arabic mode yields a Hijri (Umm al-Qura) day/month with Arabic-Indic digits.
        label: f.formatDate(point.at, { month: 'short', day: 'numeric' }),
        value: point.score,
      })),
    [scoreHistory, f],
  );

  if (dashboardQuery.isLoading && rulesQuery.isLoading) {
    return (
      <LexRouteGuard route="/lex/compliance">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            eyebrow={chrome.eyebrow}
            title={labels.pageTitle}
            description={labels.loadingDescription}
          />
          <LoadingSkeleton variant="card" count={4} />
        </div>
      </LexRouteGuard>
    );
  }

  if (dashboardQuery.isError && rulesQuery.isError) {
    return (
      <LexRouteGuard route="/lex/compliance">
        <ErrorState
          message={labels.loadError}
          onRetry={() => { void dashboardQuery.refetch(); void rulesQuery.refetch(); }}
        />
      </LexRouteGuard>
    );
  }

  const dashboard = dashboardQuery.data;
  const rules = rulesQuery.data?.data ?? [];
  // Headline count comes from the server-side total; enabled counts/shares are
  // derived from the loaded page (per_page=100 covers realistic libraries).
  const totalRules = rulesQuery.data?.meta?.total ?? rules.length;
  const enabledRules = rules.filter((r) => r.enabled).length;
  const enabledRuleShare = percent(enabledRules, rules.length);
  // Rule-type coverage: share of the known rule types (excluding 'custom')
  // with at least one configured rule.
  const configuredRuleTypes = new Set(
    rules.map((r) => r.rule_type).filter((t) => t !== 'custom'),
  ).size;
  const ruleTypeCoverage = percent(configuredRuleTypes, RULE_TYPES.length - 1);
  const openAlertCount = dashboard?.open_alerts ?? 0;
  // Share of ALL alerts (any status) that are still active (open + acknowledged
  // + investigating — the backend's open_alerts aggregate).
  const totalAlerts = Object.values(dashboard?.alerts_by_status ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  );
  const currentScore = typeof score === 'number' ? Math.round(score) : undefined;

  const exportComplianceReport = () => {
    const csvLabels = labels.csv;
    const dashboardRows = dashboard
      ? [
          [csvLabels.dashboard, csvLabels.metrics.openAlerts, String(dashboard.open_alerts)],
          [csvLabels.dashboard, csvLabels.metrics.resolvedAlerts, String(dashboard.resolved_alerts)],
          [csvLabels.dashboard, csvLabels.metrics.contractsInScope, String(dashboard.contracts_in_scope)],
          [csvLabels.dashboard, csvLabels.metrics.complianceScore, String(dashboard.compliance_score)],
          ...Object.entries(dashboard.rules_by_type).map(([type, count]) => [csvLabels.rulesByType, type, String(count)]),
          ...Object.entries(dashboard.alerts_by_status).map(([status, count]) => [csvLabels.alertsByStatus, status, String(count)]),
          ...Object.entries(dashboard.alerts_by_severity).map(([severity, count]) => [csvLabels.alertsBySeverity, severity, String(count)]),
        ]
      : [];
    const ruleRows = rules.map((rule) => [
      csvLabels.regulationRule,
      rule.name,
      csvLabels.ruleDetail(rule.rule_type, rule.severity, rule.enabled),
    ]);
    const csv = [[csvLabels.headerSection, csvLabels.headerMetric, csvLabels.headerValue], ...dashboardRows, ...ruleRows]
      .map((row) => row.map(csvCell).join(','))
      .join('\n');
    downloadBlob(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
      `watheeq-compliance-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const alertColumns: ColumnDef<LexComplianceAlert>[] = [
    ...(canWrite ? [selectionColumn<LexComplianceAlert>(bulkLabels.selection)] : []),
    {
      id: 'title',
      accessorKey: 'title',
      header: labels.alertColumns.alert,
      cell: ({ row }) => (
        <button
          type="button"
          className="text-start"
          onClick={() => setDetailTarget(row.original)}
        >
          <p className="font-medium hover:underline" dir="auto">{row.original.title}</p>
          <p className="text-xs text-muted-foreground line-clamp-1" dir="auto">{row.original.description}</p>
        </button>
      ),
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: labels.alertColumns.severity,
      cell: ({ row }) => <SeverityIndicator severity={normalizeSeverity(row.original.severity)} size="sm" />,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: labels.alertColumns.status,
      cell: ({ row }) => (
        <Badge variant="outline">
          {labels.enums.alertStatuses[row.original.status] ?? row.original.status.replace(/_/g, ' ')}
        </Badge>
      ),
    },
    {
      id: 'age',
      header: labels.alertColumns.age,
      accessorFn: (row) => row.created_at,
      enableSorting: true,
      sortingFn: (a, b) => compareAlertAge(a.original, b.original),
      cell: ({ row }) => <AlertAgeCell alert={row.original} />,
    },
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: labels.alertColumns.created,
      enableSorting: true,
      // KSA: localized relative time ("3 days ago" / "منذ ٣ أيام") with Hijri-aware
      // full date in the title, instead of the English-only shared RelativeTime.
      cell: ({ row }) => (
        <span className="text-sm tabular-nums" title={f.formatDual(row.original.created_at)}>
          {f.formatRelative(row.original.created_at)}
        </span>
      ),
    },
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: '',
            enableHiding: false,
            enableSorting: false,
            cell: ({ row }: { row: { original: LexComplianceAlert } }) => (
              <Button variant="ghost" size="sm" onClick={() => setAlertTarget(row.original)}>
                {labels.actions.update}
              </Button>
            ),
          } satisfies ColumnDef<LexComplianceAlert>,
        ]
      : []),
  ];

  const kpiItems: LexKpiItem[] = [
    {
      id: 'total-rules',
      label: labels.kpis.totalRules,
      value: totalRules,
      icon: Scale,
      theme: 'primary',
      description: labels.kpiDetails.totalRules,
      progress: ruleTypeCoverage,
      progressLabel: labels.kpiDetails.ruleCoverage,
      detail: labels.kpiDetails.rulesConfigured,
      detailValue: f.formatNumber(totalRules),
      onAction: () => {
        setRuleScope('all');
        setRuleTypeScope(null);
        requestAnimationFrame(() => document.getElementById('lex-compliance-rules')?.scrollIntoView({ behavior: 'smooth' }));
      },
      pressed: ruleScope === 'all' && ruleTypeScope === null,
    },
    {
      id: 'enabled-rules',
      label: labels.kpis.enabledRules,
      value: enabledRules,
      icon: ShieldCheck,
      theme: 'emerald',
      description: labels.kpiDetails.enabledRules,
      progress: enabledRuleShare,
      progressLabel: labels.kpiDetails.enabledShare,
      detail: labels.kpiDetails.enabledShare,
      detailValue: `${f.formatNumber(enabledRuleShare)}%`,
      onAction: () => {
        setRuleScope('enabled');
        setRuleTypeScope(null);
        requestAnimationFrame(() => document.getElementById('lex-compliance-rules')?.scrollIntoView({ behavior: 'smooth' }));
      },
      pressed: ruleScope === 'enabled' && ruleTypeScope === null,
    },
    {
      id: 'open-alerts',
      label: labels.kpis.openAlerts,
      value: openAlertCount,
      icon: AlertTriangle,
      theme: 'red',
      description: labels.kpiDetails.openAlerts,
      progress: percent(openAlertCount, totalAlerts),
      progressLabel: labels.kpiDetails.activeAlerts,
      detail: labels.kpiDetails.activeAlerts,
      detailValue: f.formatNumber(openAlertCount),
      onAction: () => {
        applyView('open-alerts');
        requestAnimationFrame(() => document.getElementById('lex-compliance-alerts')?.scrollIntoView({ behavior: 'smooth' }));
      },
      pressed: activeView === 'open-alerts',
    },
  ];
  const visibleRules = rules.filter(
    (rule) =>
      (ruleScope !== 'enabled' || rule.enabled) &&
      (ruleTypeScope === null || rule.rule_type === ruleTypeScope),
  );
  const openAlertRecords = (key: 'severity' | 'status', value: string) => {
    setFilter(key, value);
    requestAnimationFrame(() =>
      document.getElementById('lex-compliance-alerts')?.scrollIntoView({ behavior: 'smooth' }),
    );
  };

  return (
    <LexRouteGuard route="/lex/compliance">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          eyebrow={chrome.eyebrow}
          title={labels.pageTitle}
          description={labels.pageDescription}
          actions={
            canWrite ? (
              <div className="flex items-center gap-2">
                <LastRunBadge calculatedAt={dashboard?.calculated_at} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runMutation.mutate()}
                  disabled={runMutation.isPending}
                >
                  {runMutation.isPending
                    ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                    : <Play className="me-1.5 h-3.5 w-3.5" />}
                  {labels.actions.runCheck}
                </Button>
                <Button variant="outline" size="sm" onClick={exportComplianceReport}>
                  <Download className="me-1.5 h-3.5 w-3.5" />
                  {labels.actions.export}
                </Button>
                <Button size="sm" onClick={() => setCreateRuleOpen(true)}>
                  <Plus className="me-1.5 h-4 w-4" />
                  {labels.actions.newRule}
                </Button>
              </div>
            ) : (
              <LastRunBadge calculatedAt={dashboard?.calculated_at} />
            )
          }
        />

        {/* Partial-load notice: the full-page ErrorState only fires when BOTH
            queries fail; surface a retry-able banner when just one did so figures
            aren't silently shown as zero. */}
        {dashboardQuery.isError || rulesQuery.isError ? (
          <CompliancePartialError
            labels={chrome.partialError}
            onRetry={() => {
              if (dashboardQuery.isError) void dashboardQuery.refetch();
              if (rulesQuery.isError) void rulesQuery.refetch();
            }}
          />
        ) : null}

        {/* Standardized on the canonical <LexKpiStrip> (shared KpiCard under the
            hood) so the stat row matches sibling Lex pages. Semantic tones: rule
            counts = sky, enabled = emerald (health), open alerts = red (risk). The
            compliance score renders as a gauge (Feature 4) below, not a flat tile. */}
        <LexKpiStrip columns={3} items={kpiItems} />

        {/* Compliance score gauge (Feature 4). Rendered only when the dashboard
            loaded (matching the breakdown charts) so a loading/failed query is
            never presented as a false 0% score; the partial-error banner above
            covers the failure case. */}
        {dashboard ? (
          <ComplianceScoreGauge
            score={dashboard.compliance_score}
            onAction={() => {
              applyView('open-alerts');
              requestAnimationFrame(() =>
                document.getElementById('lex-compliance-alerts')?.scrollIntoView({ behavior: 'smooth' }),
              );
            }}
          />
        ) : dashboardQuery.isLoading ? (
          <LoadingSkeleton variant="card" count={1} />
        ) : null}

        {/* Dashboard breakdown charts (Feature 3) */}
        {dashboard ? (
          <ComplianceBreakdownCharts
            dashboard={dashboard}
            onAlertSeveritySelect={(severity) => openAlertRecords('severity', severity)}
            onAlertStatusSelect={(status) => openAlertRecords('status', status)}
            onRuleTypeSelect={(ruleType) => {
              setRuleTypeScope(ruleType);
              requestAnimationFrame(() =>
                document.getElementById('lex-compliance-rules')?.scrollIntoView({ behavior: 'smooth' }),
              );
            }}
          />
        ) : null}

        {/* Compliance Score Trend */}
        <SectionCard title={labels.trend.title} description={labels.trend.description}>
          {trendData.length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.trend.empty}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium tabular-nums">
                  {/* KSA: shape the embedded score digits to Arabic-Indic in ar mode
                      (idempotent / unchanged in en). */}
                  {shapeDigits(
                    labels.trend.current(currentScore ?? trendData[trendData.length - 1].value),
                    locale,
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{labels.trend.localNote}</span>
              </div>
              <TrendSparkline data={trendData} height={96} showAxis />
            </div>
          )}
        </SectionCard>

        {/* Rule Library (Features 6 + 8) */}
        <div id="lex-compliance-rules">
        <SectionCard title={labels.ruleLibrary.title} description={labels.ruleLibrary.description}>
          <RuleLibrary
            rules={visibleRules}
            canWrite={canWrite}
            onEdit={setEditRuleTarget}
            onDelete={setDeleteRuleTarget}
            emptyState={
              canWrite ? (
                <RuleTemplateGallery onSeeded={() => { void rulesQuery.refetch(); }} />
              ) : (
                <p className="text-sm text-muted-foreground">{labels.ruleLibrary.empty}</p>
              )
            }
          />
        </SectionCard>
        </div>

        {/* Compliance Alerts */}
        <div id="lex-compliance-alerts">
        <SectionCard title={labels.alerts.title} description={labels.alerts.description}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{savedViewLabels.presetsHeading}</span>
            {COMPLIANCE_SAVED_VIEWS.map((view) => (
              <Button
                key={view.id}
                variant={activeView === view.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyView(view.id)}
              >
                {savedViewLabels.views[view.id]}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              {savedViewLabels.clearAll}
            </Button>
            <SavedViewsBar
              namespace="lex-compliance-alerts"
              activeFilters={filters}
              onApply={applyView}
              className="ms-auto"
            />
          </div>
          <DataTable
            {...tableProps}
            columns={alertColumns}
            filters={buildAlertFilters(labels)}
            activeFilters={filters}
            onFilterChange={setFilter}
            onClearFilters={clearFilters}
            enableSelection={canWrite}
            onSelectionChange={canWrite ? setSelectedAlertIds : undefined}
            tableId="lex-compliance-alerts"
            striped
            stickyHeader
            enableDensityToggle
            enableColumnToggle
            emptyState={{
              icon: Scale,
              title: labels.alerts.emptyTitle,
              description: labels.alerts.emptyDescription,
            }}
          />
        </SectionCard>
        </div>
      </div>

      {/* Dialogs */}
      <RuleFormDialog open={createRuleOpen} onOpenChange={setCreateRuleOpen} labels={labels} />
      {editRuleTarget ? (
        <RuleFormDialog
          open
          rule={editRuleTarget}
          onOpenChange={(o) => { if (!o) setEditRuleTarget(null); }}
          labels={labels}
        />
      ) : null}
      <ConfirmDialog
        open={deleteRuleTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteRuleTarget(null); }}
        title={labels.deleteDialog.title}
        description={labels.deleteDialog.description(deleteRuleTarget?.name ?? '')}
        confirmLabel={labels.deleteDialog.confirm}
        variant="destructive"
        loading={deleteRuleMutation.isPending}
        onConfirm={() => { if (deleteRuleTarget) deleteRuleMutation.mutate(deleteRuleTarget.id); }}
      />
      <AlertStatusDialog
        open={alertTarget !== null}
        alert={alertTarget}
        onOpenChange={(o) => { if (!o) setAlertTarget(null); }}
        labels={labels}
      />
      <AlertDetailPanel
        open={detailTarget !== null}
        alert={detailTarget}
        onOpenChange={(o) => { if (!o) setDetailTarget(null); }}
        canWrite={canWrite}
        onRequestStatusEdit={(alert) => {
          setDetailTarget(null);
          setAlertTarget(alert);
        }}
      />
      {canWrite ? (
        <AlertBulkActionBar selectedIds={selectedAlertIds} onClear={() => setSelectedAlertIds([])} />
      ) : null}
      <RunSummaryDialog
        open={runResult !== null}
        result={runResult}
        onOpenChange={(o) => { if (!o) setRunResult(null); }}
        previousScore={previousScore}
      />
    </LexRouteGuard>
  );
}

/**
 * useComplianceScoreHistory persists the live dashboard score to the shared,
 * tenant-scoped localStorage store (`../_lib/compliance-score-history`) so a
 * short trend can be charted even without a dedicated history endpoint. The
 * store appends a new point per UTC day (or when the score changes) and caps
 * the series length. Clearly labeled as browser-local in the UI.
 */
function useComplianceScoreHistory(
  tenantId: string,
  score: number | undefined,
): ComplianceScorePoint[] {
  const [history, setHistory] = useState<ComplianceScorePoint[]>(() =>
    readComplianceScoreHistory(tenantId),
  );

  useEffect(() => {
    if (typeof score !== 'number' || Number.isNaN(score)) {
      setHistory(readComplianceScoreHistory(tenantId));
      return;
    }
    setHistory(recordComplianceScore(tenantId, score));
  }, [tenantId, score]);

  return history;
}

function normalizeSeverity(value: string): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  switch (value) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
      return value;
    default:
      return 'info';
  }
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
