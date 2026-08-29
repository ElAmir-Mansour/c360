export const SUPPORTED_LOCALES = ['ar', 'en'] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type AppDirection = 'ltr' | 'rtl';

export const DEFAULT_LOCALE: AppLocale = 'ar';
export const LOCALE_COOKIE_NAME = 'clario360_locale';

/**
 * Synthetic build-time PSEUDO-LOCALE for localization QA. When
 * `NEXT_PUBLIC_PSEUDO_LOCALE=1`, a `'pseudo'` locale becomes selectable: its
 * catalogue is `en` transformed at runtime (accented letters, +40% padding,
 * `[!! … !!]` brackets — see `getMessages` in `./i18n/messages`). Any UI text
 * that renders as plain, unbracketed English on the pseudo page is a
 * hardcoded literal that bypassed i18n; the padding surfaces truncation and
 * layout overflow. It is intentionally NOT part of `AppLocale`/`SUPPORTED_LOCALES`
 * so the typed catalogue and `tsc` stay untouched, and it is gated so it never
 * ships to production. Typed as `string` (not the `'pseudo'` literal) so
 * equality checks against `AppLocale` don't trip TS "no overlap".
 */
export const PSEUDO_LOCALE: string = 'pseudo';

/** True only when the build opted into the pseudo-locale via env flag. */
export function isPseudoLocaleEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PSEUDO_LOCALE === '1';
}

const LOCALE_DIRECTIONS: Record<AppLocale, AppDirection> = {
  ar: 'rtl',
  en: 'ltr',
};

function isSupportedLocale(value: string): value is AppLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(candidate: string | null | undefined): AppLocale | null {
  const normalized = candidate?.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;

  // Pseudo-locale is accepted only when explicitly enabled; it deliberately
  // sits outside AppLocale, so cast (runtime-only value, type stays 'ar'|'en').
  if (isPseudoLocaleEnabled() && normalized === PSEUDO_LOCALE) {
    return PSEUDO_LOCALE as AppLocale;
  }

  if (isSupportedLocale(normalized)) {
    return normalized;
  }

  const [language] = normalized.split('-');
  return isSupportedLocale(language) ? language : null;
}

export function getConfiguredDefaultLocale(): AppLocale {
  return normalizeLocale(process.env.NEXT_PUBLIC_DEFAULT_LOCALE) ?? DEFAULT_LOCALE;
}

export function getLocaleDirection(locale: string | null | undefined): AppDirection {
  const normalized = normalizeLocale(locale);
  // Pseudo-locale is accented Latin text — render it left-to-right.
  if (normalized === PSEUDO_LOCALE) return 'ltr';
  return normalized ? LOCALE_DIRECTIONS[normalized] : LOCALE_DIRECTIONS[getConfiguredDefaultLocale()];
}

export function resolveLocaleFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
): AppLocale | null {
  if (!acceptLanguage) return null;

  const matches = acceptLanguage
    .split(',')
    .map((entry, index) => {
      const [localePart, ...parameters] = entry.trim().split(';');
      const q = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith('q='))
        ?.slice(2);

      return {
        locale: normalizeLocale(localePart),
        priority: q ? Number(q) : 1,
        index,
      };
    })
    .filter(
      (match): match is { locale: AppLocale; priority: number; index: number } =>
        Boolean(match.locale) && Number.isFinite(match.priority) && match.priority > 0,
    )
    .sort((left, right) => right.priority - left.priority || left.index - right.index);

  return matches[0]?.locale ?? null;
}

export function resolveAppLocale(
  candidates: readonly (string | null | undefined)[] = [],
  fallbackLocale: string | null | undefined = getConfiguredDefaultLocale(),
): AppLocale {
  for (const candidate of candidates) {
    const locale = candidate?.includes(',') || candidate?.includes(';')
      ? resolveLocaleFromAcceptLanguage(candidate)
      : normalizeLocale(candidate);

    if (locale) {
      return locale;
    }
  }

  return normalizeLocale(fallbackLocale) ?? DEFAULT_LOCALE;
}

export function getDocumentLocaleAttributes(locale?: string | null): {
  lang: AppLocale;
  dir: AppDirection;
} {
  const lang = resolveAppLocale(locale ? [locale] : []);
  return {
    lang,
    // Via getLocaleDirection so the pseudo-locale resolves to 'ltr' instead of
    // an undefined direction (it is absent from LOCALE_DIRECTIONS by design).
    dir: getLocaleDirection(lang),
  };
}

/** One year, in seconds — the locale-cookie lifetime. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Serialise the locale cookie for `document.cookie` (client-side switching).
 * Mirrors what the server would set: root path, year-long, Lax SameSite. Not
 * httpOnly — this is a UI preference the client must read/write.
 */
export function serializeLocaleCookie(locale: AppLocale): string {
  return `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}
