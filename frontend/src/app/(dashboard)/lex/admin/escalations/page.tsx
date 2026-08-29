'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  GitFork,
  Network,
  ShieldCheck,
  TimerReset,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { LexAccessGuard } from '@/components/lex/access/lex-access-guard';
import { StatTile } from '@/components/shared/stat-tile';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { lexAdminApi, type OrgEntity, type OrgRoleKey, type SLATarget } from '@/lib/lex/admin';
import {
  ESCALATION_ROLE_KEYS,
  buildCoverageRows,
  escalationLevel,
  type CoverageStatus,
} from '../org-entities/_lib/escalation-coverage';

type EscalationLabels = {
  pageTitle: string;
  pageDescription: string;
  eyebrow: string;
  viewSla: string;
  viewOrg: string;
  stats: {
    activeTargets: string;
    orderedTargets: string;
    recipientCoverage: string;
    gaps: string;
  };
  copy: {
    activeTargets: string;
    orderedTargets: string;
    recipientCoverage: string;
    gaps: string;
    services: string;
    l1Average: string;
    strictOrder: string;
    matrixScope: string;
    uncoveredCells: string;
  };
  timing: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    service: string;
    priority: string;
    turnaround: string;
    l1: string;
    l2: string;
    l3: string;
    state: string;
    active: string;
    inactive: string;
    normal: string;
    urgent: string;
    daysAfterBreach: (days: number) => string;
  };
  coverage: {
    title: string;
    description: string;
    role: string;
    level: string;
    bound: string;
    inherited: string;
    missing: string;
    coverage: string;
    assignmentHint: string;
  };
  preview: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    source: string;
  };
  errorTitle: string;
  errorDescription: string;
  retry: string;
};

