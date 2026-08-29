'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/components/providers/locale-provider';
import {
  getLocaleDirection,
  serializeLocaleCookie,
  type AppLocale,
} from '@/lib/i18n';

/**
 * Switches the active UI locale at runtime.
 *
 * 1. Writes the `clario360_locale` cookie so the server resolves the same locale
 *    on the next render (and on hard reloads / new tabs).
 * 2. Applies the new `lang`/`dir` to `<html>` immediately, so direction flips
 *    live (logical properties + Tailwind `rtl:`/`ltr:` re-evaluate at once)
 *    without waiting for the server round-trip.
 * 3. Calls `router.refresh()` so the server re-renders the tree (RSC), feeding
 *    the new `messages` into <LocaleProvider> so labels update without a full
 *    page reload.
 */
export function useSetLocale() {
  const router = useRouter();
  const { locale } = useLocale();

  const setLocale = useCallback(
    (next: AppLocale) => {
      if (next === locale) return;

      const direction = getLocaleDirection(next);

      // 1. Persist preference.
      if (typeof document !== 'undefined') {
        document.cookie = serializeLocaleCookie(next);

        // 2. Apply direction/lang live on <html>.
        const html = document.documentElement;
        html.setAttribute('lang', next);
        html.setAttribute('dir', direction);
        html.setAttribute('data-locale', next);
      }

      // 3. Re-render the server tree so messages/labels update.
      router.refresh();
    },
    [locale, router],
  );

  /** Convenience: switch to the "other" supported locale (ar <-> en). */
  const toggleLocale = useCallback(() => {
    setLocale(locale === 'ar' ? 'en' : 'ar');
  }, [locale, setLocale]);

  return { locale, setLocale, toggleLocale };
}
