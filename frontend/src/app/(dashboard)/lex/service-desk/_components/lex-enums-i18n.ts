'use client';

/**
 * Bilingual (English + Modern Standard Arabic) resolvers for the RAW backend
 * enum tokens surfaced on the Legal Service Desk *request detail* page.
 *
 * The backend returns enum values as English machine tokens — request types
 * ("legal consultation" / "LEGAL_CONSULTATION"), lifecycle statuses
 * ("in_execution"), approval workflow step names ("Approve request") and
 * approval task statuses ("pending"). On the Arabic (RTL) surface those leak
 * through untranslated. This module turns each raw token into a localized
 * display string.
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale. Enum maps are keyed by the NORMALIZED token so a single
 * key set serves the code form, the lowercased-code form and the
 * spaced-lowercase form. Anything unknown falls back to {@link prettify}.
 *
 * Every export comes in two forms: a PURE resolver `resolve*Label(token, locale)`
 * for non-React callers (loaders, tests, `page.tsx` server-adjacent helpers) and
 * a thin React hook `use*Label()` that binds the active locale. Status and
 * priority reuse the existing `statusOptions` / `priorityOptions` maps from
 * `labels.ts` rather than duplicating them.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import type { RequestPriority, RequestStatus } from '@/lib/lex/requests';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import { resolveServiceDeskLabels } from './labels';

/* ------------------------------------------------------------------------- *
 * Token normalisation + safe fallback.
 * ------------------------------------------------------------------------- */

/**
 * normalizeToken lower-cases, trims, collapses internal whitespace and unifies
 * word separators to a single underscore. This folds the three shapes a token
 * can arrive in — `LEGAL_CONSULTATION`, `legal_consultation`, and
 * `legal consultation` — onto one lookup key (`legal_consultation`).
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
 * with spaces, collapse runs, and Title-Case each word (e.g. `some_new_status`
 * → `Some New Status`, `LEGAL_CONSULTATION` → `Legal Consultation`). Empty /
 * nullish input yields an empty string.
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

/**
 * pickFromMap resolves a raw token against a resolved (single-locale) label map:
 * try the token verbatim, then its normalized form, then a locale-safe fallback.
 */
function pickFromMap(map: Record<string, string>, token: string, locale: AppLocale): string {
  if (token == null) return '';
  return map[token] ?? map[normalizeToken(token)] ?? (locale === 'ar' ? 'غير معروف' : prettify(token));
}

/* ------------------------------------------------------------------------- *
 * The bilingual bundle of enum maps.
 *
 * Keys are the NORMALIZED token (lowercase + single underscores). Both locales
 * carry the SAME key set. Statuses/priorities are intentionally absent here —
 * they reuse the `labels.ts` maps via the resolvers below.
 * ------------------------------------------------------------------------- */

interface LexEnumMaps {
  /** Legal service / request-type codes (standard services, routing aliases + the case SLA code). */
  serviceType: Record<string, string>;
  /** Linked-subject kinds a request can spawn (case / consultation / matter …). */
  subjectType: Record<string, string>;
  /** Approval workflow step / task names. */
  approvalTask: Record<string, string>;
  /** Approval (human) task statuses. */
  approvalTaskStatus: Record<string, string>;
}

