'use client';

import '../../../_lib/admin-i18n';
import { useBilingual } from '@/components/providers/locale-provider';
import type { WorkflowCategory } from '@/types/models';
import type { AppLocale } from '@/lib/i18n';
import type { WorkflowTemplate } from '@/types/models';
import {
  TEMPLATE_ARABIC_FALLBACKS,
  type TemplateArabicFallback,
} from './template-fallbacks';

export type TemplateCategoryFilter = WorkflowCategory | 'legal' | 'all';

export const TEMPLATE_CATEGORY_VALUES: TemplateCategoryFilter[] = [
  'all',
  'legal',
  'approval',
  'onboarding',
  'review',
  'escalation',
  'notification',
  'data_pipeline',
  'compliance',
  'custom',
];

type TemplateCountPair = {
  one: string;
  many: string;
};

export type TemplateCountKind = 'step' | 'variable' | 'use';

export type TemplateLocalLabels = {
  counts: Record<TemplateCountKind, TemplateCountPair>;
  categories: Record<string, string>;
  tags: Record<string, string>;
  stepTypes: Record<string, string>;
  variableTypes: Record<string, string>;
  defaultValues: Record<string, string>;
  generic: {
    step: string;
    variable: string;
  };
};

const TEMPLATE_LOCAL_LABELS: {
  readonly en: TemplateLocalLabels;
  readonly ar: TemplateLocalLabels;
} = {
  en: {
    counts: {
      step: { one: '{n} step', many: '{n} steps' },
      variable: { one: '{n} var', many: '{n} vars' },
      use: { one: '{n} use', many: '{n} uses' },
    },
    categories: {
      all: 'All',
      legal: 'Legal',
      approval: 'Approval',
      onboarding: 'Onboarding',
      review: 'Review',
      escalation: 'Escalation',
      notification: 'Notification',
      data_pipeline: 'Data Pipeline',
      compliance: 'Compliance',
      custom: 'Custom',
    },
    tags: {
      acquisition: 'Acquisition',
      admin: 'Administration',
      adr: 'ADR',
      agm: 'AGM',
      amendment: 'Amendment',
      appeal: 'Appeal',
      approval: 'Approval',
      arbitration: 'Arbitration',
      archival: 'Archival',
      assignment: 'Assignment',
      'auto-renewal': 'Auto-renewal',
      board: 'Board',
      brand: 'Brand',
      breach: 'Breach',
      bylaws: 'Bylaws',
      catalog: 'Catalog',
      'clause-library': 'Clause Library',
      clm: 'CLM',
      closure: 'Closure',
      'commercial-registration': 'Commercial Registration',
      compliance: 'Compliance',
      'conflict-check': 'Conflict Check',
      'conflict-of-interest': 'Conflict of Interest',
      consultation: 'Consultation',
      contracts: 'Contracts',
      'cross-border': 'Cross-border',
      deadlines: 'Deadlines',
      defense: 'Defense',
      deficiency: 'Deficiency',
      'digital-asset': 'Digital Asset',
      disciplinary: 'Disciplinary',
      disposal: 'Disposal',
      dispute: 'Dispute',
      disputes: 'Disputes',
      doa: 'DoA',
      domain: 'Domain',
      dpia: 'DPIA',
      drafting: 'Drafting',
      dsr: 'DSR',
      'due-diligence': 'Due Diligence',
      'e-archive': 'E-archive',
      'e-sign': 'E-signature',
      'e-signature': 'E-signature',
      ejar: 'Ejar',
      employment: 'Employment',
      'end-of-service': 'End of Service',
      enforcement: 'Enforcement',
      escalation: 'Escalation',
      event_task: 'Event',
      esign: 'E-signature',
      ethics: 'Ethics',
      evidence: 'Evidence',
      execution: 'Execution',
      exit: 'Exit',
      expedited: 'Expedited',
      expert: 'Expert',
      'external-counsel': 'External Counsel',
      'fast-track': 'Fast-track',
      filing: 'Filing',
      gosi: 'GOSI',
      governance: 'Governance',
      government: 'Government',
      handover: 'Handover',
      hearings: 'Hearings',
      identity: 'Identity',
      incident: 'Incident',
      incorporation: 'Incorporation',
      infringement: 'Infringement',
      intake: 'Intake',
      integration: 'Integration',
      investigation: 'Investigation',
      invoice: 'Invoice',
      ip: 'IP',
      iqama: 'Iqama',
      kpi: 'KPI',
      ksa: 'KSA',
      labor: 'Labor',
      lease: 'Lease',
      legal: 'Legal',
      'legal-hold': 'Legal Hold',
      licensing: 'Licensing',
      litigation: 'Litigation',
      matter: 'Matter',
      metadata: 'Metadata',
      mhrsd: 'MHRSD',
      milestones: 'Milestones',
      moc: 'MOC',
      monitoring: 'Monitoring',
      nafath: 'Nafath',
      najiz: 'Najiz',
      nda: 'NDA',
      negotiation: 'Negotiation',
      obligations: 'Obligations',
      onboarding: 'Onboarding',
      opinion: 'Opinion',
      pdpl: 'PDPL',
      policy: 'Policy',
      portfolio: 'Portfolio',
      'power-of-attorney': 'Power of Attorney',
      privacy: 'Privacy',
      procurement: 'Procurement',
      prosecution: 'Prosecution',
      qiwa: 'Qiwa',
      'real-estate': 'Real Estate',
      reassignment: 'Reassignment',
      reconciliation: 'Reconciliation',
      records: 'Records',
      redlining: 'Redlining',
      registration: 'Registration',
      regulation: 'Regulation',
      regulatory: 'Regulatory',
      review: 'Review',
      'related-party': 'Related Party',
      renewal: 'Renewal',
      'rent-review': 'Rent Review',
      reporting: 'Reporting',
      repository: 'Repository',
      resolution: 'Resolution',
      retention: 'Retention',
      risk: 'Risk',
      sadad: 'SADAD',
      saip: 'SAIP',
      saudization: 'Saudization',
      'self-service': 'Self-service',
      'service-desk': 'Service Desk',
      settlement: 'Settlement',
      shareholder: 'Shareholder',
      signatory: 'Signatory',
      sla: 'SLA',
      surrender: 'Surrender',
      tax: 'Tax',
      termination: 'Termination',
      trademark: 'Trademark',
      triage: 'Triage',
      urgent: 'Urgent',
      variation: 'Variation',
      vendor: 'Vendor',
      whistleblower: 'Whistleblower',
      zakat: 'Zakat',
      zatca: 'ZATCA',
    },
    stepTypes: {
      approval: 'Approval',
      approval_chain: 'Approval chain',
      event_task: 'Event',
      review: 'Review',
      task: 'Task',
      human_task: 'Human Task',
      service_task: 'Automated',
      notification: 'Notification',
      condition: 'Condition',
      parallel_gateway: 'Parallel',
      join_gateway: 'Join gateway',
      delay: 'Delay',
      timer: 'Timer',
      webhook: 'Webhook',
      script: 'Script',
      sub_workflow: 'Sub-workflow',
      end: 'End',
    },
    variableTypes: {
      string: 'Text',
      number: 'Number',
      boolean: 'Boolean',
      date: 'Date',
      object: 'Object',
      array: 'List',
      json: 'JSON',
    },
    defaultValues: {},
    generic: {
      step: 'Step {n}',
      variable: 'Variable {n}',
    },
  },
  ar: {
    counts: {
      step: { one: '{n} خطوة', many: '{n} خطوات' },
      variable: { one: '{n} متغير', many: '{n} متغيرات' },
      use: { one: '{n} استخدام', many: '{n} استخدامات' },
    },
    categories: {
      all: 'الكل',
      legal: 'القانوني',
      approval: 'الاعتماد',
      onboarding: 'الإعداد',
      review: 'المراجعة',
      escalation: 'التصعيد',
      notification: 'الإشعارات',
      data_pipeline: 'مسار البيانات',
      compliance: 'الامتثال',
      custom: 'مخصص',
    },
    tags: {
      acquisition: 'الاستحواذ',
      admin: 'الإدارة',
      adr: 'التسوية البديلة',
      agm: 'الجمعية العامة',
      amendment: 'تعديل',
      appeal: 'استئناف',
      approval: 'اعتماد',
      arbitration: 'تحكيم',
      archival: 'أرشفة',
      assignment: 'تنازل',
      'auto-renewal': 'تجديد تلقائي',
      board: 'مجلس الإدارة',
      brand: 'العلامة',
      breach: 'إخلال',
      bylaws: 'النظام الأساسي',
      catalog: 'الفهرس',
      'clause-library': 'مكتبة البنود',
      clm: 'إدارة العقود',
      closure: 'إغلاق',
      'commercial-registration': 'السجل التجاري',
      compliance: 'الامتثال',
      'conflict-check': 'فحص التعارض',
      'conflict-of-interest': 'تعارض المصالح',
      consultation: 'استشارة',
      contracts: 'العقود',
      'cross-border': 'عابر للحدود',
      deadlines: 'المواعيد النهائية',
      defense: 'الدفاع',
      deficiency: 'نقص',
      'digital-asset': 'أصل رقمي',
      disciplinary: 'تأديبي',
      disposal: 'إتلاف',
      dispute: 'نزاع',
      disputes: 'نزاعات',
      doa: 'تفويض الصلاحيات',
      domain: 'نطاق',
      dpia: 'تقييم أثر الخصوصية',
      drafting: 'الصياغة',
      dsr: 'طلبات أصحاب البيانات',
      'due-diligence': 'العناية الواجبة',
      'e-archive': 'الأرشفة الإلكترونية',
      'e-sign': 'التوقيع الإلكتروني',
      'e-signature': 'التوقيع الإلكتروني',
      ejar: 'إيجار',
      employment: 'التوظيف',
      'end-of-service': 'نهاية الخدمة',
      enforcement: 'التنفيذ',
      escalation: 'تصعيد',
      event_task: 'حدث',
      esign: 'التوقيع الإلكتروني',
      ethics: 'الأخلاقيات',
      evidence: 'الأدلة',
      execution: 'التنفيذ',
      exit: 'الخروج',
      expedited: 'مسار عاجل',
      expert: 'خبير',
      'external-counsel': 'مستشار خارجي',
      'fast-track': 'مسار سريع',
      filing: 'إيداع',
      gosi: 'التأمينات الاجتماعية',
      governance: 'الحوكمة',
      government: 'حكومي',
      handover: 'تسليم',
      hearings: 'الجلسات',
      identity: 'الهوية',
      incident: 'حادثة',
      incorporation: 'تأسيس',
      infringement: 'تعدي',
      intake: 'استقبال',
      integration: 'تكامل',
      investigation: 'تحقيق',
      invoice: 'فاتورة',
      ip: 'الملكية الفكرية',
      iqama: 'الإقامة',
      kpi: 'مؤشر أداء',
      ksa: 'السعودية',
      labor: 'العمل',
      lease: 'إيجار',
      legal: 'القانوني',
      'legal-hold': 'تحفظ قانوني',
      licensing: 'ترخيص',
      litigation: 'التقاضي',
      matter: 'ملف',
      metadata: 'بيانات وصفية',
      mhrsd: 'وزارة الموارد البشرية',
      milestones: 'معالم',
      moc: 'وزارة التجارة',
      monitoring: 'مراقبة',
      nafath: 'نفاذ',
      najiz: 'ناجز',
      nda: 'اتفاقية سرية',
      negotiation: 'تفاوض',
      obligations: 'التزامات',
      onboarding: 'الإعداد',
      opinion: 'رأي',
      pdpl: 'نظام حماية البيانات',
      policy: 'سياسة',
      portfolio: 'محفظة',
      'power-of-attorney': 'وكالة',
      privacy: 'خصوصية',
      procurement: 'المشتريات',
      prosecution: 'الملاحقة',
      qiwa: 'قوى',
      'real-estate': 'عقار',
      reassignment: 'إعادة إسناد',
      reconciliation: 'تسوية',
      records: 'السجلات',
      redlining: 'مراجعة التعديلات',
      registration: 'تسجيل',
      regulation: 'تنظيم',
      regulatory: 'تنظيمي',
      review: 'مراجعة',
      'related-party': 'طرف ذو علاقة',
      renewal: 'تجديد',
      'rent-review': 'مراجعة الأجرة',
      reporting: 'تقارير',
      repository: 'المستودع',
      resolution: 'قرار',
      retention: 'احتفاظ',
      risk: 'مخاطر',
      sadad: 'سداد',
      saip: 'الهيئة السعودية للملكية الفكرية',
      saudization: 'السعودة',
      'self-service': 'خدمة ذاتية',
      'service-desk': 'مكتب الخدمة',
      settlement: 'تسوية',
      shareholder: 'مساهم',
      signatory: 'مخوّل بالتوقيع',
      sla: 'اتفاقية الخدمة',
      surrender: 'تنازل',
      tax: 'ضريبة',
      termination: 'إنهاء',
      trademark: 'علامة تجارية',
      triage: 'فرز',
      urgent: 'عاجل',
      variation: 'تغيير',
      vendor: 'مورد',
      whistleblower: 'إبلاغ',
      zakat: 'زكاة',
      zatca: 'هيئة الزكاة والضريبة والجمارك',
    },
    stepTypes: {
      approval: 'اعتماد',
      approval_chain: 'سلسلة اعتماد',
      event_task: 'حدث',
      review: 'مراجعة',
      task: 'مهمة',
      human_task: 'مهمة بشرية',
      service_task: 'آلية',
      notification: 'إشعار',
      condition: 'شرط',
      parallel_gateway: 'تفرع متوازٍ',
      join_gateway: 'دمج المسارات',
      delay: 'تأخير',
      timer: 'مؤقّت',
      webhook: 'خطاف ويب',
      script: 'سكريبت',
      sub_workflow: 'سير عمل فرعي',
      end: 'نهاية',
    },
    variableTypes: {
      string: 'نص',
      number: 'رقم',
      boolean: 'منطقي',
      date: 'تاريخ',
      object: 'كائن',
      array: 'قائمة',
      json: 'JSON',
    },
    defaultValues: {
      consultation: 'استشارة',
      contract: 'عقد',
      litigation: 'تقاضٍ',
      investigation: 'تحقيق',
      opinion: 'رأي',
      low: 'منخفضة',
      normal: 'عادية',
      high: 'مرتفعة',
      urgent: 'عاجلة',
      pending: 'معلّق',
      review: 'مراجعة',
      approved: 'معتمد',
      rejected: 'مرفوض',
      true: 'نعم',
      false: 'لا',
    },
    generic: {
      step: 'خطوة {n}',
      variable: 'متغير {n}',
    },
  },
};

