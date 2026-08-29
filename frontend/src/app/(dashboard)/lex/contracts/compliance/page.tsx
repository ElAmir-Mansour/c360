'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { useLocale } from '@/components/providers/locale-provider';
import { TrendSparkline } from '@/components/shared/trend-sparkline';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Surface } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { LexContractRenewalWarning, LexObligation } from '@/types/suites';
import {
  readComplianceScoreHistory,
  recordComplianceScore,
  type ComplianceScorePoint,
} from '../../_lib/compliance-score-history';
import { LexRouteGuard } from '../../_guards/lex-route-guard';

type ObligationTableRow = LexObligation & Record<string, unknown>;

const copy = {
  en: {
    eyebrow: 'WatheeqTech · Contracts',
    title: 'Contract Compliance & Renewals',
    description: 'Monitor renewal windows, contractual obligations, and portfolio compliance.',
    back: 'Contracts Registry',
    fullCompliance: 'Compliance Center',
    run: 'Run Compliance',
    score: 'Compliance Rate',
    scoreHint: 'Across contracts in scope',
    due: 'Due This Month',
    dueHint: 'Open obligations in 30 days',
    overdue: 'Overdue',
    overdueHint: 'Requires immediate action',
    expiring: 'Expiring in 90 Days',
    expiringHint: 'Renewal decision required',
    renewals: 'Upcoming Renewals',
    renewalsDescription: 'Contracts approaching their notice or expiry window',
    obligations: 'Obligations Tracker',
    obligationsDescription: 'Live contractual commitments and due dates',
    trend: 'Historical Compliance Trend',
    trendDescription: 'Tenant-scoped compliance scores recorded by operational runs',
    renew: 'Renew',
    view: 'View',
    complete: 'Mark Complete',
    completed: 'Completed',
    owner: 'Owner',
    contract: 'Contract',
    obligation: 'Obligation',
    dueDate: 'Due Date',
    status: 'Status',
    emptyRenewals: 'No renewals are currently inside the 90-day window.',
    emptyObligations: 'No open contract obligations were found.',
    updated: 'Compliance updated',
    updatedDescription: 'The portfolio compliance score and alerts were refreshed.',
    renewed: 'Contract renewed',
    renewedDescription: 'A new one-year contract term was created.',
    obligationUpdated: 'Obligation completed',
    obligationUpdatedDescription: 'The obligation tracker has been updated.',
    loadError: 'The contract compliance workspace could not be loaded.',
    days: (value: number) => value < 0 ? `${Math.abs(value)} days overdue` : `${value} days remaining`,
  },
  ar: {
    eyebrow: 'وثيق تك · العقود',
    title: 'امتثال العقود وتجديداتها',
    description: 'راقب نوافذ التجديد والالتزامات التعاقدية وامتثال المحفظة.',
    back: 'سجل العقود',
    fullCompliance: 'مركز الامتثال',
    run: 'تشغيل فحص الامتثال',
    score: 'نسبة الامتثال',
    scoreHint: 'ضمن العقود المشمولة',
    due: 'مستحق هذا الشهر',
    dueHint: 'التزامات مفتوحة خلال 30 يوماً',
    overdue: 'متأخر',
    overdueHint: 'يتطلب إجراءً فورياً',
    expiring: 'ينتهي خلال 90 يوماً',
    expiringHint: 'يلزم قرار التجديد',
    renewals: 'التجديدات القادمة',
    renewalsDescription: 'العقود التي تقترب من نافذة الإشعار أو الانتهاء',
    obligations: 'متابعة الالتزامات',
    obligationsDescription: 'الالتزامات التعاقدية المباشرة وتواريخ استحقاقها',
    trend: 'الاتجاه التاريخي للامتثال',
    trendDescription: 'درجات الامتثال الخاصة بالمنشأة والمسجلة أثناء الفحوص التشغيلية',
    renew: 'تجديد',
    view: 'عرض',
    complete: 'تحديد كمكتمل',
    completed: 'مكتمل',
    owner: 'المسؤول',
    contract: 'العقد',
    obligation: 'الالتزام',
    dueDate: 'تاريخ الاستحقاق',
    status: 'الحالة',
    emptyRenewals: 'لا توجد تجديدات ضمن نافذة التسعين يوماً حالياً.',
    emptyObligations: 'لم يتم العثور على التزامات تعاقدية مفتوحة.',
    updated: 'تم تحديث الامتثال',
    updatedDescription: 'تم تحديث درجة امتثال المحفظة والتنبيهات.',
    renewed: 'تم تجديد العقد',
    renewedDescription: 'تم إنشاء مدة تعاقدية جديدة لسنة واحدة.',
    obligationUpdated: 'اكتمل الالتزام',
    obligationUpdatedDescription: 'تم تحديث سجل الالتزامات.',
    loadError: 'تعذّر تحميل مساحة امتثال العقود.',
    days: (value: number) => value < 0 ? `متأخر ${Math.abs(value)} يوماً` : `متبقٍ ${value} يوماً`,
  },
} as const;

