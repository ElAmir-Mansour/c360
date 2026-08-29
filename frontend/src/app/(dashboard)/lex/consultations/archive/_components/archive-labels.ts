'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface ConsultationArchiveLabels {
  eyebrow: string;
  title: string;
  description: string;
  backToConsultations: string;
  exportResults: string;
  exporting: string;
  stats: {
    total: string;
    thisMonth: string;
    completed: string;
    averageResponse: string;
    allRecords: string;
    createdThisMonth: string;
    answeredOrClosed: string;
    responseSample: (count: string) => string;
  };
  filters: {
    search: string;
    allDates: string;
    allAdvisors: string;
    allDepartments: string;
    allStatuses: string;
    allTypes: string;
    clear: string;
  };
  columns: {
    reference: string;
    subject: string;
    requester: string;
    advisor: string;
    submitted: string;
    resolved: string;
    status: string;
    actions: string;
  };
  table: {
    emptyTitle: string;
    emptyDescription: string;
    retry: string;
    view: string;
    showing: (from: string, to: string, total: string) => string;
    page: (page: string, total: string) => string;
    previousPage: string;
    nextPage: string;
    rowsPerPage: string;
    unassigned: string;
    noDepartment: string;
  };
  export: {
    number: string;
    title: string;
    type: string;
    requester: string;
    department: string;
    advisor: string;
    status: string;
    priority: string;
    submitted: string;
    resolved: string;
  };
}

const COPY: Record<'en' | 'ar', ConsultationArchiveLabels> = {
  en: {
    eyebrow: 'Consultations / Archive',
    title: 'Legal Consultations Archive',
    description:
      'Search, filter, review, and export the complete consultation record.',
    backToConsultations: 'Consultations',
    exportResults: 'Export results',
    exporting: 'Exporting…',
    stats: {
      total: 'Total consultations',
      thisMonth: 'Inquiries this month',
      completed: 'Answered / closed',
      averageResponse: 'Avg. response time',
      allRecords: 'Across the full archive',
      createdThisMonth: 'Submitted in the current month',
      answeredOrClosed: 'Responded, approved, or archived',
      responseSample: (count) => `Based on ${count} responses`,
    },
    filters: {
      search: 'Search by reference, title, or inquiry…',
      allDates: 'All dates',
      allAdvisors: 'All legal advisors',
      allDepartments: 'All departments',
      allStatuses: 'All statuses',
      allTypes: 'All consultation types',
      clear: 'Clear filters',
    },
    columns: {
      reference: 'Reference',
      subject: 'Subject',
      requester: 'Requester',
      advisor: 'Legal advisor',
      submitted: 'Submitted',
      resolved: 'Resolved',
      status: 'Status',
      actions: 'Actions',
    },
    table: {
      emptyTitle: 'No consultations found',
      emptyDescription: 'Try adjusting the search or archive filters.',
      retry: 'Try again',
      view: 'View',
      showing: (from, to, total) => `Showing ${from}–${to} of ${total} consultations`,
      page: (page, total) => `Page ${page} of ${total}`,
      previousPage: 'Previous page',
      nextPage: 'Next page',
      rowsPerPage: 'Rows per page',
      unassigned: 'Unassigned',
      noDepartment: 'No department',
    },
    export: {
      number: 'Reference',
      title: 'Title',
      type: 'Consultation type',
      requester: 'Requester',
      department: 'Department',
      advisor: 'Legal advisor',
      status: 'Status',
      priority: 'Priority',
      submitted: 'Submitted',
      resolved: 'Resolved',
    },
  },
  ar: {
    eyebrow: 'الاستشارات / الأرشيف',
    title: 'أرشيف الاستشارات القانونية',
    description:
      'ابحث وصفِّ وراجع وصدّر السجل الكامل للاستشارات القانونية.',
    backToConsultations: 'الاستشارات',
    exportResults: 'تصدير النتائج',
    exporting: 'جارٍ التصدير…',
    stats: {
      total: 'إجمالي الاستشارات',
      thisMonth: 'استفسارات هذا الشهر',
      completed: 'تم الرد أو الإغلاق',
      averageResponse: 'متوسط وقت الرد',
      allRecords: 'في كامل الأرشيف',
      createdThisMonth: 'قُدّمت خلال الشهر الحالي',
      answeredOrClosed: 'تم الرد عليها أو اعتمادها أو أرشفتها',
      responseSample: (count) => `استنادًا إلى ${count} ردود`,
    },
    filters: {
      search: 'ابحث بالمرجع أو العنوان أو نص الاستفسار…',
      allDates: 'كل التواريخ',
      allAdvisors: 'كل المستشارين القانونيين',
      allDepartments: 'كل الإدارات',
      allStatuses: 'كل الحالات',
      allTypes: 'كل أنواع الاستشارات',
      clear: 'مسح عوامل التصفية',
    },
    columns: {
      reference: 'المرجع',
      subject: 'الموضوع',
      requester: 'مقدم الطلب',
      advisor: 'المستشار القانوني',
      submitted: 'تاريخ التقديم',
      resolved: 'تاريخ الإنجاز',
      status: 'الحالة',
      actions: 'الإجراءات',
    },
    table: {
      emptyTitle: 'لا توجد استشارات',
      emptyDescription: 'جرّب تعديل البحث أو عوامل تصفية الأرشيف.',
      retry: 'إعادة المحاولة',
      view: 'عرض',
      showing: (from, to, total) => `عرض ${from}–${to} من أصل ${total} استشارة`,
      page: (page, total) => `الصفحة ${page} من ${total}`,
      previousPage: 'الصفحة السابقة',
      nextPage: 'الصفحة التالية',
      rowsPerPage: 'عدد الصفوف في الصفحة',
      unassigned: 'غير معيّن',
      noDepartment: 'بدون إدارة',
    },
    export: {
      number: 'المرجع',
      title: 'العنوان',
      type: 'نوع الاستشارة',
      requester: 'مقدم الطلب',
      department: 'الإدارة',
      advisor: 'المستشار القانوني',
      status: 'الحالة',
      priority: 'الأولوية',
      submitted: 'تاريخ التقديم',
      resolved: 'تاريخ الإنجاز',
    },
  },
};

export function useConsultationArchiveLabels(): ConsultationArchiveLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => COPY[locale === 'ar' ? 'ar' : 'en'], [locale]);
}
