'use client';

/**
 * Bilingual (English + Modern Standard Arabic) resolvers for the RAW backend
 * enum tokens surfaced on the Litigation Case *detail* page.
 *
 * The backend returns enum values as English machine tokens — case lifecycle
 * statuses (`under_procedure`), company side (`plaintiff`/`defendant`), case
 * strength (`strong`/`weak`), legal priority (`critical`…`low`), party roles,
 * and the free-text `case_type` classification token. On the Arabic (RTL)
 * surface those leak through untranslated. This module turns each raw token
 * into a localized display string.
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle resolved per locale. Status / company
 * side / strength / priority / party role reuse the already-translated maps in
 * the Litigation Cases label catalog (`../../_components/labels`) rather than
 * duplicating them, so a single source of truth stays authoritative. The
 * free-text `case_type` token has no fixed vocabulary, so it falls back to
 * {@link prettify}.
 *
 * Every export comes in two forms: a PURE resolver `resolve*Label(token, locale)`
 * for non-React callers (loaders, tests) and a thin React hook `use*Label()`
 * that binds the active locale. This mirrors `service-desk/_components/
 * lex-enums-i18n.ts` (a sibling domain's copy — intentionally NOT shared/edited).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type {
  CaseCompanyStatus,
  CasePartyRole,
  CaseRiskRating,
  CaseStatus,
  CaseStrength,
  LegalPriority,
} from '@/lib/lex/cases';
import { type LexBilingual, resolveLexBilingual } from '@/app/(dashboard)/lex/_lib/lex-i18n';
import { resolveCaseLabels } from '../../_components/labels';

/* ------------------------------------------------------------------------- *
 * Token normalisation + safe fallback (same contract as the service-desk copy).
 * ------------------------------------------------------------------------- */