export default function ContractCompliancePage() {
  return (
    <LexRouteGuard route="/lex/contracts">
      <ContractComplianceWorkspace />
    </LexRouteGuard>
  );
}

function ContractComplianceWorkspace() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { locale, direction } = useLocale();
  const t = copy[locale];

  const dashboardQuery = useQuery({
    queryKey: ['lex-compliance-dashboard'],
    queryFn: () => enterpriseApi.lex.getComplianceDashboard(),
  });
  const renewalsQuery = useQuery({
    queryKey: ['lex-contract-renewals-deep'],
    queryFn: () => enterpriseApi.lex.getContractRenewalWarnings({ horizon_days: 90, lead_days: 30 }),
  });
  const obligationsQuery = useQuery({
    queryKey: ['lex-contract-obligations-deep'],
    queryFn: () => enterpriseApi.lex.listObligations({
      page: 1,
      per_page: 100,
      order: 'asc',
      filters: { status: ['open', 'in_progress', 'blocked'] },
    }),
  });

  const [trend, setTrend] = useState<ComplianceScorePoint[]>([]);
  const [obligationScope, setObligationScope] = useState<'due' | 'overdue' | null>(null);
  const score = dashboardQuery.data?.compliance_score;
  useEffect(() => {
    const tenantId = user?.tenant_id ?? 'default';
    setTrend(
      typeof score === 'number'
        ? recordComplianceScore(tenantId, score)
        : readComplianceScoreHistory(tenantId),
    );
  }, [score, user?.tenant_id]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lex-compliance-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contract-renewals-deep'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contract-obligations-deep'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-contracts'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
    ]);
  };

  const runMutation = useMutation({
    mutationFn: () => enterpriseApi.lex.runCompliance({}),
    onSuccess: async () => {
      showSuccess(t.updated, t.updatedDescription);
      await refresh();
    },
    onError: showApiError,
  });
  const renewMutation = useMutation({
    mutationFn: (warning: LexContractRenewalWarning) => {
      const previousExpiry = warning.expiry_date ? new Date(warning.expiry_date) : new Date();
      const newEffective = new Date(previousExpiry);
      newEffective.setUTCDate(newEffective.getUTCDate() + 1);
      const newExpiry = new Date(newEffective);
      newExpiry.setUTCFullYear(newExpiry.getUTCFullYear() + 1);
      newExpiry.setUTCDate(newExpiry.getUTCDate() - 1);
      return enterpriseApi.lex.renewContract(warning.contract_id, {
        new_effective_date: newEffective.toISOString(),
        new_expiry_date: newExpiry.toISOString(),
        change_summary: locale === 'ar'
          ? 'تجديد لسنة واحدة من مساحة امتثال العقود'
          : 'One-year renewal from the contract compliance workspace',
      });
    },
    onSuccess: async () => {
      showSuccess(t.renewed, t.renewedDescription);
      await refresh();
    },
    onError: showApiError,
  });
  const obligationMutation = useMutation({
    mutationFn: (obligation: LexObligation) =>
      enterpriseApi.lex.updateObligationStatus(obligation.id, { status: 'completed' }),
    onSuccess: async () => {
      showSuccess(t.obligationUpdated, t.obligationUpdatedDescription);
      await refresh();
    },
    onError: showApiError,
  });

  const obligations = useMemo(
    () => (obligationsQuery.data?.data.filter((item) => Boolean(item.contract_id)) ?? []) as ObligationTableRow[],
    [obligationsQuery.data?.data],
  );
  const obligationColumns = useMemo<Column<ObligationTableRow>[]>(
    () => [
      {
        key: 'obligation',
        header: t.obligation,
        render: (obligation) => (
          <div>
            <p className="font-medium">{obligation.title}</p>
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{obligation.description}</p>
          </div>
        ),
      },
      {
        key: 'contract',
        header: t.contract,
        render: (obligation) => obligation.contract_id ? (
          <Link href={`/lex/contracts/${obligation.contract_id}`} className="hover:underline">
            {obligation.contract_title || obligation.contract_id.slice(0, 8)}
          </Link>
        ) : '—',
      },
      {
        key: 'owner',
        header: t.owner,
        render: (obligation) => <span className="text-muted-foreground">{obligation.owner_name}</span>,
      },
      {
        key: 'due',
        header: t.dueDate,
        render: (obligation) => (
          <div>
            <p>{formatDate(obligation.due_date, locale)}</p>
            <p className={cn('text-xs', obligation.days_until_due < 0 ? 'text-destructive' : 'text-muted-foreground')}>
              {t.days(obligation.days_until_due)}
            </p>
          </div>
        ),
      },
      {
        key: 'status',
        header: t.status,
        render: (obligation) => (
          <Badge variant={obligation.days_until_due < 0 ? 'destructive' : obligation.status === 'in_progress' ? 'warning' : 'secondary'}>
            {obligation.status.replaceAll('_', ' ')}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (obligation) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void obligationMutation.mutate(obligation)}
            disabled={obligationMutation.isPending}
          >
            {obligationMutation.isPending && obligationMutation.variables?.id === obligation.id
              ? <Loader2 className="me-2 h-4 w-4 animate-spin" />
              : <CheckCircle2 className="me-2 h-4 w-4" />}
            {t.complete}
          </Button>
        ),
      },
    ],
    [locale, obligationMutation, t],
  );

  if (dashboardQuery.isLoading || renewalsQuery.isLoading || obligationsQuery.isLoading) {
    return <Skeleton variant="page" />;
  }
  if (dashboardQuery.isError || renewalsQuery.isError || obligationsQuery.isError) {
    return (
      <ErrorState
        message={t.loadError}
        onRetry={() => void Promise.all([
          dashboardQuery.refetch(),
          renewalsQuery.refetch(),
          obligationsQuery.refetch(),
        ])}
      />
    );
  }

  const dueThisMonth = obligations.filter((item) => item.days_until_due >= 0 && item.days_until_due <= 30).length;
  const overdue = obligations.filter((item) => item.days_until_due < 0).length;
  const visibleObligations = obligationScope === 'due'
    ? obligations.filter((item) => item.days_until_due >= 0 && item.days_until_due <= 30)
    : obligationScope === 'overdue'
      ? obligations.filter((item) => item.days_until_due < 0)
      : obligations;
  const warnings = renewalsQuery.data?.items ?? [];
  const trendData = trend.map((point) => ({
    label: new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', { month: 'short', day: 'numeric' }).format(new Date(point.at)),
    value: point.score,
  }));
  const revealSection = (id: string) => {
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div dir={direction} lang={locale} className="space-y-6">
      <PageHeader
        eyebrow={t.eyebrow}
        title={t.title}
        description={t.description}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href="/lex/contracts">
                {direction === 'rtl' ? <ArrowRight className="me-2 h-4 w-4" /> : <ArrowLeft className="me-2 h-4 w-4" />}
                {t.back}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/lex/compliance">
                <ExternalLink className="me-2 h-4 w-4" />
                {t.fullCompliance}
              </Link>
            </Button>
            <Button onClick={() => void runMutation.mutate()} disabled={runMutation.isPending}>
              {runMutation.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <RefreshCw className="me-2 h-4 w-4" />}
              {t.run}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ShieldCheck} label={t.score} value={`${Math.round(score ?? 0)}%`} hint={t.scoreHint} tone="success" onAction={() => revealSection('compliance-trend')} />
        <KpiCard icon={CalendarCheck2} label={t.due} value={String(dueThisMonth)} hint={t.dueHint} tone="warning" pressed={obligationScope === 'due'} onAction={() => { setObligationScope((scope) => scope === 'due' ? null : 'due'); revealSection('compliance-obligations'); }} />
        <KpiCard icon={AlertTriangle} label={t.overdue} value={String(overdue)} hint={t.overdueHint} tone="danger" pressed={obligationScope === 'overdue'} onAction={() => { setObligationScope((scope) => scope === 'overdue' ? null : 'overdue'); revealSection('compliance-obligations'); }} />
        <KpiCard icon={CalendarClock} label={t.expiring} value={String(warnings.length)} hint={t.expiringHint} tone="primary" onAction={() => revealSection('compliance-renewals')} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <Surface id="compliance-renewals" variant="card" padding="lg" className="scroll-mt-24">
          <SectionHeading icon={CalendarClock} title={t.renewals} description={t.renewalsDescription} />
          {warnings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t.emptyRenewals}</p>
          ) : (
            <div className="space-y-3">
              {warnings.slice(0, 6).map((warning) => (
                <div key={warning.contract_id} className="flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/lex/contracts/${warning.contract_id}`} className="truncate font-semibold hover:underline">
                        {warning.title}
                      </Link>
                      <Badge variant={warning.severity === 'urgent' ? 'destructive' : 'warning'}>
                        {t.days(warning.days_until_expiry)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {warning.counterparty} · {formatDate(warning.expiry_date, locale)}
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      <Progress
                        aria-label={t.days(warning.days_until_expiry)}
                        value={Math.max(0, 90 - warning.days_until_expiry)}
                        max={90}
                        className="h-2 max-w-64"
                        indicatorClassName={warning.severity === 'urgent' ? 'bg-destructive' : 'bg-warning-500'}
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/lex/contracts/${warning.contract_id}`}>{t.view}</Link>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void renewMutation.mutate(warning)}
                      disabled={renewMutation.isPending}
                    >
                      {renewMutation.isPending && renewMutation.variables?.contract_id === warning.contract_id
                        ? <Loader2 className="me-2 h-4 w-4 animate-spin" />
                        : <RefreshCw className="me-2 h-4 w-4" />}
                      {t.renew}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>

        <Surface id="compliance-trend" variant="card" padding="lg" className="scroll-mt-24">
          <SectionHeading icon={TrendingUp} title={t.trend} description={t.trendDescription} />
          <div className="mt-6 rounded-2xl border bg-muted/20 p-5">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-3xl font-semibold">{Math.round(score ?? 0)}%</p>
                <p className="text-sm text-muted-foreground">{formatDate(dashboardQuery.data?.calculated_at, locale)}</p>
              </div>
              <Badge variant="success"><TrendingUp className="me-1 h-3.5 w-3.5" />{t.score}</Badge>
            </div>
            {trendData.length > 0 ? (
              <TrendSparkline data={trendData} height={150} showAxis />
            ) : (
              <Progress value={score ?? 0} className="h-3" />
            )}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <MiniMetric href="/lex/contracts" label={locale === 'ar' ? 'العقود المشمولة' : 'Contracts in Scope'} value={String(dashboardQuery.data?.contracts_in_scope ?? 0)} />
            <MiniMetric href="/lex/compliance" label={locale === 'ar' ? 'تنبيهات مفتوحة' : 'Open Alerts'} value={String(dashboardQuery.data?.open_alerts ?? 0)} />
          </div>
        </Surface>
      </div>

      <Surface id="compliance-obligations" variant="card" padding="lg" className="scroll-mt-24">
        <SectionHeading icon={ClipboardCheck} title={t.obligations} description={t.obligationsDescription} />
        {visibleObligations.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t.emptyObligations}</p>
        ) : (
          <SimpleTable
            className="mt-5"
            ariaLabel={t.obligations}
            columns={obligationColumns}
            data={visibleObligations.slice(0, 12)}
            getRowKey={(obligation) => obligation.id}
          />
        )}
      </Surface>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  onAction,
  pressed,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  hint: string;
  tone: 'success' | 'warning' | 'danger' | 'primary';
  onAction: () => void;
  pressed?: boolean;
}) {
  const tones = {
    success: 'bg-success-100 text-success-700 dark:bg-success-950/40 dark:text-success-300',
    warning: 'bg-warning-100 text-warning-700 dark:bg-warning-950/40 dark:text-warning-300',
    danger: 'bg-error-100 text-error-700 dark:bg-error-950/40 dark:text-error-300',
    primary: 'bg-primary/10 text-primary',
  };
  return (
    <Button type="button" variant="ghost" onClick={onAction} aria-pressed={pressed} className="h-auto w-full items-stretch justify-start rounded-2xl p-0 text-start font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Surface variant="card" padding="md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', tones[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      </Surface>
    </Button>
  );
}

function SectionHeading({ icon: Icon, title, description }: { icon: typeof Clock3; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function MiniMetric({ href, label, value }: { href: string; label: string; value: string }) {
  return (
    <Link href={href} className="rounded-xl border bg-muted/20 p-3 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </Link>
  );
}

function formatDate(value: string | null | undefined, locale: 'en' | 'ar') {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
