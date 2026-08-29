/**
 * SAR-first currency formatting — the PLATFORM-WIDE canonical module,
 * generalized from the Lex KSA layer (`src/lib/lex/ksa/currency.ts`, which now
 * delegates here).
 *
 * Arabic mode uses the `ar-SA` locale so the Saudi Riyal symbol/abbreviation
 * and Arabic-Indic digits render natively; English mode uses `en-US` with the
 * ISO currency code. A `numerals` preference can force Latin or Arabic-Indic
 * digits regardless of locale. All functions are pure and SSR-safe (`Intl`
 * only). No `Date.now()` / `Math.random()` at module scope.
 */

import type { AppLocale } from '@/lib/i18n';
import { resolveNumberLocale, type NumeralPreference } from './numerals';

/** Official Unicode Saudi Riyal sign (U+20C1), adopted for all SAR output. */
export const SAUDI_RIYAL_SYMBOL = '\u20C1';

function withOfficialSaudiRiyalSymbol(formatted: string, currency: string): string {
  if (currency.toUpperCase() !== 'SAR') return formatted;
  return formatted
    .replace(/\bSAR\b/gu, SAUDI_RIYAL_SYMBOL)
    .replace(/ر\.?\s*س\.?/gu, SAUDI_RIYAL_SYMBOL);
}

export interface FormatCurrencyOptions {
  /** ISO 4217 currency code. Defaults to SAR (Saudi Riyal). */
  currency?: string;
  locale: AppLocale;
  /** Override the default 2 minor-unit fraction digits. */
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  /** 'symbol' (default), 'code', or 'name' currency display. */
  currencyDisplay?: Intl.NumberFormatOptions['currencyDisplay'];
  /** Digit-glyph preference; 'auto' follows the locale. */
  numerals?: NumeralPreference;
}

/**
 * Format a monetary amount. Arabic mode emits e.g. "١٬٢٥٠٫٠٠ ر.س."; English
 * mode emits e.g. "SAR 1,250.00". Non-finite / unparseable input returns an
 * empty string.
 */
export function formatCurrency(amount: number | string, options: FormatCurrencyOptions): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric)) {
    return '';
  }

  const { locale, currency = 'SAR', currencyDisplay = 'symbol', numerals = 'auto' } = options;

  const formatted = new Intl.NumberFormat(resolveNumberLocale(locale, numerals), {
    style: 'currency',
    currency,
    currencyDisplay,
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits,
  }).format(numeric);
  return withOfficialSaudiRiyalSymbol(formatted, currency);
}

/**
 * Compact currency, e.g. 1_250_000 -> "SAR 1.3M" (en) / Arabic-Indic
 * equivalent (ar). Handy for KPI tiles where full grouping is too wide.
 */
export function formatCurrencyCompact(
  amount: number | string,
  options: FormatCurrencyOptions,
): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric)) {
    return '';
  }

  const { locale, currency = 'SAR', currencyDisplay = 'symbol', numerals = 'auto' } = options;

  const formatted = new Intl.NumberFormat(resolveNumberLocale(locale, numerals), {
    style: 'currency',
    currency,
    currencyDisplay,
    notation: 'compact',
    maximumFractionDigits: options.maximumFractionDigits ?? 1,
  }).format(numeric);
  return withOfficialSaudiRiyalSymbol(formatted, currency);
}
