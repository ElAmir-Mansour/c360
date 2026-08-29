'use client';

/**
 * Bilingual (English + Modern Standard Arabic) resolvers for the RAW backend
 * enum tokens surfaced on the Settlements / ADR *detail* page.
 *
 * The settlement lifecycle status and ADR method already have canonical
 * bilingual maps in the shared `../_components/labels` catalog; those are reused
 * here (never duplicated) so the detail surface reads identically to the list.
 * The one enum the shared catalog does NOT cover is the append-only governance
 * AUDIT `action` token (`opened`, `terms_recorded`, `round_added`, `submitted`,
 * `approved`, `executed`, `closed`, …) which leaks through untranslated on the
 * Arabic (RTL) activity feed — this module localizes it.
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle resolved per locale. Maps are keyed by
 * the NORMALIZED token so the code form, lowercased-code form and
 * spaced-lowercase form all resolve to one entry. Anything unknown falls back to
 * {@link prettify}. Every export comes in a pure resolver `resolve*Label(token,
 * locale)` (loaders/tests) plus a thin React hook `use*Label()` bound to the
 * active locale. Do NOT edit the service-desk `lex-enums-i18n.ts`; this is the
 * settlements-domain sibling.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type { SettlementMethod, SettlementStatus } from '@/lib/lex/settlements';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';
import { resolveSettlementLabels } from '../../_components/labels';

/* ------------------------------------------------------------------------- *
 * Token normalisation + safe fallback (mirrors the service-desk sibling).
 * ------------------------------------------------------------------------- */

/** Fold `TERMS_RECORDED`, `terms_recorded` and `terms recorded` onto one key. */
export function normalizeToken(token: string): string {
  return String(token ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Safe display fallback for an unmapped token: spaced + Title-Cased. */
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

function pickFromMap(map: Record<string, string>, token: string): string {
  if (token == null) return '';
  return map[token] ?? map[normalizeToken(token)] ?? prettify(token);
}

/* ------------------------------------------------------------------------- *
 * Settlement status / ADR method — reuse the shared catalog maps.
 * ------------------------------------------------------------------------- */

/** Localized settlement lifecycle status label (reuses the shared catalog). */
export function resolveSettlementStatusLabel(
  status: SettlementStatus | string,
  locale: AppLocale = 'en',
): string {
  return pickFromMap(resolveSettlementLabels(locale).filters.statusOptions, status);
}

/** React hook form of {@link resolveSettlementStatusLabel}. */
export function useSettlementStatusLabel(): (status: SettlementStatus | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (status: SettlementStatus | string) => resolveSettlementStatusLabel(status, locale),
    [locale],
  );
}

/** Localized ADR method label (reuses the shared catalog). */
export function resolveSettlementMethodLabel(
  method: SettlementMethod | string,
  locale: AppLocale = 'en',
): string {
  return pickFromMap(resolveSettlementLabels(locale).filters.methodOptions, method);
}

/** React hook form of {@link resolveSettlementMethodLabel}. */
export function useSettlementMethodLabel(): (method: SettlementMethod | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (method: SettlementMethod | string) => resolveSettlementMethodLabel(method, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Governance audit action token.
 *
 * Keys are the NORMALIZED action token. Both locales carry the SAME key set;
 * unknown tokens fall back to {@link prettify}. The backend emits the action
 * verbatim, so we cover the FSM transitions (open/record/round/submit/decide/
 * approve/reject/execute/close/abandon) plus a few synonyms.
 * ------------------------------------------------------------------------- */

const AUDIT_ACTION_LABELS: LexBilingual<Record<string, string>> = {
  en: {
    opened: 'Settlement opened',
    open: 'Settlement opened',
    created: 'Settlement opened',
    updated: 'Terms updated',
    recorded: 'Terms recorded',
    record: 'Terms recorded',
    terms_recorded: 'Terms recorded',
    round_added: 'Negotiation round added',
    add_round: 'Negotiation round added',
    round: 'Negotiation round added',
    submitted: 'Submitted for approval',
    submit: 'Submitted for approval',
    decision: 'Approval decision recorded',
    decided: 'Approval decision recorded',
    approved: 'Approved',
    approve: 'Approved',
    rejected: 'Rejected',
    reject: 'Rejected',
    executed: 'Executed',
    execute: 'Executed',
    closed: 'Closed by reconciliation',
    close: 'Closed by reconciliation',
    abandoned: 'Abandoned',
    abandon: 'Abandoned',
    deleted: 'Deleted',
  },
  ar: {
    opened: 'فُتحت التسوية',
    open: 'فُتحت التسوية',
    created: 'فُتحت التسوية',
    updated: 'تم تحديث البنود',
    recorded: 'تم تسجيل البنود',
    record: 'تم تسجيل البنود',
    terms_recorded: 'تم تسجيل البنود',
    round_added: 'أُضيفت جولة تفاوض',
    add_round: 'أُضيفت جولة تفاوض',
    round: 'أُضيفت جولة تفاوض',
    submitted: 'أُرسلت للاعتماد',
    submit: 'أُرسلت للاعتماد',
    decision: 'سُجّل قرار الاعتماد',
    decided: 'سُجّل قرار الاعتماد',
    approved: 'اعتُمدت',
    approve: 'اعتُمدت',
    rejected: 'رُفضت',
    reject: 'رُفضت',
    executed: 'نُفّذت',
    execute: 'نُفّذت',
    closed: 'أُغلقت بالصلح',
    close: 'أُغلقت بالصلح',
    abandoned: 'تُركت',
    abandon: 'تُركت',
    deleted: 'حُذفت',
  },
};

/** Localized governance-audit action label; unknown tokens prettify safely. */
export function resolveSettlementAuditActionLabel(action: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveLexBilingual(AUDIT_ACTION_LABELS, locale), action);
}

/** React hook form of {@link resolveSettlementAuditActionLabel}. */
export function useSettlementAuditActionLabel(): (action: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (action: string) => resolveSettlementAuditActionLabel(action, locale), [locale]);
}