const TEMPLATE_FALLBACK_BY_ID = new Map<string, TemplateArabicFallback>();
const TEMPLATE_FALLBACK_BY_ENGLISH_NAME = new Map<
  string,
  TemplateArabicFallback
>();

for (const entry of TEMPLATE_ARABIC_FALLBACKS) {
  TEMPLATE_FALLBACK_BY_ID.set(entry.id, entry);
  TEMPLATE_FALLBACK_BY_ENGLISH_NAME.set(normalizeTemplateName(entry.en), entry);
}

export function useTemplateLocalLabels(): TemplateLocalLabels {
  return useBilingual(TEMPLATE_LOCAL_LABELS);
}

export function getWorkflowCategoryLabel(
  labels: TemplateLocalLabels,
  value: string,
): string {
  return labels.categories[value] ?? value;
}

export function getTemplateTagLabel(
  labels: TemplateLocalLabels,
  value: string,
): string {
  return labels.tags[value] ?? value;
}

export function getTemplateCountLabel(
  labels: TemplateLocalLabels,
  kind: TemplateCountKind,
  count: number,
  formattedCount: string,
): string {
  const template =
    count === 1 ? labels.counts[kind].one : labels.counts[kind].many;
  return template.replace('{n}', formattedCount);
}

export function getTemplateStepTypeLabel(
  labels: TemplateLocalLabels,
  type: string,
): string {
  return labels.stepTypes[type] ?? type;
}

