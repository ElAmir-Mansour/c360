import { IBM_Plex_Sans_Arabic } from 'next/font/google';

/**
 * Arabic display face for the marketing surface, self-hosted via next/font (the
 * same optimised-font mechanism the app already uses for Inter). Exposed as the
 * CSS variable `--font-arabic-clario`, which clario-site.css layers in front of
 * the `--arabic` fallback stack and applies under `.clario-site[dir="rtl"]`.
 *
 * IBM Plex Sans Arabic matches the app's Arabic face for cross-surface
 * consistency and ships proper Arabic-Indic numerals. Kept in a plain (non
 * "use client") module so the font loader runs at build time and the resolved
 * `.variable` string can be consumed by the client shell.
 */
export const marketingArabicFont = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-arabic-clario',
  fallback: ['Noto Sans Arabic', 'Tajawal', 'Tahoma', 'sans-serif'],
});
