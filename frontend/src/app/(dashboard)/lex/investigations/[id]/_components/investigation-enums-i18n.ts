'use client';

/**
 * Bilingual (English + Modern Standard Arabic) resolvers for the RAW backend
 * enum tokens surfaced on the Legal *Investigations* detail page.
 *
 * The backend returns enum values as machine tokens — lifecycle statuses
 * (`in_progress`, `pending_approval`), priorities (`critical`), party roles
 * (`complainant`), evidence categories (`system_log`, `financial_record`) and
 * append-only audit action verbs (`evidence_uploaded`, `status_changed`). On
 * the Arabic (RTL) surface these leak through untranslated. This module turns
 * each raw token into a localized display string.
 *
 * Mirrors the Service Desk `lex-enums-i18n.ts` contract but is fully
 * self-contained (it never imports that domain's file). Status / priority /
 * party-role / evidence-type reuse the canonical maps from the investigations
 * `labels.ts` (via `resolveInvestigationLabels`) rather than duplicating them;
 * the audit-action verbs — which have no home elsewhere — carry their own
 * `LexBilingual` bundle here. Anything unmapped falls back to {@link prettify}.
 *
 * Every enum comes in two forms: a PURE resolver `resolve*Label(token, locale)`
 * for non-React callers, and a thin React hook `use*Label()` that binds the
 * active locale.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type {
  InvestigationPartyRole,
  InvestigationPriority,
  InvestigationStatus,
} from '@/lib/lex/investigations';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';
import { resolveInvestigationLabels } from '../../_components/labels';

/* ------------------------------------------------------------------------- *
 * Token normalisation + safe fallback (local copies — the module stays
 * decoupled from the Service Desk enum helper).
 * ------------------------------------------------------------------------- */

/**
 * normalizeToken lower-cases, trims, collapses whitespace and unifies word
 * separators to a single underscore — folding `EVIDENCE_UPLOADED`,
 * `evidence_uploaded` and `evidence uploaded` onto one lookup key.
 */
export function normalizeToken(token: string): string {
  return String(token ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * prettify is the safe display fallback for an unmapped token: replace `_`/`-`
 * with spaces, collapse runs, and Title-Case each word. Empty input → ''.
 */
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

/** Resolve a raw token against a single-locale map: verbatim, normalized, prettified. */
function pickFromMap(map: Record<string, string>, token: string): string {
  if (token == null) return '';
  return map[token] ?? map[normalizeToken(token)] ?? prettify(token);
}

/* ------------------------------------------------------------------------- *
 * Status / priority / party role / evidence type — reuse labels.ts maps.
 * ------------------------------------------------------------------------- */

/** Localized investigation lifecycle status (reuses `filters.statusOptions`). */
export function resolveInvestigationStatusLabel(
  status: InvestigationStatus | string,
  locale: AppLocale = 'en',
): string {
  return pickFromMap(resolveInvestigationLabels(locale).filters.statusOptions, status);
}

export function useInvestigationStatusLabel(): (status: InvestigationStatus | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (status: InvestigationStatus | string) => resolveInvestigationStatusLabel(status, locale),
    [locale],
  );
}

/** Localized investigation priority (reuses `filters.priorityOptions`). */
export function resolveInvestigationPriorityLabel(
  priority: InvestigationPriority | string,
  locale: AppLocale = 'en',
): string {
  return pickFromMap(resolveInvestigationLabels(locale).filters.priorityOptions, priority);
}

export function useInvestigationPriorityLabel(): (
  priority: InvestigationPriority | string,
) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (priority: InvestigationPriority | string) =>
      resolveInvestigationPriorityLabel(priority, locale),
    [locale],
  );
}

/** Localized party role (reuses `filters.roleOptions`). */
export function resolvePartyRoleLabel(
  role: InvestigationPartyRole | string,
  locale: AppLocale = 'en',
): string {
  return pickFromMap(resolveInvestigationLabels(locale).filters.roleOptions, role);
}

export function usePartyRoleLabel(): (role: InvestigationPartyRole | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (role: InvestigationPartyRole | string) => resolvePartyRoleLabel(role, locale),
    [locale],
  );
}

