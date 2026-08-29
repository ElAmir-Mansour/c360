/**
 * Bilingual (EN / professional MSA AR) labels for the live what-if escalation
 * simulator. Resolve with:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? whatIfLabels.ar : whatIfLabels.en;
 *
 * Default is EN. The `en` and `ar` objects are kept structurally identical so
 * the resolved `t` is uniformly typed regardless of locale.
 */
import type { OrgEntityType, OrgRoleKey } from '@/lib/lex/admin';

export interface WhatIfLabels {
  title: string;
  description: string;
  /** Entity picker. */
  pickerLabel: string;
  pickerPlaceholder: string;
  pickerSearchPlaceholder: string;
  pickerNoMatches: string;
  /** Pre-selection prompt. */
  selectPromptTitle: string;
  selectPromptDescription: string;
  /** Ladder section. */
  ladderHeading: string;
  ladderHint: string;
  levelBadge: (level: number) => string;
  /** Row content. */
  fromEntity: string;
  onLeaveLabel: string;
  onLeaveAria: (roleLabel: string) => string;
  statusOriginal: string;
  statusSubstituted: string;
  statusUncovered: string;
  substitutedFrom: (entityCode: string) => string;
  uncoveredRow: string;
  gapRow: string;
  gapRowHint: string;
  /** Effective summary panel. */
  effectiveTitle: string;
  effectiveDescription: string;
  effectiveEmpty: string;
  effectiveAllFire: string;
  effectiveSomeUncovered: (count: number) => string;
  willNotify: string;
  /** States. */
  loadingLadder: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  entitiesEmptyTitle: string;
  entitiesEmptyDescription: string;
  resetToggles: string;
  unavailableCount: (count: number) => string;
  /** Per-role display names. */
  roleKeys: Record<OrgRoleKey, string>;
  /** Per-entity-type display names. */
  entityTypes: Record<OrgEntityType, string>;
}

const en: WhatIfLabels = {
  title: 'What-if escalation simulator',
  description:
    'Model an escalation before it happens: mark role holders as on leave and instantly see who the L1 → L2 → L3 notifications would actually reach — or where a rung would go uncovered and fail to fire.',
  pickerLabel: 'Entity',
  pickerPlaceholder: 'Select an entity to simulate…',
  pickerSearchPlaceholder: 'Search by name or code…',
  pickerNoMatches: 'No entities match your search.',
  selectPromptTitle: 'Pick an entity to simulate',
  selectPromptDescription:
    'Choose an org entity above to load its resolved escalation ladder, then toggle role holders on leave to preview the effective recipients.',
  ladderHeading: 'Resolved escalation ladder',
  ladderHint:
    'Toggle "On leave" on any holder to recompute the ladder against the live org chart.',
  levelBadge: (level) => `L${level}`,
  fromEntity: 'from',
  onLeaveLabel: 'On leave',
  onLeaveAria: (roleLabel) => `Mark the ${roleLabel} as on leave / unavailable`,
  statusOriginal: 'Original',
  statusSubstituted: 'Substituted',
  statusUncovered: 'Uncovered',
  substitutedFrom: (entityCode) => `Substituted from ${entityCode}`,
  uncoveredRow: 'UNCOVERED — would not fire',
  gapRow: 'No holder configured',
  gapRowHint: 'This rung has no role holder anywhere up the ancestry.',
  effectiveTitle: 'Effective notification recipients',
  effectiveDescription: 'The final list as it would actually fire after applying the toggles.',
  effectiveEmpty: 'No recipients would be notified — every rung is uncovered.',
  effectiveAllFire: 'All three levels would fire.',
  effectiveSomeUncovered: (count) =>
    `${count} ${count === 1 ? 'level is' : 'levels are'} uncovered and would not fire.`,
  willNotify: 'Would notify',
  loadingLadder: 'Resolving escalation ladder…',
  errorTitle: 'Could not load the escalation ladder',
  errorDescription: 'The resolved ladder for this entity could not be loaded. Please retry.',
  retry: 'Retry',
  entitiesEmptyTitle: 'No org entities yet',
  entitiesEmptyDescription:
    'Once org entities are configured, you can simulate their escalation here.',
  resetToggles: 'Reset',
  unavailableCount: (count) =>
    `${count} ${count === 1 ? 'holder' : 'holders'} marked on leave`,
  roleKeys: {
    section_supervisor: 'Section supervisor',
    department_manager: 'Department manager',
    shared_services_manager: 'Shared services manager',
    legal_director: 'Legal director',
    contracts_manager: 'Contracts manager',
    compliance_officer: 'Compliance officer',
    general_counsel: 'General counsel',
  },
  entityTypes: {
    company: 'Company',
    business_unit: 'Business unit',
    department: 'Department',
    section: 'Section',
    shared_services_unit: 'Shared services unit',
  },
};

