import { cookies } from 'next/headers';
import {
  DEFAULT_MARKETING_LOCALE,
  MARKETING_LOCALE_COOKIE,
  normalizeMarketingLocale,
  type MarketingLocale,
} from './messages';

/**
 * Resolve the marketing locale on the server from the preference cookie, so the
 * shell can render the correct `dir`/`lang` and translated nav/footer during SSR
 * (no hydration mismatch, no flash for visitors who persisted Arabic). Defaults
 * to EN/LTR when no valid cookie is present.
 *
 * NOTE: reading `cookies()` opts the caller into dynamic rendering — acceptable
 * for the marketing surface, and required for cookie-driven SSR locale.
 */
export async function getMarketingLocale(): Promise<MarketingLocale> {
  const store = await cookies();
  const value = store.get(MARKETING_LOCALE_COOKIE)?.value;
  return normalizeMarketingLocale(value) ?? DEFAULT_MARKETING_LOCALE;
}
