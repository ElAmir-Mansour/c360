/**
 * Self-contained bilingual (EN/AR) label bundle for the people-resolved roles +
 * responsibility-directory surface. Kept local to the org-entities feature so it
 * is independent of the shared admin-labels module. Resolve at call sites with:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? peopleLabels.ar : peopleLabels.en;
 *
 * Arabic copy is professional Modern Standard Arabic (MSA). Default is EN.
 */
import type { OrgRoleKey } from '@/lib/lex/admin';

export interface PeopleLabels {
  /** Responsibility directory section. */
  directory: {
    title: string;
    description: string;
    loading: string;
    errorTitle: string;
    errorDescription: string;
    retry: string;
    emptyTitle: string;
    emptyDescription: string;
    /** Shown when filters exclude every row. */
    noMatchTitle: string;
    noMatchDescription: string;
    clearFilters: string;
  };
  /** KPI strip. */
  kpis: {
    roleHolders: string;
    roleHoldersHint: string;
    vacancies: string;
    vacanciesHint: string;
    overloaded: string;
    overloadedHint: string;
  };
  /** Table headers + filters. */
  table: {
    person: string;
    role: string;
    entity: string;
    status: string;
    searchPlaceholder: string;
    allRoles: string;
    vacantOnly: string;
    /** (n) => "Showing 12 assignments" */
    resultCount: (n: number) => string;
  };
  /** Role-holder chip. */
  chip: {
    /** Fallback subtitle when a person resolves but has no email. */
    unknownEmail: string;
    /** Tooltip / aria when only an id is known. */
    unresolved: string;
  };
  /** Vacancy panel. */
  vacancy: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    /** Reason chip on each vacant row. */
    missingDepartmentManager: string;
    missingSectionSupervisor: string;
    escalationRisk: string;
    open: string;
  };
  /** Overload panel (rendered alongside vacancies). */
  overload: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    /** (n) => "Holds 4 roles" */
    roleSpread: (n: number) => string;
  };
  /** Person status chip text, keyed by the raw status string (lower-cased). */
  personStatus: {
    active: string;
    inactive: string;
    suspended: string;
    invited: string;
    unknown: string;
  };
  /** Localized display names for every org role key. */
  roleKeys: Record<OrgRoleKey, string>;
}

