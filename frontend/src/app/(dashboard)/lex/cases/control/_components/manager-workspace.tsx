'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpFromLine,
  CalendarDays,
  FileSearch,
  Gavel,
  Loader2,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { useLocale } from '@/components/providers/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/use-auth';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { resolveLocalized } from '@/lib/i18n/localized';
import {
  casesApi,
  type CaseCompanyStatus,
  type LegalCaseListItem,
} from '@/lib/lex/cases';
import {
  investigationsApi,
  type Investigation,
} from '@/lib/lex/investigations';
import { useLexFormat } from '@/lib/lex/ksa';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { UserDirectoryEntry } from '@/types/suites';
import { useCaseCourtName } from '../../_components/case-court';

import { ManagerControlNav } from './manager-control-nav';

export type ManagerWorkspaceView = 'overview' | 'assignment' | 'litigation';

interface WorkspaceCopy {
  nav: {
    title: string;
    description: string;
  };
  overview: {
    title: string;
    description: string;
    activeCases: string;
    investigations: string;
    sessions: string;
    plaintiff: string;
    defendant: string;
    activeCasesHint: string;
    investigationsHint: string;
    sessionsHint: string;
    plaintiffHint: string;
    defendantHint: string;
    workload: string;
    averageUtil: (value: string) => string;
    assignedCases: (value: string) => string;
    noAssignments: string;
    hearings: string;
    viewCalendar: string;
    counsel: (name: string) => string;
    noHearings: string;
  };
  assignment: {
    title: string;
    description: string;
    queue: string;
    pending: (value: string) => string;
    selected: string;
    selectPrompt: string;
    directory: string;
    directoryHint: string;
    filed: (value: string) => string;
    match: string;
    activeLoad: (value: string) => string;
    assign: string;
    assigning: string;
    assigned: string;
    noQueue: string;
    noTeam: string;
    caseLabel: string;
    investigationLabel: string;
  };
  litigation: {
    title: string;
    description: string;
    all: (value: string) => string;
    plaintiff: (value: string) => string;
    defendant: (value: string) => string;
    search: string;
    columns: {
      id: string;
      title: string;
      role: string;
      hearing: string;
      strength: string;
      sla: string;
    };
    plaintiffRole: string;
    defendantRole: string;
    notScheduled: string;
    notAssessed: string;
    notScored: string;
    empty: string;
  };
  states: {
    errorTitle: string;
    errorBody: string;
    retry: string;
  };
}

