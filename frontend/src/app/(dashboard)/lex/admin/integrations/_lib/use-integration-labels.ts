'use client';

/**
 * Locale-bound accessor for the admin/integrations console copy.
 *
 * Mirrors the org-entities `useOrgLabels()` hook: it reads the active locale
 * from the LocaleProvider (Arabic-first; `ar` is the platform default) and
 * returns the matching {@link IntegrationConsoleLabels} bundle. Kept suite-local
 * so the shared `@/lib/i18n/messages` catalog is untouched (the integrator owns
 * that; proposed shared keys live in the manifest).
 */
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { integrationLabels, type IntegrationConsoleLabels } from '../_labels';

export function useIntegrationLabels(): IntegrationConsoleLabels {
  const { locale } = useLocaleOrDefault();
  return locale === 'ar' ? integrationLabels.ar : integrationLabels.en;
}

/** Interpolate a single `{token}` placeholder in a label string. */
export function fillToken(
  template: string,
  token: string,
  value: string | number,
): string {
  return template.replace(`{${token}}`, String(value));
}
