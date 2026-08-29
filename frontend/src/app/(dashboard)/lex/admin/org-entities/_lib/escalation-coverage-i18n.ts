/**
 * Bilingual (EN / professional MSA AR) labels for the escalation coverage
 * heatmap. Resolve with:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? labels.ar : labels.en;
 *
 * Default is EN. The `en` and `ar` objects are kept structurally identical so
 * the resolved `t` is uniformly typed regardless of locale.
 */
import type { OrgEntityType, OrgRoleKey } from '@/lib/lex/admin';

export interface CoverageLabels {
  title: string;
  description: string;
  /** Column header for the entity column. */
  entityColumn: string;
  /** Search box. */
  searchPlaceholder: string;
  /** Entity-type filter. */
  typeFilterLabel: string;
  typeFilterAll: string;
  activeOnly: string;
  /** Row-cap notice, e.g. "Showing 200 of 412". */
  showingCount: (shown: number, total: number) => string;
  rowCapNotice: (cap: number) => string;
  /** KPI strip. */
  kpiNoCoverage: string;
  kpiInherited: string;
  kpiBound: string;
  kpiCoverage: string;
  /** Legend. */
  legendTitle: string;
  legendBound: string;
  legendInherited: string;
  legendNone: string;
  /** Cell tooltips. */
  cellBound: (code: string) => string;
  cellInherited: (ancestorCode: string) => string;
  cellNone: string;
  cellAssignHint: string;
  /** Group headers over the columns. */
  ladderGroup: string;
  governanceGroup: string;
  levelBadge: (level: number) => string;
  /** Empty / error states. */
  emptyTitle: string;
  emptyDescription: string;
  emptyFilteredTitle: string;
  emptyFilteredDescription: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  /** Assign dialog. */
  dialogTitle: string;
  dialogDescription: (entityCode: string, roleLabel: string) => string;
  dialogUser: string;
  dialogSelectUser: string;
  dialogSearchUsers: string;
  dialogLoadingUsers: string;
  dialogNoUsers: string;
  dialogUsersLoadError: string;
  dialogRetry: string;
  dialogLabelEn: string;
  dialogLabelAr: string;
  dialogCancel: string;
  dialogSubmit: string;
  dialogUserRequired: string;
  dialogToastAssigned: string;
  /** Per-role display names. */
  roleKeys: Record<OrgRoleKey, string>;
  /** Per-entity-type display names. */
  entityTypes: Record<OrgEntityType, string>;
}

