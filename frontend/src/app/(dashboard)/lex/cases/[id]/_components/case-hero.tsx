'use client';

/**
 * Case hero band — a full-width `card` band carrying the litigation case's key
 * facts (case number, type, competent court, opened-on) plus unified status /
 * company-side / priority / strength chips, the record title and a short
 * summary, and the page's header-actions slot (toolbar nav + write actions).
 *
 * Mirrors the service-desk `RequestHero` gold standard: flat token card surface
 * (the shell owns the chrome), a localized chip row, a `dir="auto"` title
 * and summary, and a 4-tile icon+label+value fact grid. Fully bilingual + RTL
 * via logical classes and the co-located enum/label helpers.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock, Hash, Landmark, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LexStatusChip, LexPriorityChip } from '@/components/lex/status-chip';
import { useLexFormat } from '@/lib/lex/ksa';
import type { LegalCase } from '@/lib/lex/cases';
import { useCaseLabels } from '../../_components/labels';
import { useCaseCourtName } from '../../_components/case-court';
import { useCaseDetailExtraLabels } from './case-detail-labels';
import {
  useCaseTypeLabel,
  useCompanyStatusLabel,
  useStrengthLabel,
} from './case-enums-i18n';

export interface CaseHeroProps {
  legalCase: LegalCase;
  title: string;
  actions?: ReactNode;
}

export function CaseHero({ legalCase, title, actions }: CaseHeroProps) {
  const caseLabels = useCaseLabels();
  const t = useCaseDetailExtraLabels().hero;
  const f = useLexFormat();
  const companyStatusLabel = useCompanyStatusLabel();
  const strengthLabel = useStrengthLabel();
  const caseTypeLabel = useCaseTypeLabel();
  const courtName = useCaseCourtName();

  const facts: { key: string; icon: typeof Hash; label: string; value: string }[] = [
    {
      key: 'number',
      icon: Hash,
      label: t.facts.caseNumber,
      value: legalCase.case_number || t.notSet,
    },
    {
      key: 'type',
      icon: Scale,
      label: t.facts.caseType,
      value: caseTypeLabel(legalCase.case_type) || t.notSet,
    },
    {
      key: 'court',
      icon: Landmark,
      label: t.facts.court,
      // Reference court first, legacy free text second — never the retired
      // court number.
      value: courtName(legalCase) || t.notSet,
    },
    {
      key: 'opened',
      icon: CalendarClock,
      label: t.facts.opened,
      value: f.formatDual(legalCase.created_at),
    },
  ];

  return (
    <section className="card p-6 sm:p-7">
      <div className="flex flex-col gap-5">
        <Button variant="ghost" size="sm" asChild className="-ms-2 self-start">
          <Link href="/lex/cases">
            <ArrowRight className="me-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
            {t.backToList}
          </Link>
        </Button>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <LexStatusChip
                value={legalCase.status}
                domain="case"
                labels={caseLabels.filters.statusOptions}
                size="md"
              />
              <Badge
                variant={legalCase.company_status === 'plaintiff' ? 'success' : 'warning'}
                size="sm"
              >
                {companyStatusLabel(legalCase.company_status)}
              </Badge>
              <LexPriorityChip
                value={legalCase.priority}
                labels={caseLabels.filters.priorityOptions}
                size="md"
              />
              {legalCase.strength ? (
                <Badge
                  variant={legalCase.strength === 'strong' ? 'success' : 'destructive'}
                  size="sm"
                >
                  {strengthLabel(legalCase.strength)}
                </Badge>
              ) : null}
            </div>
            <h1
              className="text-h2 font-bold leading-tight tracking-tight text-foreground"
              dir="auto"
            >
              {title}
            </h1>
            {legalCase.description ? (
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground" dir="auto">
                {legalCase.description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {facts.map((fact) => {
            const Icon = fact.icon;
            return (
              <div
                key={fact.key}
                className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 shadow-elevation-1"
              >
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
                    {fact.label}
                  </dt>
                  <dd
                    className="truncate text-sm font-medium text-foreground"
                    dir="auto"
                    title={fact.value}
                  >
                    {fact.value}
                  </dd>
                </div>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
