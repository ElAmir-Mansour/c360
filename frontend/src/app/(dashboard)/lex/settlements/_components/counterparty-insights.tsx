/**
 * FEATURE 13 — Counterparty conflict-check + cross-settlement history.
 *
 * Mounts inside the detail page's "Counterparty" SectionCard (after the
 * encrypted counterparty metadata rows). It gives the legal team two
 * counterparty-scoped lenses:
 *
 *   (a) Conflict check — a button that runs the shared lex matter
 *       conflict-check engine (`enterpriseApi.lex.checkMatterConflict`) seeded
 *       from THIS settlement (title / counterparty / terms) and renders the
 *       `conflicts[]` / `warnings[]` result, mirroring the matters surface.
 *
 *   (b) Cross-settlement history — every OTHER settlement involving the same
 *       counterparty (matched by a name search), each linking to its detail
 *       page with status + value, so the user can see prior dealings with the
 *       same طرف مقابل before agreeing terms.
 *
 * Self-contained bilingual labels (EN + MSA) following the canonical lex
 * `LexBilingual<T>` contract. Guards gracefully when the settlement has no
 * counterparty name on file.
 */

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, History, ScanSearch, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { showApiError } from '@/lib/toast';
import { enterpriseApi } from '@/lib/enterprise';
import type {
  LexMatterConflictCheckResult,
  LexMatterConflictIssue,
} from '@/types/suites';
import {
  formatSettlementValue,
  settlementsApi,
  type Settlement,
} from '@/lib/lex/settlements';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import {
  settlementMethodLabel,
  settlementStatusLabel,
  useSettlementLabels,
} from './labels';

// ---------------------------------------------------------------------------
// Self-contained bilingual labels (EN + professional MSA).
// Legal glossary: تسوية / مفاوضة / تحكيم / وساطة / مصالحة / اعتماد / طرف مقابل.
// ---------------------------------------------------------------------------

interface CounterpartyInsightsLabels {
  title: string;
  description: string;
  noCounterpartyTitle: string;
  noCounterpartyDescription: string;
  conflict: {
    heading: string;
    description: string;
    run: string;
    running: string;
    inProgressTitle: string;
    inProgressDescription: string;
    emptyTitle: string;
    emptyDescription: string;
    resultTitle: string;
    checkedAt: string;
    conflicts: string;
    warnings: string;
    potentialMatch: string;
    conflictSeverity: string;
    warningSeverity: string;
    noIssues: string;
  };
  history: {
    heading: string;
    description: (counterparty: string) => string;
    loading: string;
    error: string;
    emptyTitle: string;
    emptyDescription: (counterparty: string) => string;
    countLabel: (n: number) => string;
    view: string;
    noValue: string;
  };
}