const LEX_ENUM_LABELS: LexBilingual<LexEnumMaps> = {
  en: {
    serviceType: {
      legal_consultation: 'Legal consultation',
      consultation: 'Legal consultation',
      contract_review: 'Contract review',
      contract_drafting: 'Contract drafting',
      litigation: 'Litigation',
      litigation_support: 'Litigation support',
      legal_opinion: 'Legal opinion',
      regulatory_compliance: 'Regulatory compliance',
      power_of_attorney: 'Power of attorney',
      enforcement: 'Enforcement',
      investigation: 'Investigation',
      legal_investigation: 'Legal investigation',
      general_legal_request: 'General legal request',
      legal_case: 'Legal case',
    },
    subjectType: {
      legal_case: 'Legal case',
      consultation: 'Consultation',
      litigation: 'Litigation',
      matter: 'Matter',
      contract: 'Contract',
      document: 'Document',
      legal_opinion: 'Legal opinion',
    },
    approvalTask: {
      approve_request: 'Approve request',
      requester_approval: 'Requester approval',
      provider_approval: 'Provider approval',
      requester_review: 'Requester review',
      provider_review: 'Provider review',
      legal_review: 'Legal review',
      approve: 'Approve',
      reject: 'Reject',
      // Settlement approval workflow (settlement_service.go) step + task names.
      settlement_approval: 'Settlement approval',
      approve_settlement: 'Approve settlement',
      // Investigation results-approval workflow (investigation_service.go).
      investigation_results_approval: 'Investigation results approval',
      approve_investigation_results: 'Approve investigation results',
      // Shared workflow end-step name.
      completed: 'Completed',
    },
    approvalTaskStatus: {
      pending: 'Pending',
      in_progress: 'In progress',
      completed: 'Completed',
      approved: 'Approved',
      rejected: 'Rejected',
      cancelled: 'Cancelled',
      expired: 'Expired',
    },
  },
  ar: {
    serviceType: {
      legal_consultation: 'استشارة قانونية',
      consultation: 'استشارة قانونية',
      contract_review: 'مراجعة عقد',
      contract_drafting: 'صياغة عقد',
      litigation: 'التقاضي',
      litigation_support: 'دعم التقاضي',
      legal_opinion: 'رأي قانوني',
      regulatory_compliance: 'الامتثال التنظيمي',
      power_of_attorney: 'توكيل',
      enforcement: 'تنفيذ',
      investigation: 'تحقيق',
      legal_investigation: 'تحقيق قانوني',
      general_legal_request: 'طلب قانوني عام',
      legal_case: 'قضية قانونية',
    },
    subjectType: {
      legal_case: 'قضية قانونية',
      consultation: 'استشارة',
      litigation: 'تقاضٍ',
      matter: 'ملف قانوني',
      contract: 'عقد',
      document: 'وثيقة',
      legal_opinion: 'رأي قانوني',
    },
    approvalTask: {
      approve_request: 'اعتماد الطلب',
      requester_approval: 'موافقة مقدّم الطلب',
      provider_approval: 'موافقة مقدّم الخدمة',
      requester_review: 'مراجعة مقدّم الطلب',
      provider_review: 'مراجعة مقدّم الخدمة',
      legal_review: 'مراجعة قانونية',
      approve: 'اعتماد',
      reject: 'رفض',
      // Settlement approval workflow (settlement_service.go) step + task names.
      settlement_approval: 'اعتماد التسوية',
      approve_settlement: 'اعتماد التسوية',
      // Investigation results-approval workflow (investigation_service.go).
      investigation_results_approval: 'اعتماد نتائج التحقيق',
      approve_investigation_results: 'اعتماد نتائج التحقيق',
      // Shared workflow end-step name.
      completed: 'مكتمل',
    },
    approvalTaskStatus: {
      pending: 'قيد الانتظار',
      in_progress: 'قيد التنفيذ',
      completed: 'مكتملة',
      approved: 'معتمدة',
      rejected: 'مرفوضة',
      cancelled: 'مُلغاة',
      expired: 'منتهية',
    },
  },
};

/* ------------------------------------------------------------------------- *
 * Service type / request type.
 * ------------------------------------------------------------------------- */

/**
 * resolveServiceTypeLabel maps a raw request-type token — a legal service code
 * (`LEGAL_CONSULTATION`), its lowercased form (`legal_consultation`) or the
 * spaced-lowercase form (`legal consultation`) — to its localized name. Unknown
 * tokens fall back to {@link prettify}.
 */
