'use client';

import { useMemo } from 'react';
import { useLocale } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

/**
 * Bilingual taxonomy labels for the clause library list surface.
 *
 * The clause-library page previously rendered several fixed vocabularies —
 * clause type, risk level, filter language, and a handful of filter/column
 * captions — as raw English tokens (`clause_type.replace(/_/g, ' ')`,
 * hard-coded `'Risk'` / `'Clause type'` strings). That reads inconsistently in
 * Arabic mode. This hook localizes those closed token sets so they match the
 * rest of the localized surface (status/governance already flow through
 * `LexStatusChip` + `useClauseLibraryLabels`).
 *
 * Kept as an additive, list-scoped helper (mirrors the `useClauseLibraryLabels`
 * pattern) so the large shared labels file stays untouched. Unknown tokens fall
 * back to a humanized form, so custom clause types coming from the backend still
 * render sensibly.
 */

function humanizeToken(value: string): string {
  return value.replace(/_/g, ' ').trim();
}

const CLAUSE_TYPE_LABELS: Record<AppLocale, Record<string, string>> = {
  en: {
    indemnification: 'Indemnification',
    termination: 'Termination',
    limitation_of_liability: 'Limitation of Liability',
    confidentiality: 'Confidentiality',
    ip_ownership: 'IP Ownership',
    non_compete: 'Non-Compete',
    payment_terms: 'Payment Terms',
    warranty: 'Warranty',
    force_majeure: 'Force Majeure',
    dispute_resolution: 'Dispute Resolution',
    data_protection: 'Data Protection',
    governing_law: 'Governing Law',
    assignment: 'Assignment',
    insurance: 'Insurance',
    audit_rights: 'Audit Rights',
    sla: 'SLA',
    auto_renewal: 'Auto-Renewal',
    representations: 'Representations',
    non_solicitation: 'Non-Solicitation',
    other: 'Other',
  },
  ar: {
    indemnification: 'التعويض',
    termination: 'الإنهاء',
    limitation_of_liability: 'تحديد المسؤولية',
    confidentiality: 'السرية',
    ip_ownership: 'ملكية الملكية الفكرية',
    non_compete: 'عدم المنافسة',
    payment_terms: 'شروط الدفع',
    warranty: 'الضمان',
    force_majeure: 'القوة القاهرة',
    dispute_resolution: 'تسوية النزاعات',
    data_protection: 'حماية البيانات',
    governing_law: 'القانون الحاكم',
    assignment: 'التنازل',
    insurance: 'التأمين',
    audit_rights: 'حقوق التدقيق',
    sla: 'اتفاقية مستوى الخدمة',
    auto_renewal: 'التجديد التلقائي',
    representations: 'الإقرارات والتعهدات',
    non_solicitation: 'عدم الاستقطاب',
    other: 'أخرى',
  },
};

const RISK_LABELS: Record<AppLocale, Record<string, string>> = {
  en: {
    none: 'None',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
  },
  ar: {
    none: 'بدون',
    low: 'منخفضة',
    medium: 'متوسطة',
    high: 'عالية',
    critical: 'حرجة',
  },
};

// Language names render as autonyms (each language named in its own script) so
// they read correctly in both UI locales and never surface a raw English token
// in the Arabic surface: العربية / الإنجليزية / ثنائي اللغة.
const LANGUAGE_LABELS: Record<AppLocale, Record<string, string>> = {
  en: { bilingual: 'ثنائي اللغة', en: 'الإنجليزية', ar: 'العربية' },
  ar: { bilingual: 'ثنائي اللغة', en: 'الإنجليزية', ar: 'العربية' },
};

// Clause lifecycle + governance status. Covers every `LexLibraryStatus` value so
// the drawer, delete-impact, bulk, and governance surfaces never humanize a raw
// token. Governance and library status share this vocabulary.
const STATUS_LABELS: Record<AppLocale, Record<string, string>> = {
  en: {
    draft: 'Draft',
    active: 'Active',
    in_review: 'In Review',
    pending_review: 'Pending Review',
    approved: 'Approved',
    rejected: 'Rejected',
    superseded: 'Superseded',
    deprecated: 'Deprecated',
    archived: 'Archived',
  },
  ar: {
    draft: 'مسودة',
    active: 'ساري',
    in_review: 'قيد المراجعة',
    pending_review: 'بانتظار المراجعة',
    approved: 'موافَق عليه',
    rejected: 'مرفوض',
    superseded: 'مُستبدَل',
    deprecated: 'موقوف',
    archived: 'مؤرشف',
  },
};