export function getTemplateStepNameLabel(
  labels: TemplateLocalLabels,
  name: string,
  type: string,
  formattedIndex: string,
  locale: AppLocale | string,
): string {
  if (isArabicLocale(locale) && /[A-Za-z]/.test(name)) {
    return `${labels.generic.step.replace('{n}', formattedIndex)} - ${getTemplateStepTypeLabel(labels, type)}`;
  }
  return name;
}

export function getTemplateVariableNameLabel(
  labels: TemplateLocalLabels,
  name: string,
  formattedIndex: string,
  locale: AppLocale | string,
): string {
  if (isArabicLocale(locale) && /[A-Za-z]/.test(name)) {
    return labels.generic.variable.replace('{n}', formattedIndex);
  }
  return name;
}

export function getTemplateVariableTypeLabel(
  labels: TemplateLocalLabels,
  type: string,
): string {
  return labels.variableTypes[type] ?? type;
}

export function getTemplateDefaultValueLabel(
  labels: TemplateLocalLabels,
  value: unknown,
): string {
  if (value == null) {
    return '—';
  }
  if (typeof value === 'boolean') {
    return labels.defaultValues[String(value)] ?? String(value);
  }
  if (typeof value === 'string') {
    return labels.defaultValues[value] ?? value;
  }
  return String(value);
}

