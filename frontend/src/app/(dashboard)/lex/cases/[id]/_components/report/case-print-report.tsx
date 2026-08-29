'use client';

import { Printer } from 'lucide-react';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  formatCaseToken,
  type CaseHearing,
  type CaseParty,
  type CaseTask,
  type LegalCase,
  type LegalExpertAssignment,
  type LegalJudgment,
  type LegalPleading,
} from '@/lib/lex/cases';
import { useCaseLabels } from '../../../_components/labels';
import { useCaseCourtName } from '../../../_components/case-court';
import { derivePosture } from '../qualification/use-case-qualification';
import { useCasePositionLabels } from '../position/case-position-i18n';
import { useCaseDetailExtraLabels } from '../case-detail-labels';

interface CaseReportButtonProps {
  className?: string;
}

export function CaseReportButton({ className }: CaseReportButtonProps) {
  const t = useCaseDetailExtraLabels().toolbar;
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      aria-label={t.exportReportAria}
      onClick={() => window.print()}
    >
      <Printer className="me-1.5 h-3.5 w-3.5" aria-hidden />
      {t.exportReport}
    </Button>
  );
}

interface CasePrintReportProps {
  legalCase: LegalCase;
  title: string;
  parties: CaseParty[];
  hearings: CaseHearing[];
  tasks: CaseTask[];
  pleadings: LegalPleading[];
  experts: LegalExpertAssignment[];
  judgments: LegalJudgment[];
}

