/**
 * Money-KPI strip for the contracts list workspace (`/lex/contracts`).
 *
 * Four read-only portfolio-value tiles that complement the existing COUNT
 * KPI row (total / active / expiring / high-risk) with MONEY figures:
 *
 *   1. Active portfolio value — exact, from the dashboard aggregate
 *      (`total_contract_value.by_currency`).
 *   2. Value expiring within 30 days,
 *   3. Value expiring within 60 days,
 *   4. Value pending signature — top-value list samples (see
 *      {@link ../_lib/use-portfolio-kpis!usePortfolioKpis} for the sampling
 *      contract; a truncated sample renders as a "≥" lower bound and the tile
 *      footer discloses the sampling window).
 *
 * SAR is the primary display currency (KSA layer, `formatCurrencyCompact`);
 * other currencies are NEVER summed into the headline — they surface as a
 * compact sub-line per tile. Each tile loads/errors independently so one
 * failed query never blanks the strip. Read-only: no mutations, so no
 * `canWrite` gating is required (the page-level `LexRouteGuard` already gates
 * viewing).
 *
 * Each tile is a TOGGLE over the register, not a link: `onSelectView` hands the
 * tile's slice (filters + ordering, see `_lib/contract-view-specs`) to the list
 * page, which narrows in place and hands back `activeFilters`/`sort` so the
 * clicked tile — and only it — reads as pressed. Ordering is part of a slice's
 * identity precisely because "Value pending signature" and the count tile "Out
 * for signature" cover the same rows; without it, clicking one would light up
 * the other. Rendered without `onSelectView` the tiles degrade to links.
 *
 * Bilingual (English + MSA) via the canonical lex `LexBilingual<T>` contract;
 * layout is RTL-safe (grid + logical text alignment only).
 */

'use client';

import { useMemo } from 'react';
import {
  Banknote,
  CalendarClock,
  CalendarRange,
  FileSignature,
  type LucideIcon,
} from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat, type LexFormatter } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import {
  PRIMARY_CURRENCY,
  usePortfolioKpis,
  type MoneyBucket,
  type MoneySplit,
} from '../_lib/use-portfolio-kpis';
import {
  CONTRACT_MONEY_VIEWS,
  contractViewHref,
  isContractViewActive,
  type ContractSortSpec,
  type ContractViewSpec,
} from '../_lib/contract-view-specs';
import { ContractKpiTile, type ContractKpiTheme } from './contracts-kpi-tile';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical lex token-record contract).
 * ------------------------------------------------------------------------- */

export interface ContractMoneyKpisLabels {
  /** Accessible name for the whole strip. */
  stripLabel: string;
  portfolio: { title: string; description: string; countLabel: string };
  expiring30: { title: string; description: string };
  expiring60: { title: string; description: string };
  pendingSignature: { title: string; description: string };
  /** Footer start-label when the bucket sample is complete. */
  contractsCount: string;
  /** Footer start-label when the bucket was truncated to the top-N sample. */
  topByValue: (sampled: number) => string;
  /** Title/aria hint on the non-SAR currencies sub-line. */
  otherCurrencies: string;
  /** Overflow marker when more currencies exist than the sub-line shows. */
  moreCurrencies: (count: number) => string;
}

export const contractMoneyKpisLabels: LexBilingual<ContractMoneyKpisLabels> = {
  en: {
    stripLabel: 'Portfolio value',
    portfolio: {
      title: 'Active portfolio value',
      description: 'Sum of active contract values across the portfolio.',
      countLabel: 'Active contracts',
    },
    expiring30: {
      title: 'Value expiring in 30 days',
      description: 'Active contract value with expiry inside 30 days.',
    },
    expiring60: {
      title: 'Value expiring in 60 days',
      description: 'Active contract value with expiry inside 60 days.',
    },
    pendingSignature: {
      title: 'Value pending signature',
      description: 'Contract value awaiting signature execution.',
    },
    contractsCount: 'Contracts',
    topByValue: (sampled) => `Top ${sampled} by value of`,
    otherCurrencies: 'Other currencies',
    moreCurrencies: (count) => `+${count} more`,
  },
  ar: {
    stripLabel: 'قيمة المحفظة',
    portfolio: {
      title: 'قيمة المحفظة النشطة',
      description: 'إجمالي قيم العقود النشطة عبر المحفظة.',
      countLabel: 'العقود النشطة',
    },
    expiring30: {
      title: 'القيمة المنتهية خلال 30 يومًا',
      description: 'قيمة العقود النشطة التي ينتهي سريانها خلال 30 يومًا.',
    },
    expiring60: {
      title: 'القيمة المنتهية خلال 60 يومًا',
      description: 'قيمة العقود النشطة التي ينتهي سريانها خلال 60 يومًا.',
    },
    pendingSignature: {
      title: 'القيمة بانتظار التوقيع',
      description: 'قيمة العقود التي تنتظر إتمام التوقيع.',
    },
    contractsCount: 'العقود',
    topByValue: (sampled) => `أعلى ${sampled} حسب القيمة من`,
    otherCurrencies: 'عملات أخرى',
    moreCurrencies: (count) => `+${count} أخرى`,
  },
};

