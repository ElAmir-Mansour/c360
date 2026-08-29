'use client';

/**
 * Bilingual (English + Modern Standard Arabic) resolvers for the RAW backend
 * enum tokens surfaced on the Legal Consultation *detail* page.
 *
 * The backend returns enum values as English machine tokens — consultation
 * types (`intellectual_property`), lifecycle statuses (`responded`), audit
 * action verbs (`document_attached`) and approval task statuses (`pending`). On
 * the Arabic (RTL) surface those leak through untranslated. This module turns
 * each raw token into a localized display string.
 *
 * Follows the canonical lex i18n contract (`../../../_lib/lex-i18n`). Type /
 * status / priority reuse the existing `filters.*Options` maps from
 * `../../_components/labels.ts` (single source of truth) rather than duplicating
 * them; audit actions + approval-task statuses get their own maps here. Anything
 * unknown falls back to {@link prettify}.
 *
 * Every export comes in two forms: a PURE resolver `resolve*Label(token, locale)`
 * for non-React callers and a thin React hook `use*Label()` bound to the active
 * locale.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../../_lib/lex-i18n';
import { resolveConsultationLabels } from '../../_components/labels';

/* ------------------------------------------------------------------------- *
 * Token normalisation + safe fallback.
 * ------------------------------------------------------------------------- */

/** Fold `LABOR`, `labor`, `labor law` → one lookup key (`labor_law`/`labor`). */
export function normalizeToken(token: string): string {
  return String(token ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Safe display fallback for an unmapped token: `document_attached` → `Document Attached`. */
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

/** Resolve a raw token against a resolved (single-locale) label map. */
function pickFromMap(map: Record<string, string>, token: string): string {
  if (token == null) return '';
  return map[token] ?? map[normalizeToken(token)] ?? prettify(token);
}

/* ------------------------------------------------------------------------- *
 * Audit action + approval task-status maps (keyed by NORMALIZED token).
 * ------------------------------------------------------------------------- */

interface ConsultationEnumMaps {
  /** Governance audit action verbs. */
  action: Record<string, string>;
  /** Approval (human) task statuses. */
  approvalTaskStatus: Record<string, string>;
}

const CONSULTATION_ENUM_LABELS: LexBilingual<ConsultationEnumMaps> = {
  en: {
    action: {
      submitted: 'Submitted',
      created: 'Created',
      classified: 'Classified',
      routed: 'Routed',
      responded: 'Responded',
      response_recorded: 'Response recorded',
      approved: 'Approved',
      rejected: 'Rejected',
      archived: 'Archived',
      deleted: 'Deleted',
      document_attached: 'Document attached',
      document_detached: 'Document removed',
      approval_started: 'Approval started',
      approval_decided: 'Approval decided',
      tagged: 'Tagged',
      updated: 'Updated',
    },
    approvalTaskStatus: {
      pending: 'Pending',
      claimed: 'Claimed',
      in_progress: 'In progress',
      completed: 'Completed',
      approved: 'Approved',
      rejected: 'Rejected',
      escalated: 'Escalated',
      cancelled: 'Cancelled',
      expired: 'Expired',
    },
  },
  ar: {
    action: {
      submitted: 'مُقدَّمة',
      created: 'أُنشئت',
      classified: 'مُصنَّفة',
      routed: 'مُوجَّهة',
      responded: 'تم الرد',
      response_recorded: 'سُجّل الرد',
      approved: 'معتمدة',
      rejected: 'مرفوضة',
      archived: 'مؤرشفة',
      deleted: 'محذوفة',
      document_attached: 'أُرفق مستند',
      document_detached: 'أُزيل مستند',
      approval_started: 'بدأ الاعتماد',
      approval_decided: 'صدر قرار الاعتماد',
      tagged: 'مُوسَّمة',
      updated: 'مُحدَّثة',
    },
    approvalTaskStatus: {
      pending: 'قيد الانتظار',
      claimed: 'مُستلَمة',
      in_progress: 'قيد التنفيذ',
      completed: 'مكتملة',
      approved: 'معتمدة',
      rejected: 'مرفوضة',
      escalated: 'مُصعَّدة',
      cancelled: 'مُلغاة',
      expired: 'منتهية',
    },
  },
};

/* ------------------------------------------------------------------------- *
 * Consultation type (reuses labels.ts filters.typeOptions).
 * ------------------------------------------------------------------------- */

export function resolveConsultationTypeLabel(type: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveConsultationLabels(locale).filters.typeOptions, type);
}

export function useConsultationTypeLabel(): (type: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (type: string) => resolveConsultationTypeLabel(type, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Consultation status (reuses labels.ts filters.statusOptions).
 * ------------------------------------------------------------------------- */

export function resolveConsultationStatusLabel(status: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveConsultationLabels(locale).filters.statusOptions, status);
}

export function useConsultationStatusLabel(): (status: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (status: string) => resolveConsultationStatusLabel(status, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Consultation priority (reuses labels.ts filters.priorityOptions).
 * ------------------------------------------------------------------------- */

export function resolveConsultationPriorityLabel(priority: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveConsultationLabels(locale).filters.priorityOptions, priority);
}

export function useConsultationPriorityLabel(): (priority: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (priority: string) => resolveConsultationPriorityLabel(priority, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Audit action verb.
 * ------------------------------------------------------------------------- */

export function resolveConsultationActionLabel(action: string, locale: AppLocale = 'en'): string {
  return pickFromMap(resolveLexBilingual(CONSULTATION_ENUM_LABELS, locale).action, action);
}

export function useConsultationActionLabel(): (action: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (action: string) => resolveConsultationActionLabel(action, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Approval (human) task status.
 * ------------------------------------------------------------------------- */

export function resolveConsultationApprovalStatusLabel(
  status: string,
  locale: AppLocale = 'en',
): string {
  return pickFromMap(
    resolveLexBilingual(CONSULTATION_ENUM_LABELS, locale).approvalTaskStatus,
    status,
  );
}

export function useConsultationApprovalStatusLabel(): (status: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (status: string) => resolveConsultationApprovalStatusLabel(status, locale),
    [locale],
  );
}
