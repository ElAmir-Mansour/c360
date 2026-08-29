/**
 * DELEGATE — the SAR-first currency formatting that used to live here is now
 * the platform-wide canonical module at `@/lib/format/currency` (generalized
 * for every suite, not just Lex).
 *
 * This re-export preserves the historical Lex import path and its full public
 * surface (`formatCurrency`, `formatCurrencyCompact`, `FormatCurrencyOptions`)
 * so all existing Lex consumers keep compiling unchanged. New code should
 * import from `@/lib/format/currency` directly.
 */

export * from '@/lib/format/currency';
