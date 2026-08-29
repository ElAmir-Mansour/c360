/**
 * Feature #14 — contract TEXT search UI for the contracts list page
 * (`/lex/contracts`). Two presentational components over the data hook in
 * `../_lib/use-contract-text-search.ts`:
 *
 *   1. {@link ContractSearchModeToggle} — the compact Metadata | Contract text
 *      pill mounted BESIDE the existing SearchInput. Metadata mode leaves the
 *      pre-existing list search untouched; text mode swaps the input over to
 *      the debounced full-text query.
 *
 *   2. {@link ContractTextSearchPanel} — the results panel rendered under the
 *      toolbar while text mode is active: matching contracts (grouped from the
 *      document hits) with highlighted `ts_headline` snippets, an "Open
 *      contract" link per group, and an "In current view" chip when the
 *      contract is on the visible table page (those rows also get the
 *      client-side highlight applied by the page). Loading / empty / error /
 *      below-min-length states included.
 *
 * Snippets re-use `tokenizeSnippet` from the documents workspace so the raw
 * server string is NEVER injected as HTML — `<mark>` markers are parsed into
 * plain-text tokens and re-rendered through styled elements. Snippet and title
 * text get `dir="auto"` so Arabic document bodies lay out correctly inside
 * either UI direction; layout uses logical properties throughout.
 *
 * Fully bilingual via the canonical lex `LexBilingual<T>` token-record
 * contract; counts format through `useLexFormat` (Arabic-Indic digits under
 * `ar`). Read-only — nothing here mutates, so no `canWrite` gating applies.
 */

'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { FileSearch, FileText, SearchX, TextCursorInput } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { LexContract } from '@/types/suites';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import { tokenizeSnippet } from '../../documents/_lib/documents-helpers';
import {
  type ContractSearchMode,
  type ContractTextSearchGroup,
  type ContractTextSearchResult,
  TEXT_SEARCH_MIN_QUERY_LENGTH,
} from '../_lib/use-contract-text-search';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical lex token-record contract).
 * ------------------------------------------------------------------------- */

export interface ContractTextSearchLabels {
  /** Search-mode pill. */
  modeGroup: string;
  modeMetadata: string;
  modeText: string;
  /** Placeholder for the text-mode search input. */
  placeholder: string;
  panelTitle: string;
  /** Result count line. Receives PRE-FORMATTED counts. */
  resultCount: (count: string) => string;
  /** Prompt shown before anything is typed. */
  prompt: string;
  /** Hint while the query is below the minimum length. */
  minLengthHint: (min: string) => string;
  searching: string;
  emptyTitle: string;
  emptyDescription: string;
  loadError: string;
  retry: string;
  openContract: string;
  /** Chip on groups whose contract is on the visible table page. */
  inCurrentView: string;
  /** Group heading fallback when the linked contract is not on this page. */
  linkedContract: string;
  /** Heading of the bucket for matches without a linked contract. */
  unlinkedHeading: string;
  /** Note when the server holds more matches than the fetched page. */
  truncated: (shown: string, total: string) => string;
}

export const contractTextSearchLabels: LexBilingual<ContractTextSearchLabels> = {
  en: {
    modeGroup: 'Search mode',
    modeMetadata: 'Metadata',
    modeText: 'Contract text',
    placeholder: 'Search inside contract documents…',
    panelTitle: 'Contract text matches',
    resultCount: (count) => `${count} match${count === '1' ? '' : 'es'}`,
    prompt: 'Search the full text of contract documents — clauses, terms, and scanned bodies.',
    minLengthHint: (min) => `Type at least ${min} characters to search contract text.`,
    searching: 'Searching contract text…',
    emptyTitle: 'No text matches',
    emptyDescription: 'No contract document matched this text. Try different terms.',
    loadError: 'Unable to search contract text.',
    retry: 'Retry',
    openContract: 'Open contract',
    inCurrentView: 'In current view',
    linkedContract: 'Linked contract',
    unlinkedHeading: 'Document matches without a linked contract',
    truncated: (shown, total) => `Showing the top ${shown} of ${total} matches — refine the query to narrow down.`,
  },
  ar: {
    modeGroup: 'وضع البحث',
    modeMetadata: 'البيانات الوصفية',
    modeText: 'نص العقد',
    placeholder: 'ابحث داخل مستندات العقود…',
    panelTitle: 'نتائج البحث في نص العقود',
    resultCount: (count) => `${count} نتيجة`,
    prompt: 'ابحث في النص الكامل لمستندات العقود — البنود والشروط والنصوص الممسوحة ضوئيًا.',
    minLengthHint: (min) => `اكتب ${min} أحرف على الأقل للبحث في نص العقود.`,
    searching: 'جارٍ البحث في نص العقود…',
    emptyTitle: 'لا توجد نتائج نصية',
    emptyDescription: 'لم يطابق هذا النص أي مستند عقد. جرّب مصطلحات أخرى.',
    loadError: 'تعذّر البحث في نص العقود.',
    retry: 'إعادة المحاولة',
    openContract: 'فتح العقد',
    inCurrentView: 'ضمن العرض الحالي',
    linkedContract: 'عقد مرتبط',
    unlinkedHeading: 'نتائج مستندات غير مرتبطة بعقد',
    truncated: (shown, total) => `يتم عرض أفضل ${shown} من أصل ${total} نتيجة — ضيّق نطاق البحث لتقليلها.`,
  },
};