const LABELS: Record<'en' | 'ar', EscalationLabels> = {
  en: {
    pageTitle: 'Escalation Policies',
    pageDescription:
      'Monitor SLA breach timing, L1-L3 escalation ladders, and role coverage before a legal service misses its commitment.',
    eyebrow: 'Lex administration',
    viewSla: 'SLA targets',
    viewOrg: 'Org registry',
    stats: {
      activeTargets: 'Active targets',
      orderedTargets: 'Ordered ladders',
      recipientCoverage: 'Recipient coverage',
      gaps: 'Open gaps',
    },
    copy: {
      activeTargets: 'Published SLA targets with escalation timings.',
      orderedTargets: 'Active targets where L1, L2 and L3 fire in strict order.',
      recipientCoverage: 'Escalation role cells covered directly or by inheritance.',
      gaps: 'Missing L1-L3 role bindings across the active organization tree.',
      services: 'Services covered',
      l1Average: 'Avg. L1 offset',
      strictOrder: 'Strict timing order',
      matrixScope: 'L1-L3 matrix cells',
      uncoveredCells: 'Uncovered cells',
    },
    timing: {
      title: 'SLA Timing Matrix',
      description:
        'Escalation timings are configured on SLA targets; this page summarizes the active service-priority ladder.',
      emptyTitle: 'No SLA escalation targets found',
      emptyDescription:
        'Create active SLA targets to define the service turnaround and L1-L3 breach escalation offsets.',
      service: 'Service',
      priority: 'Priority',
      turnaround: 'Turnaround',
      l1: 'L1',
      l2: 'L2',
      l3: 'L3',
      state: 'State',
      active: 'Active',
      inactive: 'Inactive',
      normal: 'Normal',
      urgent: 'Urgent',
      daysAfterBreach: (days) => `+${days} working day${days === 1 ? '' : 's'}`,
    },
    coverage: {
      title: 'Recipient Coverage',
      description:
        'L1, L2 and L3 recipients resolve from org role bindings: section supervisor, department manager, shared services manager.',
      role: 'Role',
      level: 'Level',
      bound: 'Direct',
      inherited: 'Inherited',
      missing: 'Missing',
      coverage: 'Coverage',
      assignmentHint: 'Assign missing owners in the org registry to prevent silent escalation gaps.',
    },
    preview: {
      title: 'Escalation Chain Preview',
      description:
        'Sample active entities and their effective L1-L3 chain. Use this to spot missing owners before an SLA clock breaches.',
      emptyTitle: 'No org entities available',
      emptyDescription: 'Add org entities and role holders so SLA escalations can resolve recipients.',
      source: 'Source',
    },
    errorTitle: 'Could not load escalation policy data',
    errorDescription: 'Refresh the page or check the Lex admin API health.',
    retry: 'Retry',
  },
  ar: {
    pageTitle: 'سياسات التصعيد',
    pageDescription:
      'متابعة توقيتات تجاوز اتفاقية مستوى الخدمة وسلالم التصعيد من المستوى الأول إلى الثالث وتغطية الأدوار قبل إخلال الخدمة القانونية بالتزامها.',
    eyebrow: 'إدارة ليكس',
    viewSla: 'أهداف اتفاقية مستوى الخدمة',
    viewOrg: 'سجل الجهات',
    stats: {
      activeTargets: 'الأهداف النشطة',
      orderedTargets: 'السلالم المرتبة',
      recipientCoverage: 'تغطية المستلمين',
      gaps: 'الفجوات المفتوحة',
    },
    copy: {
      activeTargets: 'أهداف اتفاقية مستوى الخدمة المنشورة مع توقيتات التصعيد.',
      orderedTargets: 'الأهداف النشطة التي يتم فيها تشغيل L1 و L2 و L3 بترتيب صارم.',
      recipientCoverage: 'خلايا أدوار التصعيد المغطاة مباشرة أو بالوراثة.',
      gaps: 'ارتباطات أدوار L1-L3 المفقودة عبر شجرة التنظيم النشطة.',
      services: 'الخدمات المغطاة',
      l1Average: 'متوسط إزاحة L1',
      strictOrder: 'ترتيب توقيت صارم',
      matrixScope: 'خلايا مصفوفة L1-L3',
      uncoveredCells: 'خلايا غير مغطاة',
    },
    timing: {
      title: 'مصفوفة توقيت اتفاقية مستوى الخدمة',
      description:
        'يتم ضبط توقيتات التصعيد على أهداف اتفاقية مستوى الخدمة؛ وتلخص هذه الصفحة سلم الخدمة والأولوية النشط.',
      emptyTitle: 'لا توجد أهداف تصعيد',
      emptyDescription: 'أنشئ أهداف اتفاقية مستوى خدمة نشطة لتحديد مدة الإنجاز وإزاحات تصعيد L1-L3 بعد التجاوز.',
      service: 'الخدمة',
      priority: 'الأولوية',
      turnaround: 'مدة الإنجاز',
      l1: 'L1',
      l2: 'L2',
      l3: 'L3',
      state: 'الحالة',
      active: 'نشط',
      inactive: 'غير نشط',
      normal: 'عادي',
      urgent: 'عاجل',
      daysAfterBreach: (days) => `+${days} يوم عمل`,
    },
    coverage: {
      title: 'تغطية المستلمين',
      description:
        'يتم حل مستلمي L1 و L2 و L3 من ارتباطات أدوار الجهات: مشرف القسم، مدير الإدارة، مدير الخدمات المشتركة.',
      role: 'الدور',
      level: 'المستوى',
      bound: 'مباشر',
      inherited: 'موروث',
      missing: 'مفقود',
      coverage: 'التغطية',
      assignmentHint: 'أسند المالكين المفقودين في سجل الجهات لمنع فجوات التصعيد الصامتة.',
    },
    preview: {
      title: 'معاينة سلسلة التصعيد',
      description:
        'عينة من الجهات النشطة وسلسلة L1-L3 الفعلية لها. استخدمها لاكتشاف المالكين المفقودين قبل تجاوز ساعة اتفاقية مستوى الخدمة.',
      emptyTitle: 'لا توجد جهات تنظيمية',
      emptyDescription: 'أضف الجهات التنظيمية وحاملي الأدوار حتى يتمكن التصعيد من حل المستلمين.',
      source: 'المصدر',
    },
    errorTitle: 'تعذر تحميل بيانات سياسة التصعيد',
    errorDescription: 'حدّث الصفحة أو تحقق من صحة واجهة إدارة ليكس.',
    retry: 'إعادة المحاولة',
  },
};