const NOT_SET_LABELS: Record<AppLocale, string> = {
  en: 'Not set',
  ar: 'غير محدّد',
};

const STATE_LABELS: Record<AppLocale, { errorTitle: string; errorDescription: string; retry: string }> = {
  en: {
    errorTitle: 'Could not load clauses',
    errorDescription: 'The clause summary failed to load. Retry to refresh this panel.',
    retry: 'Retry',
  },
  ar: {
    errorTitle: 'تعذّر تحميل البنود',
    errorDescription: 'فشل تحميل ملخص البنود. أعد المحاولة لتحديث هذه اللوحة.',
    retry: 'إعادة المحاولة',
  },
};

const FILTER_LABELS: Record<AppLocale, { clauseType: string; risk: string; language: string; category: string; tags: string }> = {
  en: {
    clauseType: 'Clause type',
    risk: 'Risk',
    language: 'Language',
    category: 'Category',
    tags: 'Tags',
  },
  ar: {
    clauseType: 'نوع البند',
    risk: 'المخاطر',
    language: 'اللغة',
    category: 'الفئة',
    tags: 'الوسوم',
  },
};

// Version-compare table on the version-history surface. Field captions are keyed
// by the compare field key (matching `buildClauseCompareFields`) so the utils
// helper can look one up by key without carrying English strings itself. The
// enum-valued rows (status/governance/risk/clause type) resolve their VALUES
// through `status`/`risk`/`clauseType` above — only these captions live here.
// The `id` key additionally localizes the lineage field badge (whose raw schema
// field is one of id/supersedes_id/deprecated_by_id/replacement_clause_id), so
// no snake_case token renders in the Arabic surface.
const COMPARE_CAPTION_LABELS: Record<AppLocale, Record<string, string>> = {
  en: {
    id: 'Clause ID',
    version: 'Version',
    title_en: 'English title',
    title_ar: 'Arabic title',
    text_en: 'English text',
    text_ar: 'Arabic text',
    status: 'Status',
    governance_status: 'Governance',
    risk_level: 'Risk level',
    clause_type: 'Clause type',
    category: 'Category',
    jurisdiction: 'Jurisdiction',
    source: 'Source',
    tags: 'Tags',
    supersedes_id: 'Supersedes ID',
    deprecated_by_id: 'Deprecated by ID',
    replacement_clause_id: 'Replacement clause ID',
  },
  ar: {
    id: 'معرّف البند',
    version: 'الإصدار',
    title_en: 'العنوان بالإنجليزية',
    title_ar: 'العنوان بالعربية',
    text_en: 'النص بالإنجليزية',
    text_ar: 'النص بالعربية',
    status: 'الحالة',
    governance_status: 'الحوكمة',
    risk_level: 'مستوى المخاطر',
    clause_type: 'نوع البند',
    category: 'الفئة',
    jurisdiction: 'الاختصاص القضائي',
    source: 'المصدر',
    tags: 'الوسوم',
    supersedes_id: 'معرّف البند المُستبدَل',
    deprecated_by_id: 'معرّف البند المُوقِف',
    replacement_clause_id: 'معرّف البند البديل',
  },
};

// Lineage relation captions rendered by `getClauseVersionReferences`. Verbs are
// aligned with the shared status vocabulary above (superseded → مُستبدَل,
// deprecated → موقوف) so the lineage and status surfaces read consistently.
const COMPARE_REFERENCE_LABELS: Record<
  AppLocale,
  { current: string; supersedes: string; deprecated_by: string; replacement: string }
> = {
  en: {
    current: 'Current version',
    supersedes: 'Supersedes',
    deprecated_by: 'Deprecated by',
    replacement: 'Replacement clause',
  },
  ar: {
    current: 'الإصدار الحالي',
    supersedes: 'يَستبدل',
    deprecated_by: 'موقوف بواسطة',
    replacement: 'البند البديل',
  },
};