const en: CoverageLabels = {
  title: 'Escalation coverage heatmap',
  description:
    'Tenant-wide view of which entities have escalation and governance roles bound, inherited, or missing entirely — to de-risk SLA escalation.',
  entityColumn: 'Entity',
  searchPlaceholder: 'Search by name or code…',
  typeFilterLabel: 'Type',
  typeFilterAll: 'All types',
  activeOnly: 'Active only',
  showingCount: (shown, total) => `Showing ${shown} of ${total} entities`,
  rowCapNotice: (cap) =>
    `Showing the first ${cap} matches. Refine your search or filters to narrow the list.`,
  kpiNoCoverage: 'No coverage',
  kpiInherited: 'Inherited',
  kpiBound: 'Bound here',
  kpiCoverage: 'Overall coverage',
  legendTitle: 'Legend',
  legendBound: 'Bound on this entity',
  legendInherited: 'Inherited from an ancestor',
  legendNone: 'No coverage in ancestry',
  cellBound: (code) => `Bound on ${code}`,
  cellInherited: (ancestorCode) => `Inherited from ${ancestorCode}`,
  cellNone: 'No coverage in ancestry',
  cellAssignHint: 'Click to assign a role holder',
  ladderGroup: 'Escalation ladder',
  governanceGroup: 'Governance',
  levelBadge: (level) => `L${level}`,
  emptyTitle: 'No org entities yet',
  emptyDescription:
    'Once org entities and their roles are configured, their escalation coverage will appear here.',
  emptyFilteredTitle: 'No matching entities',
  emptyFilteredDescription: 'No entities match the current search and filters. Try clearing them.',
  errorTitle: 'Could not load coverage',
  errorDescription: 'The org-entity registry could not be loaded. Please retry.',
  retry: 'Retry',
  dialogTitle: 'Assign role holder',
  dialogDescription: (entityCode, roleLabel) =>
    `Bind a ${roleLabel} directly on ${entityCode} to close this coverage gap.`,
  dialogUser: 'User',
  dialogSelectUser: 'Select a user',
  dialogSearchUsers: 'Search by name or email…',
  dialogLoadingUsers: 'Loading users…',
  dialogNoUsers: 'No active users found.',
  dialogUsersLoadError: 'Could not load the user directory.',
  dialogRetry: 'Retry',
  dialogLabelEn: 'Label (English)',
  dialogLabelAr: 'Label (Arabic)',
  dialogCancel: 'Cancel',
  dialogSubmit: 'Assign',
  dialogUserRequired: 'Select a user.',
  dialogToastAssigned: 'Role holder assigned.',
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

const ar: CoverageLabels = {
  title: 'خريطة تغطية التصعيد',
  description:
    'عرض على مستوى المستأجر يوضّح الجهات التي تملك أدوار التصعيد والحوكمة مُسندةً مباشرةً أو موروثةً أو مفقودةً تمامًا، للحد من مخاطر تصعيد اتفاقية مستوى الخدمة.',
  entityColumn: 'الجهة',
  searchPlaceholder: 'ابحث بالاسم أو الرمز…',
  typeFilterLabel: 'النوع',
  typeFilterAll: 'جميع الأنواع',
  activeOnly: 'النشطة فقط',
  showingCount: (shown, total) => `عرض ${shown} من ${total} جهة`,
  rowCapNotice: (cap) => `يتم عرض أول ${cap} نتيجة. حسِّن البحث أو عوامل التصفية لتضييق القائمة.`,
  kpiNoCoverage: 'دون تغطية',
  kpiInherited: 'موروثة',
  kpiBound: 'مُسندة هنا',
  kpiCoverage: 'التغطية الإجمالية',
  legendTitle: 'مفتاح الرموز',
  legendBound: 'مُسندة على هذه الجهة',
  legendInherited: 'موروثة من جهة أصل',
  legendNone: 'لا تغطية ضمن سلسلة الأصول',
  cellBound: (code) => `مُسندة على ${code}`,
  cellInherited: (ancestorCode) => `موروثة من ${ancestorCode}`,
  cellNone: 'لا تغطية ضمن سلسلة الأصول',
  cellAssignHint: 'انقر لإسناد شاغل الدور',
  ladderGroup: 'سلّم التصعيد',
  governanceGroup: 'الحوكمة',
  levelBadge: (level) => `م${level}`,
  emptyTitle: 'لا توجد جهات تنظيمية بعد',
  emptyDescription: 'بمجرد إعداد الجهات التنظيمية وأدوارها، ستظهر تغطية التصعيد الخاصة بها هنا.',
  emptyFilteredTitle: 'لا توجد جهات مطابقة',
  emptyFilteredDescription: 'لا توجد جهات مطابقة للبحث وعوامل التصفية الحالية. حاول مسحها.',
  errorTitle: 'تعذّر تحميل التغطية',
  errorDescription: 'تعذّر تحميل سجل الجهات التنظيمية. يرجى إعادة المحاولة.',
  retry: 'إعادة المحاولة',
  dialogTitle: 'إسناد شاغل الدور',
  dialogDescription: (entityCode, roleLabel) =>
    `أسند دور ${roleLabel} مباشرةً على ${entityCode} لسدّ فجوة التغطية هذه.`,
  dialogUser: 'المستخدم',
  dialogSelectUser: 'اختر مستخدمًا',
  dialogSearchUsers: 'ابحث بالاسم أو البريد الإلكتروني…',
  dialogLoadingUsers: 'جارٍ تحميل المستخدمين…',
  dialogNoUsers: 'لم يتم العثور على مستخدمين نشطين.',
  dialogUsersLoadError: 'تعذّر تحميل دليل المستخدمين.',
  dialogRetry: 'إعادة المحاولة',
  dialogLabelEn: 'التسمية (بالإنجليزية)',
  dialogLabelAr: 'التسمية (بالعربية)',
  dialogCancel: 'إلغاء',
  dialogSubmit: 'إسناد',
  dialogUserRequired: 'اختر مستخدمًا.',
  dialogToastAssigned: 'تم إسناد شاغل الدور.',
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

export const coverageLabels = { en, ar } as const;
