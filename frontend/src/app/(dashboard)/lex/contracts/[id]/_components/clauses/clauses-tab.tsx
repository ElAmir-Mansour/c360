'use client';

/**
 * CAP-107 — Clause-by-clause review · "Clauses" tab.
 *
 * Master/detail layout: a left list rail of the contract's clauses (risk +
 * review-status at a glance) with single-selection, and a right-hand
 * <ClauseReviewPanel/> for the selected clause. Clause data comes from the
 * per-cap `useClauses` hook (GET …/clauses); the panel persists reviews via
 * PUT …/review with an optimistic cache update + invalidate.
 *
 * Reuses shared lex primitives (status-chip) + common empty/error/loading
 * states. Bilingual + RTL via the locale provider.
 */

import { useEffect, useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { LexStatusChip } from '@/components/lex/status-chip';
import { SectionCard } from '@/components/suites/section-card';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { titleCase } from '@/lib/format';
import { useClauseReviewStatusLabels } from '../../../_lib/contracts-labels';
import { resolveLexBilingual, type LexBilingual } from '../../../../_lib/lex-i18n';
import { useClauses } from './use-clauses';
import { ClauseReviewPanel } from './clause-review-panel';

interface ClausesTabProps {
  contractId: string;
}

export function ClausesTab({ contractId }: ClausesTabProps) {
  const { locale, direction } = useLocaleOrDefault();
  const t = useMemo(() => resolveLexBilingual(clausesTabLabels, locale), [locale]);
  const reviewStatusLabels = useClauseReviewStatusLabels();

  const clausesQuery = useClauses(contractId);
  const clauses = useMemo(() => clausesQuery.data ?? [], [clausesQuery.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep a valid selection: default to the first clause; recover if the
  // selected clause disappears after a refetch.
  useEffect(() => {
    if (clauses.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current && clauses.some((clause) => clause.id === current)
        ? current
        : clauses[0].id,
    );
  }, [clauses]);

  const selectedClause = useMemo(
    () => clauses.find((clause) => clause.id === selectedId) ?? null,
    [clauses, selectedId],
  );

  if (clausesQuery.isLoading) {
    return (
      <div dir={direction} lang={locale}>
        <SectionCard title={t.title} description={t.description}>
          <LoadingSkeleton variant="list-item" count={4} />
        </SectionCard>
      </div>
    );
  }

  if (clausesQuery.isError) {
    return (
      <div dir={direction} lang={locale}>
        <SectionCard title={t.title} description={t.description}>
          <ErrorState message={t.loadError} onRetry={() => void clausesQuery.refetch()} />
        </SectionCard>
      </div>
    );
  }

  if (clauses.length === 0) {
    return (
      <div dir={direction} lang={locale}>
        <SectionCard title={t.title} description={t.description}>
          <EmptyState icon={ListChecks} title={t.emptyTitle} description={t.emptyDescription} />
        </SectionCard>
      </div>
    );
  }

  return (
    <div
      dir={direction}
      lang={locale}
      className="grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1.15fr]"
    >
      {/* Left rail — clause list with selection. */}
      <SectionCard title={t.title} description={t.listDescription(clauses.length)}>
        <ul className="space-y-2" role="listbox" aria-label={t.title}>
          {clauses.map((clause) => {
            const active = clause.id === selectedId;
            return (
              <li key={clause.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => setSelectedId(clause.id)}
                  className={cn(
                    'w-full rounded-lg border px-4 py-3 text-start transition-colors',
                    active
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {clause.title || titleCase(clause.clause_type)}
                    </span>
                    <LexStatusChip
                      domain="generic"
                      value={clause.review_status}
                      labels={reviewStatusLabels}
                      size="sm"
                    />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{titleCase(clause.clause_type)}</span>
                    <span>{t.riskScorePrefix(clause.risk_score)}</span>
                    {clause.section_reference ? (
                      <span className="truncate">{clause.section_reference}</span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      {/* Right panel — review surface for the selected clause. */}
      {selectedClause ? (
        <ClauseReviewPanel contractId={contractId} clause={selectedClause} />
      ) : (
        <SectionCard title={t.panelTitle} description={t.panelEmptyDescription}>
          <EmptyState icon={ListChecks} title={t.selectTitle} description={t.selectDescription} />
        </SectionCard>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Self-contained bilingual labels (English + Modern Standard Arabic).
 * ------------------------------------------------------------------------- */

interface ClausesTabLabels {
  title: string;
  description: string;
  listDescription: (count: number) => string;
  riskScorePrefix: (score: number) => string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  panelTitle: string;
  panelEmptyDescription: string;
  selectTitle: string;
  selectDescription: string;
}

const clausesTabLabels: LexBilingual<ClausesTabLabels> = {
  en: {
    title: 'Clauses',
    description: 'Review each extracted clause, set its status, and capture notes.',
    listDescription: (count) => `${count} clause${count === 1 ? '' : 's'} extracted.`,
    riskScorePrefix: (score) => `Risk ${score}`,
    loadError: 'Failed to load contract clauses.',
    emptyTitle: 'No clauses extracted',
    emptyDescription: 'Run contract analysis to extract clauses for review.',
    panelTitle: 'Clause review',
    panelEmptyDescription: 'Select a clause from the list to review it.',
    selectTitle: 'No clause selected',
    selectDescription: 'Choose a clause from the list on the left.',
  },
  ar: {
    title: 'البنود',
    description: 'راجع كل بند مُستخرج، وحدّد حالته، وسجّل الملاحظات.',
    listDescription: (count) => `تم استخراج ${count} بند.`,
    riskScorePrefix: (score) => `المخاطر ${score}`,
    loadError: 'تعذّر تحميل بنود العقد.',
    emptyTitle: 'لا توجد بنود مُستخرجة',
    emptyDescription: 'شغّل تحليل العقد لاستخراج البنود للمراجعة.',
    panelTitle: 'مراجعة البند',
    panelEmptyDescription: 'اختر بندًا من القائمة لمراجعته.',
    selectTitle: 'لم يتم اختيار بند',
    selectDescription: 'اختر بندًا من القائمة على اليمين.',
  },
};
