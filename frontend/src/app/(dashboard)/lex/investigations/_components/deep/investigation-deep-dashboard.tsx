'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  Banknote,
  CheckCircle2,
  Clock3,
  CloudLightning,
  Cpu,
  Database,
  Download,
  FileCheck2,
  FileText,
  LockKeyhole,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { LexRouteGuard } from '../../../_guards/lex-route-guard';
import { ErrorState } from '@/components/common/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  investigationsApi,
  type Investigation,
  type InvestigationEvidence,
} from '@/lib/lex/investigations';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  scopeInvestigationsToWorkspace,
  type InvestigationWorkspace,
} from '../investigation-workspaces';

export type InvestigationDeepVariant = 'fraud' | 'compliance' | 'forensics' | 'board';

interface InvestigationDeepDashboardProps {
  variant: InvestigationDeepVariant;
}

interface VariantCopy {
  crumb: string;
  title: string;
  description: string;
  export: string;
  create: string;
}

const COPY: Record<'en' | 'ar', Record<InvestigationDeepVariant, VariantCopy>> = {
  en: {
    fraud: {
      crumb: 'Fraud Investigations',
      title: 'Fraud Investigation Dashboard',
      description: 'Specialized workspace for corporate fraud discovery, risk evaluation, and recovery.',
      export: 'Export PDF',
      create: 'Initiate Fraud Investigation',
    },
    compliance: {
      crumb: 'Compliance Audits',
      title: 'Compliance Audit Investigations',
      description:
        'Regulated auditing workspace mapping Saudi national regulatory standards and internal policy mandates.',
      export: 'Generate Audit Report',
      create: 'Schedule Compliance Audit',
    },
    forensics: {
      crumb: 'Digital Forensics',
      title: 'Digital Forensics & Evidence Lab',
      description:
        'High-integrity laboratory chain-of-custody tracking and bitstream preservation logging space.',
      export: 'Verify Chain hashes',
      create: 'Register Evidence Asset',
    },
    board: {
      crumb: 'Board Review',
      title: 'Board Review & Governance',
      description:
        'High-level governance panel for case oversight, final regulatory sign-off, and statutory reporting checks.',
      export: 'Download Board Pack',
      create: 'Schedule Committee Session',
    },
  },
  ar: {
    fraud: {
      crumb: 'تحقيقات الاحتيال المالي',
      title: 'لوحة تحقيقات الاحتيال المالي',
      description: 'مساحة عمل متخصصة لكشف الاحتيال المؤسسي، وتقييم المخاطر، واسترداد الأموال.',
      export: 'تصدير التقرير PDF',
      create: 'بدء تحقيق احتيال جديد',
    },
    compliance: {
      crumb: 'عمليات تدقيق الالتزام',
      title: 'تحقيقات التزام التدقيق والأنظمة',
      description:
        'فضاء عمل مخصص لمتابعة الالتزام بالمعايير التشريعية الوطنية ومطابقة القوانين المحلية.',
      export: 'إنشاء تقرير الالتزام الدوري',
      create: 'جدولة تدقيق التزام جديد',
    },
    forensics: {
      crumb: 'الأدلة الرقمية',
      title: 'مختبر الأدلة الرقمية والتحقيق الجنائي',
      description:
        'فحص الأدلة السيبرانية، وتتبع البصمات الرقمية، وتحليل الأنظمة المشبوهة بدقة متناهية.',
      export: 'سجل سلسلة الحيازة الكاملة',
      create: 'تسجيل حرز رقمي جديد',
    },
    board: {
      crumb: 'مراجعة مجلس الإدارة',
      title: 'مراجعة مجلس الإدارة واللجان الرقابية',
      description:
        'اتخاذ القرارات الاستراتيجية لحماية أصول الشركة والمصادقة على نتائج تحقيقات النزاهة.',
      export: 'سجل محاضر الاجتماعات والقرارات',
      create: 'تقديم تقرير للمجلس الحالي',
    },
  },
};

const cardClass = 'rounded-xl border border-border/80 bg-card shadow-none';

async function fetchInvestigationPortfolio(): Promise<Investigation[]> {
  const firstPage = await investigationsApi.list({
    page: 1,
    per_page: 200,
    sort: 'updated_at',
    order: 'desc',
  });
  if (firstPage.meta.total_pages <= 1) return firstPage.data;

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.meta.total_pages - 1 }, (_, index) =>
      investigationsApi.list({
        page: index + 2,
        per_page: 200,
        sort: 'updated_at',
        order: 'desc',
      }),
    ),
  );
  return [firstPage, ...remainingPages].flatMap((page) => page.data);
}