export function CasePrintReport({
  legalCase,
  title,
  parties,
  hearings,
  tasks,
  pleadings,
  experts,
  judgments,
}: CasePrintReportProps) {
  const labels = useCaseLabels();
  const detail = labels.detail;
  const position = useCasePositionLabels();
  const extra = useCaseDetailExtraLabels();
  const { locale, direction } = useLocaleOrDefault();
  const f = useLexFormat();
  const courtName = useCaseCourtName();
  const posture = derivePosture(legalCase);
  const role = labels.filters.companyStatusOptions[legalCase.company_status];
  const status = labels.filters.statusOptions[legalCase.status] ?? formatCaseToken(legalCase.status);
  const postureValue =
    posture.pct === null
      ? position.strength.notAssessed
      : `${position.strength.bands[posture.band!]} · ${f.formatNumber(posture.pct)}%`;

  return (
    <article
      className="hidden bg-white text-black print:block print:min-h-screen print:p-8"
      dir={direction}
      lang={locale}
      aria-label={`${extra.hero.eyebrow}: ${title}`}
    >
      <header className="border-b-2 border-black pb-5">
        <p className="text-sm font-semibold">{extra.hero.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-bold">{title}</h1>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>{legalCase.case_number || legalCase.id}</span>
          <span>{status}</span>
          <span>{role}</span>
          <span>{f.formatDual(legalCase.updated_at)}</span>
        </div>
      </header>

      <ReportSection title={detail.overviewTitle}>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
          <ReportFact label={detail.metadata.caseNumber} value={legalCase.case_number} />
          <ReportFact label={detail.metadata.type} value={formatCaseToken(legalCase.case_type)} />
          <ReportFact label={detail.metadata.companyStatus} value={role} />
          <ReportFact label={detail.metadata.competentCourt} value={courtName(legalCase)} />
          <ReportFact
            label={detail.metadata.responsibleLawyer}
            value={legalCase.responsible_lawyer}
          />
          <ReportFact label={detail.metadata.department} value={legalCase.department} />
          <ReportFact label={position.strength.overall} value={postureValue} />
        </dl>
        {legalCase.description ? (
          <p className="mt-5 whitespace-pre-line border-t pt-4 text-sm leading-6">
            {legalCase.description}
          </p>
        ) : null}
      </ReportSection>

      <ReportSection title={labels.tabs.parties}>
        <ReportTable
          headers={[
            labels.partyForm.name,
            labels.partyForm.role,
            labels.partyForm.identifier,
            labels.partyForm.contact,
          ]}
          rows={parties.map((party) => [
            party.name,
            labels.filters.partyRoleOptions[party.role] ?? formatCaseToken(party.role),
            party.identifier,
            party.contact,
          ])}
          empty={labels.parties.emptyTitle}
        />
      </ReportSection>

      <ReportSection title={labels.tabs.tasks}>
        <ReportTable
          headers={[
            labels.taskForm.title,
            labels.taskForm.status,
            labels.taskForm.priority,
            labels.taskForm.due,
          ]}
          rows={tasks.map((task) => [
            task.title,
            labels.filters.taskStatusOptions[task.status] ?? formatCaseToken(task.status),
            labels.filters.priorityOptions[task.priority] ?? formatCaseToken(task.priority),
            task.due_date ? f.formatDual(task.due_date) : labels.tasks.noDue,
          ])}
          empty={labels.tasks.emptyTitle}
        />
      </ReportSection>

      <ReportSection title={labels.tabs.hearings}>
        <ReportTable
          headers={[
            labels.hearingForm.date,
            labels.hearingForm.location,
            labels.hearingForm.notes,
            labels.hearingForm.decision,
          ]}
          rows={hearings.map((hearing) => [
            f.formatDual(hearing.hearing_date),
            hearing.location,
            hearing.notes,
            hearing.decision,
          ])}
          empty={labels.hearings.emptyTitle}
        />
      </ReportSection>

      {legalCase.company_status === 'plaintiff' ? (
        <>
          <ReportSection title={labels.tabs.pleadings}>
            <ReportTable
              headers={[
                labels.pleadingForm.title,
                labels.pleadingForm.type,
                labels.pleadings.statusLabel,
                labels.pleadings.pleadingNumber,
              ]}
              rows={pleadings.map((pleading) => [
                pleading.title,
                labels.filters.pleadingTypeOptions[pleading.type] ??
                  formatCaseToken(pleading.type),
                labels.filters.pleadingStatusOptions[pleading.status] ??
                  formatCaseToken(pleading.status),
                pleading.pleading_number,
              ])}
              empty={labels.pleadings.emptyTitle}
            />
          </ReportSection>

          <ReportSection title={labels.tabs.experts}>
            <ReportTable
              headers={[
                labels.expertForm.expertName,
                labels.expertForm.specialization,
                labels.experts.statusLabel,
                labels.expertForm.reportDue,
              ]}
              rows={experts.map((expert) => [
                expert.expert_name,
                expert.specialization,
                labels.filters.expertStatusOptions[expert.status] ??
                  formatCaseToken(expert.status),
                expert.report_due_date ? f.formatDual(expert.report_due_date) : null,
              ])}
              empty={labels.experts.emptyTitle}
            />
          </ReportSection>

          <ReportSection title={labels.tabs.judgments}>
            <ReportTable
              headers={[
                labels.judgmentForm.judgmentRef,
                labels.judgmentForm.judgmentDate,
                labels.judgmentForm.outcome,
                labels.judgments.recommendation,
              ]}
              rows={judgments.map((judgment) => [
                judgment.judgment_ref,
                judgment.judgment_date ? f.formatDual(judgment.judgment_date) : null,
                judgment.outcome
                  ? labels.filters.judgmentOutcomeOptions[judgment.outcome] ??
                    formatCaseToken(judgment.outcome)
                  : null,
                labels.filters.judgmentRecommendationOptions[judgment.recommendation] ??
                  formatCaseToken(judgment.recommendation),
              ])}
              empty={labels.judgments.emptyTitle}
            />
          </ReportSection>
        </>
      ) : null}

      <footer className="mt-8 border-t pt-3 text-xs text-black/70">
        {resolveLocalized(legalCase.title, locale) || title} · {legalCase.case_number}
      </footer>
    </article>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7 break-inside-avoid">
      <h2 className="mb-3 border-b pb-2 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function ReportFact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-black/60">{label}</dt>
      <dd className="mt-1 text-sm font-semibold">{value?.trim() || '—'}</dd>
    </div>
  );
}

function ReportTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: Array<Array<string | null | undefined>>;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-black/60">{empty}</p>;
  }

  type ReportRow = Record<string, string>;
  const columns: Column<ReportRow>[] = headers.map((header, index) => ({
    key: `cell-${index}`,
    header,
    render: (row) => row[`cell-${index}`] || '—',
  }));
  const data: ReportRow[] = rows.map((row, rowIndex) => ({
    __key: String(rowIndex),
    ...Object.fromEntries(
      row.map((value, cellIndex) => [`cell-${cellIndex}`, value || '—']),
    ),
  }));

  return (
    <SimpleTable<ReportRow>
      columns={columns}
      data={data}
      getRowKey={(row) => row.__key}
      ariaLabel={headers.join(', ')}
      className="text-xs shadow-none print:overflow-visible"
    />
  );
}