const ROLE_LABELS: Record<OrgRoleKey, { en: string; ar: string }> = {
  section_supervisor: { en: 'Section Supervisor', ar: 'مشرف القسم' },
  department_manager: { en: 'Department Manager', ar: 'مدير الإدارة' },
  shared_services_manager: { en: 'Shared Services Manager', ar: 'مدير الخدمات المشتركة' },
  legal_director: { en: 'Legal Director', ar: 'مدير الشؤون القانونية' },
  contracts_manager: { en: 'Contracts Manager', ar: 'مدير العقود' },
  compliance_officer: { en: 'Compliance Officer', ar: 'مسؤول الامتثال' },
  general_counsel: { en: 'General Counsel', ar: 'المستشار العام' },
};

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function isOrdered(target: SLATarget): boolean {
  return (
    target.escalation_l1_days > 0 &&
    target.escalation_l2_days > target.escalation_l1_days &&
    target.escalation_l3_days > target.escalation_l2_days
  );
}

function statusTone(status: CoverageStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'bound') return 'default';
  if (status === 'inherited') return 'secondary';
  return 'destructive';
}

function statusLabel(status: CoverageStatus, labels: EscalationLabels): string {
  if (status === 'bound') return labels.coverage.bound;
  if (status === 'inherited') return labels.coverage.inherited;
  return labels.coverage.missing;
}