function resolveLocalizedMap(
  values: Record<string, string> | undefined,
  fallback: string,
  locale: AppLocale | string,
): string {
  if (!values) {
    return fallback;
  }
  return values[locale] ?? values.en ?? values.ar ?? fallback;
}

function isArabicLocale(locale: AppLocale | string): boolean {
  return locale === 'ar' || locale.startsWith('ar-');
}

function normalizeTemplateName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getTemplateArabicFallback(
  template: WorkflowTemplate,
): TemplateArabicFallback | undefined {
  return (
    TEMPLATE_FALLBACK_BY_ID.get(template.id) ??
    TEMPLATE_FALLBACK_BY_ENGLISH_NAME.get(normalizeTemplateName(template.name))
  );
}

function resolveTemplateText(
  template: WorkflowTemplate,
  values: Record<string, string> | undefined,
  fallback: string,
  field: 'name' | 'description',
  locale: AppLocale | string,
): string {
  if (isArabicLocale(locale)) {
    const explicitArabic = values?.ar?.trim();
    if (explicitArabic) {
      return explicitArabic;
    }

    const seededFallback = getTemplateArabicFallback(template);
    if (seededFallback) {
      return seededFallback[field];
    }
  }

  return resolveLocalizedMap(values, fallback, locale);
}

export function getTemplateDisplay(
  template: WorkflowTemplate,
  labels: TemplateLocalLabels,
  locale: AppLocale | string,
) {
  return {
    name: resolveTemplateText(
      template,
      template.name_i18n,
      template.name,
      'name',
      locale,
    ),
    description: resolveTemplateText(
      template,
      template.description_i18n,
      template.description,
      'description',
      locale,
    ),
    category: getWorkflowCategoryLabel(labels, template.category),
    tags: (template.tags ?? []).map((tag) => getTemplateTagLabel(labels, tag)),
  };
}
