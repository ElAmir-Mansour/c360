'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';

export interface ReportBuilderLabels {
  eyebrow: string;
  title: string;
  description: string;
  newReport: string;
  save: string;
  saveAs: string;
  saving: string;
  delete: string;
  deleting: string;
  savedReports: string;
  unsavedReport: string;
  noSavedReports: string;
  loadReport: string;
  dataSource: string;
  dataSourceHint: string;
  sourceUnavailable: string;
  fields: string;
  fieldsHint: string;
  selectAll: string;
  clear: string;
  reportSetup: string;
  reportName: string;
  reportNamePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  search: string;
  searchPlaceholder: string;
  filters: string;
  filtersHint: string;
  addFilter: string;
  chooseFilter: string;
  filterValue: string;
  filterValuePlaceholder: string;
  removeFilter: string;
  sortBy: string;
  direction: string;
  ascending: string;
  descending: string;
  visualization: string;
  table: string;
  bar: string;
  donut: string;
  groupBy: string;
  preview: string;
  previewHint: string;
  previewRows: (shown: number, total: number) => string;
  totalRecords: string;
  selectedFields: string;
  groups: string;
  refresh: string;
  exportCsv: string;
  exportXlsx: string;
  exporting: string;
  exportLimit: (limit: number) => string;
  openSource: string;
  emptyTitle: string;
  emptyDescription: string;
  errorTitle: string;
  retry: string;
  notSet: string;
  saveTitle: string;
  saveDescription: string;
  scope: string;
  personal: string;
  team: string;
  organization: string;
  cancel: string;
  confirmSave: string;
  deleteTitle: string;
  deleteDescription: (name: string) => string;
  deleteConfirm: string;
  savedToast: string;
  updatedToast: string;
  deletedToast: string;
  exportToast: (count: number) => string;
  maxRowsToast: (count: number) => string;
  sourceChangedToast: string;
  validationName: string;
  validationColumns: string;
  chartEmpty: string;
  untitled: string;
  scopes: Record<'personal' | 'team' | 'org', string>;
  sources: Record<string, { name: string; description: string }>;
  fieldsMap: Record<string, string>;
}