/** Localized evidence category (reuses `dialogs.evidenceTypeOptions`). */
export function resolveEvidenceTypeLabel(
  evidenceType: string,
  locale: AppLocale = 'en',
): string {
  return pickFromMap(resolveInvestigationLabels(locale).dialogs.evidenceTypeOptions, evidenceType);
}

export function useEvidenceTypeLabel(): (evidenceType: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (evidenceType: string) => resolveEvidenceTypeLabel(evidenceType, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Audit action verbs — own bilingual bundle (no home in labels.ts).
 *
 * Keys are the NORMALIZED token; both locales carry the SAME key set. The list
 * is a best-effort cover of the actions the investigations backend spine emits;
 * any unmapped verb degrades to {@link prettify}.
 * ------------------------------------------------------------------------- */

const AUDIT_ACTION_LABELS: LexBilingual<Record<string, string>> = {
  en: {
    registered: 'Registered',
    created: 'Created',
    updated: 'Updated',
    deleted: 'Deleted',
    status_changed: 'Status changed',
    status_updated: 'Status changed',
    party_added: 'Party added',
    party_updated: 'Party updated',
    party_removed: 'Party removed',
    party_deleted: 'Party removed',
    statement_recorded: 'Statement recorded',
    statement_added: 'Statement recorded',
    statement_removed: 'Statement removed',
    statement_deleted: 'Statement removed',
    evidence_uploaded: 'Evidence added',
    evidence_added: 'Evidence added',
    evidence_removed: 'Evidence removed',
    evidence_deleted: 'Evidence removed',
    results_recorded: 'Findings recorded',
    findings_recorded: 'Findings recorded',
    recommendations_recorded: 'Recommendations recorded',
    approval_started: 'Approval started',
    approval_requested: 'Approval requested',
    approval_decided: 'Approval decision recorded',
    approval_decision: 'Approval decision recorded',
    approved: 'Approved',
    rejected: 'Rejected',
    closed: 'Closed',
    cancelled: 'Cancelled',
    reopened: 'Reopened',
    resumed: 'Resumed',
    ai_generated: 'AI draft generated',
    ai_drafted: 'AI draft generated',
  },
  ar: {
    registered: 'تم التسجيل',
    created: 'تم الإنشاء',
    updated: 'تم التحديث',
    deleted: 'تم الحذف',
    status_changed: 'تغيّرت الحالة',
    status_updated: 'تغيّرت الحالة',
    party_added: 'أُضيف طرف',
    party_updated: 'حُدِّث طرف',
    party_removed: 'أُزيل طرف',
    party_deleted: 'أُزيل طرف',
    statement_recorded: 'سُجّلت إفادة',
    statement_added: 'سُجّلت إفادة',
    statement_removed: 'حُذفت إفادة',
    statement_deleted: 'حُذفت إفادة',
    evidence_uploaded: 'أُضيف دليل',
    evidence_added: 'أُضيف دليل',
    evidence_removed: 'أُزيل دليل',
    evidence_deleted: 'أُزيل دليل',
    results_recorded: 'سُجّلت النتائج',
    findings_recorded: 'سُجّلت النتائج',
    recommendations_recorded: 'سُجّلت التوصيات',
    approval_started: 'بدأت الموافقة',
    approval_requested: 'طُلبت الموافقة',
    approval_decided: 'سُجّل قرار الموافقة',
    approval_decision: 'سُجّل قرار الموافقة',
    approved: 'تمت الموافقة',
    rejected: 'مرفوض',
    closed: 'مغلق',
    cancelled: 'مُلغى',
    reopened: 'أُعيد فتحه',
    resumed: 'استُؤنف',
    ai_generated: 'أُنشئت مسودة بالذكاء الاصطناعي',
    ai_drafted: 'أُنشئت مسودة بالذكاء الاصطناعي',
  },
};

/** Localized audit action verb (e.g. `evidence_uploaded` → "Evidence added"). */
export function resolveAuditActionLabel(action: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveLexBilingual(AUDIT_ACTION_LABELS, locale), action);
}

export function useAuditActionLabel(): (action: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (action: string) => resolveAuditActionLabel(action, locale), [locale]);
}