const COPY: Record<'en' | 'ar', WorkspaceCopy> = {
  en: {
    nav: {
      title: 'Cases & Investigations Manager',
      description: 'Portfolio oversight, team allocation, and litigation readiness.',
    },
    overview: {
      title: 'Cases & Investigations Dashboard',
      description: 'System oversight, lawyer workloads, and compliance metrics overview.',
      activeCases: 'Active cases',
      investigations: 'Investigations',
      sessions: 'Sessions this week',
      plaintiff: 'Plaintiff actions',
      defendant: 'Defendant actions',
      activeCasesHint: 'Ongoing litigations in active progress',
      investigationsHint: 'Internal corporate inquiries',
      sessionsHint: 'Upcoming scheduled court hearings',
      plaintiffHint: 'Claims filed by our organization',
      defendantHint: 'Defensive claims and counters',
      workload: 'Lawyers Workload Allocation',
      averageUtil: (value) => `Average util: ${value}%`,
      assignedCases: (value) => `${value} active cases`,
      noAssignments: 'No active lawyer assignments yet.',
      hearings: 'Upcoming Hearings & Sessions',
      viewCalendar: 'View calendar',
      counsel: (name) => `Counsel: ${name}`,
      noHearings: 'No upcoming hearings are scheduled.',
    },
    assignment: {
      title: 'Cases & Investigations Allocation',
      description:
        'Assign available legal counsel to newly registered cases and corporate investigations.',
      queue: 'Unassigned Case Queue',
      pending: (value) => `${value} pending`,
      selected: 'Assigning to:',
      selectPrompt: 'Select an item from the queue to choose its counsel.',
      directory: 'Assign Counsel for Selected Item',
      directoryHint: 'Live team capacity',
      filed: (value) => `Filed: ${value}`,
      match: 'Available',
      activeLoad: (value) => `${value} active`,
      assign: 'Assign',
      assigning: 'Assigning',
      assigned: 'Assignment saved',
      noQueue: 'There are no unassigned cases or investigations.',
      noTeam: 'No eligible team members are available.',
      caseLabel: 'Case',
      investigationLabel: 'Investigation',
    },
    litigation: {
      title: 'Litigation Monitor',
      description:
        'Track courtroom schedules, evidentiary case strength, and operational compliance SLA.',
      all: (value) => `All active cases (${value})`,
      plaintiff: (value) => `Plaintiff actions (${value})`,
      defendant: (value) => `Defendant actions (${value})`,
      search: 'Search court, case, judge…',
      columns: {
        id: 'Case ID',
        title: 'Case title & forum',
        role: 'Role',
        hearing: 'Next trial hearing',
        strength: 'Case strength',
        sla: 'Compliance SLA',
      },
      plaintiffRole: 'Plaintiff',
      defendantRole: 'Defendant',
      notScheduled: 'Not scheduled',
      notAssessed: 'Not assessed',
      notScored: 'Not scored',
      empty: 'No active cases match these filters.',
    },
    states: {
      errorTitle: 'Unable to load the manager workspace',
      errorBody: 'The cases, investigations, or team directory could not be retrieved.',
      retry: 'Try again',
    },
  },
  ar: {
    nav: {
      title: 'إدارة القضايا والتحقيقات',
      description: 'الإشراف على المحفظة وتوزيع العمل والاستعداد للتقاضي.',
    },
    overview: {
      title: 'لوحة تحكم القضايا والتحقيقات',
      description: 'الإشراف على النظام وأعباء عمل المحامين ومؤشرات الامتثال العامة.',
      activeCases: 'القضايا النشطة',
      investigations: 'التحقيقات',
      sessions: 'جلسات هذا الأسبوع',
      plaintiff: 'إجراءات المدعي',
      defendant: 'إجراءات المدعى عليه',
      activeCasesHint: 'الدعاوى الجارية قيد المتابعة النشطة',
      investigationsHint: 'التحقيقات والاستفسارات الداخلية',
      sessionsHint: 'جلسات المحكمة المجدولة قريباً',
      plaintiffHint: 'المطالبات المرفوعة من مؤسستنا',
      defendantHint: 'الدعاوى الدفاعية والمطالبات المقابلة',
      workload: 'توزيع أعباء عمل المحامين',
      averageUtil: (value) => `متوسط الاستخدام: ${value}%`,
      assignedCases: (value) => `${value} قضايا نشطة`,
      noAssignments: 'لا توجد تكليفات نشطة للمحامين بعد.',
      hearings: 'جلسات الاستماع القادمة',
      viewCalendar: 'عرض التقويم',
      counsel: (name) => `المستشار: ${name}`,
      noHearings: 'لا توجد جلسات قادمة مجدولة.',
    },
    assignment: {
      title: 'توزيع القضايا والتحقيقات',
      description: 'تكليف المستشارين المتاحين بالقضايا والتحقيقات المؤسسية المسجلة حديثاً.',
      queue: 'قائمة القضايا غير المسندة',
      pending: (value) => `${value} معلقة`,
      selected: 'جاري الإسناد إلى:',
      selectPrompt: 'اختر عنصراً من القائمة لتحديد المستشار.',
      directory: 'تعيين مستشار للعنصر المحدد',
      directoryHint: 'الطاقة الاستيعابية المباشرة',
      filed: (value) => `سُجّلت: ${value}`,
      match: 'متاح',
      activeLoad: (value) => `${value} نشطة`,
      assign: 'تعيين',
      assigning: 'جارٍ التعيين',
      assigned: 'تم حفظ التعيين',
      noQueue: 'لا توجد قضايا أو تحقيقات غير مسندة.',
      noTeam: 'لا يوجد أعضاء فريق مؤهلون متاحون.',
      caseLabel: 'قضية',
      investigationLabel: 'تحقيق',
    },
    litigation: {
      title: 'مراقبة التقاضي',
      description: 'متابعة جداول الجلسات وقوة الأدلة والالتزام بمستوى الخدمة التشغيلي.',
      all: (value) => `جميع القضايا النشطة (${value})`,
      plaintiff: (value) => `إجراءات المدعي (${value})`,
      defendant: (value) => `إجراءات المدعى عليه (${value})`,
      search: 'البحث بالمحكمة أو القضية أو القاضي…',
      columns: {
        id: 'رقم القضية',
        title: 'عنوان القضية والمحكمة',
        role: 'الصفة',
        hearing: 'الجلسة القادمة',
        strength: 'قوة القضية',
        sla: 'الالتزام بالخدمة',
      },
      plaintiffRole: 'المدعي',
      defendantRole: 'المدعى عليه',
      notScheduled: 'غير مجدولة',
      notAssessed: 'غير مقيّمة',
      notScored: 'غير محسوبة',
      empty: 'لا توجد قضايا نشطة تطابق عوامل التصفية.',
    },
    states: {
      errorTitle: 'تعذّر تحميل مساحة عمل المدير',
      errorBody: 'تعذّر جلب القضايا أو التحقيقات أو دليل الفريق.',
      retry: 'إعادة المحاولة',
    },
  },
};