/** Fold `UNDER_PROCEDURE` / `under procedure` / `under-procedure` onto one key. */
export function normalizeToken(token: string): string {
  return String(token ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Safe display fallback for an unmapped token: spaced + Title-Cased. */
export function prettify(token: string): string {
  const raw = String(token ?? '').trim();
  if (!raw) return '';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ');
}

/** Resolve a raw token against a single-locale label map, with a prettify fallback. */
function pickFromMap(map: Record<string, string>, token: string): string {
  if (token == null) return '';
  return map[token] ?? map[normalizeToken(token)] ?? prettify(token);
}

/* ------------------------------------------------------------------------- *
 * Case lifecycle status.
 * ------------------------------------------------------------------------- */

export function resolveCaseStatusLabel(status: CaseStatus | string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveCaseLabels(locale).filters.statusOptions, status);
}

export function useCaseStatusLabel(): (status: CaseStatus | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (status: CaseStatus | string) => resolveCaseStatusLabel(status, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Company side (plaintiff / defendant).
 * ------------------------------------------------------------------------- */

export function resolveCompanyStatusLabel(
  status: CaseCompanyStatus | string,
  locale: AppLocale = 'en',
): string {
  return pickFromMap(resolveCaseLabels(locale).filters.companyStatusOptions, status);
}

export function useCompanyStatusLabel(): (status: CaseCompanyStatus | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (status: CaseCompanyStatus | string) => resolveCompanyStatusLabel(status, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Case strength (strong / weak).
 * ------------------------------------------------------------------------- */

export function resolveStrengthLabel(strength: CaseStrength | string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveCaseLabels(locale).filters.strengthOptions, strength);
}

export function useStrengthLabel(): (strength: CaseStrength | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (strength: CaseStrength | string) => resolveStrengthLabel(strength, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Case risk rating (low / medium / high / critical) — Othaim PRD 8.2.
 * ------------------------------------------------------------------------- */

export function resolveRiskRatingLabel(rating: CaseRiskRating | string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveCaseLabels(locale).filters.riskRatingOptions, rating);
}

export function useRiskRatingLabel(): (rating: CaseRiskRating | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (rating: CaseRiskRating | string) => resolveRiskRatingLabel(rating, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Legal priority (critical / high / medium / low).
 * ------------------------------------------------------------------------- */

export function resolvePriorityLabel(priority: LegalPriority | string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveCaseLabels(locale).filters.priorityOptions, priority);
}

export function usePriorityLabel(): (priority: LegalPriority | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (priority: LegalPriority | string) => resolvePriorityLabel(priority, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Party role (plaintiff / defendant / lawyer / witness / expert / other).
 * ------------------------------------------------------------------------- */

export function resolvePartyRoleLabel(role: CasePartyRole | string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveCaseLabels(locale).filters.partyRoleOptions, role);
}

export function usePartyRoleLabel(): (role: CasePartyRole | string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (role: CasePartyRole | string) => resolvePartyRoleLabel(role, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Case type.
 *
 * The backend surfaces a fixed core litigation vocabulary as English machine
 * tokens (`civil`, `commercial`, `labor`, `execution`, …). On the Arabic (RTL)
 * surface those leak through untranslated when merely humanized, so map the
 * known vocabulary to Modern Standard Arabic. The token space also allows
 * free-text classifications, so unknown tokens still fall back to
 * {@link prettify}.
 * ------------------------------------------------------------------------- */

const caseTypeLabels: LexBilingual<Record<string, string>> = {
  en: {
    civil: 'Civil',
    commercial: 'Commercial',
    labor: 'Labor',
    execution: 'Execution',
    administrative: 'Administrative',
    criminal: 'Criminal',
    real_estate: 'Real Estate',
    family: 'Family',
    arbitration: 'Arbitration',
    rental: 'Rental',
    intellectual_property: 'Intellectual Property',
    banking: 'Banking',
    insurance: 'Insurance',
  },
  ar: {
    civil: 'مدني',
    commercial: 'تجاري',
    labor: 'عمالي',
    execution: 'تنفيذ',
    administrative: 'إداري',
    criminal: 'جزائي',
    real_estate: 'عقاري',
    family: 'أحوال شخصية',
    arbitration: 'تحكيم',
    rental: 'إيجاري',
    intellectual_property: 'ملكية فكرية',
    banking: 'مصرفي',
    insurance: 'تأميني',
  },
};

export function resolveCaseTypeLabel(caseType: string, locale: AppLocale = 'en'): string {
  const map = resolveLexBilingual(caseTypeLabels, locale);
  return map[caseType] ?? map[normalizeToken(caseType)] ?? prettify(caseType);
}

export function useCaseTypeLabel(): (caseType: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (caseType: string) => resolveCaseTypeLabel(caseType, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Case audit action verb.
 *
 * The append-only case audit spine (`legal_case_audit`, surfaced by
 * `casesApi.listCaseAudit`) stores dotted machine action tokens
 * (`case.status_changed`, `case.officer_assigned`, …). On the activity feed those
 * leak through untranslated when humanized by {@link prettify}, so map the fixed
 * vocabulary emitted by the backend (`recordAudit` / `mutateAndAudit` in
 * `legal_case_service.go`). Unknown/new tokens still fall back to {@link prettify}.
 * ------------------------------------------------------------------------- */

const caseAuditActionLabels: LexBilingual<Record<string, string>> = {
  en: {
    'case.created': 'Case created',
    'case.updated': 'Case updated',
    'case.status_changed': 'Status changed',
    'case.officer_assigned': 'Handling officer assigned',
    'case.supervisor_assigned': 'Supervisor assigned',
    'case.priority_set': 'Priority set',
    'case.strength_set': 'Case strength set',
    'case.risk_rating_set': 'Case risk rating set',
    'case.transferred_to_section_manager': 'Transferred to section manager',
  },
  ar: {
    'case.created': 'تم إنشاء القضية',
    'case.updated': 'تم تحديث القضية',
    'case.status_changed': 'تغيّرت الحالة',
    'case.officer_assigned': 'تم تعيين موظف المعالجة',
    'case.supervisor_assigned': 'تم تعيين المشرف',
    'case.priority_set': 'تم تحديد الأولوية',
    'case.strength_set': 'تم تحديد قوة القضية',
    'case.risk_rating_set': 'تم تحديد تصنيف مخاطر القضية',
    'case.transferred_to_section_manager': 'تمت الإحالة إلى مدير القسم',
  },
};

export function resolveCaseAuditActionLabel(action: string, locale: AppLocale = 'en'): string {
  const map = resolveLexBilingual(caseAuditActionLabels, locale);
  return map[action] ?? map[normalizeToken(action)] ?? prettify(action);
}

export function useCaseAuditActionLabel(): (action: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (action: string) => resolveCaseAuditActionLabel(action, locale),
    [locale],
  );
}
