'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  CalendarClock,
  ExternalLink,
  FileText,
  Landmark,
  Scale,
  ShieldAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import {
  formatCaseToken,
  type LegalCase,
} from '@/lib/lex/cases';
import type { AppLocale } from '@/lib/i18n';
import { resolveCaseTypeLabel } from '../../[id]/_components/case-enums-i18n';
import { useCaseCourtName } from '../case-court';
import type { CaseLabels } from '../labels';
import type { CaseDeadline, CaseDeadlineSummary } from './deadline-utils';
import { collectCaseDeadlines, summarizeCaseDeadlines } from './deadline-utils';

interface CasePreviewSheetProps {
  legalCase: LegalCase | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: AppLocale;
  labels: CaseLabels;
  selected: boolean;
  onToggleSelected: (caseId: string) => void;
}

const riskTone: Record<CaseDeadlineSummary['risk'], string> = {
  overdue: 'border-error-100 bg-error-50 text-error-600',
  urgent: 'border-warning-100 bg-warning-50 text-warning-700 dark:text-warning-300',
  soon: 'border-warning-100 bg-warning-50 text-warning-700 dark:text-warning-300',
  scheduled: 'border-sky-200 bg-sky-50 text-sky-700',
  none: 'border-border bg-muted/40 text-muted-foreground',
};

export function CasePreviewSheet({
  legalCase,
  open,
  onOpenChange,
  locale,
  labels,
  selected,
  onToggleSelected,
}: CasePreviewSheetProps) {
  const f = useLexFormat();
  const courtName = useCaseCourtName();
  const title = legalCase
    ? resolveLocalized(legalCase.title, locale) || labels.list.untitled
    : labels.list.untitled;
  const deadlines = legalCase ? collectCaseDeadlines(legalCase, locale, labels.list.untitled, labels.deadlines) : [];
  const deadlineSummary = summarizeCaseDeadlines(deadlines, labels.deadlines);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full w-[calc(100vw-1rem)] flex-col overflow-y-auto p-0 sm:max-w-2xl">
        {legalCase ? (
          <>
            <div className="border-b border-border/70 px-6 py-5">
              <SheetHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={legalCase.company_status === 'plaintiff' ? 'success' : 'warning'}>
                    {labels.filters.companyStatusOptions[legalCase.company_status] ??
                      formatCaseToken(legalCase.company_status)}
                  </Badge>
                  <Badge variant="secondary">
                    {labels.filters.statusOptions[legalCase.status] ?? formatCaseToken(legalCase.status)}
                  </Badge>
                  <Badge
                    variant={
                      legalCase.priority === 'critical' || legalCase.priority === 'high'
                        ? 'destructive'
                        : legalCase.priority === 'medium'
                          ? 'warning'
                          : 'outline'
                    }
                  >
                    {labels.filters.priorityOptions[legalCase.priority] ??
                      formatCaseToken(legalCase.priority)}
                  </Badge>
                </div>
                <div>
                  <SheetTitle className="pe-8 text-xl leading-tight">{title}</SheetTitle>
                  <SheetDescription className="mt-1">
                    {legalCase.case_number} • {resolveCaseTypeLabel(legalCase.case_type, locale)}
                  </SheetDescription>
                </div>
              </SheetHeader>
            </div>

            <div className="flex-1 space-y-5 px-6 py-5">
              <div className={cn('rounded-xl border px-4 py-3', riskTone[deadlineSummary.risk])}>
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{deadlineSummary.label}</p>
                    <p className="mt-0.5 text-xs opacity-80">{deadlineSummary.description}</p>
                  </div>
                </div>
              </div>

              <PreviewSection title={labels.preview.snapshot}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <PreviewFact
                    icon={Landmark}
                    label={labels.list.columns.court}
                    value={courtName(legalCase) || labels.list.noCourt}
                  />
                  <PreviewFact
                    icon={Scale}
                    label={labels.list.columns.strength}
                    value={
                      legalCase.strength
                        ? labels.filters.strengthOptions[legalCase.strength] ?? formatCaseToken(legalCase.strength)
                        : labels.list.noStrength
                    }
                  />
                  <PreviewFact
                    icon={UserRound}
                    label={labels.detail.metadata.responsibleLawyer}
                    value={legalCase.responsible_lawyer || labels.detail.notSet}
                  />
                  <PreviewFact
                    icon={FileText}
                    label={labels.detail.metadata.department}
                    value={legalCase.department || labels.detail.notSet}
                  />
                </div>
              </PreviewSection>

              <PreviewSection title={labels.detail.descriptionTitle}>
                <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">
                  {legalCase.description || labels.detail.descriptionEmpty}
                </p>
              </PreviewSection>

              <PreviewSection title={labels.preview.deadlineStrip}>
                {deadlines.length > 0 ? (
                  <div className="space-y-2">
                    {deadlines.slice(0, 5).map((deadline) => (
                      <DeadlineRow key={deadline.id} deadline={deadline} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                    {labels.preview.deadlineStripEmpty}
                  </p>
                )}
              </PreviewSection>

              <PreviewSection title={labels.preview.portfolioMetadata}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <PreviewFact
                    icon={CalendarClock}
                    label={labels.detail.metadata.created}
                    value={f.formatDate(legalCase.created_at, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  />
                  <PreviewFact
                    icon={CalendarClock}
                    label={labels.detail.metadata.updated}
                    value={f.formatRelative(legalCase.updated_at)}
                  />
                </div>
              </PreviewSection>
            </div>

            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-background/95 px-6 py-4">
              <Button type="button" variant="outline" onClick={() => onToggleSelected(legalCase.id)}>
                {selected ? labels.preview.removeFromSelection : labels.preview.selectCase}
              </Button>
              <Button asChild>
                <Link href={`/lex/cases/${legalCase.id}`}>
                  {labels.preview.openDetail}
                  <ExternalLink className="ms-2 h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function PreviewFact({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 px-3 py-3">
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <div className="mt-1 truncate text-sm font-medium text-foreground">{value}</div>
        </div>
      </div>
    </div>
  );
}

function DeadlineRow({ deadline }: { deadline: CaseDeadline }) {
  const f = useLexFormat();
  const tone =
    deadline.risk === 'overdue'
      ? 'border-error-100 bg-error-50 text-error-600'
      : deadline.risk === 'urgent'
        ? 'border-warning-100 bg-warning-50 text-warning-700 dark:text-warning-300'
        : deadline.risk === 'soon'
          ? 'border-warning-100 bg-warning-50 text-warning-700 dark:text-warning-300'
          : 'border-border bg-card/60 text-foreground';

  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5', tone)}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{deadline.title}</p>
        <p className="mt-0.5 text-xs opacity-75">{deadline.kind}</p>
      </div>
      <div className="shrink-0 text-end text-xs font-medium">
        {f.formatRelative(deadline.date)}
      </div>
    </div>
  );
}