export function resolveServiceTypeLabel(requestType: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveLexBilingual(LEX_ENUM_LABELS, locale).serviceType, requestType, locale);
}

/** React hook form of {@link resolveServiceTypeLabel}, bound to the active locale. */
export function useServiceTypeLabel(): (requestType: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (requestType: string) => resolveServiceTypeLabel(requestType, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Linked-subject type (the downstream matter a request spawns).
 * ------------------------------------------------------------------------- */

/**
 * resolveSubjectTypeLabel maps a request's `subject_type` token — the kind of
 * downstream matter it spawned (`legal_case` / `consultation`, and the routing
 * aliases `litigation` / `matter` / `contract` / `document` / `legal_opinion`)
 * — to its localized name. Unknown tokens fall back to {@link prettify}.
 */
export function resolveSubjectTypeLabel(subjectType: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveLexBilingual(LEX_ENUM_LABELS, locale).subjectType, subjectType, locale);
}

/** React hook form of {@link resolveSubjectTypeLabel}, bound to the active locale. */
export function useSubjectTypeLabel(): (subjectType: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (subjectType: string) => resolveSubjectTypeLabel(subjectType, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Request lifecycle status (reuses labels.ts statusOptions).
 * ------------------------------------------------------------------------- */

/**
 * resolveRequestStatusLabel maps a request lifecycle status to its localized
 * label, reusing the canonical `statusOptions` map from `labels.ts`. Unknown
 * tokens fall back to {@link prettify}.
 */
export function resolveRequestStatusLabel(status: RequestStatus, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveServiceDeskLabels(locale).statusOptions, status, locale);
}

/** React hook form of {@link resolveRequestStatusLabel}, bound to the active locale. */
export function useRequestStatusLabel(): (status: RequestStatus) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (status: RequestStatus) => resolveRequestStatusLabel(status, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Approval workflow step name.
 * ------------------------------------------------------------------------- */

/**
 * resolveApprovalTaskLabel maps a workflow approval step name (e.g.
 * "Approve request", "Requester approval", "Provider Approval") to its
 * localized label, case-insensitively. Unknown names fall back to
 * {@link prettify}.
 */
export function resolveApprovalTaskLabel(name: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveLexBilingual(LEX_ENUM_LABELS, locale).approvalTask, name, locale);
}

/** React hook form of {@link resolveApprovalTaskLabel}, bound to the active locale. */
export function useApprovalTaskLabel(): (name: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (name: string) => resolveApprovalTaskLabel(name, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Approval (human) task status.
 * ------------------------------------------------------------------------- */

/**
 * resolveApprovalTaskStatusLabel maps an approval task status (`pending`,
 * `in_progress`, `completed`, `approved`, `rejected`, `cancelled`, `expired`)
 * to its localized label. Unknown tokens fall back to {@link prettify}.
 */
export function resolveApprovalTaskStatusLabel(status: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveLexBilingual(LEX_ENUM_LABELS, locale).approvalTaskStatus, status, locale);
}

/** React hook form of {@link resolveApprovalTaskStatusLabel}, bound to the active locale. */
export function useApprovalTaskStatusLabel(): (status: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (status: string) => resolveApprovalTaskStatusLabel(status, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Priority (reuses labels.ts priorityOptions).
 * ------------------------------------------------------------------------- */

/**
 * resolvePriorityLabel maps a request priority (`urgent` / `normal`) to its
 * localized label, reusing the canonical `priorityOptions` map from
 * `labels.ts`. Unknown tokens fall back to {@link prettify}.
 */
export function resolvePriorityLabel(priority: RequestPriority, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveServiceDeskLabels(locale).priorityOptions, priority, locale);
}

/** React hook form of {@link resolvePriorityLabel}, bound to the active locale. */
export function usePriorityLabel(): (priority: RequestPriority) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (priority: RequestPriority) => resolvePriorityLabel(priority, locale), [locale]);
}
