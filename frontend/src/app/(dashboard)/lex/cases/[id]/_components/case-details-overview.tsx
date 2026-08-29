'use client';

import type { ReactNode } from 'react';
import { CalendarDays, Scale, UsersRound, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { CaseHearing, LegalCase } from '@/lib/lex/cases';
import { useCaseUsers } from '../../_components/tabs/sessions/use-case-users';
import { useCaseCourtName } from '../../_components/case-court';
import { resolveCaseTypeLabel } from './case-enums-i18n';

interface CaseDetailsOverviewProps {
  legalCase: LegalCase;
  hearings: CaseHearing[];
  title: string;
  statusLabel: string;
  canWrite: boolean;
  onEdit: () => void;
}

const copy = {
  en: {
    information: 'Case information',
    financial: 'Financial details',
    dates: 'Key dates',
    team: 'Assigned team',
    edit: 'Edit case details',
    title: 'Case title',
    type: 'Case type',
    number: 'Case number',
    court: 'Court',
    chamber: 'Chamber',
    filingDate: 'Filing date',
    status: 'Status',
    claim: 'Claim amount',
    courtFees: 'Court fees',
    legalFees: 'Legal fees',
    nextHearing: 'Next hearing',
    registration: 'Case registration',
    firstHearing: 'First hearing',
    expectedResolution: 'Expected resolution',
    lead: 'Lead consultant',
    litigation: 'Litigation lawyer',
    researcher: 'Legal researcher',
    notSet: 'Not set',
  },
  ar: {
    information: 'معلومات القضية',
    financial: 'التفاصيل المالية',
    dates: 'التواريخ الرئيسية',
    team: 'فريق العمل المكلّف',
    edit: 'تعديل تفاصيل القضية',
    title: 'عنوان القضية',
    type: 'نوع القضية',
    number: 'رقم القضية',
    court: 'المحكمة',
    chamber: 'الدائرة',
    filingDate: 'تاريخ القيد',
    status: 'الحالة',
    claim: 'مبلغ المطالبة',
    courtFees: 'الرسوم القضائية',
    legalFees: 'الأتعاب القانونية',
    nextHearing: 'الجلسة القادمة',
    registration: 'تسجيل القضية',
    firstHearing: 'الجلسة الأولى',
    expectedResolution: 'التاريخ المتوقع للحسم',
    lead: 'المستشار الرئيسي',
    litigation: 'محامي التقاضي',
    researcher: 'الباحث القانوني',
    notSet: 'غير محدد',
  },
} as const;

export function CaseDetailsOverview({
  legalCase,
  hearings,
  title,
  statusLabel,
  canWrite,
  onEdit,
}: CaseDetailsOverviewProps) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? copy.ar : copy.en;
  const f = useLexFormat();
  const users = useCaseUsers();
  const courtName = useCaseCourtName();
  const orderedHearings = [...hearings].sort(
    (a, b) => new Date(a.hearing_date).getTime() - new Date(b.hearing_date).getTime(),
  );
  const firstHearing = orderedHearings[0]?.hearing_date;
  const nextHearing = orderedHearings.find(
    (hearing) => new Date(hearing.hearing_date).getTime() >= Date.now(),
  )?.hearing_date;
  const currency = legalCase.currency?.trim() || 'SAR';
  const money = (value: number | null | undefined) =>
    value == null ? null : f.formatCurrency(value, { currency });
  const name = (id: string | null | undefined, fallback?: string | null) =>
    id ? users.nameOf(id) : fallback?.trim() || null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-elevation-1 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{t.information}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{legalCase.case_number}</p>
        </div>
        {canWrite ? (
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            {t.edit}
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DetailsCard title={t.information} icon={<Scale className="h-4 w-4" aria-hidden />}>
          <Detail label={t.title} value={title} strong />
          <Detail label={t.type} value={resolveCaseTypeLabel(legalCase.case_type, locale)} />
          <Detail label={t.number} value={legalCase.case_number} strong tabular />
          <Detail label={t.court} value={courtName(legalCase)} />
          <Detail label={t.chamber} value={legalCase.chamber} />
          <Detail label={t.filingDate} value={formatDate(legalCase.filing_date, f)} />
          <Detail label={t.status} value={statusLabel} accent />
        </DetailsCard>

        <DetailsCard title={t.financial} icon={<WalletCards className="h-4 w-4" aria-hidden />}>
          <Detail label={t.claim} value={money(legalCase.claim_amount)} strong tabular />
          <Detail label={t.courtFees} value={money(legalCase.court_fees)} tabular />
          <Detail label={t.legalFees} value={money(legalCase.legal_fees)} tabular />
        </DetailsCard>

        <DetailsCard title={t.dates} icon={<CalendarDays className="h-4 w-4" aria-hidden />}>
          <Detail label={t.nextHearing} value={formatDate(nextHearing, f)} strong />
          <Detail
            label={t.registration}
            value={formatDate(legalCase.filing_date || legalCase.created_at, f)}
          />
          <Detail label={t.firstHearing} value={formatDate(firstHearing, f)} />
          <Detail
            label={t.expectedResolution}
            value={formatDate(legalCase.expected_resolution_date, f)}
          />
        </DetailsCard>

        <DetailsCard title={t.team} icon={<UsersRound className="h-4 w-4" aria-hidden />}>
          <Detail
            label={t.lead}
            value={name(legalCase.section_manager_id, legalCase.responsible_lawyer)}
            strong
          />
          <Detail label={t.litigation} value={name(legalCase.supervisor_id)} strong />
          <Detail label={t.researcher} value={name(legalCase.handling_officer_id)} strong />
        </DetailsCard>
      </div>
    </section>
  );
}

function DetailsCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="rounded-xl border border-border/80 bg-card p-4 sm:p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </h3>
      <dl className="space-y-3">{children}</dl>
    </article>
  );
}

function Detail({
  label,
  value,
  strong = false,
  accent = false,
  tabular = false,
}: {
  label: string;
  value: string | null | undefined;
  strong?: boolean;
  accent?: boolean;
  tabular?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 text-sm ${strong ? 'font-bold' : 'font-medium'} ${
          accent
            ? 'inline-flex rounded-md bg-success-50 px-2 py-1 text-success-700 dark:bg-success-950/40 dark:text-success-300'
            : 'text-foreground'
        } ${tabular ? 'tabular-nums' : ''}`}
        dir="auto"
      >
        {value?.trim() || '—'}
      </dd>
    </div>
  );
}

function formatDate(
  value: string | null | undefined,
  f: ReturnType<typeof useLexFormat>,
): string | null {
  if (!value) return null;
  return f.formatDual(value);
}