const ar: WhatIfLabels = {
  title: 'محاكي التصعيد الافتراضي',
  description:
    'حاكِ التصعيد قبل وقوعه: حدِّد شاغلي الأدوار كَمَن هم في إجازة لترى فورًا الجهة التي ستصلها إشعارات المستوى الأول ← الثاني ← الثالث فعليًا، أو الموضع الذي تبقى فيه الدرجة دون تغطية فلا تُطلَق.',
  pickerLabel: 'الجهة',
  pickerPlaceholder: 'اختر جهة للمحاكاة…',
  pickerSearchPlaceholder: 'ابحث بالاسم أو الرمز…',
  pickerNoMatches: 'لا توجد جهات مطابقة لبحثك.',
  selectPromptTitle: 'اختر جهة للمحاكاة',
  selectPromptDescription:
    'اختر جهة تنظيمية من الأعلى لتحميل سلّم التصعيد المُحلّ الخاص بها، ثم بدِّل حالة شاغلي الأدوار إلى «في إجازة» لمعاينة المستلمين الفعليين.',
  ladderHeading: 'سلّم التصعيد المُحلّ',
  ladderHint: 'بدِّل «في إجازة» على أي شاغل لإعادة احتساب السلّم وفق الهيكل التنظيمي الحي.',
  levelBadge: (level) => `م${level}`,
  fromEntity: 'من',
  onLeaveLabel: 'في إجازة',
  onLeaveAria: (roleLabel) => `حدِّد ${roleLabel} كَمَن هو في إجازة / غير متاح`,
  statusOriginal: 'الأصلي',
  statusSubstituted: 'بديل',
  statusUncovered: 'دون تغطية',
  substitutedFrom: (entityCode) => `بديل من ${entityCode}`,
  uncoveredRow: 'دون تغطية — لن يُطلَق',
  gapRow: 'لا يوجد شاغل مُعَدّ',
  gapRowHint: 'لا يوجد شاغل لهذه الدرجة في أي موضع ضمن سلسلة الأصول.',
  effectiveTitle: 'المستلمون الفعليون للإشعار',
  effectiveDescription: 'القائمة النهائية كما ستُطلَق فعليًا بعد تطبيق عوامل التبديل.',
  effectiveEmpty: 'لن يُشعَر أي مستلم — جميع الدرجات دون تغطية.',
  effectiveAllFire: 'ستُطلَق المستويات الثلاثة جميعها.',
  effectiveSomeUncovered: (count) => `${count} ${count === 1 ? 'مستوى' : 'مستويات'} دون تغطية ولن تُطلَق.`,
  willNotify: 'سيُشعَر',
  loadingLadder: 'جارٍ حلّ سلّم التصعيد…',
  errorTitle: 'تعذّر تحميل سلّم التصعيد',
  errorDescription: 'تعذّر تحميل السلّم المُحلّ لهذه الجهة. يرجى إعادة المحاولة.',
  retry: 'إعادة المحاولة',
  entitiesEmptyTitle: 'لا توجد جهات تنظيمية بعد',
  entitiesEmptyDescription: 'بمجرد إعداد الجهات التنظيمية، يمكنك محاكاة تصعيدها هنا.',
  resetToggles: 'إعادة تعيين',
  unavailableCount: (count) => `${count} ${count === 1 ? 'شاغل' : 'شاغلين'} محدَّدون في إجازة`,
  roleKeys: {
    section_supervisor: 'مشرف القسم',
    department_manager: 'مدير الإدارة',
    shared_services_manager: 'مدير الخدمات المشتركة',
    legal_director: 'المدير القانوني',
    contracts_manager: 'مدير العقود',
    compliance_officer: 'مسؤول الامتثال',
    general_counsel: 'المستشار العام',
  },
  entityTypes: {
    company: 'شركة',
    business_unit: 'وحدة أعمال',
    department: 'إدارة',
    section: 'قسم',
    shared_services_unit: 'وحدة خدمات مشتركة',
  },
};

export const whatIfLabels = { en, ar } as const;