const labels: LexBilingual<ReportBuilderLabels> = {
  en: {
    eyebrow: 'Insights · Reporting',
    title: 'Report Builder',
    description:
      'Create focused legal reports without spreadsheets: choose a data source, shape the fields, filter the records, visualize the result, and save it for reuse.',
    newReport: 'New report',
    save: 'Save',
    saveAs: 'Save as',
    saving: 'Saving…',
    delete: 'Delete',
    deleting: 'Deleting…',
    savedReports: 'Saved reports',
    unsavedReport: 'Unsaved report',
    noSavedReports: 'No saved reports yet',
    loadReport: 'Load a saved report',
    dataSource: '1. Data source',
    dataSourceHint: 'Choose one trusted legal dataset.',
    sourceUnavailable: 'You do not have access to this source.',
    fields: '2. Fields',
    fieldsHint: 'Choose the columns your audience needs.',
    selectAll: 'Select all',
    clear: 'Clear',
    reportSetup: '3. Shape the report',
    reportName: 'Report name',
    reportNamePlaceholder: 'e.g. Contracts expiring this quarter',
    descriptionLabel: 'Purpose or audience',
    descriptionPlaceholder: 'Optional context for people who reuse this report',
    search: 'Search records',
    searchPlaceholder: 'Search this data source…',
    filters: 'Filters',
    filtersHint: 'Filters run on the server and apply to preview and export.',
    addFilter: 'Add filter',
    chooseFilter: 'Choose a field',
    filterValue: 'Value',
    filterValuePlaceholder: 'Enter a value',
    removeFilter: 'Remove filter',
    sortBy: 'Sort by',
    direction: 'Direction',
    ascending: 'Ascending',
    descending: 'Descending',
    visualization: 'View',
    table: 'Table',
    bar: 'Bar chart',
    donut: 'Donut chart',
    groupBy: 'Group by',
    preview: 'Live preview',
    previewHint: 'A representative page is shown here; exports include every matching record.',
    previewRows: (shown, total) => `Showing ${shown} of ${total}`,
    totalRecords: 'Matching records',
    selectedFields: 'Selected fields',
    groups: 'Visible groups',
    refresh: 'Refresh',
    exportCsv: 'Export CSV',
    exportXlsx: 'Export Excel',
    exporting: 'Preparing export…',
    exportLimit: (limit) => `CSV exports are safely capped at ${limit.toLocaleString()} rows.`,
    openSource: 'Open source records',
    emptyTitle: 'No matching records',
    emptyDescription: 'Adjust the search or filters to broaden this report.',
    errorTitle: 'The report preview could not be loaded.',
    retry: 'Try again',
    notSet: 'Not set',
    saveTitle: 'Save report definition',
    saveDescription: 'Give the report a clear name and choose who can discover it.',
    scope: 'Visibility',
    personal: 'Only me',
    team: 'Legal team',
    organization: 'Organization',
    cancel: 'Cancel',
    confirmSave: 'Save report',
    deleteTitle: 'Delete saved report?',
    deleteDescription: (name) => `“${name}” will be removed. Source records are not affected.`,
    deleteConfirm: 'Delete report',
    savedToast: 'Report saved',
    updatedToast: 'Report updated',
    deletedToast: 'Report deleted',
    exportToast: (count) => `Exported ${count.toLocaleString()} records`,
    maxRowsToast: (count) => `The export reached the safety limit of ${count.toLocaleString()} rows.`,
    sourceChangedToast: 'Fields, filters, and grouping were reset for the new data source.',
    validationName: 'Enter a report name.',
    validationColumns: 'Select at least one field.',
    chartEmpty: 'There is no grouped data to chart.',
    untitled: 'Untitled report',
    scopes: {
      personal: 'Personal',
      team: 'Team',
      org: 'Organization',
    },
    sources: {
      contracts: {
        name: 'Contracts',
        description: 'Lifecycle, counterparty, risk, version, and expiry details.',
      },
      matters: {
        name: 'Matters',
        description: 'Cross-domain legal work, owners, priorities, and due dates.',
      },
      obligations: {
        name: 'Obligations',
        description: 'Commitments, owners, linked work, deadlines, and completion.',
      },
      requests: {
        name: 'Legal requests',
        description: 'Service desk demand, requester, department, priority, and status.',
      },
      cases: {
        name: 'Cases',
        description: 'Litigation posture, risk, priority, ownership, and lifecycle.',
      },
      consultations: {
        name: 'Consultations',
        description: 'Advice workload, advisors, response status, and SLA outcomes.',
      },
    },
    fieldsMap: {
      title: 'Title',
      status: 'Status',
      type: 'Type',
      risk_level: 'Risk level',
      party_b_name: 'Counterparty',
      expiry_date: 'Expiry date',
      current_version: 'Current version',
      created_at: 'Created',
      updated_at: 'Updated',
      department: 'Department',
      owner_user_id: 'Owner ID',
      tag: 'Tag',
      matter_number: 'Matter number',
      priority: 'Priority',
      owner_name: 'Owner',
      opened_at: 'Opened',
      due_date: 'Due date',
      due_after: 'Due on or after',
      due_before: 'Due on or before',
      closed_at: 'Closed',
      contract_title: 'Contract',
      matter_title: 'Matter',
      days_until_due: 'Days until due',
      completed_at: 'Completed',
      overdue: 'Overdue',
      request_number: 'Request number',
      request_type: 'Request type',
      requester_name: 'Requester',
      case_number: 'Case number',
      case_type: 'Case type',
      company_status: 'Company position',
      risk_rating: 'Risk rating',
      responsible_lawyer: 'Responsible lawyer',
      consultation_number: 'Consultation number',
      advisor_name: 'Advisor',
      advisor_id: 'Advisor ID',
      sla_outcome: 'SLA outcome',
      sla_response_due_at: 'Response due',
      responded_at: 'Responded',
    },
  },
  ar: {
    eyebrow: 'الرؤى · التقارير',
    title: 'منشئ التقارير',
    description:
      'أنشئ تقارير قانونية مركزة دون جداول خارجية: اختر مصدر البيانات والحقول والمرشحات وطريقة العرض، ثم احفظ التقرير لإعادة استخدامه.',
    newReport: 'تقرير جديد',
    save: 'حفظ',
    saveAs: 'حفظ باسم',
    saving: 'جارٍ الحفظ…',
    delete: 'حذف',
    deleting: 'جارٍ الحذف…',
    savedReports: 'التقارير المحفوظة',
    unsavedReport: 'تقرير غير محفوظ',
    noSavedReports: 'لا توجد تقارير محفوظة بعد',
    loadReport: 'تحميل تقرير محفوظ',
    dataSource: '١. مصدر البيانات',
    dataSourceHint: 'اختر مجموعة بيانات قانونية موثوقة.',
    sourceUnavailable: 'ليس لديك صلاحية الوصول إلى هذا المصدر.',
    fields: '٢. الحقول',
    fieldsHint: 'اختر الأعمدة التي يحتاجها جمهور التقرير.',
    selectAll: 'تحديد الكل',
    clear: 'مسح',
    reportSetup: '٣. تشكيل التقرير',
    reportName: 'اسم التقرير',
    reportNamePlaceholder: 'مثال: العقود المنتهية هذا الربع',
    descriptionLabel: 'الغرض أو الجمهور',
    descriptionPlaceholder: 'سياق اختياري لمن يعيد استخدام التقرير',
    search: 'البحث في السجلات',
    searchPlaceholder: 'ابحث في مصدر البيانات…',
    filters: 'المرشحات',
    filtersHint: 'تطبق المرشحات على الخادم وعلى المعاينة والتصدير.',
    addFilter: 'إضافة مرشح',
    chooseFilter: 'اختر حقلاً',
    filterValue: 'القيمة',
    filterValuePlaceholder: 'أدخل قيمة',
    removeFilter: 'إزالة المرشح',
    sortBy: 'الترتيب حسب',
    direction: 'الاتجاه',
    ascending: 'تصاعدي',
    descending: 'تنازلي',
    visualization: 'العرض',
    table: 'جدول',
    bar: 'مخطط أعمدة',
    donut: 'مخطط دائري',
    groupBy: 'التجميع حسب',
    preview: 'معاينة مباشرة',
    previewHint: 'تظهر صفحة تمثيلية هنا، بينما يشمل التصدير جميع السجلات المطابقة.',
    previewRows: (shown, total) => `عرض ${shown} من ${total}`,
    totalRecords: 'السجلات المطابقة',
    selectedFields: 'الحقول المحددة',
    groups: 'المجموعات الظاهرة',
    refresh: 'تحديث',
    exportCsv: 'تصدير CSV',
    exportXlsx: 'تصدير Excel',
    exporting: 'جارٍ إعداد التصدير…',
    exportLimit: (limit) => `يقتصر تصدير CSV بأمان على ${limit.toLocaleString('ar-SA')} سجل.`,
    openSource: 'فتح السجلات المصدرية',
    emptyTitle: 'لا توجد سجلات مطابقة',
    emptyDescription: 'عدّل البحث أو المرشحات لتوسيع التقرير.',
    errorTitle: 'تعذر تحميل معاينة التقرير.',
    retry: 'إعادة المحاولة',
    notSet: 'غير محدد',
    saveTitle: 'حفظ تعريف التقرير',
    saveDescription: 'امنح التقرير اسماً واضحاً واختر من يمكنه العثور عليه.',
    scope: 'إمكانية العرض',
    personal: 'أنا فقط',
    team: 'الفريق القانوني',
    organization: 'المنظمة',
    cancel: 'إلغاء',
    confirmSave: 'حفظ التقرير',
    deleteTitle: 'حذف التقرير المحفوظ؟',
    deleteDescription: (name) => `سيتم حذف «${name}». لن تتأثر السجلات المصدرية.`,
    deleteConfirm: 'حذف التقرير',
    savedToast: 'تم حفظ التقرير',
    updatedToast: 'تم تحديث التقرير',
    deletedToast: 'تم حذف التقرير',
    exportToast: (count) => `تم تصدير ${count.toLocaleString('ar-SA')} سجل`,
    maxRowsToast: (count) => `بلغ التصدير حد الأمان البالغ ${count.toLocaleString('ar-SA')} سجل.`,
    sourceChangedToast: 'أعيد ضبط الحقول والمرشحات والتجميع لمصدر البيانات الجديد.',
    validationName: 'أدخل اسماً للتقرير.',
    validationColumns: 'حدد حقلاً واحداً على الأقل.',
    chartEmpty: 'لا توجد بيانات مجمعة لعرضها.',
    untitled: 'تقرير بلا عنوان',
    scopes: {
      personal: 'شخصي',
      team: 'الفريق',
      org: 'المنظمة',
    },
    sources: {
      contracts: {
        name: 'العقود',
        description: 'دورة الحياة والطرف المقابل والمخاطر والإصدارات وتواريخ الانتهاء.',
      },
      matters: {
        name: 'الملفات القانونية',
        description: 'العمل القانوني متعدد المجالات والملاك والأولويات والمواعيد.',
      },
      obligations: {
        name: 'الالتزامات',
        description: 'التعهدات والملاك والأعمال المرتبطة والمواعيد والإنجاز.',
      },
      requests: {
        name: 'الطلبات القانونية',
        description: 'طلب الخدمات ومقدم الطلب والإدارة والأولوية والحالة.',
      },
      cases: {
        name: 'القضايا',
        description: 'وضع التقاضي والمخاطر والأولوية والملكية ودورة الحياة.',
      },
      consultations: {
        name: 'الاستشارات',
        description: 'عبء الاستشارات والمستشارون وحالة الرد ونتائج اتفاقية الخدمة.',
      },
    },
    fieldsMap: {
      title: 'العنوان',
      status: 'الحالة',
      type: 'النوع',
      risk_level: 'مستوى المخاطر',
      party_b_name: 'الطرف المقابل',
      expiry_date: 'تاريخ الانتهاء',
      current_version: 'الإصدار الحالي',
      created_at: 'تاريخ الإنشاء',
      updated_at: 'تاريخ التحديث',
      department: 'الإدارة',
      owner_user_id: 'معرف المالك',
      tag: 'الوسم',
      matter_number: 'رقم الملف',
      priority: 'الأولوية',
      owner_name: 'المالك',
      opened_at: 'تاريخ الفتح',
      due_date: 'تاريخ الاستحقاق',
      due_after: 'مستحق في أو بعد',
      due_before: 'مستحق في أو قبل',
      closed_at: 'تاريخ الإغلاق',
      contract_title: 'العقد',
      matter_title: 'الملف',
      days_until_due: 'الأيام حتى الاستحقاق',
      completed_at: 'تاريخ الإنجاز',
      overdue: 'متأخر',
      request_number: 'رقم الطلب',
      request_type: 'نوع الطلب',
      requester_name: 'مقدم الطلب',
      case_number: 'رقم القضية',
      case_type: 'نوع القضية',
      company_status: 'صفة الشركة',
      risk_rating: 'تصنيف المخاطر',
      responsible_lawyer: 'المحامي المسؤول',
      consultation_number: 'رقم الاستشارة',
      advisor_name: 'المستشار',
      advisor_id: 'معرف المستشار',
      sla_outcome: 'نتيجة اتفاقية الخدمة',
      sla_response_due_at: 'موعد الرد',
      responded_at: 'تاريخ الرد',
    },
  },
};