// Free-standing literals the compare/lineage helpers emit for empty or boolean
// cells. `notLoadedSuffix` is the parenthetical for a referenced-but-unfetched
// clause id (`<id> (not loaded)`).
const COMPARE_LITERAL_LABELS: Record<
  AppLocale,
  { versionNotSet: string; noComparison: string; yes: string; no: string; notLoadedSuffix: string }
> = {
  en: {
    versionNotSet: 'Version not set',
    noComparison: 'No comparison selected',
    yes: 'Yes',
    no: 'No',
    notLoadedSuffix: 'not loaded',
  },
  ar: {
    versionNotSet: 'الإصدار غير محدّد',
    noComparison: 'لم يتم اختيار مقارنة',
    yes: 'نعم',
    no: 'لا',
    notLoadedSuffix: 'غير مُحمّل',
  },
};

export interface ClauseTaxonomyLabels {
  /** Localized clause-type label; empty → `notSet`, else humanized fallback. */
  clauseType(value: string | null | undefined): string;
  /** Localized risk-level label; empty → `notSet`, else humanized fallback. */
  risk(value: string | null | undefined): string;
  /** Localized language label (autonym); empty → `notSet`. */
  language(value: string | null | undefined): string;
  /** Localized clause/governance status label; empty → `notSet`. */
  status(value: string | null | undefined): string;
  /** Localized "not set" placeholder. */
  notSet: string;
  filters: {
    clauseType: string;
    risk: string;
    language: string;
    category: string;
    tags: string;
  };
  states: {
    errorTitle: string;
    errorDescription: string;
    retry: string;
  };
  /**
   * Version-compare + lineage vocabulary for the version-history surface. Field
   * captions are keyed by compare field key; enum-valued rows still resolve
   * their VALUES through `status`/`risk`/`clauseType`/`notSet` above.
   */
  compare: {
    /** Field caption keyed by compare field key; missing keys fall back to the key. */
    captions: Record<string, string>;
    /** Lineage relation captions. */
    references: {
      current: string;
      supersedes: string;
      deprecated_by: string;
      replacement: string;
    };
    /** `formatClauseVersion` placeholder when a version is absent. */
    versionNotSet: string;
    /** Comparison column placeholder when no target version is selected. */
    noComparison: string;
    /** Boolean-cell labels. */
    yes: string;
    no: string;
    /** `<id> (not loaded)` for a referenced-but-unfetched clause. */
    notLoaded(id: string): string;
  };
}

export function useClauseTaxonomyLabels(): ClauseTaxonomyLabels {
  const { locale } = useLocale();
  const active: AppLocale = locale === 'ar' ? 'ar' : 'en';

  return useMemo<ClauseTaxonomyLabels>(() => {
    const clauseTypes = CLAUSE_TYPE_LABELS[active];
    const risks = RISK_LABELS[active];
    const languages = LANGUAGE_LABELS[active];
    const statuses = STATUS_LABELS[active];
    const notSet = NOT_SET_LABELS[active];
    // Resolve a token against its closed vocabulary; blank tokens read as the
    // localized "not set" placeholder, unknown tokens degrade to a humanized
    // form so custom backend values still render sensibly (never a raw en label).
    const resolve = (map: Record<string, string>, value: string | null | undefined) => {
      const token = String(value ?? '').trim();
      if (!token) {
        return notSet;
      }
      return map[token.toLowerCase()] ?? humanizeToken(token);
    };
    return {
      clauseType: (value) => resolve(clauseTypes, value),
      risk: (value) => resolve(risks, value),
      language: (value) => resolve(languages, value),
      status: (value) => resolve(statuses, value),
      notSet,
      filters: FILTER_LABELS[active],
      states: STATE_LABELS[active],
      compare: {
        captions: COMPARE_CAPTION_LABELS[active],
        references: COMPARE_REFERENCE_LABELS[active],
        versionNotSet: COMPARE_LITERAL_LABELS[active].versionNotSet,
        noComparison: COMPARE_LITERAL_LABELS[active].noComparison,
        yes: COMPARE_LITERAL_LABELS[active].yes,
        no: COMPARE_LITERAL_LABELS[active].no,
        notLoaded: (id: string) => `${id} (${COMPARE_LITERAL_LABELS[active].notLoadedSuffix})`,
      },
    };
  }, [active]);
}
