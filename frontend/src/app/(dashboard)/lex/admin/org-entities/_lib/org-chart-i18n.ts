/**
 * Self-contained bilingual (EN/AR) label bundle for the interactive org-chart
 * surface. Kept local to the org-chart feature so the component is independent
 * of the shared admin-labels module. Resolve at call sites with:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? orgChartLabels.ar : orgChartLabels.en;
 *
 * Arabic copy is professional Modern Standard Arabic (MSA).
 */
import type { OrgEntityType, OrgRoleKey } from '@/lib/lex/admin';

export interface OrgChartLabels {
  /** Card title for the chart section. */
  title: string;
  description: string;
  /** Loading / empty / error states. */
  loading: string;
  emptyTitle: string;
  emptyDescription: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  /** Toolbar controls. */
  toolbar: {
    zoomIn: string;
    zoomOut: string;
    fit: string;
    expandAll: string;
    collapseAll: string;
    exportSvg: string;
    exportPng: string;
    print: string;
    searchPlaceholder: string;
    searchNoMatch: string;
    readOnly: string;
  };
  /** Node card chips and affordances. */
  node: {
    inactive: string;
    active: string;
    escalationReady: string;
    /** (n) => "Missing 2" — count of unreachable escalation roles. */
    escalationMissing: (n: number) => string;
    /** (n) => "3 sub-units" — collapsed subtree size hint. */
    childrenCount: (n: number) => string;
    expand: string;
    collapse: string;
    open: string;
    dragHint: string;
  };
  /** Reparent confirmation dialog. */
  reparent: {
    title: string;
    /** (child, parent) => sentence describing the move. */
    body: (child: string, parent: string) => string;
    toRoot: string;
    cycleBlocked: string;
    confirm: string;
    cancel: string;
    success: string;
  };
  entityTypes: Record<OrgEntityType, string>;
  /** Short labels for the three escalation roles in the coverage chip tooltip. */
  escalationRoles: Record<
    Extract<OrgRoleKey, 'section_supervisor' | 'department_manager' | 'shared_services_manager'>,
    string
  >;
  /** Synthetic root used when the registry has multiple top-level entities. */
  virtualRoot: string;
}

export const orgChartLabels: { en: OrgChartLabels; ar: OrgChartLabels } = {
  en: {
    title: 'Organisation chart',
    description:
      'Interactive hierarchy of legal-org entities. Zoom, collapse subtrees, and drag to re-parent.',
    loading: 'Building the organisation chart…',
    emptyTitle: 'No org entities yet',
    emptyDescription:
      'Create the first company, department, or section to render the organisation hierarchy.',
    errorTitle: 'Could not load the organisation chart',
    errorDescription:
      'The org-entity registry did not respond. Check your connection and try again.',
    retry: 'Retry',
    toolbar: {
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fit: 'Fit to view',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      exportSvg: 'Export SVG',
      exportPng: 'Export PNG',
      print: 'Print',
      searchPlaceholder: 'Search code or name…',
      searchNoMatch: 'No matching entity',
      readOnly: 'Read-only',
    },
    node: {
      inactive: 'Inactive',
      active: 'Active',
      escalationReady: 'Escalation ready',
      escalationMissing: (n) => `Missing ${n}`,
      childrenCount: (n) => (n === 1 ? '1 sub-unit' : `${n} sub-units`),
      expand: 'Expand subtree',
      collapse: 'Collapse subtree',
      open: 'Open entity',
      dragHint: 'Drag onto another entity to re-parent',
    },
    reparent: {
      title: 'Re-parent entity',
      body: (child, parent) => `Move “${child}” under “${parent}”?`,
      toRoot: 'top level',
      cycleBlocked: 'Cannot move an entity under itself or one of its descendants.',
      confirm: 'Move entity',
      cancel: 'Cancel',
      success: 'Entity re-parented.',
    },
    entityTypes: {
      company: 'Company',
      business_unit: 'Business unit',
      department: 'Department',
      section: 'Section',
      shared_services_unit: 'Shared services',
    },
    escalationRoles: {
      section_supervisor: 'Section supervisor',
      department_manager: 'Department manager',
      shared_services_manager: 'Shared-services manager',
    },
    virtualRoot: 'Organisation',
  },
  ar: {
    title: 'الهيكل التنظيمي',
    description:
      'هيكل تفاعلي للجهات القانونية والتنظيمية. كبّر العرض، واطوِ الفروع، واسحب لإعادة الإسناد.',
    loading: 'جارٍ إنشاء الهيكل التنظيمي…',
    emptyTitle: 'لا توجد جهات تنظيمية بعد',
    emptyDescription:
      'أنشئ أول شركة أو إدارة أو قسم لعرض الهيكل التنظيمي.',
    errorTitle: 'تعذّر تحميل الهيكل التنظيمي',
    errorDescription:
      'لم يستجب سجلّ الجهات التنظيمية. تحقّق من اتصالك وأعد المحاولة.',
    retry: 'إعادة المحاولة',
    toolbar: {
      zoomIn: 'تكبير',
      zoomOut: 'تصغير',
      fit: 'ملاءمة العرض',
      expandAll: 'توسيع الكل',
      collapseAll: 'طي الكل',
      exportSvg: 'تصدير SVG',
      exportPng: 'تصدير PNG',
      print: 'طباعة',
      searchPlaceholder: 'ابحث بالرمز أو الاسم…',
      searchNoMatch: 'لا توجد جهة مطابقة',
      readOnly: 'للقراءة فقط',
    },
    node: {
      inactive: 'غير نشطة',
      active: 'نشطة',
      escalationReady: 'جاهز للتصعيد',
      escalationMissing: (n) => `ناقص ${n}`,
      childrenCount: (n) => (n === 1 ? 'وحدة فرعية واحدة' : `${n} وحدات فرعية`),
      expand: 'توسيع الفرع',
      collapse: 'طي الفرع',
      open: 'فتح الجهة',
      dragHint: 'اسحب فوق جهة أخرى لإعادة الإسناد',
    },
    reparent: {
      title: 'إعادة إسناد الجهة',
      body: (child, parent) => `هل تريد نقل «${child}» إلى «${parent}»؟`,
      toRoot: 'المستوى الأعلى',
      cycleBlocked: 'لا يمكن نقل جهة إلى نفسها أو إلى إحدى الجهات التابعة لها.',
      confirm: 'نقل الجهة',
      cancel: 'إلغاء',
      success: 'تمت إعادة إسناد الجهة.',
    },
    entityTypes: {
      company: 'شركة',
      business_unit: 'وحدة أعمال',
      department: 'إدارة',
      section: 'قسم',
      shared_services_unit: 'خدمات مشتركة',
    },
    escalationRoles: {
      section_supervisor: 'مشرف القسم',
      department_manager: 'مدير الإدارة',
      shared_services_manager: 'مدير الخدمات المشتركة',
    },
    virtualRoot: 'المنشأة',
  },
};
