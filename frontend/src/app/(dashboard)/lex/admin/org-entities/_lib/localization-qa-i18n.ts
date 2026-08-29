/**
 * Bilingual (EN / professional MSA AR) labels for the org-entity bilingual
 * completeness QA panel (Watheeq / Saudi).
 *
 * Resolve with:
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? labels.ar : labels.en;
 *
 * Default is EN. The `en` and `ar` objects are kept structurally identical so
 * the resolved `t` is uniformly typed regardless of locale.
 */
import type { LocalizationScope, LocalizationSide } from './org-localization';

export interface LocalizationQaLabels {
  title: string;
  description: string;
  /** KPI strip. */
  kpiOverall: string;
  kpiEntities: string;
  kpiRoles: string;
  kpiOverallDesc: string;
  kpiEntitiesDesc: string;
  kpiRolesDesc: string;
  /** Coverage of N of M strings line. */
  coverageMeta: (complete: number, total: number) => string;
  /** Missing list. */
  missingTitle: string;
  missingCount: (count: number) => string;
  exportButton: string;
  /** Scope chips. */
  scope: Record<LocalizationScope, string>;
  /** "Role:" prefix for the role-label scope. */
  roleKeyPrefix: string;
  /** Missing-side badges. */
  missingSide: Record<LocalizationSide, string>;
  /** Preview row. */
  presentLabel: string;
  presentEmpty: string;
  fixLink: string;
  /** Empty (fully localized) state. */
  emptyTitle: string;
  emptyDescription: string;
  /** Error / loading. */
  errorTitle: string;
  errorDescription: string;
  retry: string;
  loadingLabel: string;
  /** CSV header row. */
  csvHeaders: {
    entity_code: string;
    scope: string;
    role_key: string;
    missing_side: string;
    present_text: string;
  };
}

const en: LocalizationQaLabels = {
  title: 'Bilingual completeness QA',
  description:
    'Watheeq compliance check: verify that every org entity name and role label carries BOTH Arabic and English. Rows deep-link to the entity for fixing.',
  kpiOverall: 'Overall coverage',
  kpiEntities: 'Entity names',
  kpiRoles: 'Role labels',
  kpiOverallDesc: 'All localizable strings, AR + EN',
  kpiEntitiesDesc: 'Names with both locales filled',
  kpiRolesDesc: 'Labels with both locales filled',
  coverageMeta: (complete, total) =>
    `${complete} of ${total} strings fully localized`,
  missingTitle: 'Missing translations',
  missingCount: (count) => `${count} ${count === 1 ? 'gap' : 'gaps'}`,
  exportButton: 'Export missing (CSV)',
  scope: {
    entity_name: 'Entity name',
    role_label: 'Role label',
  },
  roleKeyPrefix: 'Role',
  missingSide: {
    ar: 'Missing Arabic',
    en: 'Missing English',
  },
  presentLabel: 'Present',
  presentEmpty: 'Both sides empty',
  fixLink: 'Fix',
  emptyTitle: 'Fully localized',
  emptyDescription: 'AR + EN complete everywhere — no bilingual gaps found.',
  errorTitle: 'Could not load entities',
  errorDescription: 'The org-entity registry could not be loaded. Please retry.',
  retry: 'Retry',
  loadingLabel: 'Scanning localization…',
  csvHeaders: {
    entity_code: 'entity_code',
    scope: 'scope',
    role_key: 'role_key',
    missing_side: 'missing_side',
    present_text: 'present_text',
  },
};

const ar: LocalizationQaLabels = {
  title: 'فحص اكتمال الترجمة الثنائية',
  description:
    'فحص امتثال وثيق: تأكَّد من أن كل اسم جهة تنظيمية وكل تسمية دور يحملان العربية والإنجليزية معًا. تنقلك الصفوف مباشرةً إلى الجهة لإصلاحها.',
  kpiOverall: 'التغطية الإجمالية',
  kpiEntities: 'أسماء الجهات',
  kpiRoles: 'تسميات الأدوار',
  kpiOverallDesc: 'جميع النصوص القابلة للترجمة، عربي + إنجليزي',
  kpiEntitiesDesc: 'الأسماء المكتملة باللغتين',
  kpiRolesDesc: 'التسميات المكتملة باللغتين',
  coverageMeta: (complete, total) =>
    `${complete} من ${total} نص مترجم بالكامل`,
  missingTitle: 'الترجمات الناقصة',
  missingCount: (count) => `${count} ${count === 1 ? 'فجوة' : 'فجوة'}`,
  exportButton: 'تصدير الناقص (CSV)',
  scope: {
    entity_name: 'اسم الجهة',
    role_label: 'تسمية الدور',
  },
  roleKeyPrefix: 'الدور',
  missingSide: {
    ar: 'العربية ناقصة',
    en: 'الإنجليزية ناقصة',
  },
  presentLabel: 'المتوفّر',
  presentEmpty: 'كلا الجانبين فارغ',
  fixLink: 'إصلاح',
  emptyTitle: 'مترجم بالكامل',
  emptyDescription: 'العربية + الإنجليزية مكتملتان في كل مكان — لا توجد فجوات لغوية.',
  errorTitle: 'تعذّر تحميل الجهات',
  errorDescription: 'تعذّر تحميل سجل الجهات التنظيمية. يرجى إعادة المحاولة.',
  retry: 'إعادة المحاولة',
  loadingLabel: 'جارٍ فحص الترجمة…',
  // CSV headers stay machine-stable in English on both locales (spec columns).
  csvHeaders: {
    entity_code: 'entity_code',
    scope: 'scope',
    role_key: 'role_key',
    missing_side: 'missing_side',
    present_text: 'present_text',
  },
};

export const localizationQaLabels = { en, ar } as const;
