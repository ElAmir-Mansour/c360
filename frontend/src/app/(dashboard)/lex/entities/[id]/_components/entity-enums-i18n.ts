'use client';

/**
 * ENTITY-360 detail — bilingual (English + Modern Standard Arabic) resolvers for
 * the RAW backend enum tokens surfaced on the entity-360 revamp surfaces (the
 * right-rail linked-records card and the organization/people card).
 *
 * Mirrors the service-desk `lex-enums-i18n.ts` contract (which we do NOT edit):
 * a `LexBilingual<T> = { en, ar }` bundle of enum maps keyed by the NORMALIZED
 * token, a pure `resolve*` function + a thin `use*` hook per enum, and a safe
 * {@link prettify} fallback for anything unmapped.
 *
 * NOTE — unlike the service desk (which leaks request-type / approval-step
 * tokens), the entity domain has little raw-enum leakage: record statuses are
 * already localized by `<LexStatusChip>` and the shared entity-i18n bundle. This
 * helper CENTRALIZES the few tokens the new rail surfaces render directly:
 *   - record KIND (contract / case / settlement) — subsection framing,
 *   - case company-status (plaintiff / defendant) — the client's posture,
 *   - a status-by-kind resolver — compact localized status text in the rail
 *     rows (kept as text, not a chip, so the 360px rail stays tight).
 *
 * Contract statuses reuse the canonical `lexContractStatusLabels` map from the
 * shared suite bundle rather than duplicating it.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import {
  type LexBilingual,
  resolveLexBilingual,
  lexContractStatusLabels,
} from '../../../_lib/lex-i18n';
import type { CaseCompanyStatus } from '@/lib/lex/cases';
import type { EntityRecordKind } from '../../_lib/entity-data';

/* ------------------------------------------------------------------------- *
 * Token normalisation + safe fallback (mirrors lex-enums-i18n.ts).
 * ------------------------------------------------------------------------- */

export function normalizeToken(token: string): string {
  return String(token ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

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
 * Enum maps (keys normalized; both locales carry the SAME key set).
 * ------------------------------------------------------------------------- */

const recordKindLabels: LexBilingual<Record<EntityRecordKind, string>> = {
  en: { contract: 'Contract', case: 'Case', settlement: 'Settlement' },
  ar: { contract: 'عقد', case: 'قضية', settlement: 'تسوية' },
};

const companyStatusLabels: LexBilingual<Record<CaseCompanyStatus, string>> = {
  en: { plaintiff: 'Plaintiff', defendant: 'Defendant' },
  ar: { plaintiff: 'مدّعٍ', defendant: 'مدّعى عليه' },
};

/** Litigation-case lifecycle statuses (raw `CaseStatus` tokens). */
const caseStatusLabels: LexBilingual<Record<string, string>> = {
  en: {
    intake: 'Intake',
    phase1: 'Phase 1',
    phase2: 'Phase 2',
    open: 'Open',
    under_procedure: 'Under procedure',
    on_hold: 'On hold',
    closed: 'Closed',
    cancelled: 'Cancelled',
  },
  ar: {
    intake: 'استقبال',
    phase1: 'المرحلة الأولى',
    phase2: 'المرحلة الثانية',
    open: 'مفتوحة',
    under_procedure: 'قيد الإجراء',
    on_hold: 'معلّقة',
    closed: 'مغلقة',
    cancelled: 'ملغاة',
  },
};

/** Settlement / ADR lifecycle statuses (raw `SettlementStatus` tokens). */
const settlementStatusLabels: LexBilingual<Record<string, string>> = {
  en: {
    proposed: 'Proposed',
    negotiating: 'Negotiating',
    pending_approval: 'Pending approval',
    approved: 'Approved',
    executed: 'Executed',
    rejected: 'Rejected',
    abandoned: 'Abandoned',
  },
  ar: {
    proposed: 'مقترحة',
    negotiating: 'قيد التفاوض',
    pending_approval: 'بانتظار الاعتماد',
    approved: 'معتمدة',
    executed: 'مُنفَّذة',
    rejected: 'مرفوضة',
    abandoned: 'متروكة',
  },
};

/* ------------------------------------------------------------------------- *
 * Record kind.
 * ------------------------------------------------------------------------- */

export function resolveRecordKindLabel(kind: EntityRecordKind, locale: AppLocale = 'en'): string {
  return resolveLexBilingual(recordKindLabels, locale)[kind] ?? prettify(kind);
}

export function useRecordKindLabel(): (kind: EntityRecordKind) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => (kind: EntityRecordKind) => resolveRecordKindLabel(kind, locale), [locale]);
}

/* ------------------------------------------------------------------------- *
 * Case company-status (the client's posture: plaintiff / defendant).
 * ------------------------------------------------------------------------- */

export function resolveCompanyStatusLabel(
  status: CaseCompanyStatus,
  locale: AppLocale = 'en',
): string {
  return resolveLexBilingual(companyStatusLabels, locale)[status] ?? prettify(status);
}

export function useCompanyStatusLabel(): (status: CaseCompanyStatus) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (status: CaseCompanyStatus) => resolveCompanyStatusLabel(status, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Status-by-kind — one resolver that dispatches to the right map for a linked
 * record's raw status token. Contracts reuse the canonical shared map.
 * ------------------------------------------------------------------------- */

export function resolveEntityStatusLabel(
  kind: EntityRecordKind,
  status: string,
  locale: AppLocale = 'en',
): string {
  const map =
    kind === 'contract'
      ? resolveLexBilingual(lexContractStatusLabels, locale)
      : kind === 'case'
        ? resolveLexBilingual(caseStatusLabels, locale)
        : resolveLexBilingual(settlementStatusLabels, locale);
  return pickFromMap(map, status);
}

export function useEntityStatusLabel(): (kind: EntityRecordKind, status: string) => string {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => (kind: EntityRecordKind, status: string) => resolveEntityStatusLabel(kind, status, locale),
    [locale],
  );
}