const ARABIC_TOKENS: Record<string, string> = {
  draft: 'مسودة',
  submitted: 'مقدم',
  pending_requester_approval: 'بانتظار اعتماد مقدم الطلب',
  pending_provider_approval: 'بانتظار اعتماد مقدم الخدمة',
  approved: 'معتمد',
  routed: 'موجّه',
  in_execution: 'قيد التنفيذ',
  delivered: 'تم التسليم',
  returned: 'معاد',
  active: 'نشط',
  closed: 'مغلق',
  cancelled: 'ملغى',
  open: 'مفتوح',
  intake: 'استقبال',
  internal_review: 'مراجعة داخلية',
  legal_review: 'مراجعة قانونية',
  negotiation: 'تفاوض',
  pending_signature: 'بانتظار التوقيع',
  suspended: 'معلق',
  expired: 'منتهي',
  terminated: 'منهى',
  renewed: 'مجدد',
  in_review: 'قيد المراجعة',
  waiting_on_business: 'بانتظار جهة الأعمال',
  on_hold: 'معلق مؤقتاً',
  in_progress: 'قيد التقدم',
  waived: 'متنازل عنه',
  critical: 'حرج',
  high: 'مرتفع',
  medium: 'متوسط',
  low: 'منخفض',
  normal: 'عادي',
  urgent: 'عاجل',
  completed: 'مكتمل',
  blocked: 'متوقف',
  phase1: 'المرحلة الأولى',
  phase2: 'المرحلة الثانية',
  under_procedure: 'تحت الإجراء',
  plaintiff: 'مدعٍ',
  defendant: 'مدعى عليه',
  classified: 'مصنف',
  responded: 'تم الرد',
  archived: 'مؤرشف',
  on_time: 'في الموعد',
  breached: 'متجاوز',
  pending: 'قيد الانتظار',
  general: 'عام',
  contractual: 'تعاقدي',
  contract: 'عقد',
  litigation: 'تقاضٍ',
  regulatory: 'تنظيمي',
  employment: 'توظيف',
  dispute: 'نزاع',
  advisory: 'استشاري',
  other: 'أخرى',
  renewal: 'تجديد',
  notice: 'إشعار',
  payment: 'دفعة',
  delivery: 'تسليم',
  reporting: 'إبلاغ',
  compliance: 'امتثال',
  covenant: 'تعهد',
  condition_precedent: 'شرط سابق',
  service_agreement: 'اتفاقية خدمات',
  nda: 'اتفاقية عدم إفصاح',
  vendor: 'مورد',
  license: 'ترخيص',
  lease: 'إيجار',
  partnership: 'شراكة',
  consulting: 'استشارات',
  procurement: 'مشتريات',
  sla: 'اتفاقية مستوى خدمة',
  mou: 'مذكرة تفاهم',
  amendment: 'تعديل',
  labor: 'عمالي',
  corporate: 'شركات',
  intellectual_property: 'ملكية فكرية',
  tax: 'ضريبي',
  true: 'نعم',
  false: 'لا',
  none: 'بدون',
};

function titleCaseToken(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function useReportBuilderLabels() {
  const { locale } = useLocaleOrDefault();
  const resolved = useMemo(
    () => resolveLexBilingual(labels, locale === 'ar' ? 'ar' : 'en'),
    [locale],
  );
  return {
    labels: resolved,
    locale,
    fieldLabel: (field: string) => resolved.fieldsMap[field] ?? titleCaseToken(field),
    optionLabel: (value: string) =>
      locale === 'ar' ? ARABIC_TOKENS[value] ?? titleCaseToken(value) : titleCaseToken(value),
  };
}