const insightsLabels: LexBilingual<CounterpartyInsightsLabels> = {
  en: {
    title: 'Counterparty insights',
    description: 'Conflict-of-interest screening and prior settlements with this counterparty.',
    noCounterpartyTitle: 'No counterparty on file',
    noCounterpartyDescription:
      'Record a counterparty name to run a conflict check and surface prior settlements.',
    conflict: {
      heading: 'Conflict check',
      description: 'Screen this counterparty and terms against existing matters and contracts.',
      run: 'Run conflict check',
      running: 'Checking…',
      inProgressTitle: 'Running conflict check…',
      inProgressDescription: 'Screening matters and contracts for overlaps.',
      emptyTitle: 'No check run yet',
      emptyDescription: 'Run a conflict check to screen for related matters and contracts.',
      resultTitle: 'Conflict screening result',
      checkedAt: 'Checked',
      conflicts: 'conflicts',
      warnings: 'warnings',
      potentialMatch: 'Potential match',
      conflictSeverity: 'Conflict',
      warningSeverity: 'Warning',
      noIssues: 'No conflicts or warnings were found.',
    },
    history: {
      heading: 'Other settlements with this counterparty',
      description: (counterparty) => `Prior reconciliation and ADR attempts involving ${counterparty}.`,
      loading: 'Loading prior settlements…',
      error: 'Failed to load prior settlements.',
      emptyTitle: 'No other settlements',
      emptyDescription: (counterparty) => `This is the only settlement on record with ${counterparty}.`,
      countLabel: (n) => `${n} other`,
      view: 'View',
      noValue: 'No value',
    },
  },
  ar: {
    title: 'رؤى الطرف المقابل',
    description: 'فحص تعارض المصالح والتسويات السابقة مع هذا الطرف المقابل.',
    noCounterpartyTitle: 'لا يوجد طرف مقابل مسجّل',
    noCounterpartyDescription:
      'سجّل اسم الطرف المقابل لإجراء فحص التعارض وإظهار التسويات السابقة.',
    conflict: {
      heading: 'فحص التعارض',
      description: 'افحص هذا الطرف المقابل والبنود مقابل القضايا والعقود القائمة.',
      run: 'تشغيل فحص التعارض',
      running: 'جارٍ الفحص…',
      inProgressTitle: 'جارٍ تشغيل فحص التعارض…',
      inProgressDescription: 'فحص القضايا والعقود بحثًا عن تداخلات.',
      emptyTitle: 'لم يُجرَ فحص بعد',
      emptyDescription: 'شغّل فحص التعارض للكشف عن القضايا والعقود ذات الصلة.',
      resultTitle: 'نتيجة فحص التعارض',
      checkedAt: 'فُحص في',
      conflicts: 'تعارضات',
      warnings: 'تحذيرات',
      potentialMatch: 'تطابق محتمل',
      conflictSeverity: 'تعارض',
      warningSeverity: 'تحذير',
      noIssues: 'لم يُعثر على أي تعارضات أو تحذيرات.',
    },
    history: {
      heading: 'تسويات أخرى مع هذا الطرف المقابل',
      description: (counterparty) => `محاولات الصلح والحل البديل السابقة المتعلقة بـ ${counterparty}.`,
      loading: 'جارٍ تحميل التسويات السابقة…',
      error: 'تعذّر تحميل التسويات السابقة.',
      emptyTitle: 'لا توجد تسويات أخرى',
      emptyDescription: (counterparty) => `هذه هي التسوية الوحيدة المسجّلة مع ${counterparty}.`,
      countLabel: (n) => `${n} أخرى`,
      view: 'عرض',
      noValue: 'لا توجد قيمة',
    },
  },
};

function resolveCounterpartyInsightsLabels(
  locale: AppLocale = 'en',
): CounterpartyInsightsLabels {
  return resolveLexBilingual(insightsLabels, locale);
}

function useCounterpartyInsightsLabels(): CounterpartyInsightsLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCounterpartyInsightsLabels(locale), [locale]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CounterpartyInsightsProps {
  settlement: Settlement;
  canWrite: boolean;
}

