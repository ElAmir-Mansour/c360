/**
 * Feature #11 — entity facet + rollup surfaces for the contracts list page
 * (`/lex/contracts`). Two read-only components fed by the NEW
 * GET /contracts/entity-rollup endpoint via `useEntityRollup`:
 *
 *   1. {@link ContractsEntityRollupPanel} — per-legal-entity subtotals
 *      (contract count + total value per currency) over the CURRENT table
 *      scope, with click-to-filter: selecting a bucket applies/toggles the
 *      `org_entity_id` list filter through the page's `setFilter`.
 *
 *   2. {@link ContractsPortfolioTcvFooter} — a one-line portfolio
 *      total-contract-value summary mounted under the table, fed by the SAME
 *      rollup query (identical query key ⇒ TanStack dedupes to one request).
 *
 * Both are fully bilingual (English + MSA) following the canonical lex
 * `LexBilingual<T> = { en, ar }` token-record contract, format money/counts
 * through `useLexFormat` (SAR-first, Arabic-Indic digits under `ar`), and use
 * logical properties (ms-/me-/text-start/text-end) so RTL lays out correctly.
 * No mutation surface — nothing to RBAC-gate beyond the page's own view gate.
 */

'use client';

import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import {
  type ContractEntityRollupRow,
  orgEntityDisplayName,
  sumRollupValueByCurrency,
  useEntityRollup,
} from '../_lib/use-entity-rollup';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical lex token-record contract).
 * ------------------------------------------------------------------------- */

export interface EntityRollupLabels {
  /** 'Legal entity' — the list filter facet label (consumed by page.tsx). */
  facetLabel: string;
  panelTitle: string;
  panelDescription: string;
  /** Bucket for contracts without an org-entity link. */
  unassigned: string;
  /** Count line under each bucket. Receives a PRE-FORMATTED count string. */
  contractsCount: (count: string) => string;
  /** aria-label for a clickable bucket row. */
  filterByEntity: (name: string) => string;
  /** aria-label for the active bucket row (clicking clears the filter). */
  clearEntityFilter: (name: string) => string;
  /** Value placeholder when a bucket has no disclosed values. */
  noValue: string;
  loadError: string;
  emptyTitle: string;
  emptyDescription: string;
  /** Footer lead-in ('Portfolio TCV'). */
  footerLead: string;
  /** Footer trailing scope note. Receives a PRE-FORMATTED count string. */
  footerContracts: (count: string) => string;
}

export const contractsEntityRollupLabels: LexBilingual<EntityRollupLabels> = {
  en: {
    facetLabel: 'Legal entity',
    panelTitle: 'By legal entity',
    panelDescription:
      'Contract count and value per legal entity in the current scope. Select an entity to filter the table.',
    unassigned: 'No entity assigned',
    contractsCount: (count) => `${count} contract${count === '1' ? '' : 's'}`,
    filterByEntity: (name) => `Filter contracts by ${name}`,
    clearEntityFilter: (name) => `Clear the ${name} entity filter`,
    noValue: 'Undisclosed',
    loadError: 'Unable to load the entity rollup.',
    emptyTitle: 'No contracts in scope',
    emptyDescription: 'No contracts matched the current filters.',
    footerLead: 'Portfolio TCV',
    footerContracts: (count) => `across ${count} contract${count === '1' ? '' : 's'}`,
  },
  ar: {
    facetLabel: 'الكيان القانوني',
    panelTitle: 'حسب الكيان القانوني',
    panelDescription:
      'عدد العقود وقيمتها لكل كيان قانوني ضمن النطاق الحالي. اختر كيانًا لتصفية الجدول.',
    unassigned: 'بدون كيان مرتبط',
    contractsCount: (count) => `${count} عقد`,
    filterByEntity: (name) => `تصفية العقود حسب ${name}`,
    clearEntityFilter: (name) => `إزالة تصفية الكيان ${name}`,
    noValue: 'غير مُفصح عنها',
    loadError: 'تعذّر تحميل ملخص الكيانات.',
    emptyTitle: 'لا توجد عقود ضمن النطاق',
    emptyDescription: 'لا توجد عقود مطابقة للمرشّحات الحالية.',
    footerLead: 'إجمالي قيمة المحفظة',
    footerContracts: (count) => `عبر ${count} عقد`,
  },
};

export function useEntityRollupLabels(): EntityRollupLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractsEntityRollupLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Shared value-line formatting.
 * ------------------------------------------------------------------------- */

/**
 * Format a per-currency subtotal map into a single ' · '-joined line (SAR
 * first). Returns `undefined` when nothing is disclosed so callers can fall
 * back to the bilingual placeholder.
 */
function useValueLine() {
  const f = useLexFormat();
  return (byCurrency: Record<string, number> | undefined): string | undefined => {
    const parts = sumRollupValueByCurrency(
      byCurrency ? [{ count: 0, total_value_by_currency: byCurrency }] : undefined,
    )
      .filter(({ amount }) => amount > 0)
      .map(({ currency, amount }) =>
        f.formatCurrency(amount, { currency, maximumFractionDigits: 0 }),
      );
    return parts.length > 0 ? parts.join(' · ') : undefined;
  };
}

