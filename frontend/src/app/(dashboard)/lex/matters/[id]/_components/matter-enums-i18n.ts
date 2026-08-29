'use client';

/**
 * Bilingual (English + Modern Standard Arabic) resolvers for the RAW backend
 * enum tokens surfaced on the Matters (قضايا / الملفات القانونية) *detail* page.
 *
 * The backend returns matter enums as machine tokens — type (`dispute`,
 * `regulatory`), lifecycle status (`in_review`, `waiting_on_business`), priority
 * (`critical`) and the contract-relationship (`primary`, `amendment`). On the
 * Arabic (RTL) surface those leak through untranslated unless resolved.
 *
 * This module mirrors the Legal Service Desk `lex-enums-i18n.ts` reference
 * verbatim (normalize → map → prettify fallback) but resolves against the
 * Matters label maps already defined in `../_components/labels.ts`
 * (`filters.typeOptions` / `statusOptions` / `priorityOptions` and
 * `matterRelationshipLabels`) rather than duplicating a second copy. Every
 * export comes in two forms: a PURE resolver `resolve*Label(token, locale)` for
 * non-React callers/tests and a thin React hook `use*Label()` bound to the
 * active locale.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { resolveMatterLabels, matterRelationshipLabels } from '../../_components/labels';
import { resolveLexBilingual } from '../../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Token normalisation + safe fallback (identical contract to lex-enums-i18n).
 * ------------------------------------------------------------------------- */

/** Fold `Some_Token`, `some token` and `SOME-TOKEN` onto one lookup key. */
export function normalizeToken(token: string): string {
  return String(token ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Safe Title-Case display fallback for an unmapped token. */
export function prettify(token: string): string {
  const raw = String(token ?? '').trim();
  if (!raw) return '';
  return raw
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ');
}

/** Resolve a raw token against a resolved label map: verbatim → normalized → prettify. */
function pickFromMap(map: Record<string, string>, token: string): string {
  if (token == null) return '';
  return map[token] ?? map[normalizeToken(token)] ?? prettify(token);
}

/* ------------------------------------------------------------------------- *
 * Matter type.
 * ------------------------------------------------------------------------- */

export function resolveMatterTypeLabel(type: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveMatterLabels(locale).filters.typeOptions, type);
}

export function useMatterTypeLabel(): (type: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (type: string) => resolveMatterTypeLabel(type, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Matter lifecycle status.
 * ------------------------------------------------------------------------- */

export function resolveMatterStatusLabel(status: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveMatterLabels(locale).filters.statusOptions, status);
}

export function useMatterStatusLabel(): (status: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (status: string) => resolveMatterStatusLabel(status, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Matter priority.
 * ------------------------------------------------------------------------- */

export function resolveMatterPriorityLabel(priority: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveMatterLabels(locale).filters.priorityOptions, priority);
}

export function useMatterPriorityLabel(): (priority: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (priority: string) => resolveMatterPriorityLabel(priority, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Contract-relationship token (primary / related / amendment / dispute / …).
 * ------------------------------------------------------------------------- */

export function resolveMatterRelationshipLabel(
  relationship: string,
  locale: AppLocale = 'en',
): string {
  return pickFromMap(resolveLexBilingual(matterRelationshipLabels, locale), relationship);
}

export function useMatterRelationshipLabel(): (relationship: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (relationship: string) => resolveMatterRelationshipLabel(relationship, locale),
    [locale],
  );
}
