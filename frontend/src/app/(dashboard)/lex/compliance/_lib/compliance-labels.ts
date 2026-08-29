/**
 * Bilingual (English + Modern Standard Arabic) labels for the Watheeq
 * compliance surface (KPIs, rule library, alerts table, rule form dialog, alert
 * status dialog, and CSV export headings). Follows the canonical lex bilingual
 * contract (`../../_lib/lex-i18n.ts`).
 *
 * The `en` side MUST equal the pre-existing English strings so existing
 * English-asserting tests stay green; the `ar` side is professional MSA using
 * the suite glossary (الامتثال / لائحة / عقد / تنبيه / الحوكمة).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface ComplianceLabels {
  pageTitle: string;
  pageDescription: string;
  loadingDescription: string;
  loadError: string;
  actions: {
    runCheck: string;
    export: string;
    newRule: string;
    edit: string;
    delete: string;
    update: string;
    cancel: string;
    save: string;
  };
  kpis: {
    totalRules: string;
    enabledRules: string;
    openAlerts: string;
    complianceScore: string;
  };
  kpiDetails: {
    totalRules: string;
    enabledRules: string;
    openAlerts: string;
    ruleCoverage: string;
    rulesConfigured: string;
    enabledShare: string;
    activeAlerts: string;
  };
  trend: {
    title: string;
    description: string;
    localNote: string;
    empty: string;
    current: (score: number) => string;
  };
  ruleLibrary: {
    title: string;
    description: string;
    empty: string;
    disabledBadge: string;
  };
  alerts: {
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  alertColumns: {
    alert: string;
    severity: string;
    status: string;
    age: string;
    created: string;
  };
  filters: {
    status: string;
    severity: string;
  };
  enums: {
    ruleTypes: Record<string, string>;
    severities: Record<string, string>;
    alertStatuses: Record<string, string>;
  };
  toasts: {
    runTitle: string;
    runDescription: (alertsCreated: number, score: number) => string;
    ruleCreatedTitle: string;
    ruleUpdatedTitle: string;
    ruleSavedDescription: string;
    ruleDeletedTitle: string;
    ruleDeletedDescription: string;
    alertUpdatedTitle: string;
    alertUpdatedDescription: string;
  };
  ruleForm: {
    editTitle: string;
    createTitle: string;
    editDescription: string;
    createDescription: string;
    name: string;
    namePlaceholder: string;
    ruleType: string;
    severity: string;
    description: string;
    descriptionPlaceholder: string;
    enabled: string;
    enabledHint: string;
    cancel: string;
    save: string;
    create: string;
  };
  alertDialog: {
    title: string;
    newStatus: string;
    resolutionNotes: string;
    resolutionNotesPlaceholder: string;
    cancel: string;
    save: string;
  };
  deleteDialog: {
    title: string;
    description: (name: string) => string;
    confirm: string;
  };
  csv: {
    headerSection: string;
    headerMetric: string;
    headerValue: string;
    dashboard: string;
    rulesByType: string;
    alertsByStatus: string;
    alertsBySeverity: string;
    regulationRule: string;
    metrics: {
      openAlerts: string;
      resolvedAlerts: string;
      contractsInScope: string;
      complianceScore: string;
    };
    ruleDetail: (ruleType: string, severity: string, enabled: boolean) => string;
    enabled: string;
    disabled: string;
  };
}

export const complianceLabels: LexBilingual<ComplianceLabels> = {
  en: {
    pageTitle: 'Compliance',
    pageDescription:
      'Rule coverage, active alerts, and compliance score from the live compliance engine.',
    loadingDescription: 'Regulatory compliance tracking',
    loadError: 'Failed to load compliance posture.',
    actions: {
      runCheck: 'Run Compliance Check',
      export: 'Export',
      newRule: 'New Rule',
      edit: 'Edit',
      delete: 'Delete',
      update: 'Update',
      cancel: 'Cancel',
      save: 'Save',
    },
    kpis: {
      totalRules: 'Total Rules',
      enabledRules: 'Enabled Rules',
      openAlerts: 'Active Alerts',
      complianceScore: 'Compliance Score',
    },
    kpiDetails: {
      totalRules: 'Configured compliance rules in the current library.',
      enabledRules: 'Rules actively participating in compliance checks.',
      openAlerts: 'Active compliance exceptions requiring follow-up.',
      ruleCoverage: 'Rule coverage',
      rulesConfigured: 'Rules configured',
      enabledShare: 'Enabled share',
      activeAlerts: 'Active alerts',
    },
    trend: {
      title: 'Compliance Score Trend',
      description: 'Compliance score over time.',
      localNote: 'Trend is built from recent scores stored locally in this browser.',
      empty: 'No score history yet. The trend builds as compliance checks run.',
      current: (score) => `Current: ${score}%`,
    },
    ruleLibrary: {
      title: 'Regulation Library',
      description: 'Compliance rules evaluated during automated and manual compliance checks.',
      empty: 'No compliance rules have been configured.',
      disabledBadge: 'Disabled',
    },
    alerts: {
      title: 'Compliance Alerts',
      description: 'All alerts generated by compliance rules across the contract portfolio.',
      emptyTitle: 'No compliance alerts',
      emptyDescription: 'No alerts matched the current filters.',
    },
    alertColumns: {
      alert: 'Alert',
      severity: 'Severity',
      status: 'Status',
      age: 'Age',
      created: 'Created',
    },
    filters: {
      status: 'Status',
      severity: 'Severity',
    },
    enums: {
      ruleTypes: {
        expiry_warning: 'expiry warning',
        missing_clause: 'missing clause',
        risk_threshold: 'risk threshold',
        review_overdue: 'review overdue',
        unsigned_contract: 'unsigned contract',
        value_threshold: 'value threshold',
        jurisdiction_check: 'jurisdiction check',
        data_protection_required: 'data protection required',
        custom: 'custom',
      },
      severities: {
        critical: 'Critical',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
      },
      alertStatuses: {
        open: 'open',
        acknowledged: 'acknowledged',
        investigating: 'investigating',
        resolved: 'resolved',
        dismissed: 'dismissed',
      },
    },
    toasts: {
      runTitle: 'Compliance check complete.',
      runDescription: (alertsCreated, score) =>
        `${alertsCreated} new alert${alertsCreated === 1 ? '' : 's'} created. Score: ${score}%.`,
      ruleCreatedTitle: 'Rule created.',
      ruleUpdatedTitle: 'Rule updated.',
      ruleSavedDescription: 'The compliance rule has been saved.',
      ruleDeletedTitle: 'Rule deleted.',
      ruleDeletedDescription: 'The compliance rule has been removed.',
      alertUpdatedTitle: 'Alert updated.',
      alertUpdatedDescription: 'The compliance alert status has been saved.',
    },
    ruleForm: {
      editTitle: 'Edit Rule',
      createTitle: 'Create Compliance Rule',
      editDescription: 'Update this compliance rule definition.',
      createDescription: 'Add a new rule that will be evaluated during compliance checks.',
      name: 'Rule name',
      namePlaceholder: '30-day expiry warning',
      ruleType: 'Rule type',
      severity: 'Severity',
      description: 'Description',
      descriptionPlaceholder: 'Describe what this rule checks and when it triggers.',
      enabled: 'Enabled',
      enabledHint: 'Disabled rules are skipped during compliance checks.',
      cancel: 'Cancel',
      save: 'Save changes',
      create: 'Create rule',
    },
    alertDialog: {
      title: 'Update Alert Status',
      newStatus: 'New status',
      resolutionNotes: 'Resolution notes',
      resolutionNotesPlaceholder: 'Optional resolution or investigation notes.',
      cancel: 'Cancel',
      save: 'Save',
    },
    deleteDialog: {
      title: 'Delete rule',
      description: (name) =>
        `Are you sure you want to delete "${name}"? Existing alerts from this rule will remain.`,
      confirm: 'Delete',
    },
    csv: {
      headerSection: 'Section',
      headerMetric: 'Metric',
      headerValue: 'Value',
      dashboard: 'Dashboard',
      rulesByType: 'Rules by type',
      alertsByStatus: 'Alerts by status',
      alertsBySeverity: 'Alerts by severity',
      regulationRule: 'Regulation rule',
      metrics: {
        openAlerts: 'open_alerts',
        resolvedAlerts: 'resolved_alerts',
        contractsInScope: 'contracts_in_scope',
        complianceScore: 'compliance_score',
      },
      ruleDetail: (ruleType, severity, enabled) =>
        `${ruleType}; ${severity}; ${enabled ? 'enabled' : 'disabled'}`,
      enabled: 'enabled',
      disabled: 'disabled',
    },
  },
  ar: {
    pageTitle: 'الامتثال',
    pageDescription: 'تغطية القواعد والتنبيهات النشطة ودرجة الامتثال من محرك الامتثال المباشر.',
    loadingDescription: 'تتبّع الامتثال التنظيمي',
    loadError: 'تعذّر تحميل وضع الامتثال.',
    actions: {
      runCheck: 'تشغيل فحص الامتثال',
      export: 'تصدير',
      newRule: 'قاعدة جديدة',
      edit: 'تعديل',
      delete: 'حذف',
      update: 'تحديث',
      cancel: 'إلغاء',
      save: 'حفظ',
    },
    kpis: {
      totalRules: 'إجمالي القواعد',
      enabledRules: 'القواعد المُفعَّلة',
      openAlerts: 'التنبيهات النشطة',
      complianceScore: 'درجة الامتثال',
    },
    kpiDetails: {
      totalRules: 'قواعد الامتثال المُهيّأة في المكتبة الحالية.',
      enabledRules: 'قواعد تشارك فعليًا في فحوص الامتثال.',
      openAlerts: 'استثناءات امتثال نشطة تحتاج متابعة.',
      ruleCoverage: 'تغطية القواعد',
      rulesConfigured: 'القواعد المُهيّأة',
      enabledShare: 'حصة التفعيل',
      activeAlerts: 'التنبيهات النشطة',
    },
    trend: {
      title: 'اتجاه درجة الامتثال',
      description: 'درجة الامتثال عبر الزمن.',
      localNote: 'يُبنى الاتجاه من الدرجات الأخيرة المخزّنة محليًا في هذا المتصفح.',
      empty: 'لا يوجد سجل درجات بعد. يُبنى الاتجاه مع تشغيل فحوصات الامتثال.',
      current: (score) => `الحالية: ${score}%`,
    },
    ruleLibrary: {
      title: 'مكتبة اللوائح',
      description: 'قواعد الامتثال التي تُقيَّم أثناء فحوصات الامتثال التلقائية واليدوية.',
      empty: 'لم تتم تهيئة أي قواعد امتثال.',
      disabledBadge: 'مُعطَّلة',
    },
    alerts: {
      title: 'تنبيهات الامتثال',
      description: 'جميع التنبيهات المولّدة من قواعد الامتثال عبر محفظة العقود.',
      emptyTitle: 'لا توجد تنبيهات امتثال',
      emptyDescription: 'لا توجد تنبيهات مطابقة للمرشّحات الحالية.',
    },
    alertColumns: {
      alert: 'التنبيه',
      severity: 'الخطورة',
      status: 'الحالة',
      age: 'العمر',
      created: 'تاريخ الإنشاء',
    },
    filters: {
      status: 'الحالة',
      severity: 'الخطورة',
    },
    enums: {
      ruleTypes: {
        expiry_warning: 'تنبيه انتهاء',
        missing_clause: 'بند مفقود',
        risk_threshold: 'حدّ المخاطر',
        review_overdue: 'مراجعة متأخرة',
        unsigned_contract: 'عقد غير موقّع',
        value_threshold: 'حدّ القيمة',
        jurisdiction_check: 'فحص الاختصاص',
        data_protection_required: 'حماية البيانات مطلوبة',
        custom: 'مخصّص',
      },
      severities: {
        critical: 'حرج',
        high: 'مرتفع',
        medium: 'متوسط',
        low: 'منخفض',
      },
      alertStatuses: {
        open: 'مفتوح',
        acknowledged: 'مُقَر به',
        investigating: 'قيد التحقيق',
        resolved: 'محلول',
        dismissed: 'مرفوض',
      },
    },
    toasts: {
      runTitle: 'اكتمل فحص الامتثال.',
      runDescription: (alertsCreated, score) =>
        `تم إنشاء ${alertsCreated} تنبيه جديد. الدرجة: ${score}%.`,
      ruleCreatedTitle: 'تم إنشاء القاعدة.',
      ruleUpdatedTitle: 'تم تحديث القاعدة.',
      ruleSavedDescription: 'تم حفظ قاعدة الامتثال.',
      ruleDeletedTitle: 'تم حذف القاعدة.',
      ruleDeletedDescription: 'تمت إزالة قاعدة الامتثال.',
      alertUpdatedTitle: 'تم تحديث التنبيه.',
      alertUpdatedDescription: 'تم حفظ حالة تنبيه الامتثال.',
    },
    ruleForm: {
      editTitle: 'تعديل القاعدة',
      createTitle: 'إنشاء قاعدة امتثال',
      editDescription: 'تحديث تعريف قاعدة الامتثال هذه.',
      createDescription: 'أضف قاعدة جديدة تُقيَّم أثناء فحوصات الامتثال.',
      name: 'اسم القاعدة',
      namePlaceholder: 'تنبيه انتهاء قبل 30 يومًا',
      ruleType: 'نوع القاعدة',
      severity: 'الخطورة',
      description: 'الوصف',
      descriptionPlaceholder: 'صِف ما تفحصه هذه القاعدة ومتى تُفعَّل.',
      enabled: 'مُفعَّلة',
      enabledHint: 'تُتخطّى القواعد المُعطَّلة أثناء فحوصات الامتثال.',
      cancel: 'إلغاء',
      save: 'حفظ التغييرات',
      create: 'إنشاء القاعدة',
    },
    alertDialog: {
      title: 'تحديث حالة التنبيه',
      newStatus: 'الحالة الجديدة',
      resolutionNotes: 'ملاحظات الحل',
      resolutionNotesPlaceholder: 'ملاحظات حلّ أو تحقيق اختيارية.',
      cancel: 'إلغاء',
      save: 'حفظ',
    },
    deleteDialog: {
      title: 'حذف القاعدة',
      description: (name) =>
        `هل أنت متأكد من حذف "${name}"؟ ستبقى التنبيهات القائمة من هذه القاعدة.`,
      confirm: 'حذف',
    },
    csv: {
      headerSection: 'القسم',
      headerMetric: 'المؤشر',
      headerValue: 'القيمة',
      dashboard: 'لوحة المعلومات',
      rulesByType: 'القواعد حسب النوع',
      alertsByStatus: 'التنبيهات حسب الحالة',
      alertsBySeverity: 'التنبيهات حسب الخطورة',
      regulationRule: 'قاعدة لائحة',
      metrics: {
        openAlerts: 'open_alerts',
        resolvedAlerts: 'resolved_alerts',
        contractsInScope: 'contracts_in_scope',
        complianceScore: 'compliance_score',
      },
      ruleDetail: (ruleType, severity, enabled) =>
        `${ruleType}؛ ${severity}؛ ${enabled ? 'مُفعَّلة' : 'مُعطَّلة'}`,
      enabled: 'مُفعَّلة',
      disabled: 'مُعطَّلة',
    },
  },
};

export function useComplianceLabels(): ComplianceLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(complianceLabels, locale), [locale]);
}

/**
 * resolveComplianceLabels is the pure resolver for non-React callers/tests.
 */
export function resolveComplianceLabels(locale: AppLocale = 'en'): ComplianceLabels {
  return resolveLexBilingual(complianceLabels, locale === 'ar' ? 'ar' : 'en');
}
