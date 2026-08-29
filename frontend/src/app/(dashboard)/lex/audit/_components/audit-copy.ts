'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface LexAuditCopy {
  title: string;
  description: string;
  tamperEvident: string;
  logTab: string;
  timelineTab: string;
  permissionMatrix: string;
  search: string;
  refresh: string;
  exportCsv: string;
  exporting: string;
  filters: {
    severity: string;
    allSeverity: string;
    info: string;
    warning: string;
    high: string;
    critical: string;
  };
  columns: {
    transaction: string;
    timestamp: string;
    actor: string;
    action: string;
    resource: string;
    ip: string;
    severity: string;
  };
  empty: {
    title: string;
    description: string;
  };
  timeline: {
    title: string;
    description: string;
    target: string;
    recordType: string;
    recordId: string;
    integrityHash: string;
    previousHash: string;
    totalActions: string;
    actors: string;
    system: string;
    noSelection: string;
    selectHint: string;
    latestActivity: string;
    by: string;
    appendOnly: string;
    oldValue: string;
    newValue: string;
  };
}

const EN: LexAuditCopy = {
  title: 'Audit & Compliance',
  description:
    'Review the immutable WatheeqTech activity trail, investigate a record chronologically, and verify who changed what.',
  tamperEvident: 'Tamper-evident ledger',
  logTab: 'Audit Log Viewer',
  timelineTab: 'Activity Timeline',
  permissionMatrix: 'Permission Matrix',
  search: 'Search transaction, actor, action, or target…',
  refresh: 'Live refresh',
  exportCsv: 'Export CSV',
  exporting: 'Preparing the filtered audit export…',
  filters: {
    severity: 'Outcome severity',
    allSeverity: 'All severity levels',
    info: 'Information',
    warning: 'Warning',
    high: 'High',
    critical: 'Critical',
  },
  columns: {
    transaction: 'TX ID',
    timestamp: 'Timestamp',
    actor: 'Actor user',
    action: 'Action',
    resource: 'Target resource',
    ip: 'IP address',
    severity: 'Severity',
  },
  empty: {
    title: 'No Watheeq audit events',
    description:
      'No Watheeq activity matched the selected search and severity filters.',
  },
  timeline: {
    title: 'Chronological History',
    description:
      'Select any event in the audit table to isolate the history of its target record.',
    target: 'Target record',
    recordType: 'Record type',
    recordId: 'Record ID',
    integrityHash: 'Integrity hash',
    previousHash: 'Previous hash',
    totalActions: 'Total actions',
    actors: 'Actors',
    system: 'System',
    noSelection: 'Current filtered activity',
    selectHint:
      'No target is selected, so the timeline shows the current filtered audit page.',
    latestActivity: 'Latest activity',
    by: 'by',
    appendOnly:
      'This activity trail is append-only. Administrative annotations must be recorded through an audited source workflow.',
    oldValue: 'Before',
    newValue: 'After',
  },
};

const AR: LexAuditCopy = {
  title: 'التدقيق والامتثال',
  description:
    'راجع سجل نشاط وثيق غير القابل للتلاعب، وتتبّع السجل زمنيًا، وتحقق ممن أجرى كل تغيير.',
  tamperEvident: 'سجل مقاوم للتلاعب',
  logTab: 'عارض سجل التدقيق',
  timelineTab: 'الخط الزمني للنشاط',
  permissionMatrix: 'مصفوفة الصلاحيات',
  search: 'ابحث بالمعاملة أو المنفّذ أو الإجراء أو الهدف…',
  refresh: 'تحديث مباشر',
  exportCsv: 'تصدير CSV',
  exporting: 'جارٍ إعداد تصدير سجل التدقيق المصفّى…',
  filters: {
    severity: 'درجة نتيجة الحدث',
    allSeverity: 'جميع درجات الخطورة',
    info: 'معلومات',
    warning: 'تحذير',
    high: 'مرتفعة',
    critical: 'حرجة',
  },
  columns: {
    transaction: 'رقم المعاملة',
    timestamp: 'الوقت',
    actor: 'المستخدم المنفّذ',
    action: 'الإجراء',
    resource: 'المورد المستهدف',
    ip: 'عنوان IP',
    severity: 'الخطورة',
  },
  empty: {
    title: 'لا توجد أحداث تدقيق لوثيق',
    description:
      'لا يوجد نشاط لخدمة وثيق يطابق البحث ومرشحات الخطورة المحددة.',
  },
  timeline: {
    title: 'السجل الزمني',
    description:
      'اختر أي حدث من جدول التدقيق لعزل سجل المورد المستهدف وعرضه زمنيًا.',
    target: 'السجل المستهدف',
    recordType: 'نوع السجل',
    recordId: 'معرّف السجل',
    integrityHash: 'بصمة التكامل',
    previousHash: 'البصمة السابقة',
    totalActions: 'إجمالي الإجراءات',
    actors: 'المنفّذون',
    system: 'النظام',
    noSelection: 'النشاط المصفّى الحالي',
    selectHint:
      'لم يتم اختيار مورد، لذلك يعرض الخط الزمني صفحة التدقيق المصفّاة الحالية.',
    latestActivity: 'أحدث نشاط',
    by: 'بواسطة',
    appendOnly:
      'سجل النشاط هذا غير قابل للتعديل. يجب تسجيل الملاحظات الإدارية من خلال إجراء مصدر خاضع للتدقيق.',
    oldValue: 'قبل',
    newValue: 'بعد',
  },
};

export function resolveLexAuditCopy(locale: string): LexAuditCopy {
  return locale === 'ar' ? AR : EN;
}

export function useLexAuditCopy(): LexAuditCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexAuditCopy(locale), [locale]);
}