export function CounterpartyInsights({ settlement, canWrite }: CounterpartyInsightsProps) {
  const L = useCounterpartyInsightsLabels();
  const settlementLabels = useSettlementLabels();
  const counterparty = (settlement.counterparty_name ?? '').trim();
  const hasCounterparty = counterparty.length > 0;

  // (a) Conflict check — button-triggered, seeded from this settlement.
  const conflictMutation = useMutation<LexMatterConflictCheckResult>({
    mutationFn: () =>
      enterpriseApi.lex.checkMatterConflict({
        title: settlement.title,
        counterparty,
        description: settlement.terms,
      }),
    onError: (error) => showApiError(error),
  });

  // (b) Cross-settlement history — other settlements with the same counterparty.
  const historyQuery = useQuery({
    queryKey: ['lex-settlements', 'counterparty-history', counterparty],
    enabled: hasCounterparty,
    queryFn: () =>
      settlementsApi.list({
        page: 1,
        per_page: 20,
        search: counterparty,
        sort: 'updated_at',
        order: 'desc',
      }),
  });

  const relatedSettlements = useMemo(() => {
    const rows = historyQuery.data?.data ?? [];
    return rows.filter(
      (row) =>
        row.id !== settlement.id &&
        (row.counterparty_name ?? '').trim().toLowerCase() === counterparty.toLowerCase(),
    );
  }, [historyQuery.data, settlement.id, counterparty]);

  if (!hasCounterparty) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <div className="flex items-start gap-3">
          <ScanSearch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">{L.noCounterpartyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{L.noCounterpartyDescription}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <p className="text-sm font-semibold">{L.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{L.description}</p>
      </div>

      {/* (a) Conflict check */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{L.conflict.heading}</p>
            <p className="text-xs text-muted-foreground">{L.conflict.description}</p>
          </div>
          {canWrite ? (
            <Button
              size="sm"
              variant="outline"
              disabled={conflictMutation.isPending}
              onClick={() => conflictMutation.mutate()}
            >
              <ScanSearch className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {conflictMutation.isPending ? L.conflict.running : L.conflict.run}
            </Button>
          ) : null}
        </div>
        <ConflictResult
          labels={L}
          loading={conflictMutation.isPending}
          result={conflictMutation.data ?? null}
        />
      </section>

      {/* (b) Cross-settlement history */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{L.history.heading}</p>
          </div>
          {relatedSettlements.length > 0 ? (
            <Badge variant="outline">{L.history.countLabel(relatedSettlements.length)}</Badge>
          ) : null}
        </div>

        {historyQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">{L.history.loading}</p>
        ) : historyQuery.isError ? (
          <p className="text-sm text-destructive">{L.history.error}</p>
        ) : relatedSettlements.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">{L.history.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {L.history.emptyDescription(counterparty)}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {relatedSettlements.map((row) => (
              <Link
                key={row.id}
                href={`/lex/settlements/${row.id}`}
                className="block rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">{row.title}</p>
                  <Badge variant="outline">
                    {settlementStatusLabel(settlementLabels, row.status)}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{settlementMethodLabel(settlementLabels, row.method)}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {row.value === null || row.value === undefined
                      ? L.history.noValue
                      : formatSettlementValue(row.value, row.currency)}
                  </span>
                  {row.reference ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="font-mono">{row.reference}</span>
                    </>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict result renderer — mirrors the matters-surface MatterConflictResult.
// ---------------------------------------------------------------------------

function ConflictResult({
  labels,
  loading,
  result,
}: {
  labels: CounterpartyInsightsLabels;
  loading: boolean;
  result: LexMatterConflictCheckResult | null;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2">
          <ScanSearch className="h-4 w-4 animate-pulse text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">{labels.conflict.inProgressTitle}</p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{labels.conflict.inProgressDescription}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <p className="text-sm font-medium">{labels.conflict.emptyTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{labels.conflict.emptyDescription}</p>
      </div>
    );
  }

  const issues: LexMatterConflictIssue[] = [...result.conflicts, ...result.warnings];
  const hasConflicts = result.conflicts.length > 0;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {hasConflicts ? (
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
          ) : (
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          )}
          <div>
            <p className="text-sm font-medium">{labels.conflict.resultTitle}</p>
            <p className="text-xs text-muted-foreground">
              {labels.conflict.checkedAt} {formatDateTime(result.checked_at)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Badge variant={hasConflicts ? 'destructive' : 'outline'}>
            {result.conflicts.length} {labels.conflict.conflicts}
          </Badge>
          <Badge variant={result.warnings.length > 0 ? 'warning' : 'outline'}>
            {result.warnings.length} {labels.conflict.warnings}
          </Badge>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {issues.length > 0 ? (
          issues.map((issue, index) => (
            <div
              key={`${issue.severity}-${issue.matter_id ?? issue.contract_id ?? index}`}
              className="rounded-md border px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium">
                  {issue.matter_title ?? issue.contract_title ?? labels.conflict.potentialMatch}
                </p>
                <Badge variant={issue.severity === 'conflict' ? 'destructive' : 'warning'}>
                  {issue.severity === 'conflict'
                    ? labels.conflict.conflictSeverity
                    : labels.conflict.warningSeverity}
                </Badge>
              </div>
              {issue.reasons.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">{issue.reasons.join('، ')}</p>
              ) : null}
              {issue.matched_terms?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {issue.matched_terms.map((term) => (
                    <Badge key={term} variant="outline">
                      {term}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{labels.conflict.noIssues}</p>
        )}
      </div>
    </div>
  );
}