/* ------------------------------------------------------------------------- *
 * 1. ContractsEntityRollupPanel — per-entity subtotals with click-to-filter.
 * ------------------------------------------------------------------------- */

export interface ContractsEntityRollupPanelProps {
  /** `activeFilters` from `useDataTable` — the scope the rollup mirrors. */
  filters: Record<string, string | string[]>;
  /** `searchValue` from `useDataTable`. */
  search?: string;
  /** Currently applied `org_entity_id` filter (highlights that bucket). */
  activeEntityId?: string;
  /**
   * Click-to-filter hand-off. The integrator wires this to
   * `setFilter('org_entity_id', id)` — `undefined` clears the facet (fired
   * when the operator re-selects the active bucket).
   */
  onSelectEntity: (entityId: string | undefined) => void;
  className?: string;
}

/**
 * Per-entity rollup panel. NOT a table rewrite: a compact card listing each
 * entity bucket with its contract count and per-currency value subtotal.
 * The unassigned bucket renders non-interactive (the list endpoint has no
 * "unassigned-only" filter). Errors render a quiet inline notice rather than
 * unmounting, so the workspace layout stays stable.
 */
export function ContractsEntityRollupPanel({
  filters,
  search,
  activeEntityId,
  onSelectEntity,
  className,
}: ContractsEntityRollupPanelProps) {
  const labels = useEntityRollupLabels();
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const valueLine = useValueLine();
  const { data, isLoading, isError } = useEntityRollup({ filters, search });

  const items = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => b.count - a.count),
    [data?.items],
  );

  const rowName = (row: ContractEntityRollupRow): string =>
    row.entity_id
      ? orgEntityDisplayName(
          { id: row.entity_id, code: row.entity_code ?? '', name: row.entity_name ?? { en: '', ar: '' } },
          locale,
        )
      : labels.unassigned;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-brand-accent" aria-hidden="true" />
          {labels.panelTitle}
        </CardTitle>
        <CardDescription>{labels.panelDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton.List rows={3} role="status" aria-label={labels.panelTitle} />
        ) : isError ? (
          <p className="text-sm text-muted-foreground" role="status">
            {labels.loadError}
          </p>
        ) : items.length === 0 ? (
          <div className="py-2">
            <p className="text-sm font-medium text-foreground">{labels.emptyTitle}</p>
            <p className="text-sm text-muted-foreground">{labels.emptyDescription}</p>
          </div>
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pe-1" role="list">
            {items.map((row) => {
              const name = rowName(row);
              const isActive = Boolean(row.entity_id) && row.entity_id === activeEntityId;
              const value = valueLine(row.total_value_by_currency);
              const body = (
                <>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {name}
                    </span>
                    {row.entity_code ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.entity_code}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block text-sm font-semibold tabular-nums text-foreground">
                      {labels.contractsCount(f.formatNumber(row.count))}
                    </span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {value ?? labels.noValue}
                    </span>
                  </span>
                </>
              );
              if (!row.entity_id) {
                return (
                  <li
                    key="unassigned"
                    className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-2"
                  >
                    {body}
                  </li>
                );
              }
              return (
                <li key={row.entity_id}>
                  <button
                    type="button"
                    onClick={() => onSelectEntity(isActive ? undefined : row.entity_id ?? undefined)}
                    aria-pressed={isActive}
                    aria-label={
                      isActive ? labels.clearEntityFilter(name) : labels.filterByEntity(name)
                    }
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-start transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'border-brand-accent/45 bg-brand-accent/12'
                        : 'border-border bg-muted/30 hover:border-brand-accent/25 hover:bg-brand-accent/[0.06]',
                    )}
                  >
                    {body}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------------- *
 * 2. ContractsPortfolioTcvFooter — one-line portfolio TCV under the table.
 * ------------------------------------------------------------------------- */

export interface ContractsPortfolioTcvFooterProps {
  /** Same scope props as the panel — identical query key, one shared fetch. */
  filters: Record<string, string | string[]>;
  search?: string;
  className?: string;
}

/**
 * Portfolio total-contract-value footer line: per-currency totals summed
 * across every rollup bucket (SAR first) plus the in-scope contract count.
 * Renders nothing while loading, on error, or when the scope is empty — a
 * footer should never add layout noise it cannot substantiate.
 */
export function ContractsPortfolioTcvFooter({
  filters,
  search,
  className,
}: ContractsPortfolioTcvFooterProps) {
  const labels = useEntityRollupLabels();
  const f = useLexFormat();
  const { data, isLoading, isError } = useEntityRollup({ filters, search });

  const totals = useMemo(() => sumRollupValueByCurrency(data?.items), [data?.items]);

  if (isLoading || isError || !data || data.total === 0) {
    return null;
  }

  const valueText =
    totals.length > 0
      ? totals
          .map(({ currency, amount }) =>
            f.formatCurrency(amount, { currency, maximumFractionDigits: 0 }),
          )
          .join(' · ')
      : labels.noValue;

  return (
    <p
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-3 text-sm',
        className,
      )}
      role="status"
    >
      <span className="font-medium text-muted-foreground">{labels.footerLead}</span>
      <span className="font-semibold tabular-nums text-foreground">{valueText}</span>
      <span className="text-xs text-muted-foreground">
        {labels.footerContracts(f.formatNumber(data.total))}
      </span>
    </p>
  );
}
