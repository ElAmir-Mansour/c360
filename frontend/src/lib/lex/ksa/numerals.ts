/**
 * DELEGATE — the Arabic-Indic numeral shaping + locale-aware number formatting
 * that used to live here is now the platform-wide canonical module at
 * `@/lib/format/numerals` (generalized for every suite, not just Lex).
 *
 * This re-export preserves the historical Lex import path and its full public
 * surface (`toArabicIndic`, `toLatinDigits`, `shapeDigits`, `formatNumber`,
 * `formatPercent`, `formatCompact`, `ARABIC_INDIC_DIGITS`, ...) so all
 * existing Lex consumers keep compiling unchanged. New code should import from
 * `@/lib/format/numerals` directly.
 */

export * from '@/lib/format/numerals';