function useContractMoneyKpisLabels(): ContractMoneyKpisLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(contractMoneyKpisLabels, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Pure display helpers (exported for unit tests).
 * ------------------------------------------------------------------------- */

/** Non-SAR currencies rendered on the sub-line before the overflow marker. */
export const MAX_OTHER_CURRENCIES = 2;

/**
 * Compact headline for a per-currency split: the SAR figure, prefixed with a
 * "≥" lower-bound marker when the underlying sample was truncated.
 */
export function moneyHeadline(
  primaryAmount: number,
  partial: boolean,
  f: Pick<LexFormatter, 'formatCurrencyCompact'>,
): string {
  const amount = f.formatCurrencyCompact(primaryAmount, { currency: PRIMARY_CURRENCY });
  return partial ? `≥ ${amount}` : amount;
}

/**
 * Compact "other currencies" sub-line, e.g. "USD 1.2M · EUR 300K · +1 more".
 * Currencies arrive largest-first from `splitPrimary`; only the top
 * {@link MAX_OTHER_CURRENCIES} are itemized. Empty string when all-SAR.
 */
export function formatOthersLine(
  others: MoneySplit['others'],
  f: Pick<LexFormatter, 'formatCurrencyCompact'>,
  moreLabel: (count: number) => string,
): string {
  if (others.length === 0) return '';
  const parts = others
    .slice(0, MAX_OTHER_CURRENCIES)
    .map((entry) => f.formatCurrencyCompact(entry.amount, { currency: entry.currency }));
  const overflow = others.length - MAX_OTHER_CURRENCIES;
  if (overflow > 0) {
    parts.push(moreLabel(overflow));
  }
  return parts.join(' · ');
}

/* ------------------------------------------------------------------------- *
 * Tiles.
 * ------------------------------------------------------------------------- */

/** Muted footer sub-line listing non-SAR totals (rendered in the spark slot). */
function OthersSubline({ others }: { others: MoneySplit['others'] }) {
  const labels = useContractMoneyKpisLabels();
  const f = useLexFormat();
  const line = formatOthersLine(others, f, labels.moreCurrencies);
  if (!line) return null;
  return (
    <span
      className="max-w-full truncate text-xs text-muted-foreground"
      title={labels.otherCurrencies}
    >
      {line}
    </span>
  );
}

interface MoneyKpiTileProps {
  title: string;
  value: string;
  tone: ContractKpiTheme;
  icon: LucideIcon;
  detail: string;
  detailValue: string;
  others: MoneySplit['others'];
  loading: boolean;
  error: boolean;
  /** The register slice this tile stands for. */
  spec: ContractViewSpec;
  /** Selects/deselects {@link spec}; falls back to link navigation when absent. */
  onSelect?: (spec: ContractViewSpec) => void;
  /** The register is currently showing exactly this slice. */
  active: boolean;
}

/**
 * One money tile. With `onSelect` wired it is a toggle button that narrows the
 * register in place (and reads as pressed while its slice is showing); without
 * one it degrades to a link onto the same slice.
 */
function MoneyKpiTile({
  title,
  value,
  tone,
  icon,
  detail,
  detailValue,
  others,
  loading,
  error,
  spec,
  onSelect,
  active,
}: MoneyKpiTileProps) {
  const shared = {
    title,
    value,
    theme: tone,
    icon,
    detail,
    detailValue,
    loading,
    error,
    children: others.length > 0 ? <OthersSubline others={others} /> : undefined,
  };
  return onSelect ? (
    <ContractKpiTile {...shared} active={active} onClick={() => onSelect(spec)} />
  ) : (
    <ContractKpiTile {...shared} href={contractViewHref(spec)} />
  );
}

/* ------------------------------------------------------------------------- *
 * ContractMoneyKpis — the strip.
 * ------------------------------------------------------------------------- */

export interface ContractMoneyKpisProps {
  /** Optional className passthrough for layout placement. */
  className?: string;
  /** Let the four cards participate directly in a parent grid. */
  embedded?: boolean;
  /**
   * Selects the tile's slice on the register — or deselects it when that slice
   * is already showing (the list page owns the toggle). Omit to fall back to
   * link navigation.
   */
  onSelectView?: (spec: ContractViewSpec) => void;
  /** The register's current filter set, used to resolve the pressed tile. */
  activeFilters?: Record<string, string | string[]>;
  /** The register's current ordering — part of a slice's identity. */
  sort?: { column?: string; direction?: ContractSortSpec['direction'] };
}

/**
 * The four-tile money strip. Mount directly under the existing count-KPI grid
 * on `/lex/contracts` (same responsive grid, so the two rows read as one
 * dashboard block).
 */
export function ContractMoneyKpis({
  className,
  embedded = false,
  onSelectView,
  activeFilters,
  sort,
}: ContractMoneyKpisProps) {
  const labels = useContractMoneyKpisLabels();
  const f = useLexFormat();
  const { portfolio, expiring30, expiring60, pendingSignature } = usePortfolioKpis();

  const isActive = (spec: ContractViewSpec) =>
    isContractViewActive(spec, activeFilters ?? {}, sort);

  /** Shared bucket-tile wiring: headline, sampling footer, and query flags. */
  const bucketProps = (bucket: MoneyBucket) => ({
    value: moneyHeadline(bucket.primary, bucket.partial, f),
    detail: bucket.partial ? labels.topByValue(bucket.sampled) : labels.contractsCount,
    detailValue: f.formatNumber(bucket.totalContracts),
    others: bucket.others,
    loading: bucket.isLoading,
    error: bucket.isError,
  });

  return (
    <section
      aria-label={labels.stripLabel}
      className={cn(
        embedded ? 'contents' : 'grid grid-cols-2 gap-3 lg:grid-cols-4',
        className,
      )}
    >
      <MoneyKpiTile
        title={labels.portfolio.title}
        value={moneyHeadline(portfolio.primary, false, f)}
        tone="emerald"
        icon={Banknote}
        detail={labels.portfolio.countLabel}
        detailValue={f.formatNumber(portfolio.activeContracts)}
        others={portfolio.others}
        loading={portfolio.isLoading}
        error={portfolio.isError}
        spec={CONTRACT_MONEY_VIEWS.portfolio}
        onSelect={onSelectView}
        active={isActive(CONTRACT_MONEY_VIEWS.portfolio)}
      />
      <MoneyKpiTile
        {...bucketProps(expiring30)}
        title={labels.expiring30.title}
        tone="rose"
        icon={CalendarClock}
        spec={CONTRACT_MONEY_VIEWS.expiring30}
        onSelect={onSelectView}
        active={isActive(CONTRACT_MONEY_VIEWS.expiring30)}
      />
      <MoneyKpiTile
        {...bucketProps(expiring60)}
        title={labels.expiring60.title}
        tone="gold"
        icon={CalendarRange}
        spec={CONTRACT_MONEY_VIEWS.expiring60}
        onSelect={onSelectView}
        active={isActive(CONTRACT_MONEY_VIEWS.expiring60)}
      />
      <MoneyKpiTile
        {...bucketProps(pendingSignature)}
        title={labels.pendingSignature.title}
        tone="teal"
        icon={FileSignature}
        spec={CONTRACT_MONEY_VIEWS.pendingSignature}
        onSelect={onSelectView}
        active={isActive(CONTRACT_MONEY_VIEWS.pendingSignature)}
      />
    </section>
  );
}
