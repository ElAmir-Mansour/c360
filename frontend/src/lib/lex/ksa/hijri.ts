/**
 * DELEGATE — the Hijri (Umm al-Qura) <-> Gregorian formatting that used to
 * live here is now the platform-wide canonical module at
 * `@/lib/format/datetime` (generalized for every suite, not just Lex).
 *
 * This re-export preserves the historical Lex import path and its full public
 * surface (`formatHijri`, `formatGregorian`, `formatDual`, `toDate`,
 * `getHijriParts`, `HIJRI_MONTH_NAMES`, ...) so all existing Lex consumers
 * keep compiling unchanged. New code should import from
 * `@/lib/format/datetime` directly.
 */

export * from '@/lib/format/datetime';
