import { cookies, headers } from 'next/headers';
import {
  getDocumentLocaleAttributes,
  LOCALE_COOKIE_NAME,
  resolveAppLocale,
  type AppLocale,
} from './i18n';

export async function getRequestLocale(): Promise<AppLocale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  return resolveAppLocale([
    cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    headerStore.get('accept-language'),
  ]);
}

export async function getRequestLocaleAttributes() {
  return getDocumentLocaleAttributes(await getRequestLocale());
}