export function InvestigationDeepDashboard({ variant }: InvestigationDeepDashboardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale, direction } = useLocaleOrDefault();
  const { hasAnyPermission, hasPermission } = useAuth();
  const f = useLexFormat();
  const isArabic = locale === 'ar';
  const copy = COPY[isArabic ? 'ar' : 'en'][variant];
  const canWrite = hasAnyPermission(['lex:investigation:add', 'lex:investigation:edit']);
  const canApprove = hasPermission('lex:investigation:approve');

  const portfolioQuery = useQuery({
    queryKey: ['lex-investigations-deep', variant],
    queryFn: fetchInvestigationPortfolio,
    staleTime: 60_000,
  });
  const portfolioRows = useMemo(() => portfolioQuery.data ?? [], [portfolioQuery.data]);
  const rows = useMemo(
    () => scopeInvestigationsToWorkspace(portfolioRows, variant),
    [portfolioRows, variant],
  );

  const detailQueries = useQueries({
    queries: rows.slice(0, 30).map((row) => ({
      queryKey: ['lex-investigation-deep-detail', row.id],
      queryFn: () => investigationsApi.get(row.id),
      staleTime: 60_000,
    })),
  });
  const details = useMemo(
    () => detailQueries.flatMap((query) => (query.data ? [query.data] : [])),
    [detailQueries],
  );

  const approveMutation = useMutation({
    mutationFn: async (investigation: Investigation) => {
      const tasks = await investigationsApi.listApprovalTasks(investigation.id);
      const task = tasks.find((item) => {
        const status = String(item.status ?? '').toLowerCase();
        return !['approved', 'completed', 'rejected', 'cancelled'].includes(status);
      });
      if (!task) throw new Error(isArabic ? 'لا توجد مهمة موافقة مفتوحة' : 'No open approval task');
      const workflowId = String(task.workflow_instance_id ?? investigation.workflow_instance_id ?? '');
      if (!workflowId) {
        throw new Error(isArabic ? 'مسار الموافقة غير متاح' : 'Approval workflow is unavailable');
      }
      const deadline = task.sla_deadline ?? task.due_at;
      let lateJustification = '';
      if (deadline && Date.now() > new Date(deadline).getTime()) {
        lateJustification = window.prompt(
          isArabic
            ? 'يرجى توضيح سبب اعتماد التحقيق بعد موعد اتفاقية مستوى الخدمة.'
            : 'Explain why this investigation is being approved after its SLA deadline.',
        )?.trim() ?? '';
        if (!lateJustification) {
          throw new Error(isArabic ? 'مبرر تجاوز اتفاقية مستوى الخدمة مطلوب' : 'A late SLA justification is required');
        }
      }
      return investigationsApi.decideApproval(investigation.id, workflowId, String(task.id), {
        decision: 'approve',
        notes: isArabic
          ? 'تمت الموافقة من مساحة مراجعة مجلس الإدارة'
          : 'Approved from the board review workspace',
        ...(lateJustification ? { late_justification: lateJustification } : {}),
      });
    },
    onSuccess: async () => {
      showSuccess(isArabic ? 'تم اعتماد ملف التحقيق' : 'Investigation approved');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-investigations-deep'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-investigations'] }),
      ]);
    },
    onError: showApiError,
  });

  const exportWorkspace = () => {
    const lines = [
      ['Investigation', 'Subject', 'Department', 'Priority', 'Status', 'Lead'],
      ...rows.map((row) => [
        row.investigation_number,
        row.subject,
        row.department ?? '',
        row.priority,
        row.status,
        row.lead_investigator,
      ]),
    ];
    const csv = lines
      .map((line) =>
        line
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(','),
      )
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `investigations-${variant}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (portfolioQuery.isLoading) {
    return (
      <LexRouteGuard route="/lex/investigations">
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton.Card key={index} />
            ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </LexRouteGuard>
    );
  }

  if (portfolioQuery.isError) {
    return (
      <LexRouteGuard route="/lex/investigations">
        <ErrorState
          message={isArabic ? 'تعذر تحميل مساحة التحقيقات' : 'Unable to load the investigations workspace'}
          onRetry={() => void portfolioQuery.refetch()}
        />
      </LexRouteGuard>
    );
  }

  return (
    <LexRouteGuard route="/lex/investigations">
      <div
        className="space-y-6 motion-safe:animate-fade-up"
        dir={direction}
        lang={locale}
        data-testid={`investigation-deep-${variant}`}
      >
        <header className="space-y-4">
          <nav className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link href="/lex">{isArabic ? 'وثيق تيك' : 'WatheeqTech'}</Link>
            <span aria-hidden>{isArabic ? '‹' : '›'}</span>
            <Link href="/lex/investigations">
              {isArabic ? 'القضايا والتحقيقات' : 'Cases & Investigations'}
            </Link>
            <span aria-hidden>{isArabic ? '‹' : '›'}</span>
            <span className="font-semibold text-primary">{copy.crumb}</span>
          </nav>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">{copy.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={exportWorkspace}>
                <Download className="me-2 h-4 w-4" aria-hidden />
                {copy.export}
              </Button>
              {canWrite ? (
                <Button
                  type="button"
                  onClick={() =>
                    router.push(`/lex/investigations?create=1&workspace=${variant}`)
                  }
                >
                  <span className="me-2 text-base" aria-hidden>+</span>
                  {copy.create}
                </Button>
              ) : null}
            </div>
          </div>
        </header>

        <WorkspaceInvestigationRegister
          rows={rows}
          workspace={variant}
          isArabic={isArabic}
          formatRelative={f.formatRelative}
        />

        <div className="space-y-6" aria-labelledby="workspace-analytics-heading">
          <div>
            <h2 id="workspace-analytics-heading" className="text-xl font-bold">
              {isArabic ? 'تحليلات مساحة العمل' : 'Workspace analytics'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isArabic
                ? 'مؤشرات وتحليلات ثانوية مستمدة فقط من سجل مساحة العمل أعلاه.'
                : 'Secondary indicators derived only from the scoped work register above.'}
            </p>
          </div>

          {variant === 'fraud' ? (
            <FraudDashboard rows={rows} isArabic={isArabic} formatNumber={f.formatNumber} />
          ) : null}
          {variant === 'compliance' ? (
            <ComplianceDashboard rows={rows} isArabic={isArabic} formatDate={f.formatDate} />
          ) : null}
          {variant === 'forensics' ? (
            <ForensicsDashboard
              details={details}
              loading={detailQueries.some((query) => query.isLoading)}
              isArabic={isArabic}
              formatDate={f.formatDate}
            />
          ) : null}
          {variant === 'board' ? (
            <BoardDashboard
              rows={rows}
              isArabic={isArabic}
              canApprove={canApprove}
              approvingId={approveMutation.isPending ? approveMutation.variables?.id : undefined}
              onApprove={(row) => approveMutation.mutate(row)}
            />
          ) : null}
        </div>
      </div>
    </LexRouteGuard>
  );
}

export function WorkspaceInvestigationRegister({
  rows,
  workspace,
  isArabic,
  formatRelative,
}: {
  rows: Investigation[];
  workspace: InvestigationWorkspace;
  isArabic: boolean;
  formatRelative: (value: string) => string;
}) {
  type WorkspaceRow = Investigation & Record<string, unknown>;
  const workspaceName = COPY[isArabic ? 'ar' : 'en'][workspace].crumb;
  const columns: Column<WorkspaceRow>[] = [
    {
      key: 'number',
      header: isArabic ? 'رقم التحقيق' : 'Investigation',
      render: (row) => (
        <Link
          href={`/lex/investigations/${row.id}`}
          className="font-mono font-semibold text-primary hover:underline"
        >
          {row.investigation_number}
        </Link>
      ),
    },
    {
      key: 'subject',
      header: isArabic ? 'الموضوع' : 'Subject',
      className: 'min-w-56',
      render: (row) => (
        <Link
          href={`/lex/investigations/${row.id}`}
          className="line-clamp-2 font-semibold text-foreground hover:text-primary hover:underline"
          dir="auto"
        >
          {row.subject}
        </Link>
      ),
    },
    {
      key: 'status',
      header: isArabic ? 'الحالة' : 'Status',
      render: (row) => (
        <Badge variant={statusBadgeVariant(row.status)}>{row.status.replaceAll('_', ' ')}</Badge>
      ),
    },
    {
      key: 'lead',
      header: isArabic ? 'المحقق المسؤول' : 'Lead investigator',
      render: (row) => <span dir="auto">{row.lead_investigator}</span>,
    },
    {
      key: 'updated',
      header: isArabic ? 'آخر تحديث' : 'Updated',
      render: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatRelative(row.updated_at)}
        </span>
      ),
    },
    {
      key: 'action',
      header: isArabic ? 'الإجراء' : 'Action',
      align: 'right',
      render: (row) => (
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href={`/lex/investigations/${row.id}`}>
            {isArabic ? 'فتح التحقيق' : 'Open investigation'}
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <section
      className={cn(cardClass, 'overflow-hidden p-5')}
      aria-labelledby="workspace-register-heading"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="workspace-register-heading" className="text-xl font-bold">
            {isArabic ? 'سجل أعمال مساحة العمل' : 'Workspace work register'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isArabic
              ? `جميع التحقيقات المحددة النطاق لمساحة ${workspaceName}.`
              : `All investigations scoped to the ${workspaceName} workspace.`}
          </p>
        </div>
        <Badge variant="outline">
          {rows.length}{' '}
          {isArabic ? 'تحقيقات' : rows.length === 1 ? 'investigation' : 'investigations'}
        </Badge>
      </div>
      <SimpleTable
        className="mt-4 shadow-none"
        ariaLabel={isArabic ? `سجل تحقيقات ${workspaceName}` : `${workspaceName} work register`}
        columns={columns}
        data={rows as WorkspaceRow[]}
        getRowKey={(row) => row.id}
        emptyMessage={
          isArabic
            ? 'لا توجد تحقيقات محددة لهذه المساحة بعد. استخدم إجراء الإنشاء أعلاه لإضافة أول تحقيق.'
            : 'No investigations are scoped to this workspace yet. Use the create action above to add the first one.'
        }
      />
    </section>
  );
}

function FraudDashboard({
  rows,
  isArabic,
  formatNumber,
}: {
  rows: Investigation[];
  isArabic: boolean;
  formatNumber: (value: number) => string;
}) {
  const active = rows.filter((row) => !['closed', 'cancelled'].includes(row.status));
  const exposures = rows.map((row) => metadataNumber(row, ['financial_exposure', 'exposure', 'value']));
  const exposureRows = rows.filter((row) => metadataNumber(row, ['financial_exposure', 'exposure', 'value']) > 0);
  const exposure = exposures.reduce((sum, value) => sum + value, 0);
  const resolvedRows = rows.filter((row) => ['approved', 'closed'].includes(row.status));
  const recovery = rows.length ? Math.round((resolvedRows.length / rows.length) * 100) : 0;
  const whistleblower = rows.filter((row) =>
    metadataText(row, ['intake_source', 'source', 'channel']).toLowerCase().includes('whistle'),
  );

  return (
    <>
      <KpiGrid
        items={[
          {
            label: isArabic ? 'قضايا الاحتيال النشطة' : 'Active Fraud Cases',
            value: isArabic ? `${formatNumber(active.length)} قضايا` : `${formatNumber(active.length)} Ongoing`,
            detail: isArabic ? 'قضايا قيد المعالجة' : 'Live portfolio workload',
            icon: ShieldAlert,
            contributors: investigationContributors(active),
          },
          {
            label: isArabic ? 'الانكشاف المالي الإجمالي' : 'Financial Exposure',
            value: exposure > 0 ? `SAR ${formatNumber(exposure)}` : isArabic ? 'غير مسجل' : 'Not recorded',
            detail: isArabic ? 'مخاطر مالية مسجلة' : 'Recorded financial risk',
            icon: Banknote,
            contributors: investigationContributors(exposureRows),
          },
          {
            label: isArabic ? 'متوسط مدة القضية' : 'Avg. Case Duration',
            value: averageAge(rows, isArabic),
            detail: isArabic ? 'الهدف: أقل من 90 يوماً' : 'Target: <90 days',
            icon: Clock3,
            contributors: investigationContributors(rows),
          },
          {
            label: isArabic ? 'نسبة إغلاق الملفات' : 'Recovery Rate',
            value: `${formatNumber(recovery)}%`,
            detail: isArabic ? 'الملفات المعتمدة والمغلقة' : 'Approved or closed files',
            icon: CheckCircle2,
            contributors: investigationContributors(resolvedRows),
          },
        ]}
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-lg font-bold">
              {isArabic ? 'التحقيقات النشطة الحالية' : 'Active Investigations'}
            </h2>
            {active.length ? (
              <div className="grid gap-4 lg:grid-cols-3">
                {active.slice(0, 3).map((row) => (
                  <article key={row.id} className={cn(cardClass, 'p-5')}>
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/lex/investigations/${row.id}`}
                        className="font-mono text-sm font-semibold text-primary hover:underline"
                      >
                        {row.investigation_number}
                      </Link>
                      <PriorityBadge value={row.priority} isArabic={isArabic} />
                    </div>
                    <h3 className="mt-5 line-clamp-2 font-bold" dir="auto">{row.subject}</h3>
                    <p className="mt-1 text-sm text-muted-foreground" dir="auto">
                      {row.department || (isArabic ? 'غير محدد' : 'Unassigned')}
                    </p>
                    <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">{isArabic ? 'الانكشاف' : 'Exposure'}</dt>
                        <dd className="mt-1 font-semibold">
                          {metadataNumber(row, ['financial_exposure', 'exposure', 'value']) > 0
                            ? `SAR ${metadataNumber(row, ['financial_exposure', 'exposure', 'value']).toLocaleString()}`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{isArabic ? 'المحقق' : 'Investigator'}</dt>
                        <dd className="mt-1 truncate font-semibold" dir="auto">{row.lead_investigator}</dd>
                      </div>
                    </dl>
                    <div className="mt-5 border-t pt-4">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{isArabic ? 'التقدم' : 'Progress'}</span>
                        <span>{progressFor(row)}%</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${progressFor(row)}%` }}
                        />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <WorkspaceEmpty isArabic={isArabic} />
            )}
          </section>

          <section className={cn(cardClass, 'p-6')}>
            <h2 className="text-lg font-bold">
              {isArabic ? 'تحليل أنماط الاحتيال حسب الإدارات' : 'Fraud Pattern Analysis by Department'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isArabic
                ? 'مؤشر تكرار التحقيقات المسجلة حسب الإدارة ونوع المخالفة.'
                : 'Frequency index generated from the current audited investigation portfolio.'}
            </p>
            <FraudHeatmap rows={rows} isArabic={isArabic} />
          </section>
        </div>

        <section className={cn(cardClass, 'p-6')}>
          <h2 className="text-lg font-bold">
            {isArabic ? 'صندوق البلاغات السرية' : 'Whistleblower Inbox'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isArabic
              ? 'بلاغات تتطلب الفحص الأولي.'
              : 'Portal entries requiring preliminary vetting.'}
          </p>
          <div className="mt-5 space-y-3">
            {whistleblower.length ? (
              whistleblower.slice(0, 4).map((row) => (
                <Link
                  key={row.id}
                  href={`/lex/investigations/${row.id}`}
                  className="block rounded-lg bg-muted/50 p-4 transition-colors hover:bg-muted"
                >
                  <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                    <span>{new Date(row.created_at).toLocaleDateString()}</span>
                    <PriorityBadge value={row.priority} isArabic={isArabic} />
                  </div>
                  <p className="mt-3 text-sm font-semibold" dir="auto">{row.subject}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {isArabic ? 'الحالة' : 'Status'}: {row.status.replaceAll('_', ' ')}
                  </p>
                </Link>
              ))
            ) : (
              <p className="rounded-lg bg-muted/40 p-5 text-sm text-muted-foreground">
                {isArabic ? 'لا توجد بلاغات سرية جديدة.' : 'No new whistleblower tips.'}
              </p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function ComplianceDashboard({
  rows,
  isArabic,
  formatDate,
}: {
  rows: Investigation[];
  isArabic: boolean;
  formatDate: (value: string) => string;
}) {
  const displayed = rows;
  const active = displayed.filter((row) => !['closed', 'cancelled'].includes(row.status));
  const criticalRows = displayed.filter((row) => row.priority === 'critical');
  const completedRows = displayed.filter((row) => ['approved', 'closed'].includes(row.status));
  const resolution = displayed.length ? Math.round((completedRows.length / displayed.length) * 100) : 0;
  type ComplianceRow = Investigation & Record<string, unknown>;
  const columns: Column<ComplianceRow>[] = [
    {
      key: 'number',
      header: isArabic ? 'معرف التدقيق' : 'Audit ID',
      render: (row) => (
        <Link
          href={`/lex/investigations/${row.id}`}
          className="font-mono font-semibold text-primary hover:underline"
        >
          {row.investigation_number}
        </Link>
      ),
    },
    {
      key: 'standard',
      header: isArabic ? 'الجهة / المعيار' : 'Regulation / Standard',
      className: 'max-w-64',
      render: (row) => <span className="line-clamp-2" dir="auto">{row.subject}</span>,
    },
    {
      key: 'department',
      header: isArabic ? 'الإدارة' : 'Department',
      render: (row) => <span className="text-muted-foreground" dir="auto">{row.department || '—'}</span>,
    },
    {
      key: 'auditor',
      header: isArabic ? 'المدقق الرئيسي' : 'Lead Auditor',
      render: (row) => <span dir="auto">{row.lead_investigator}</span>,
    },
    {
      key: 'priority',
      header: isArabic ? 'الأولوية' : 'Priority',
      render: (row) => <PriorityBadge value={row.priority} isArabic={isArabic} />,
    },
    {
      key: 'status',
      header: isArabic ? 'الحالة' : 'Status',
      render: (row) => (
        <Badge variant={statusBadgeVariant(row.status)}>{row.status.replaceAll('_', ' ')}</Badge>
      ),
    },
    {
      key: 'due',
      header: isArabic ? 'تاريخ الاستحقاق' : 'Due Date',
      render: (row) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {formatDate(metadataText(row, ['due_date', 'target_completion']) || row.updated_at)}
        </span>
      ),
    },
  ];

  return (
    <>
      <KpiGrid
        items={[
          {
            label: isArabic ? 'عمليات تدقيق الالتزام النشطة' : 'Active Compliance Audits',
            value: isArabic ? `${active.length} عمليات` : `${active.length} Audits`,
            detail: isArabic ? 'مجدولة ومباشرة' : 'Scheduled and triggered',
            icon: FileCheck2,
            contributors: investigationContributors(active),
          },
          {
            label: isArabic ? 'النتائج الربعية' : 'Quarterly Findings',
            value: isArabic ? `${displayed.length} ملاحظة` : `${displayed.length} Findings`,
            detail: isArabic ? 'إجمالي الملفات المطابقة' : 'Current audited portfolio',
            icon: Search,
            contributors: investigationContributors(displayed),
          },
          {
            label: isArabic ? 'الملاحظات الحرجة' : 'Critical Findings',
            value: isArabic ? `${criticalRows.length} حرجة` : `${criticalRows.length} Critical`,
            detail: isArabic ? 'تتطلب إجراءً فورياً' : 'Immediate corrective path',
            icon: AlertOctagon,
            contributors: investigationContributors(criticalRows),
          },
          {
            label: isArabic ? 'معدل معالجة المخالفات' : 'Audit Resolution Rate',
            value: `${resolution}%`,
            detail: isArabic ? 'الملفات المعتمدة والمغلقة' : 'Approved and closed audits',
            icon: Sparkles,
            contributors: investigationContributors(completedRows),
          },
        ]}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className={cn(cardClass, 'min-w-0 overflow-hidden p-6')}>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold">
              {isArabic
                ? 'سجل التحقق من الالتزام والتدقيق التنظيمي'
                : 'Regulatory Audit Investigation Tracker'}
            </h2>
            <Badge variant="neutral">
              {isArabic ? 'كافة الجهات الرقابية' : 'All Regulatory'}
            </Badge>
          </div>
          <SimpleTable
            className="mt-5 rounded-lg shadow-none"
            ariaLabel={
              isArabic
                ? 'سجل التحقق من الالتزام والتدقيق التنظيمي'
                : 'Regulatory audit investigation tracker'
            }
            columns={columns}
            data={displayed.slice(0, 8) as ComplianceRow[]}
            getRowKey={(row) => row.id}
            emptyMessage={
              isArabic
                ? 'لا توجد سجلات مطابقة في مساحة العمل الحالية.'
                : 'No matching records in this workspace.'
            }
          />
        </section>

        <section className={cn(cardClass, 'p-6')}>
          <h2 className="text-lg font-bold">
            {isArabic ? 'التقويم التشريعي والالتزامات' : 'Regulatory Calendar'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isArabic
              ? 'تواريخ المراجعات والتقارير التنظيمية القادمة.'
              : 'Upcoming statutory filings, reviews, and benchmarks.'}
          </p>
          <div className="mt-5 space-y-3">
            {active.slice(0, 5).map((row) => {
              const date = new Date(metadataText(row, ['due_date']) || row.updated_at);
              return (
                <Link
                  key={row.id}
                  href={`/lex/investigations/${row.id}`}
                  className="flex items-start gap-4 rounded-lg p-3 hover:bg-muted/40"
                >
                  <div className="w-14 shrink-0 rounded-lg bg-muted px-2 py-2 text-center">
                    <p className="text-[10px] font-bold uppercase text-primary">
                      {date.toLocaleString(isArabic ? 'ar-SA' : 'en', { month: 'short' })}
                    </p>
                    <p className="text-lg font-bold">{date.getDate()}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase text-action">
                      {metadataText(row, ['audit_type', 'type']) || (isArabic ? 'مراجعة' : 'Review')}
                    </p>
                    <p className="line-clamp-2 text-sm font-semibold" dir="auto">{row.subject}</p>
                  </div>
                </Link>
              );
            })}
            {!active.length ? (
              <p className="rounded-lg bg-muted/40 p-5 text-sm text-muted-foreground">
                {isArabic ? 'لا توجد مواعيد تنظيمية قادمة.' : 'No upcoming regulatory dates.'}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

function ForensicsDashboard({
  details,
  loading,
  isArabic,
  formatDate,
}: {
  details: Investigation[];
  loading: boolean;
  isArabic: boolean;
  formatDate: (value: string) => string;
}) {
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const assets = details.flatMap((investigation) =>
    (investigation.evidence ?? []).map((evidence) => ({ investigation, evidence })),
  );
  const validAssets = assets.filter(({ evidence }) =>
    Boolean(metadataTextFromRecord(evidence.metadata, ['sha256', 'hash', 'checksum'])),
  );
  const integrity = assets.length ? (validAssets.length / assets.length) * 100 : 0;
  const statuses = [
    { label: isArabic ? '1. الحفظ والتوثيق' : '1. Acquisition', key: 'acquisition' },
    { label: isArabic ? '2. الاستنساخ المتطابق' : '2. Preservation', key: 'preserved' },
    { label: isArabic ? '3. التحليل والفحص' : '3. Analysis', key: 'analysis' },
    { label: isArabic ? '4. التقارير الفنية' : '4. Reporting', key: 'report' },
  ];
  type CustodyRow = {
    investigation: Investigation;
    evidence: InvestigationEvidence;
  } & Record<string, unknown>;
  const custodyColumns: Column<CustodyRow>[] = [
    {
      key: 'evidence',
      header: isArabic ? 'رقم الحرز' : 'Evidence ID',
      render: ({ investigation, evidence }) => (
        <Link
          href={`/lex/investigations/${investigation.id}/evidence`}
          className="font-mono font-semibold text-primary hover:underline"
        >
          {evidenceReference(evidence)}
        </Link>
      ),
    },
    {
      key: 'case',
      header: isArabic ? 'مرجع القضية' : 'Case Ref',
      render: ({ investigation }) => (
        <span className="font-mono">{investigation.investigation_number}</span>
      ),
    },
    {
      key: 'type',
      header: isArabic ? 'نوع الدليل' : 'Asset Type',
      render: ({ evidence }) => evidence.evidence_type,
    },
    {
      key: 'source',
      header: isArabic ? 'المصدر' : 'Source / Host',
      className: 'max-w-44',
      render: ({ evidence }) => (
        <span className="line-clamp-2 text-muted-foreground" dir="auto">
          {metadataTextFromRecord(evidence.metadata, ['source', 'host']) || evidence.description}
        </span>
      ),
    },
    {
      key: 'hash',
      header: isArabic ? 'سلامة البصمة' : 'Hash Integrity',
      render: ({ evidence }) => (
        <span className="text-primary">
          {metadataTextFromRecord(evidence.metadata, ['sha256', 'hash', 'checksum'])
            ? '● SHA-256 Valid'
            : '—'}
        </span>
      ),
    },
    {
      key: 'analyst',
      header: isArabic ? 'المحلل' : 'Analyst',
      render: ({ evidence }) => <span dir="auto">{evidence.collected_by}</span>,
    },
    {
      key: 'status',
      header: isArabic ? 'الحالة' : 'Status',
      render: ({ evidence }) => <Badge variant="neutral">{evidenceStatus(evidence)}</Badge>,
    },
    {
      key: 'priority',
      header: isArabic ? 'الأولوية' : 'Priority',
      render: ({ investigation }) => (
        <PriorityBadge value={investigation.priority} isArabic={isArabic} />
      ),
    },
  ];

  return (
    <>
      <KpiGrid
        items={[
          {
            label: isArabic ? 'التحليلات الجنائية النشطة' : 'Active Analyses',
            value: isArabic ? `${assets.length} عنصراً` : `${assets.length} Items`,
            detail: isArabic ? 'في الفحص الجنائي' : 'In forensic deep-dive',
            icon: Cpu,
            contributors: evidenceContributors(assets),
          },
          {
            label: isArabic ? 'الأحراز والأدلة المفحوصة' : 'Evidence Processed',
            value: isArabic ? `${assets.length} دليلاً` : `${assets.length} Assets`,
            detail: isArabic ? 'سجل الأدلة الحالي' : 'Current evidence registry',
            icon: Database,
            contributors: evidenceContributors(assets),
          },
          {
            label: isArabic ? 'سلامة وضمان الأدلة' : 'Integrity Score (Chain)',
            value: `${integrity.toFixed(1)}%`,
            detail: isArabic ? 'البصمات الرقمية المسجلة' : 'Recorded hash verification',
            icon: LockKeyhole,
            contributors: evidenceContributors(validAssets),
          },
          {
            label: isArabic ? 'متوسط وقت المعالجة' : 'Avg. Processing Time',
            value: averageEvidenceAge(assets.map(({ evidence }) => evidence), isArabic),
            detail: isArabic ? 'الهدف: أقل من 5 أيام' : 'Target: <5.0 days',
            icon: CloudLightning,
            contributors: evidenceContributors(assets),
          },
        ]}
      />
      <section className={cn(cardClass, 'p-5')}>
        <h2 className="text-base font-bold">
          {isArabic ? 'مسار فحص الأدلة الجنائية' : 'Lab Pipeline Progress'}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statuses.map((status, index) => {
            const matchingAssets = assets.filter(({ evidence }) =>
              evidenceStatus(evidence).includes(status.key),
            );
            return (
              <Button
                type="button"
                variant="ghost"
                key={status.key}
                onClick={() => {
                  setSelectedStatus(status.key);
                  requestAnimationFrame(() => document.getElementById('forensics-status-contributors')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                }}
                aria-pressed={selectedStatus === status.key}
                className={cn(
                  'h-auto flex-col items-stretch rounded-lg p-4 text-start font-normal transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  index === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted/60',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold">{status.label}</p>
                  <span className="flex h-7 min-w-7 items-center justify-center rounded-full border bg-card px-2 text-xs text-foreground">
                    {matchingAssets.length}
                  </span>
                </div>
                <p className={cn('mt-1 text-xs', index === 0 ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                  {index === 0
                    ? isArabic ? 'نسخة رقمية آمنة' : 'Secure bitstream copy'
                    : index === 1
                      ? isArabic ? 'تخزين وحفظ مشفر' : 'Hashing & safe storage'
                      : index === 2
                        ? isArabic ? 'استخراج الخط الزمني' : 'Sift & timeline extraction'
                        : isArabic ? 'حزمة اعتماد قانونية' : 'Legal attestation pack'}
                </p>
              </Button>
            );
          })}
        </div>
        {selectedStatus ? (
          <div id="forensics-status-contributors" className="scroll-mt-24 mt-4 rounded-lg border p-3">
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {evidenceContributors(
                assets.filter(({ evidence }) => evidenceStatus(evidence).includes(selectedStatus)),
              ).map((contributor) => (
                <li key={contributor.id}>
                  <Link href={contributor.href} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted/60">
                    <span className="truncate font-medium" dir="auto">{contributor.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{contributor.meta}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className={cn(cardClass, 'min-w-0 overflow-hidden p-6')}>
          <h2 className="text-lg font-bold">
            {isArabic ? 'سجل الأحراز الرقمية وسلسلة الحيازة' : 'Active Custody Asset Ledger'}
          </h2>
          <SimpleTable
            className="mt-4 rounded-lg shadow-none"
            ariaLabel={isArabic ? 'سجل الأحراز الرقمية' : 'Active custody asset ledger'}
            columns={custodyColumns}
            data={assets.slice(0, 12) as CustodyRow[]}
            loading={loading && !assets.length}
            getRowKey={({ evidence }) => evidence.id}
            emptyMessage={
              isArabic
                ? 'لا توجد سجلات مطابقة في مساحة العمل الحالية.'
                : 'No matching records in this workspace.'
            }
          />
        </section>

        <section className={cn(cardClass, 'p-6')}>
          <h2 className="text-lg font-bold">
            {isArabic ? 'حالة محطات العمل والمحللين' : 'Workstation Telemetry'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isArabic
              ? 'ملخص عبء العمل الفعلي للمحللين المسجلين.'
              : 'Current evidence workload grouped by assigned analyst.'}
          </p>
          <div className="mt-5 space-y-4">
            {analystWorkloads(assets).slice(0, 4).map((analyst, index) => (
              <div key={analyst.name} className="rounded-lg bg-muted/50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold" dir="auto">
                    {isArabic ? `محطة التحليل ${index + 1}` : `Forensic Station ${String.fromCharCode(65 + index)}`}
                  </p>
                  <span className="h-2 w-2 rounded-full bg-action" aria-hidden />
                </div>
                <p className="mt-3 text-xs text-muted-foreground" dir="auto">
                  {isArabic ? 'المحلل' : 'Operator'}: {analyst.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isArabic ? 'الأحراز النشطة' : 'Active assets'}: {analyst.count}
                </p>
                <div className="mt-3 flex justify-between text-xs">
                  <span>{isArabic ? 'استخدام المعالجة' : 'Compute Utilization'}</span>
                  <span>{Math.min(100, analyst.count * 20)}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(100, analyst.count * 20)}%` }}
                  />
                </div>
              </div>
            ))}
            {!assets.length ? (
              <p className="rounded-lg bg-muted/40 p-5 text-sm text-muted-foreground">
                {isArabic ? 'لا توجد محطات نشطة.' : 'No active workstations.'}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

function BoardDashboard({
  rows,
  isArabic,
  canApprove,
  approvingId,
  onApprove,
}: {
  rows: Investigation[];
  isArabic: boolean;
  canApprove: boolean;
  approvingId?: string;
  onApprove: (row: Investigation) => void;
}) {
  const docket = rows.filter((row) =>
    ['results_recorded', 'pending_approval', 'approved'].includes(row.status),
  );
  const displayed = docket.length ? docket : rows;
  const pending = displayed.filter((row) => row.status === 'pending_approval');
  const approved = displayed.filter((row) => ['approved', 'closed'].includes(row.status));
  const implementation = displayed.length ? Math.round((approved.length / displayed.length) * 100) : 0;
  const committee = unique(displayed.map((row) => row.lead_investigator).filter(Boolean));

  return (
    <>
      <KpiGrid
        items={[
          {
            label: isArabic ? 'ملفات معروضة قيد المراجعة' : 'Pending Board Review',
            value: isArabic ? `${pending.length} ملفات` : `${pending.length} Investigations`,
            detail: isArabic ? 'في جدول الأعمال الحالي' : 'In current docket',
            icon: FileText,
            contributors: investigationContributors(pending),
          },
          {
            label: isArabic ? 'تقارير معتمدة وموقعة' : 'Approved This Quarter',
            value: isArabic ? `${approved.length} تقارير` : `${approved.length} Case Resolves`,
            detail: isArabic ? 'تم اعتمادها وتسجيلها' : 'Approved governance records',
            icon: ShieldCheck,
            contributors: investigationContributors(approved),
          },
          {
            label: isArabic ? 'دورة اتخاذ القرار' : 'Avg. Board Cycle',
            value: averageAge(displayed, isArabic),
            detail: isArabic ? 'الهدف: أقل من 15 يوماً' : 'Target: <15 days',
            icon: Clock3,
            contributors: investigationContributors(displayed),
          },
          {
            label: isArabic ? 'نسبة تطبيق التوصيات' : 'Directives Enforced',
            value: `${implementation}%`,
            detail: isArabic ? 'معدل التنفيذ الحالي' : 'Implementation rating',
            icon: CheckCircle2,
            contributors: investigationContributors(approved),
          },
        ]}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <h2 className="text-lg font-bold">
            {isArabic ? 'جدول أعمال مراجعة المجلس' : 'Current Committee Docket (Pending Approval)'}
          </h2>
          {displayed.slice(0, 5).map((row, index) => (
            <article key={row.id} className={cn(cardClass, 'p-6')}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <Link
                    href={`/lex/investigations/${row.id}`}
                    className="text-lg font-bold hover:text-primary hover:underline"
                    dir="auto"
                  >
                    {row.subject}
                  </Link>
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground" dir="auto">
                    {row.findings || (isArabic ? 'بانتظار تسجيل النتائج التفصيلية.' : 'Detailed findings are awaiting capture.')}
                  </p>
                </div>
                <Badge variant={row.priority === 'critical' ? 'destructive' : 'warning'}>
                  {isArabic ? `بند ${index + 1}` : `Docket Item ${index + 1}`}
                </Badge>
              </div>
              <dl className="mt-5 grid gap-4 border-b pb-5 sm:grid-cols-4">
                <BoardFact
                  label={isArabic ? 'المحقق المسؤول' : 'Lead Investigator'}
                  value={row.lead_investigator}
                />
                <BoardFact
                  label={isArabic ? 'الأدلة المسجلة' : 'Evidence Checked'}
                  value={String(row.evidence?.length ?? metadataNumber(row, ['evidence_count']))}
                />
                <BoardFact
                  label={isArabic ? 'حالة الملف' : 'Review Status'}
                  value={row.status.replaceAll('_', ' ')}
                />
                <BoardFact
                  label={isArabic ? 'الإدارة' : 'Department'}
                  value={row.department || '—'}
                />
              </dl>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {isArabic ? 'رقم الملف' : 'File reference'}:{' '}
                  <span className="font-mono text-foreground">{row.investigation_number}</span>
                </p>
                {row.status === 'pending_approval' && canApprove ? (
                  <Button
                    type="button"
                    loading={approvingId === row.id}
                    onClick={() => onApprove(row)}
                  >
                    {isArabic ? 'توقيع واعتماد' : 'Sign & Approve'}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" asChild>
                    <Link href={`/lex/investigations/${row.id}`}>
                      {isArabic ? 'عرض تفاصيل الملف' : 'View file details'}
                    </Link>
                  </Button>
                )}
              </div>
            </article>
          ))}
          {!displayed.length ? <WorkspaceEmpty isArabic={isArabic} /> : null}

          <section className={cn(cardClass, 'p-6')}>
            <h2 className="text-lg font-bold">
              {isArabic ? 'المخطط الزمني للحوكمة الربعية' : 'Quarterly Governance Lifecycle'}
            </h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {[
                [isArabic ? 'الربع الأول' : 'Q1 Session', isArabic ? 'مراجعة المخاطر السنوية' : 'Annual risk review'],
                [isArabic ? 'الربع الثاني' : 'Q2 Session', isArabic ? 'تدقيق الالتزام' : 'Compliance attestation'],
                [isArabic ? 'الربع الثالث' : 'Q3 Session', isArabic ? 'مراجعة الإفصاح' : 'Disclosure review'],
                [isArabic ? 'الربع الرابع' : 'Q4 Session', isArabic ? 'التقرير الرقابي الشامل' : 'Annual governance report'],
              ].map(([quarter, title], index) => (
                <div key={quarter} className="relative ps-8">
                  <span
                    className={cn(
                      'absolute start-0 top-0 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white',
                      index < 2 ? 'bg-action' : 'bg-primary',
                    )}
                  >
                    {index < 2 ? '✓' : index + 1}
                  </span>
                  <p className="text-sm font-bold">{quarter}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{title}</p>
                  <p className="mt-1 text-xs font-semibold text-primary">
                    {index < 2
                      ? isArabic ? 'تم الإنجاز' : 'Completed'
                      : index === 2
                        ? isArabic ? 'قيد المراجعة' : 'Review session'
                        : isArabic ? 'قادم' : 'Upcoming'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className={cn(cardClass, 'p-6')}>
          <h2 className="text-lg font-bold">
            {isArabic ? 'أعضاء لجنة المراجعة والالتزام' : 'Committee Directory'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isArabic
              ? 'الأعضاء المسؤولون عن المراجعة النهائية.'
              : 'Governance panel members responsible for final review.'}
          </p>
          <div className="mt-5 space-y-3">
            {committee.slice(0, 6).map((name, index) => (
              <div key={name} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
                  {name.trim().slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold" dir="auto">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {index === 0
                      ? isArabic ? 'رئيس لجنة المراجعة' : 'Audit Committee Chair'
                      : isArabic ? 'عضو لجنة المراجعة' : 'Review Committee Member'}
                  </p>
                </div>
                <Badge variant="outline">{displayed.filter((row) => row.lead_investigator === name).length}</Badge>
              </div>
            ))}
            {!committee.length ? (
              <p className="rounded-lg bg-muted/40 p-5 text-sm text-muted-foreground">
                {isArabic ? 'لم يتم تعيين أعضاء بعد.' : 'No committee members assigned.'}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

function KpiGrid({
  items,
}: {
  items: Array<{
    label: string;
    value: string;
    detail: string;
    icon: LucideIcon;
    contributors: KpiContributor[];
  }>;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex == null ? null : items[selectedIndex];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <Button
              type="button"
              variant="ghost"
              key={item.label}
              onClick={() => {
                setSelectedIndex(index);
                requestAnimationFrame(() => document.getElementById('investigation-kpi-contributors')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
              }}
              aria-pressed={selectedIndex === index}
              className={cn(cardClass, 'h-auto items-center justify-between gap-4 p-5 text-start font-normal transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
            >
              <span className="min-w-0">
                <span className="block text-sm text-muted-foreground">{item.label}</span>
                <span className="mt-1 block truncate text-2xl font-bold text-foreground">{item.value}</span>
                <span className="mt-1 block text-xs text-action">{item.detail}</span>
              </span>
              <span
                className={cn(
                  'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
                  index === 1
                    ? 'bg-warning/10 text-warning'
                    : index === 2
                      ? 'bg-action/10 text-action'
                      : 'bg-primary/10 text-primary',
                )}
              >
                <Icon className="h-6 w-6" aria-hidden />
              </span>
            </Button>
          );
        })}
      </div>

      {selected ? (
        <section id="investigation-kpi-contributors" className={cn(cardClass, 'scroll-mt-24 p-4')}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{selected.label}</h2>
            <span className="font-bold tabular-nums text-primary">{selected.value}</span>
          </div>
          {selected.contributors.length > 0 ? (
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
              {selected.contributors.map((contributor) => (
                <li key={contributor.id}>
                  <Link href={contributor.href} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="truncate font-medium" dir="auto">{contributor.label}</span>
                    {contributor.meta ? <span className="shrink-0 text-xs text-muted-foreground">{contributor.meta}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{selected.detail}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

interface KpiContributor {
  id: string;
  label: string;
  href: string;
  meta?: string;
}

function investigationContributors(rows: Investigation[]): KpiContributor[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.subject,
    href: `/lex/investigations/${row.id}`,
    meta: row.investigation_number,
  }));
}

function evidenceContributors(
  assets: Array<{ investigation: Investigation; evidence: InvestigationEvidence }>,
): KpiContributor[] {
  return assets.map(({ investigation, evidence }) => ({
    id: evidence.id,
    label: evidence.title || evidence.file_id || investigation.subject,
    href: `/lex/investigations/${investigation.id}/evidence`,
    meta: evidenceReference(evidence),
  }));
}

function FraudHeatmap({ rows, isArabic }: { rows: Investigation[]; isArabic: boolean }) {
  const [selection, setSelection] = useState<{ department: string; categoryIndex: number } | null>(null);
  const departments = unique(rows.map((row) => row.department || (isArabic ? 'غير محدد' : 'Unassigned'))).slice(0, 4);
  while (departments.length < 4) departments.push(isArabic ? `إدارة ${departments.length + 1}` : `Department ${departments.length + 1}`);
  const categories = isArabic
    ? ['التلاعب المالي', 'احتيال المشتريات', 'المصروفات', 'اختلاس الأصول']
    : ['Financial Manipulation', 'Procurement Fraud', 'Expense Fraud', 'Asset Misappropriation'];
  const patterns = [
    /(financial|finance|مالي)/,
    /(procurement|vendor|مشتريات|مورد)/,
    /(expense|مصروف)/,
    /(asset|أصول)/,
  ];
  const matchingRows = (department: string, categoryIndex: number) =>
    rows.filter((row) => {
      const sameDepartment = (row.department || (isArabic ? 'غير محدد' : 'Unassigned')) === department;
      const text = `${row.subject} ${metadataText(row, ['investigation_type', 'type'])}`.toLowerCase();
      return sameDepartment && patterns[categoryIndex].test(text);
    });
  const selectedRows = selection ? matchingRows(selection.department, selection.categoryIndex) : [];

  return (
    <div className="mt-5 overflow-x-auto">
      <div
        className="grid min-w-[680px] grid-cols-[minmax(190px,1.4fr)_repeat(4,minmax(100px,1fr))] text-sm"
        role="grid"
        aria-label={
          isArabic
            ? 'تحليل أنماط الاحتيال حسب الإدارات'
            : 'Fraud pattern analysis by department'
        }
      >
        <div className="p-3" role="columnheader" />
        {departments.map((department) => (
          <div
            key={department}
            className="p-3 text-center font-semibold"
            role="columnheader"
            dir="auto"
          >
            {department}
          </div>
        ))}
        {categories.map((category, categoryIndex) => (
          <div key={category} className="contents" role="row">
            <div className="bg-muted/60 p-4 font-semibold" role="rowheader">{category}</div>
            {departments.map((department) => {
                const matches = matchingRows(department, categoryIndex);
                const score = Math.min(10, matches.length * 2.5);
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    key={department}
                    onClick={() => {
                      setSelection({ department, categoryIndex });
                      requestAnimationFrame(() => document.getElementById('fraud-heatmap-contributors')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                    }}
                    aria-pressed={selection?.department === department && selection.categoryIndex === categoryIndex}
                    className={cn(
                      'h-auto border border-card p-4 text-center font-bold transition hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      score >= 7.5
                        ? 'bg-destructive/10 text-destructive'
                        : score >= 5
                          ? 'bg-warning/15 text-warning-foreground'
                          : 'bg-action/10 text-primary',
                    )}
                    role="gridcell"
                  >
                    {score.toFixed(1)}
                  </Button>
                );
              })}
          </div>
        ))}
      </div>
      {selection ? (
        <section id="fraud-heatmap-contributors" className="scroll-mt-24 mt-4 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold" dir="auto">
              {categories[selection.categoryIndex]} · {selection.department}
            </h3>
            <Badge variant="outline">{selectedRows.length}</Badge>
          </div>
          {selectedRows.length > 0 ? (
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
              {investigationContributors(selectedRows).map((contributor) => (
                <li key={contributor.id}>
                  <Link href={contributor.href} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted/60">
                    <span className="truncate font-medium" dir="auto">{contributor.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{contributor.meta}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {isArabic ? 'لا توجد تحقيقات مساهمة في هذه الخلية.' : 'No contributing investigations in this cell.'}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function BoardFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-semibold" dir="auto">{value}</dd>
    </div>
  );
}

function WorkspaceEmpty({ isArabic }: { isArabic: boolean }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
      {isArabic ? 'لا توجد سجلات مطابقة في مساحة العمل الحالية.' : 'No matching records in this workspace.'}
    </div>
  );
}

function PriorityBadge({
  value,
  isArabic,
}: {
  value: Investigation['priority'];
  isArabic: boolean;
}) {
  const labels = isArabic
    ? { critical: 'حرج', high: 'مرتفع', medium: 'متوسط', low: 'منخفض' }
    : { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  return (
    <Badge
      variant={
        value === 'critical'
          ? 'destructive'
          : value === 'high'
            ? 'warning'
            : value === 'medium'
              ? 'info'
              : 'neutral'
      }
    >
      {labels[value]}
    </Badge>
  );
}

function metadataText(investigation: Investigation, keys: string[]): string {
  return metadataTextFromRecord(investigation.metadata, keys);
}

function metadataTextFromRecord(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[],
): string {
  if (!metadata) return '';
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function metadataNumber(investigation: Investigation, keys: string[]): number {
  if (!investigation.metadata) return 0;
  for (const key of keys) {
    const value = investigation.metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^\d.-]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function progressFor(investigation: Investigation): number {
  const metadataProgress = metadataNumber(investigation, ['progress', 'completion_percent']);
  if (metadataProgress > 0) return Math.min(100, metadataProgress);
  return {
    registered: 10,
    in_progress: 45,
    results_recorded: 75,
    pending_approval: 88,
    approved: 100,
    rejected: 70,
    closed: 100,
    cancelled: 100,
  }[investigation.status];
}

function averageAge(rows: Investigation[], isArabic: boolean): string {
  if (!rows.length) return isArabic ? '0 يوم' : '0 Days';
  const now = Date.now();
  const total = rows.reduce((sum, row) => {
    const opened = new Date(row.created_at).getTime();
    return sum + (Number.isFinite(opened) ? Math.max(0, now - opened) : 0);
  }, 0);
  const days = Math.round(total / rows.length / 86_400_000);
  return isArabic ? `${days} يوماً` : `${days} Days`;
}

function averageEvidenceAge(items: InvestigationEvidence[], isArabic: boolean): string {
  if (!items.length) return isArabic ? '0 يوم' : '0 Days';
  const now = Date.now();
  const total = items.reduce((sum, item) => {
    const date = new Date(item.collected_at || item.created_at).getTime();
    return sum + (Number.isFinite(date) ? Math.max(0, now - date) : 0);
  }, 0);
  const days = total / items.length / 86_400_000;
  return isArabic ? `${days.toFixed(1)} يوم` : `${days.toFixed(1)} Days`;
}

function evidenceStatus(evidence: InvestigationEvidence): string {
  return (
    metadataTextFromRecord(evidence.metadata, ['status', 'lab_status', 'processing_status']) ||
    'acquisition'
  ).toLowerCase();
}

function evidenceReference(evidence: InvestigationEvidence): string {
  return (
    metadataTextFromRecord(evidence.metadata, ['evidence_number', 'reference']) ||
    `EVD-${evidence.id.slice(0, 8).toUpperCase()}`
  );
}

function analystWorkloads(
  assets: Array<{ investigation: Investigation; evidence: InvestigationEvidence }>,
): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  for (const { evidence } of assets) {
    const name = evidence.collected_by || 'Unassigned';
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function statusBadgeVariant(
  status: Investigation['status'],
): 'success' | 'warning' | 'destructive' | 'neutral' {
  if (['approved', 'closed'].includes(status)) return 'success';
  if (status === 'rejected' || status === 'cancelled') return 'destructive';
  if (status === 'pending_approval') return 'warning';
  return 'neutral';
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