export default function LexEscalationsPage() {
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const lang = locale.startsWith('ar') ? 'ar' : 'en';
  const labels = LABELS[lang];
  const canManage =
    hasPermission('lex:escalation:manage') || hasPermission('lex:sla:manage') || hasPermission('lex:security:manage');

  const targetsQuery = useQuery({
    queryKey: ['lex-admin-escalations', 'sla-targets'],
    queryFn: () =>
      lexAdminApi.listSLATargets({
        page: 1,
        per_page: 500,
        sort: 'service_code',
        order: 'asc',
      }),
  });

  const orgsQuery = useQuery({
    queryKey: ['lex-admin-escalations', 'org-entities'],
    queryFn: () =>
      lexAdminApi.listOrgEntities({
        page: 1,
        per_page: 500,
        sort: 'code',
        order: 'asc',
      }),
  });

  const targets = useMemo(() => targetsQuery.data?.data ?? [], [targetsQuery.data]);
  const orgs = useMemo(() => orgsQuery.data?.data ?? [], [orgsQuery.data]);
  const activeTargets = useMemo(() => targets.filter((target) => target.active), [targets]);
  const orderedTargets = useMemo(() => activeTargets.filter(isOrdered), [activeTargets]);

  const coverage = useMemo(() => {
    const rows = buildCoverageRows(orgs.filter((entity) => entity.active));
    const byRole = ESCALATION_ROLE_KEYS.map((roleKey) => {
      let bound = 0;
      let inherited = 0;
      let missing = 0;
      for (const row of rows) {
        const status = row.cells[roleKey].status;
        if (status === 'bound') bound += 1;
        else if (status === 'inherited') inherited += 1;
        else missing += 1;
      }
      const total = bound + inherited + missing;
      return {
        roleKey,
        bound,
        inherited,
        missing,
        total,
        coveredPct: percent(bound + inherited, total),
      };
    });
    const total = byRole.reduce((sum, row) => sum + row.total, 0);
    const missing = byRole.reduce((sum, row) => sum + row.missing, 0);
    const covered = total - missing;
    const fullRows = rows.filter((row) =>
      ESCALATION_ROLE_KEYS.every((roleKey) => row.cells[roleKey].status !== 'none'),
    );
    return {
      rows,
      byRole,
      total,
      covered,
      missing,
      coveredPct: percent(covered, total),
      fullyCoveredEntities: fullRows.length,
    };
  }, [orgs]);

  const serviceCount = useMemo(() => new Set(activeTargets.map((target) => target.service_code)).size, [activeTargets]);
  const l1Average = average(activeTargets.map((target) => target.escalation_l1_days));
  const orderedShare = percent(orderedTargets.length, activeTargets.length);
  const loading = targetsQuery.isLoading || orgsQuery.isLoading;
  const error = targetsQuery.isError || orgsQuery.isError;

  const previewRows = useMemo(
    () =>
      coverage.rows
        .filter((row) => ESCALATION_ROLE_KEYS.some((roleKey) => row.cells[roleKey].status !== 'none'))
        .slice(0, 8),
    [coverage.rows],
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href="/lex/admin/sla-targets">
          <TimerReset className="me-1.5 size-4" aria-hidden />
          {labels.viewSla}
        </Link>
      </Button>
      <Button asChild variant={canManage ? 'default' : 'outline'} size="sm">
        <Link href="/lex/admin/org-entities">
          <Network className="me-1.5 size-4" aria-hidden />
          {labels.viewOrg}
        </Link>
      </Button>
    </div>
  );

  return (
    <LexAccessGuard routeKey="/lex/admin/escalations" resourceName={labels.pageTitle}>
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          eyebrow={labels.eyebrow}
          title={labels.pageTitle}
          description={labels.pageDescription}
          actions={actions}
        />

        {error ? (
          <EmptyState
            icon={AlertTriangle}
            title={labels.errorTitle}
            description={labels.errorDescription}
            action={{
              label: labels.retry,
              onClick: () => {
                void targetsQuery.refetch();
                void orgsQuery.refetch();
              },
            }}
          />
        ) : (
          <>
            <div className="escalation-kpi-grid grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatTile
                label={labels.stats.activeTargets}
                value={activeTargets.length}
                themeClass="kpi-theme-primary"
                icon={GitFork}
                loading={loading}
                detail={labels.copy.services}
                detailValue={serviceCount}
                size="md"
                appearance="operational"
                className="escalation-kpi-card"
                href="#escalation-timing-records"
              />
              <StatTile
                label={labels.stats.orderedTargets}
                value={`${orderedShare}%`}
                themeClass="kpi-theme-emerald"
                icon={CheckCircle2}
                loading={loading}
                progress={orderedShare}
                progressLabel={labels.copy.strictOrder}
                detail={labels.copy.l1Average}
                detailValue={labels.timing.daysAfterBreach(l1Average)}
                size="md"
                appearance="operational"
                className="escalation-kpi-card"
                href="#escalation-timing-records"
              />
              <StatTile
                label={labels.stats.recipientCoverage}
                value={`${coverage.coveredPct}%`}
                themeClass="kpi-theme-amber"
                icon={ShieldCheck}
                loading={loading}
                progress={coverage.coveredPct}
                progressLabel={labels.copy.matrixScope}
                detail={labels.coverage.coverage}
                detailValue={coverage.fullyCoveredEntities}
                size="md"
                appearance="operational"
                className="escalation-kpi-card"
                href="#escalation-coverage-records"
              />
              <StatTile
                label={labels.stats.gaps}
                value={coverage.missing}
                themeClass={coverage.missing > 0 ? 'kpi-theme-red' : 'kpi-theme-emerald'}
                icon={AlertTriangle}
                loading={loading}
                progress={percent(coverage.missing, coverage.total)}
                progressLabel={labels.copy.uncoveredCells}
                detail={labels.copy.matrixScope}
                detailValue={coverage.total}
                size="md"
                appearance="operational"
                className="escalation-kpi-card"
                href="#escalation-coverage-records"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]">
              <div id="escalation-timing-records" className="scroll-mt-24">
                <SectionCard title={labels.timing.title} description={labels.timing.description}>
                  {loading ? (
                    <LoadingSkeleton variant="table" count={7} />
                  ) : activeTargets.length === 0 ? (
                    <EmptyState
                      icon={BellRing}
                      title={labels.timing.emptyTitle}
                      description={labels.timing.emptyDescription}
                      size="compact"
                    />
                  ) : (
                    <Table className="min-w-[760px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{labels.timing.service}</TableHead>
                          <TableHead>{labels.timing.priority}</TableHead>
                          <TableHead>{labels.timing.turnaround}</TableHead>
                          <TableHead>{labels.timing.l1}</TableHead>
                          <TableHead>{labels.timing.l2}</TableHead>
                          <TableHead>{labels.timing.l3}</TableHead>
                          <TableHead>{labels.timing.state}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {targets.slice(0, 14).map((target) => (
                          <TableRow key={target.id}>
                            <TableCell className="font-medium">{target.service_code}</TableCell>
                            <TableCell>
                              <Badge variant={target.priority === 'urgent' ? 'destructive' : 'secondary'}>
                                {target.priority === 'urgent' ? labels.timing.urgent : labels.timing.normal}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {labels.timing.daysAfterBreach(target.turnaround_working_days)}
                            </TableCell>
                            <TableCell>{labels.timing.daysAfterBreach(target.escalation_l1_days)}</TableCell>
                            <TableCell>{labels.timing.daysAfterBreach(target.escalation_l2_days)}</TableCell>
                            <TableCell>{labels.timing.daysAfterBreach(target.escalation_l3_days)}</TableCell>
                            <TableCell>
                              <Badge variant={target.active ? 'default' : 'outline'}>
                                {target.active ? labels.timing.active : labels.timing.inactive}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </SectionCard>
              </div>

              <div id="escalation-coverage-records" className="scroll-mt-24">
                <SectionCard title={labels.coverage.title} description={labels.coverage.description}>
                  {loading ? (
                    <LoadingSkeleton variant="list" count={3} />
                  ) : (
                    <div className="space-y-4">
                      {coverage.byRole.map((row) => {
                        const level = escalationLevel(row.roleKey);
                        return (
                          <div key={row.roleKey} className="rounded-lg border p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline">L{level}</Badge>
                                  <h3 className="text-sm font-semibold">
                                    {ROLE_LABELS[row.roleKey]?.[lang] ?? row.roleKey}
                                  </h3>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {row.bound} {labels.coverage.bound} · {row.inherited} {labels.coverage.inherited} ·{' '}
                                  {row.missing} {labels.coverage.missing}
                                </p>
                              </div>
                              <span className="text-sm font-semibold">{row.coveredPct}%</span>
                            </div>
                            <Progress value={row.coveredPct} className="mt-3 h-2" />
                          </div>
                        );
                      })}
                      {coverage.missing > 0 ? (
                        <div className="rounded-lg border border-warning-300/40 bg-warning-300/10 p-3 text-sm text-warning-700 dark:text-warning-300">
                          {labels.coverage.assignmentHint}
                        </div>
                      ) : null}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>

            <SectionCard title={labels.preview.title} description={labels.preview.description}>
              {loading ? (
                <LoadingSkeleton variant="list" count={5} />
              ) : orgs.length === 0 ? (
                <EmptyState
                  icon={Network}
                  title={labels.preview.emptyTitle}
                  description={labels.preview.emptyDescription}
                  size="compact"
                />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {previewRows.map((row) => (
                    <div key={row.entity.id} className="rounded-lg border p-4">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {row.entity.code} · {resolveLocalized(row.entity.name, locale) || row.entity.code}
                          </p>
                          <p className="text-xs text-muted-foreground">{row.entity.entity_type}</p>
                        </div>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/lex/admin/org-entities/${row.entity.id}`}>
                            <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
                          </Link>
                        </Button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {ESCALATION_ROLE_KEYS.map((roleKey) => {
                          const cell = row.cells[roleKey];
                          const level = escalationLevel(roleKey);
                          return (
                            <div key={roleKey} className="rounded-md bg-muted/45 p-2">
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold">L{level}</span>
                                <Badge variant={statusTone(cell.status)} className="px-1.5 py-0 text-overline">
                                  {statusLabel(cell.status, labels)}
                                </Badge>
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {cell.sourceEntityCode
                                  ? `${labels.preview.source}: ${cell.sourceEntityCode}`
                                  : labels.coverage.missing}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </LexAccessGuard>
  );
}