export function useContractTextSearchLabels(): ContractTextSearchLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractTextSearchLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Mode toggle (Metadata | Contract text) — sits beside the SearchInput.
 * ------------------------------------------------------------------------- */

export function ContractSearchModeToggle({
  mode,
  onModeChange,
  className,
}: {
  mode: ContractSearchMode;
  onModeChange: (mode: ContractSearchMode) => void;
  className?: string;
}) {
  const labels = useContractTextSearchLabels();
  const options: Array<{ value: ContractSearchMode; label: string }> = [
    { value: 'metadata', label: labels.modeMetadata },
    { value: 'text', label: labels.modeText },
  ];
  return (
    <div
      role="group"
      aria-label={labels.modeGroup}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onModeChange(option.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.value === 'text' ? (
              <TextCursorInput className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Snippet — safe rendering of the `ts_headline` string.
 * ------------------------------------------------------------------------- */

function TextSearchSnippet({ snippet }: { snippet: string }) {
  const tokens = tokenizeSnippet(snippet);
  if (tokens.length === 0) return null;
  return (
    <p dir="auto" className="text-xs leading-relaxed text-muted-foreground">
      {tokens.map((token, index) =>
        token.highlighted ? (
          <mark
            key={index}
            className="rounded bg-yellow-100 px-0.5 font-medium text-foreground dark:bg-yellow-900/40"
          >
            {token.text}
          </mark>
        ) : (
          <span key={index}>{token.text}</span>
        ),
      )}
    </p>
  );
}

/* ------------------------------------------------------------------------- *
 * Results panel.
 * ------------------------------------------------------------------------- */

function TextSearchGroupCard({
  group,
  contract,
  labels,
}: {
  group: ContractTextSearchGroup;
  contract?: LexContract;
  labels: ContractTextSearchLabels;
}) {
  const unlinked = group.contractId === null;
  return (
    <li className="rounded-lg border border-border/70 bg-background/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileSearch className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span dir="auto" className={cn('text-sm font-medium', unlinked && 'text-muted-foreground')}>
          {unlinked
            ? labels.unlinkedHeading
            : (contract?.title ?? labels.linkedContract)}
        </span>
        {contract ? (
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {labels.inCurrentView}
          </span>
        ) : null}
        {group.contractId ? (
          <Link
            href={`/lex/contracts/${group.contractId}`}
            className="ms-auto text-xs font-medium text-primary hover:underline"
          >
            {labels.openContract}
          </Link>
        ) : null}
      </div>
      <ul className="mt-2 space-y-2 border-s-2 border-border/60 ps-3">
        {group.hits.map((hit) => (
          <li key={hit.id} className="space-y-0.5">
            <p dir="auto" className="text-xs font-medium text-foreground">
              {hit.title}
            </p>
            <TextSearchSnippet snippet={hit.snippet} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Results panel for text mode. Purely presentational: the page owns the hook
 * (`useContractTextSearch`) so it can also derive the table row highlight from
 * the same fetch, and hands the result object down here.
 */
export function ContractTextSearchPanel({
  result,
  contractsById,
  className,
}: {
  result: ContractTextSearchResult;
  /** Visible table rows keyed by id — the "in current view" join. */
  contractsById: ReadonlyMap<string, LexContract>;
  className?: string;
}) {
  const labels = useContractTextSearchLabels();
  const f = useLexFormat();

  let body: React.ReactNode;
  if (result.belowMinLength) {
    body = (
      <p className="text-sm text-muted-foreground">
        {labels.minLengthHint(f.formatNumber(TEXT_SEARCH_MIN_QUERY_LENGTH))}
      </p>
    );
  } else if (result.query.length === 0) {
    body = <p className="text-sm text-muted-foreground">{labels.prompt}</p>;
  } else if (result.isError) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-destructive">{labels.loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={result.retry}>
          {labels.retry}
        </Button>
      </div>
    );
  } else if (result.isSearching && result.hits.length === 0) {
    body = <LoadingSkeleton variant="list" count={3} label={labels.searching} />;
  } else if (result.isSettled && result.groups.length === 0) {
    body = (
      <div className="flex items-start gap-3">
        <SearchX className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">{labels.emptyTitle}</p>
          <p className="text-xs text-muted-foreground">{labels.emptyDescription}</p>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        <ul className="space-y-3">
          {result.groups.map((group) => (
            <TextSearchGroupCard
              key={group.contractId ?? 'unlinked'}
              group={group}
              contract={group.contractId ? contractsById.get(group.contractId) : undefined}
              labels={labels}
            />
          ))}
        </ul>
        {result.total > result.hits.length ? (
          <p className="text-xs text-muted-foreground">
            {labels.truncated(f.formatNumber(result.hits.length), f.formatNumber(result.total))}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section
      role="region"
      aria-label={labels.panelTitle}
      className={cn('rounded-xl border border-border bg-card/60 p-4', className)}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{labels.panelTitle}</h3>
        <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
          {result.isSettled ? labels.resultCount(f.formatNumber(result.total)) : null}
        </span>
      </div>
      {body}
    </section>
  );
}