const ACTIVE_CASE_STATUSES = new Set([
  'intake',
  'phase1',
  'phase2',
  'open',
  'under_procedure',
  'on_hold',
]);
const ACTIVE_INVESTIGATION_STATUSES = new Set([
  'registered',
  'in_progress',
  'results_recorded',
  'pending_approval',
]);

type QueueItem =
  | { kind: 'case'; id: string; record: LegalCaseListItem }
  | { kind: 'investigation'; id: string; record: Investigation };

function safePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase();
}

function formatHearingTime(value: string, locale: 'en' | 'ar'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

async function loadEligibleTeam(): Promise<UserDirectoryEntry[]> {
  try {
    const groups = await Promise.all([
      enterpriseApi.users.listByRole('legal-advisor'),
      enterpriseApi.users.listByRole('legal-investigator'),
      enterpriseApi.users.listByRole('legal-cases-supervisor'),
    ]);
    const users = new Map<string, UserDirectoryEntry>();
    for (const user of groups.flat()) users.set(user.id, user);
    if (users.size > 0) return [...users.values()];
  } catch {
    // Some deployments do not seed the role slugs used by the reference
    // workspace. The directory fallback keeps allocation available there.
  }
  const response = await enterpriseApi.users.list({
    page: 1,
    per_page: 200,
    sort: 'first_name',
    order: 'asc',
  });
  return response.data.filter((entry) => entry.status.toLocaleLowerCase() === 'active');
}

function WorkspaceError({
  copy,
  onRetry,
}: {
  copy: WorkspaceCopy['states'];
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-destructive/20 bg-card p-8 text-center">
      <h2 className="text-lg font-semibold text-foreground">{copy.errorTitle}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{copy.errorBody}</p>
      <Button className="mt-4" variant="outline" onClick={onRetry}>
        {copy.retry}
      </Button>
    </div>
  );
}

function Meter({
  value,
  warning = false,
  label,
}: {
  value: number;
  warning?: boolean;
  label: string;
}) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <div
        className={cn('h-full rounded-full', warning ? 'bg-warning-600' : 'bg-primary')}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="rounded-xl border border-border bg-white p-6">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-6 h-10 w-20" />
      <Skeleton className="mt-4 h-4 w-full" />
    </div>
  );
}

