'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Info,
  MapPin,
  Plus,
} from 'lucide-react';
import { LexRouteGuard } from '../../../../_guards/lex-route-guard';
import { ErrorState } from '@/components/common/error-state';
import { PageHeader } from '@/components/common/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import {
  investigationsApi,
  type Investigation,
  type InvestigationStatement,
  type RecordInvestigationStatementPayload,
} from '@/lib/lex/investigations';
import { showApiError, showSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

const cardClass = 'rounded-xl border border-border/80 bg-card shadow-none';
const PREPARATION_KEYS = ['review_case', 'prepare_questions', 'check_hardware', 'verify_rights'] as const;
type PreparationKey = (typeof PREPARATION_KEYS)[number];

export function InvestigationInterviewsWorkspace() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const queryClient = useQueryClient();
  const { locale, direction } = useLocaleOrDefault();
  const { hasPermission } = useAuth();
  const isArabic = locale === 'ar';
  const canWrite = hasPermission('lex:investigation:edit');
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const query = useQuery({
    queryKey: ['lex-investigation', id],
    queryFn: () => investigationsApi.get(id),
    enabled: Boolean(id),
  });

  const refresh = async () => {
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: ['lex-investigation', id] }),
      queryClient.invalidateQueries({ queryKey: ['lex-investigations'] }),
    ]);
  };

  const scheduleMutation = useMutation({
    mutationFn: (payload: RecordInvestigationStatementPayload) =>
      investigationsApi.recordStatement(id, payload),
    onSuccess: async () => {
      showSuccess(isArabic ? 'تمت جدولة المقابلة' : 'Interview scheduled');
      setScheduleOpen(false);
      await refresh();
    },
    onError: showApiError,
  });

  const preparationMutation = useMutation({
    mutationFn: (keys: PreparationKey[]) => {
      const current = query.data;
      if (!current) return Promise.reject(new Error('Investigation unavailable'));
      return investigationsApi.update(id, {
        metadata: {
          ...(current.metadata ?? {}),
          interview_preparation: keys,
        },
      });
    },
    onSuccess: async () => {
      await refresh();
    },
    onError: showApiError,
  });

  if (query.isLoading) {
    return (
      <LexRouteGuard route="/lex/investigations/[id]">
        <div className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Skeleton className="h-[560px] w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      </LexRouteGuard>
    );
  }

  if (query.isError || !query.data) {
    return (
      <LexRouteGuard route="/lex/investigations/[id]">
        <PageHeader
          title={isArabic ? 'إدارة المقابلات والشهود' : 'Interview & Witness Management'}
          description={isArabic ? 'تعذر تحميل ملف التحقيق.' : 'Unable to load the investigation.'}
        />
        <ErrorState
          message={isArabic ? 'تعذر تحميل ملف التحقيق' : 'Unable to load the investigation'}
          onRetry={() => void query.refetch()}
        />
      </LexRouteGuard>
    );
  }

  const investigation = query.data;
  const statements = investigation.statements ?? [];
  const scheduled = statements.filter(isScheduledInterview);
  const completed = statements.filter((statement) => !isScheduledInterview(statement));
  const checked = readPreparation(investigation);
  const preparationLabels: Record<PreparationKey, string> = isArabic
    ? {
        review_case: 'مراجعة ملف القضية والأدلة الرئيسية',
        prepare_questions: 'إعداد قائمة بالأسئلة المستهدفة والمحددة',
        check_hardware: 'التحقق من معدات التسجيل الفني الآمن',
        verify_rights: 'التحقق من نموذج إشعار الحقوق القانونية',
      }
    : {
        review_case: 'Review case file & key evidence',
        prepare_questions: 'Prepare targeted questions list',
        check_hardware: 'Check hardware recording equipment',
        verify_rights: 'Verify legal rights notification form',
      };

  const togglePreparation = (key: PreparationKey, enabled: boolean) => {
    const next = enabled ? unique([...checked, key]) : checked.filter((item) => item !== key);
    preparationMutation.mutate(next);
  };
  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(isArabic ? 'ar-SA' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

  const downloadTemplate = () => {
    const content = isArabic
      ? 'نموذج أسئلة المقابلة القانونية\n\n1. بيانات الشخص المستجوب:\n2. إشعار الحقوق والموافقة على التسجيل:\n3. الأسئلة الأساسية:\n4. الأدلة المشار إليها:\n5. الملاحظات والتوقيعات:'
      : 'Legal Interview Question Template\n\n1. Interviewee details:\n2. Rights notice and recording consent:\n3. Core questions:\n4. Evidence referenced:\n5. Notes and signatures:';
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `interview-question-template-${investigation.investigation_number}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <LexRouteGuard route="/lex/investigations/[id]">
      <div
        className="space-y-6 motion-safe:animate-fade-up"
        dir={direction}
        lang={locale}
        data-testid="investigation-interviews"
      >
        <header className="space-y-4">
          <InvestigationSubpageBreadcrumb
            investigation={investigation}
            current={isArabic ? 'المقابلات' : 'Interviews'}
            isArabic={isArabic}
          />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                {isArabic ? 'إدارة المقابلات والشهود' : 'Interview & Witness Management'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground" dir="auto">
                {isArabic ? 'القضية' : 'Case'}: {investigation.subject} ({investigation.investigation_number})
              </p>
            </div>
            {canWrite ? (
              <Button type="button" onClick={() => setScheduleOpen(true)}>
                <Plus className="me-2 h-4 w-4" aria-hidden />
                {isArabic ? 'جدولة مقابلة جديدة' : 'Schedule New Interview'}
              </Button>
            ) : null}
          </div>
        </header>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="min-w-0 space-y-6">
            <InterviewSection
              title={isArabic ? 'المقابلات المجدولة والقادمة' : 'Scheduled Interviews'}
            >
              {scheduled.length ? (
                <div className="space-y-3">
                  {scheduled.map((statement) => (
                    <ScheduledInterviewCard
                      key={statement.id}
                      statement={statement}
                      isArabic={isArabic}
                      formatDateTime={formatDateTime}
                    />
                  ))}
                </div>
              ) : (
                <EmptyInterview
                  text={isArabic ? 'لا توجد مقابلات مجدولة.' : 'No interviews are scheduled.'}
                />
              )}
            </InterviewSection>

            <InterviewSection
              title={isArabic ? 'المقابلات المكتملة والإفادات' : 'Completed Interviews'}
            >
              {completed.length ? (
                <div className="space-y-3">
                  {completed.map((statement) => (
                    <CompletedInterviewCard
                      key={statement.id}
                      statement={statement}
                      isArabic={isArabic}
                      formatDateTime={formatDateTime}
                    />
                  ))}
                </div>
              ) : (
                <EmptyInterview
                  text={isArabic ? 'لا توجد مقابلات مكتملة.' : 'No interviews have been completed.'}
                />
              )}
            </InterviewSection>
          </main>

          <aside className="space-y-6 xl:sticky xl:top-6">
            <section className={cn(cardClass, 'p-6')}>
              <h2 className="text-base font-bold">
                {isArabic ? 'حقيبة تحضير المقابلة القانونية' : 'Interview Preparation Kit'}
              </h2>
              <p className="mt-4 text-sm text-muted-foreground">
                {isArabic
                  ? 'قائمة التحضير القياسية للمستشار قبل بدء التواصل:'
                  : 'Standard legal preparation checklist before initiating contact:'}
              </p>
              <div className="mt-4 space-y-3">
                {PREPARATION_KEYS.map((key) => {
                  const isChecked = checked.includes(key);
                  return (
                    <label key={key} className="flex cursor-pointer items-start gap-3 text-sm">
                      <Checkbox
                        checked={isChecked}
                        disabled={!canWrite || preparationMutation.isPending}
                        onCheckedChange={(value) => togglePreparation(key, value === true)}
                      />
                      <span>{preparationLabels[key]}</span>
                    </label>
                  );
                })}
              </div>
              <Button type="button" variant="outline" className="mt-5 w-full" onClick={downloadTemplate}>
                <Download className="me-2 h-4 w-4" aria-hidden />
                {isArabic ? 'تحميل نموذج الأسئلة القانوني' : 'Download Question Template'}
              </Button>
            </section>

            <section className={cn(cardClass, 'p-6')}>
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-warning" aria-hidden />
                <h2 className="text-sm font-bold uppercase">
                  {isArabic ? 'بروتوكول المقابلات القانونية' : 'Legal Interview Protocol'}
                </h2>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {isArabic
                  ? 'يجب أن تسبق جميع الإفادات تلاوة رسمية لإشعار حقوق التحقيق، مع توثيق الموافقة اللفظية على التسجيل الإلكتروني.'
                  : 'All statements must be preceded by reading the official Notice of Investigation Rights. Electronic recording consent must be confirmed verbally on tape.'}
              </p>
            </section>
          </aside>
        </div>

        {canWrite ? (
          <ScheduleInterviewDialog
            open={scheduleOpen}
            investigation={investigation}
            isArabic={isArabic}
            loading={scheduleMutation.isPending}
            onOpenChange={setScheduleOpen}
            onSubmit={(payload) => scheduleMutation.mutate(payload)}
          />
        ) : null}
      </div>
    </LexRouteGuard>
  );
}

function InvestigationSubpageBreadcrumb({
  investigation,
  current,
  isArabic,
}: {
  investigation: Investigation;
  current: string;
  isArabic: boolean;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label="Breadcrumb">
      <Link href="/lex">{isArabic ? 'وثيق تيك' : 'WatheeqTech'}</Link>
      <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      <Link href="/lex/investigations">
        {isArabic ? 'القضايا والتحقيقات' : 'Cases & Investigations'}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      <Link href={`/lex/investigations/${investigation.id}`} className="font-mono">
        {investigation.investigation_number}
      </Link>
      <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
      <span className="font-semibold text-foreground">{current}</span>
    </nav>
  );
}

function InterviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={cardClass}>
      <h2 className="px-6 pb-4 pt-6 text-lg font-bold">{title}</h2>
      <div className="px-6 pb-6">{children}</div>
    </section>
  );
}

function ScheduledInterviewCard({
  statement,
  isArabic,
  formatDateTime,
}: {
  statement: InvestigationStatement;
  isArabic: boolean;
  formatDateTime: (value: string) => string;
}) {
  const metadata = statement.metadata ?? {};
  const role = recordText(metadata, ['interview_role', 'role']) || (isArabic ? 'شاهد' : 'Witness');
  const location = recordText(metadata, ['location', 'meeting_location']) || (isArabic ? 'غير محدد' : 'Not set');
  const interviewer = recordText(metadata, ['assigned_interviewer']) || statement.taken_by;
  return (
    <article className="rounded-lg bg-muted/40 p-4">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold" dir="auto">{statement.deponent_name}</h3>
            <Badge variant="info">{role}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground" dir="auto">{statement.statement}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" aria-hidden />
              {formatDateTime(statement.taken_at)}
            </span>
            <span className="inline-flex items-center gap-1.5" dir="auto">
              <MapPin className="h-4 w-4" aria-hidden />
              {location}
            </span>
          </div>
        </div>
        <div className="shrink-0 text-start text-xs">
          <p className="text-muted-foreground">{isArabic ? 'المحقق المعين' : 'Assigned Interviewer'}</p>
          <p className="mt-1 font-semibold" dir="auto">{interviewer}</p>
        </div>
      </div>
    </article>
  );
}

function CompletedInterviewCard({
  statement,
  isArabic,
  formatDateTime,
}: {
  statement: InvestigationStatement;
  isArabic: boolean;
  formatDateTime: (value: string) => string;
}) {
  const metadata = statement.metadata ?? {};
  const duration = recordText(metadata, ['duration', 'duration_minutes']);
  const transcriptStatus = recordText(metadata, ['transcript_status']) || (isArabic ? 'تم تفريغ الإفادة' : 'Transcribed');
  const recording = recordText(metadata, ['recording', 'recording_type']) || (isArabic ? 'إفادة موثقة' : 'Statement recorded');
  return (
    <article className="rounded-lg bg-muted/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold" dir="auto">{statement.deponent_name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDateTime(statement.taken_at)} · {statement.taken_by}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">{transcriptStatus}</Badge>
          {duration ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" aria-hidden />
              {duration}
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {isArabic ? 'النتائج الرئيسية والإفادة الموثقة' : 'Key Findings'}
      </p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground" dir="auto">{statement.statement}</p>
      <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-action" aria-hidden />
        {recording}
      </p>
    </article>
  );
}

function EmptyInterview({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

function ScheduleInterviewDialog({
  open,
  investigation,
  isArabic,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  investigation: Investigation;
  isArabic: boolean;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: RecordInvestigationStatementPayload) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState(isArabic ? 'شاهد' : 'Witness');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [interviewer, setInterviewer] = useState(investigation.lead_investigator);
  const [purpose, setPurpose] = useState('');

  const submit = () => {
    if (!name.trim() || !date || !interviewer.trim()) return;
    onSubmit({
      deponent_name: name.trim(),
      statement: purpose.trim() || (isArabic ? 'مقابلة تحقيق مجدولة' : 'Scheduled investigation interview'),
      taken_at: new Date(date).toISOString(),
      taken_by: interviewer.trim(),
      metadata: {
        interview_status: 'scheduled',
        interview_role: role.trim(),
        location: location.trim(),
        assigned_interviewer: interviewer.trim(),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isArabic ? 'جدولة مقابلة جديدة' : 'Schedule New Interview'}</DialogTitle>
          <DialogDescription>
            {isArabic
              ? 'سجّل الموعد والمكان والمحقق المعين ضمن ملف التحقيق.'
              : 'Record the date, location, and assigned interviewer in the investigation file.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label={isArabic ? 'اسم الشخص' : 'Interviewee'}>
            <Input value={name} onChange={(event) => setName(event.target.value)} dir="auto" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={isArabic ? 'الدور' : 'Role'}>
              <Input value={role} onChange={(event) => setRole(event.target.value)} dir="auto" />
            </Field>
            <Field label={isArabic ? 'التاريخ والوقت' : 'Date and time'}>
              <Input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          </div>
          <Field label={isArabic ? 'المكان أو رابط الجلسة' : 'Location or session link'}>
            <Input value={location} onChange={(event) => setLocation(event.target.value)} dir="auto" />
          </Field>
          <Field label={isArabic ? 'المحقق المعين' : 'Assigned interviewer'}>
            <Input value={interviewer} onChange={(event) => setInterviewer(event.target.value)} dir="auto" />
          </Field>
          <Field label={isArabic ? 'الغرض ومحاور المقابلة' : 'Purpose and interview focus'}>
            <Textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} rows={3} dir="auto" />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {isArabic ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button type="button" loading={loading} disabled={!name.trim() || !date} onClick={submit}>
            {isArabic ? 'جدولة المقابلة' : 'Schedule Interview'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function isScheduledInterview(statement: InvestigationStatement): boolean {
  const status = recordText(statement.metadata, ['interview_status', 'status']).toLowerCase();
  if (status === 'scheduled') return true;
  if (status === 'completed') return false;
  return new Date(statement.taken_at).getTime() > Date.now();
}

function readPreparation(investigation: Investigation): PreparationKey[] {
  const raw = investigation.metadata?.interview_preparation;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is PreparationKey =>
    PREPARATION_KEYS.includes(value as PreparationKey),
  );
}

function recordText(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[],
): string {
  if (!metadata) return '';
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
