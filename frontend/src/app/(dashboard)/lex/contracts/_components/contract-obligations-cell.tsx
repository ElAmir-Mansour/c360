/**
 * Feature 9a — per-row obligations column for the contracts list table.
 *
 * Renders the open / overdue obligation counts for one contract, backed by the
 * SINGLE batched obligations fetch shared through
 * `_lib/use-obligations-rollup.ts` (every cell dedupes onto the same TanStack
 * cache entry — no per-row requests).
 *
 * Bilingual (English + MSA) via the canonical lex `LexBilingual<T>` colocated
 * token-record contract (same idiom as `renewal-warnings-banner.tsx`), with
 * KSA digit shaping through `useLexFormat` (Arabic-Indic digits under `ar`).
 * Logical spacing props (me-/ms-) keep the chips RTL-safe.
 */

'use client';

import { useMemo } from 'react';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import { useContractObligationCounts } from '../_lib/use-obligations-rollup';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical lex token-record contract).
 * ------------------------------------------------------------------------- */

export interface ContractObligationsCellLabels {
  /** Table column header (consumed by the page's column def). */
  column: string;
  /** Open-count chip title / aria fragment. Pluralizes on the count. */
  open: (count: string) => string;
  /** Overdue-count chip title / aria fragment. */
  overdue: (count: string) => string;
  /** Full cell aria-label. */
  summary: (open: string, overdue: string) => string;
  /** Em-dash placeholder when the contract has no open obligations. */
  none: string;
}

export const contractObligationsCellLabels: LexBilingual<ContractObligationsCellLabels> = {
  en: {
    column: 'Obligations',
    open: (count) => `${count} open`,
    overdue: (count) => `${count} overdue`,
    summary: (open, overdue) => `${open} open obligations, ${overdue} overdue`,
    none: '—',
  },
  ar: {
    column: 'الالتزامات',
    open: (count) => `${count} مفتوح`,
    overdue: (count) => `${count} متأخر`,
    summary: (open, overdue) => `${open} التزامات مفتوحة، ${overdue} متأخرة`,
    none: '—',
  },
};

export function useContractObligationsCellLabels(): ContractObligationsCellLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractObligationsCellLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Cell.
 * ------------------------------------------------------------------------- */

export interface ContractObligationsCellProps {
  /** The contract row the cell belongs to. */
  contractId: string;
  /** Optional className passthrough. */
  className?: string;
}

/**
 * Open/overdue obligation counts for one contract row.
 *
 *   - loading  → slim skeleton (no layout shift)
 *   - error / zero open → muted em-dash
 *   - open > 0 → outline chip with the open count; when any are overdue an
 *     additional destructive-toned chip carries the overdue count.
 */
export function ContractObligationsCell({ contractId, className }: ContractObligationsCellProps) {
  const labels = useContractObligationsCellLabels();
  const f = useLexFormat();
  const { counts, isLoading, isError } = useContractObligationCounts(contractId);

  if (isLoading) {
    return <Skeleton className={cn('h-5 w-16', className)} aria-hidden="true" />;
  }

  if (isError || counts.open === 0) {
    return (
      <span className={cn('text-sm text-muted-foreground', className)}>{labels.none}</span>
    );
  }

  const openLabel = labels.open(f.formatNumber(counts.open));
  const overdueLabel = labels.overdue(f.formatNumber(counts.overdue));

  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      aria-label={labels.summary(f.formatNumber(counts.open), f.formatNumber(counts.overdue))}
    >
      <Badge variant="outline" className="shrink-0 tabular-nums" title={openLabel}>
        <ClipboardList className="me-1 h-3 w-3" aria-hidden="true" />
        {f.formatNumber(counts.open)}
      </Badge>
      {counts.overdue > 0 ? (
        <Badge
          variant="outline"
          className="shrink-0 border-destructive/40 bg-destructive/10 text-destructive tabular-nums"
          title={overdueLabel}
        >
          <AlertTriangle className="me-1 h-3 w-3" aria-hidden="true" />
          {overdueLabel}
        </Badge>
      ) : null}
    </div>
  );
}