function ManagerOverview({
  cases,
  investigations,
  team,
  loading,
  copy,
}: {
  cases: LegalCaseListItem[];
  investigations: Investigation[];
  team: UserDirectoryEntry[];
  loading: boolean;
  copy: WorkspaceCopy;
}) {
  const f = useLexFormat();
  const { locale } = useLocale();
  const courtName = useCaseCourtName();
  const activeCases = cases.filter((item) => ACTIVE_CASE_STATUSES.has(item.status));
  const activeInvestigations = investigations.filter((item) =>
    ACTIVE_INVESTIGATION_STATUSES.has(item.status),
  );
  const plaintiff = activeCases.filter((item) => item.company_status === 'plaintiff');
  const defendant = activeCases.filter((item) => item.company_status === 'defendant');
  const now = new Date();
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);
  const upcoming = activeCases
    .filter((item) => {
      if (!item.next_hearing_date) return false;
      const date = new Date(item.next_hearing_date);
      return date >= now && date <= nextWeek;
    })
    .sort(
      (a, b) =>
        new Date(a.next_hearing_date ?? 0).getTime() -
        new Date(b.next_hearing_date ?? 0).getTime(),
    );

  const workload = team
    .map((member) => {
      const name = userDisplayName(member);
      const count = activeCases.filter(
        (item) =>
          item.handling_officer_id === member.id ||
          item.responsible_lawyer?.toLocaleLowerCase() === name.toLocaleLowerCase(),
      ).length;
      return { member, name, count };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const fallbackWorkload = workload.length > 0 ? workload : team.slice(0, 5).map((member) => ({
    member,
    name: userDisplayName(member),
    count: 0,
  }));
  const maxLoad = Math.max(1, ...fallbackWorkload.map((item) => item.count));
  const averageUtil =
    fallbackWorkload.length === 0
      ? 0
      : Math.round(
          fallbackWorkload.reduce((sum, item) => sum + item.count / maxLoad, 0) /
            fallbackWorkload.length *
            100,
        );

  const specs = [
    {
      key: 'active',
      label: copy.overview.activeCases,
      value: activeCases.length,
      hint: copy.overview.activeCasesHint,
      icon: Gavel,
    },
    {
      key: 'investigations',
      label: copy.overview.investigations,
      value: activeInvestigations.length,
      hint: copy.overview.investigationsHint,
      icon: FileSearch,
    },
    {
      key: 'sessions',
      label: copy.overview.sessions,
      value: upcoming.length,
      hint: copy.overview.sessionsHint,
      icon: CalendarDays,
    },
    {
      key: 'plaintiff',
      label: copy.overview.plaintiff,
      value: plaintiff.length,
      hint: copy.overview.plaintiffHint,
      icon: ArrowUpFromLine,
    },
    {
      key: 'defendant',
      label: copy.overview.defendant,
      value: defendant.length,
      hint: copy.overview.defendantHint,
      icon: ShieldCheck,
      warning: true,
    },
  ];

  return (
    <>
      <PageHeader title={copy.overview.title} description={copy.overview.description} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {loading
          ? Array.from({ length: 5 }, (_, index) => <LoadingCard key={index} />)
          : specs.map((spec) => {
              const Icon = spec.icon;
              return (
                <section
                  key={spec.key}
                  className="rounded-xl border border-border bg-white p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {spec.label}
                    </p>
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                      <Icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                  </div>
                  <p className="mt-4 font-display text-4xl font-bold text-foreground">
                    {f.formatNumber(spec.value)}
                  </p>
                  <p className="mt-3 text-xs leading-5 text-foreground">{spec.hint}</p>
                </section>
              );
            })}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-foreground">
              {copy.overview.workload}
            </h2>
            <Badge className="border-0 bg-primary/10 text-primary hover:bg-primary/10">
              {copy.overview.averageUtil(f.formatNumber(averageUtil))}
            </Badge>
          </div>
          <div className="mt-5 divide-y divide-border">
            {loading ? (
              Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="flex items-center gap-4 py-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <Skeleton className="h-8 flex-1" />
                </div>
              ))
            ) : fallbackWorkload.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {copy.overview.noAssignments}
              </p>
            ) : (
              fallbackWorkload.slice(0, 5).map(({ member, name, count }) => {
                const pct = Math.round((count / maxLoad) * 100);
                return (
                  <div key={member.id} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {initials(name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {member.roles[0]?.name ?? copy.assignment.match}
                      </p>
                    </div>
                    <div className="w-36 shrink-0">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-muted-foreground">
                          {copy.overview.assignedCases(f.formatNumber(count))}
                        </span>
                        <span className="font-semibold text-foreground">
                          {f.formatNumber(pct)}%
                        </span>
                      </div>
                      <Meter value={pct} warning={pct >= 80} label={name} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-foreground">
              {copy.overview.hearings}
            </h2>
            <Link
              href="/lex/calendar"
              className="text-xs font-semibold text-primary hover:underline"
            >
              {copy.overview.viewCalendar}
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {loading ? (
              Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-[86px] w-full rounded-lg" />
              ))
            ) : upcoming.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {copy.overview.noHearings}
              </p>
            ) : (
              upcoming.slice(0, 3).map((item) => {
                const date = new Date(item.next_hearing_date!);
                const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
                const lawyer = item.responsible_lawyer?.trim() || '—';
                return (
                  <Link
                    key={item.id}
                    href={`/lex/cases/${item.id}`}
                    className="flex gap-4 rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary"
                  >
                    <span className="grid w-16 shrink-0 place-items-center rounded-md bg-primary/10 px-2 py-2 text-center font-bold text-primary">
                      <span className="block text-[11px] uppercase">{month}</span>
                      <span className="block text-base">{f.formatNumber(date.getDate())}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-foreground">
                        {resolveLocalized(item.title, locale)}
                      </span>
                      <span className="mt-1 block truncate text-xs text-foreground">
                        {courtName(item) || copy.litigation.notScheduled}
                      </span>
                      <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <UserRound className="h-3.5 w-3.5" aria-hidden />
                        {copy.overview.counsel(lawyer)}
                      </span>
                    </span>
                    <Badge
                      className={cn(
                        'h-fit border-0 text-[10px]',
                        item.company_status === 'plaintiff'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-warning-50 dark:bg-warning-950/30 text-warning-600',
                      )}
                    >
                      {item.company_status === 'plaintiff'
                        ? copy.litigation.plaintiffRole
                        : copy.litigation.defendantRole}
                    </Badge>
                  </Link>
                );
              })
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function ManagerAssignment({
  cases,
  investigations,
  team,
  loading,
  copy,
}: {
  cases: LegalCaseListItem[];
  investigations: Investigation[];
  team: UserDirectoryEntry[];
  loading: boolean;
  copy: WorkspaceCopy;
}) {
  const f = useLexFormat();
  const { locale } = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const ownerCases =
    user?.id && cases.some((item) => item.section_manager_id === user.id)
      ? cases.filter((item) => item.section_manager_id === user.id)
      : cases;
  const ownerInvestigations =
    user?.id && investigations.some((item) => item.created_by === user.id)
      ? investigations.filter((item) => item.created_by === user.id)
      : investigations;
  const queue = useMemo<QueueItem[]>(
    () => [
      ...ownerCases
        .filter(
          (item) =>
            ACTIVE_CASE_STATUSES.has(item.status) &&
            !item.handling_officer_id &&
            !item.responsible_lawyer?.trim(),
        )
        .map((record) => ({ kind: 'case' as const, id: record.id, record })),
      ...ownerInvestigations
        .filter(
          (item) =>
            ACTIVE_INVESTIGATION_STATUSES.has(item.status) &&
            !item.lead_investigator?.trim(),
        )
        .map((record) => ({ kind: 'investigation' as const, id: record.id, record })),
    ],
    [ownerCases, ownerInvestigations],
  );
  const [selectedId, setSelectedId] = useState<string | null>(queue[0]?.id ?? null);
  const selected = queue.find((item) => item.id === selectedId) ?? queue[0] ?? null;
  const activeCases = cases.filter((item) => ACTIVE_CASE_STATUSES.has(item.status));
  const activeInvestigations = investigations.filter((item) =>
    ACTIVE_INVESTIGATION_STATUSES.has(item.status),
  );

  const assignment = useMutation({
    mutationFn: async ({ item, member }: { item: QueueItem; member: UserDirectoryEntry }) => {
      const name = userDisplayName(member);
      if (item.kind === 'case') {
        await casesApi.assignOfficer(item.id, {
          handling_officer_id: member.id,
          reason: 'Assigned from the cases manager allocation workspace',
        });
      } else {
        await investigationsApi.update(item.id, { lead_investigator: name });
      }
    },
    onSuccess: async () => {
      showSuccess(copy.assignment.assigned);
      setSelectedId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cases-manager', 'cases'] }),
        queryClient.invalidateQueries({ queryKey: ['cases-manager', 'investigations'] }),
        queryClient.invalidateQueries({ queryKey: ['lex-control-panel'] }),
      ]);
    },
    onError: showApiError,
  });

  const displayTitle = (item: QueueItem) =>
    item.kind === 'case'
      ? resolveLocalized(item.record.title, locale)
      : item.record.subject;
  const displayReference = (item: QueueItem) =>
    item.kind === 'case' ? item.record.case_number : item.record.investigation_number;
  const displayCategory = (item: QueueItem) =>
    item.kind === 'case'
      ? item.record.case_type
      : item.record.department || copy.assignment.investigationLabel;
  const displayCreated = (item: QueueItem) =>
    item.kind === 'case' ? item.record.created_at : item.record.created_at;

  return (
    <>
      <PageHeader title={copy.assignment.title} description={copy.assignment.description} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(300px,440px)_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-white p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-foreground">
              {copy.assignment.queue}
            </h2>
            <Badge className="border-0 bg-warning-50 dark:bg-warning-950/30 text-warning-600 hover:bg-warning-50 dark:bg-warning-950/30">
              {copy.assignment.pending(f.formatNumber(queue.length))}
            </Badge>
          </div>

          <div className="mt-5 space-y-3">
            {loading ? (
              Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-32 w-full rounded-lg" />
              ))
            ) : queue.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {copy.assignment.noQueue}
              </p>
            ) : (
              queue.map((item) => {
                const active = selected?.id === item.id;
                const priority = item.record.priority;
                return (
                  <Button
                    key={`${item.kind}-${item.id}`}
                    type="button"
                    variant="ghost"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'h-auto w-full rounded-lg border bg-background p-4 text-start transition-colors',
                      active
                        ? 'border-primary ring-1 ring-primary/20'
                        : 'border-border hover:border-primary/60',
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-foreground">
                        {displayReference(item)}
                      </span>
                      <Badge
                        className={cn(
                          'border-0 text-[10px] capitalize',
                          priority === 'critical' || priority === 'high'
                            ? 'bg-warning-50 dark:bg-warning-950/30 text-warning-600'
                            : 'bg-primary/10 text-primary',
                        )}
                      >
                        {priority}
                      </Badge>
                    </span>
                    <span className="mt-3 block text-sm font-bold text-foreground">
                      {displayTitle(item)}
                    </span>
                    <span className="mt-3 flex items-center justify-between gap-3">
                      <Badge className="border-0 bg-primary/10 text-[10px] text-primary">
                        {item.kind === 'case'
                          ? copy.assignment.caseLabel
                          : copy.assignment.investigationLabel}
                        {' · '}
                        {displayCategory(item)}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {copy.assignment.filed(f.formatDate(displayCreated(item)))}
                      </span>
                    </span>
                  </Button>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-foreground">
              {copy.assignment.directory}
            </h2>
            <span className="text-xs text-muted-foreground">{copy.assignment.directoryHint}</span>
          </div>

          <div className="mt-5 rounded-lg bg-primary/10 px-4 py-3 text-sm text-foreground">
            {selected ? (
              <>
                {copy.assignment.selected}{' '}
                <strong className="text-foreground">{displayTitle(selected)}</strong>
              </>
            ) : (
              copy.assignment.selectPrompt
            )}
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-[86px] w-full rounded-lg" />
              ))
            ) : team.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {copy.assignment.noTeam}
              </p>
            ) : (
              team.slice(0, 8).map((member) => {
                const name = userDisplayName(member);
                const caseCount = activeCases.filter(
                  (item) =>
                    item.handling_officer_id === member.id ||
                    item.responsible_lawyer?.toLocaleLowerCase() === name.toLocaleLowerCase(),
                ).length;
                const investigationCount = activeInvestigations.filter(
                  (item) => item.lead_investigator?.toLocaleLowerCase() === name.toLocaleLowerCase(),
                ).length;
                const total = caseCount + investigationCount;
                const loadPct = Math.min(100, total * 20);
                const available = loadPct < 100;
                return (
                  <div
                    key={member.id}
                    className={cn(
                      'flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center',
                      available
                        ? 'border-primary/60 bg-background'
                        : 'border-border bg-white',
                    )}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {initials(name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-bold text-foreground">{name}</span>
                        {available ? (
                          <Badge className="border-0 bg-primary/10 text-[10px] text-primary">
                            {copy.assignment.match}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {member.roles[0]?.name ?? member.email}
                      </span>
                    </span>
                    <span className="w-full shrink-0 sm:w-36">
                      <span className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
                        <span>{copy.assignment.activeLoad(f.formatNumber(total))}</span>
                        <span className="font-semibold text-foreground">
                          {f.formatNumber(loadPct)}%
                        </span>
                      </span>
                      <Meter
                        value={loadPct}
                        warning={loadPct >= 80}
                        label={copy.assignment.activeLoad(f.formatNumber(total))}
                      />
                    </span>
                    <Button
                      size="sm"
                      disabled={!selected || !available || assignment.isPending}
                      onClick={() => {
                        if (selected) assignment.mutate({ item: selected, member });
                      }}
                    >
                      {assignment.isPending ? (
                        <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
                      ) : null}
                      {assignment.isPending
                        ? copy.assignment.assigning
                        : copy.assignment.assign}
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function ManagerLitigation({
  cases,
  loading,
  copy,
}: {
  cases: LegalCaseListItem[];
  loading: boolean;
  copy: WorkspaceCopy;
}) {
  const { locale } = useLocale();
  const f = useLexFormat();
  const courtName = useCaseCourtName();
  const [role, setRole] = useState<'all' | CaseCompanyStatus>('all');
  const [search, setSearch] = useState('');
  const active = cases.filter((item) => ACTIVE_CASE_STATUSES.has(item.status));
  const plaintiffCount = active.filter((item) => item.company_status === 'plaintiff').length;
  const defendantCount = active.filter((item) => item.company_status === 'defendant').length;
  const needle = search.trim().toLocaleLowerCase();
  const filtered = active.filter((item) => {
    if (role !== 'all' && item.company_status !== role) return false;
    if (!needle) return true;
    return [
      item.case_number,
      resolveLocalized(item.title, locale),
      // Search the displayed court so a query matches what the row shows —
      // the reference name for new cases, the legacy free text for old ones.
      courtName(item),
      item.responsible_lawyer,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle);
  });

  return (
    <>
      <PageHeader title={copy.litigation.title} description={copy.litigation.description} />

      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all' as const, label: copy.litigation.all(f.formatNumber(active.length)) },
            {
              id: 'plaintiff' as const,
              label: copy.litigation.plaintiff(f.formatNumber(plaintiffCount)),
            },
            {
              id: 'defendant' as const,
              label: copy.litigation.defendant(f.formatNumber(defendantCount)),
            },
          ].map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={role === item.id ? 'default' : 'outline'}
              className="rounded-full"
              onClick={() => setRole(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="relative w-full lg:w-72">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="bg-white ps-9"
            placeholder={copy.litigation.search}
          />
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="overflow-x-auto">
          {/* The Figma monitor needs stacked forum/date cells and two inline
              progress meters; the generic table primitives do not support this
              grouped responsive row contract. */}
          {/* eslint-disable-next-line no-restricted-syntax */}
          <table className="w-full min-w-[980px] border-collapse text-start">
            <thead className="bg-background text-xs font-bold uppercase text-muted-foreground">
              <tr>
                <th className="w-32 px-4 py-4 text-start">{copy.litigation.columns.id}</th>
                <th className="px-4 py-4 text-start">{copy.litigation.columns.title}</th>
                <th className="w-36 px-4 py-4 text-start">{copy.litigation.columns.role}</th>
                <th className="w-44 px-4 py-4 text-start">{copy.litigation.columns.hearing}</th>
                <th className="w-40 px-4 py-4 text-start">{copy.litigation.columns.strength}</th>
                <th className="w-40 px-4 py-4 text-start">{copy.litigation.columns.sla}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 5 }, (_, index) => (
                  <tr key={index}>
                    <td colSpan={6} className="px-4 py-4">
                      <Skeleton className="h-12 w-full" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-sm text-muted-foreground">
                    {copy.litigation.empty}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const metadata = item.metadata ?? {};
                  const strength =
                    safePercent(metadata.strength_score) ??
                    (item.strength === 'strong' ? 85 : item.strength === 'weak' ? 45 : null);
                  const sla =
                    safePercent(metadata.sla_compliance_pct) ??
                    safePercent(metadata.sla_score);
                  return (
                    <tr key={item.id} className="transition-colors hover:bg-muted/20">
                      <td className="px-4 py-4">
                        <Link
                          href={`/lex/cases/${item.id}`}
                          className="text-xs font-semibold text-foreground hover:text-primary hover:underline"
                        >
                          {item.case_number}
                        </Link>
                      </td>
                      <td className="px-4 py-4">
                        <p className="max-w-md truncate text-sm font-bold text-foreground">
                          {resolveLocalized(item.title, locale)}
                        </p>
                        <p className="mt-1 max-w-md truncate text-xs text-muted-foreground">
                          {courtName(item) || '—'}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <Badge
                          className={cn(
                            'border-0',
                            item.company_status === 'plaintiff'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-warning-50 dark:bg-warning-950/30 text-warning-600',
                          )}
                        >
                          {item.company_status === 'plaintiff'
                            ? copy.litigation.plaintiffRole
                            : copy.litigation.defendantRole}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 text-xs text-foreground">
                        {item.next_hearing_date ? (
                          <>
                            <span className="block font-semibold">
                              {f.formatDate(item.next_hearing_date)}
                            </span>
                            <span className="mt-1 block text-muted-foreground">
                              {formatHearingTime(item.next_hearing_date, locale)}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            {copy.litigation.notScheduled}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {strength === null ? (
                          <span className="text-xs text-muted-foreground">
                            {copy.litigation.notAssessed}
                          </span>
                        ) : (
                          <div className="w-28">
                            <p
                              className={cn(
                                'mb-1.5 text-xs font-bold',
                                strength >= 70 ? 'text-primary' : 'text-warning-600',
                              )}
                            >
                              {f.formatNumber(strength)}%
                            </p>
                            <Meter
                              value={strength}
                              warning={strength < 70}
                              label={copy.litigation.columns.strength}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {sla === null ? (
                          <span className="text-xs text-muted-foreground">
                            {copy.litigation.notScored}
                          </span>
                        ) : (
                          <div className="w-28">
                            <p
                              className={cn(
                                'mb-1.5 text-xs font-bold',
                                sla >= 70 ? 'text-primary' : 'text-warning-600',
                              )}
                            >
                              {f.formatNumber(sla)}%
                            </p>
                            <Meter
                              value={sla}
                              warning={sla < 70}
                              label={copy.litigation.columns.sla}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function ManagerWorkspace({ view }: { view: ManagerWorkspaceView }) {
  const { locale, direction } = useLocale();
  const copy = COPY[locale === 'ar' ? 'ar' : 'en'];
  const casesQuery = useQuery({
    queryKey: ['cases-manager', 'cases'],
    queryFn: () =>
      casesApi.listCases({
        page: 1,
        per_page: 200,
        sort: 'updated_at',
        order: 'desc',
      }),
    staleTime: 30_000,
  });
  const investigationsQuery = useQuery({
    queryKey: ['cases-manager', 'investigations'],
    queryFn: () =>
      investigationsApi.list({
        page: 1,
        per_page: 200,
        sort: 'updated_at',
        order: 'desc',
      }),
    staleTime: 30_000,
  });
  const teamQuery = useQuery({
    queryKey: ['cases-manager', 'eligible-team'],
    queryFn: loadEligibleTeam,
    staleTime: 5 * 60_000,
  });
  const isError = casesQuery.isError || investigationsQuery.isError || teamQuery.isError;
  const isLoading =
    casesQuery.isLoading || investigationsQuery.isLoading || teamQuery.isLoading;
  const retry = () => {
    void Promise.all([
      casesQuery.refetch(),
      investigationsQuery.refetch(),
      teamQuery.refetch(),
    ]);
  };

  return (
    <div
      dir={direction}
      lang={locale}
      className="space-y-6 rounded-2xl bg-background p-0 text-foreground"
    >
      <ManagerControlNav />

      {isError ? (
        <WorkspaceError copy={copy.states} onRetry={retry} />
      ) : view === 'overview' ? (
        <ManagerOverview
          cases={casesQuery.data?.data ?? []}
          investigations={investigationsQuery.data?.data ?? []}
          team={teamQuery.data ?? []}
          loading={isLoading}
          copy={copy}
        />
      ) : view === 'assignment' ? (
        <ManagerAssignment
          cases={casesQuery.data?.data ?? []}
          investigations={investigationsQuery.data?.data ?? []}
          team={teamQuery.data ?? []}
          loading={isLoading}
          copy={copy}
        />
      ) : (
        <ManagerLitigation
          cases={casesQuery.data?.data ?? []}
          loading={casesQuery.isLoading}
          copy={copy}
        />
      )}
    </div>
  );
}