export const peopleLabels: { en: PeopleLabels; ar: PeopleLabels } = {
  en: {
    directory: {
      title: 'Responsibility directory',
      description:
        'Every role assignment across the legal org, resolved to a named person. Filter by role, search, or surface vacancies.',
      loading: 'Resolving role holders…',
      errorTitle: 'Could not load the responsibility directory',
      errorDescription:
        'The org-entity registry or user directory did not respond. Check your connection and try again.',
      retry: 'Retry',
      emptyTitle: 'No role assignments yet',
      emptyDescription:
        'Assign a supervisor, manager, or counsel to an org entity to populate the responsibility directory.',
      noMatchTitle: 'No assignments match your filters',
      noMatchDescription: 'Adjust the role filter or search term, or clear the filters to see everything.',
      clearFilters: 'Clear filters',
    },
    kpis: {
      roleHolders: 'Role holders',
      roleHoldersHint: 'Distinct people',
      vacancies: 'Vacancies',
      vacanciesHint: 'Escalation risks',
      overloaded: 'Overloaded',
      overloadedHint: 'People on 3+ entities',
    },
    table: {
      person: 'Person',
      role: 'Role',
      entity: 'Entity',
      status: 'Status',
      searchPlaceholder: 'Search person or entity…',
      allRoles: 'All roles',
      vacantOnly: 'Vacant only',
      resultCount: (n) => (n === 1 ? '1 assignment' : `${n} assignments`),
    },
    chip: {
      unknownEmail: 'No email on file',
      unresolved: 'User could not be resolved',
    },
    vacancy: {
      title: 'Vacancies',
      description:
        'Active departments with no department manager and active sections with no supervisor. These break escalation.',
      emptyTitle: 'No vacancies',
      emptyDescription: 'Every active department and section has its escalation owner bound.',
      missingDepartmentManager: 'No department manager',
      missingSectionSupervisor: 'No section supervisor',
      escalationRisk: 'Escalation risk',
      open: 'Open entity',
    },
    overload: {
      title: 'Overloaded people',
      description: 'A single person holding roles across three or more entities is a concentration risk.',
      emptyTitle: 'No overloaded people',
      emptyDescription: 'No one currently holds roles across three or more entities.',
      roleSpread: (n) => (n === 1 ? 'On 1 entity' : `On ${n} entities`),
    },
    personStatus: {
      active: 'Active',
      inactive: 'Inactive',
      suspended: 'Suspended',
      invited: 'Invited',
      unknown: 'Unknown',
    },
    roleKeys: {
      section_supervisor: 'Section supervisor',
      department_manager: 'Department manager',
      shared_services_manager: 'Shared-services manager',
      legal_director: 'Legal director',
      contracts_manager: 'Contracts manager',
      compliance_officer: 'Compliance officer',
      general_counsel: 'General counsel',
    },
  },
  ar: {
    directory: {
      title: 'دليل المسؤوليات',
      description:
        'كل إسناد لدور عبر الهيكل القانوني، مرتبطًا بشخص محدّد. صفِّ حسب الدور أو ابحث أو اعرض الشواغر.',
      loading: 'جارٍ تحديد شاغلي الأدوار…',
      errorTitle: 'تعذّر تحميل دليل المسؤوليات',
      errorDescription:
        'لم يستجب سجلّ الجهات التنظيمية أو دليل المستخدمين. تحقّق من اتصالك وأعد المحاولة.',
      retry: 'إعادة المحاولة',
      emptyTitle: 'لا توجد إسنادات أدوار بعد',
      emptyDescription:
        'أسنِد مشرفًا أو مديرًا أو مستشارًا إلى جهة تنظيمية لملء دليل المسؤوليات.',
      noMatchTitle: 'لا توجد إسنادات مطابقة للمرشّحات',
      noMatchDescription: 'عدّل مرشّح الدور أو كلمة البحث، أو امسح المرشّحات لعرض الكل.',
      clearFilters: 'مسح المرشّحات',
    },
    kpis: {
      roleHolders: 'شاغلو الأدوار',
      roleHoldersHint: 'أشخاص متميّزون',
      vacancies: 'الشواغر',
      vacanciesHint: 'مخاطر تصعيد',
      overloaded: 'محمّلون بأعباء زائدة',
      overloadedHint: 'أشخاص في 3 جهات فأكثر',
    },
    table: {
      person: 'الشخص',
      role: 'الدور',
      entity: 'الجهة',
      status: 'الحالة',
      searchPlaceholder: 'ابحث عن شخص أو جهة…',
      allRoles: 'كل الأدوار',
      vacantOnly: 'الشواغر فقط',
      resultCount: (n) => (n === 1 ? 'إسناد واحد' : `${n} إسنادات`),
    },
    chip: {
      unknownEmail: 'لا يوجد بريد مسجّل',
      unresolved: 'تعذّر تحديد المستخدم',
    },
    vacancy: {
      title: 'الشواغر',
      description:
        'الإدارات النشطة دون مدير إدارة والأقسام النشطة دون مشرف. هذه تُعطِّل التصعيد.',
      emptyTitle: 'لا توجد شواغر',
      emptyDescription: 'لكل إدارة وقسم نشط مالكُ تصعيدٍ مُسنَد.',
      missingDepartmentManager: 'لا يوجد مدير إدارة',
      missingSectionSupervisor: 'لا يوجد مشرف قسم',
      escalationRisk: 'مخاطر تصعيد',
      open: 'فتح الجهة',
    },
    overload: {
      title: 'الأشخاص المحمّلون بأعباء زائدة',
      description: 'شغل شخص واحد لأدوار في ثلاث جهات فأكثر يمثّل خطر تركّز.',
      emptyTitle: 'لا يوجد أشخاص محمّلون بأعباء زائدة',
      emptyDescription: 'لا أحد يشغل حاليًا أدوارًا في ثلاث جهات فأكثر.',
      roleSpread: (n) => (n === 1 ? 'في جهة واحدة' : `في ${n} جهات`),
    },
    personStatus: {
      active: 'نشط',
      inactive: 'غير نشط',
      suspended: 'موقوف',
      invited: 'مدعو',
      unknown: 'غير معروف',
    },
    roleKeys: {
      section_supervisor: 'مشرف القسم',
      department_manager: 'مدير الإدارة',
      shared_services_manager: 'مدير الخدمات المشتركة',
      legal_director: 'المدير القانوني',
      contracts_manager: 'مدير العقود',
      compliance_officer: 'مسؤول الامتثال',
      general_counsel: 'المستشار العام',
    },
  },
};
