/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber *Indicators / IOC* area (`/cyber/indicators/**`).
 *
 * Same `{ en, ar }` bundle pattern as the alerts bundle: components read the
 * resolved `T` from `useIndicatorLabels()`, which falls back to English when no
 * LocaleProvider is mounted. The `en` side equals the pre-existing English.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveCyberBilingual, type CyberBilingual } from '../../alerts/_lib/alerts-i18n';

interface IndicatorLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
    indicatorsTag: (count: string) => string;
    activeTag: (count: string) => string;
    checkIndicators: string;
    bulkImport: string;
    addIndicator: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    deleteTitle: string;
    deleteDescription: string;
    deleteConfirm: string;
    indicatorDeleted: string;
  };
  filters: {
    type: string;
    source: string;
    severity: string;
    active: string;
    threatLink: string;
    confidence: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    activeOnly: string;
    inactiveOnly: string;
    linked: string;
    unlinked: string;
  };
  bulk: {
    activateSelected: string;
    deactivateSelected: string;
    exportCsv: string;
    exportJson: string;
    exportStix: string;
    deleteSelected: string;
    indicatorActivated: string;
    indicatorDeactivated: string;
    updateFailed: string;
    activated: (count: number) => string;
    deactivated: (count: number) => string;
    deleted: (count: number) => string;
  };
  columns: {
    type: string;
    value: string;
    severity: string;
    source: string;
    confidence: string;
    signal: string;
    linkedThreat: string;
    unlinked: string;
    active: string;
    enabled: string;
    disabled: string;
    firstSeen: string;
    lastSeen: string;
    expiresAt: string;
    activateIndicator: string;
    deactivateIndicator: string;
    indicatorActions: string;
    viewDetails: string;
    editIndicator: string;
    deleteIndicator: string;
  };
  stats: {
    totalIocs: string;
    totalIocsDesc: string;
    activeIocs: string;
    activeIocsDesc: (percent: number) => string;
    monitoring: string;
    expiringSoon: string;
    expiringSoonDesc: string;
    sourceMix: string;
    noSourceTelemetry: string;
  };
  editor: {
    editTitle: string;
    addTitle: string;
    description: string;
    typeLabel: string;
    severityLabel: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    valueLabel: string;
    valuePlaceholder: string;
    valueRequired: string;
    sourceLabel: string;
    linkedThreatLabel: string;
    optionalThreatLink: string;
    noLinkedThreat: string;
    confidenceLabel: (value: number) => string;
    confidenceHelp: string;
    expiresAtLabel: string;
    tagsLabel: string;
    tagsPlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    cancel: string;
    saving: string;
    saveChanges: string;
    createIndicator: string;
    created: string;
    updated: string;
  };
  bulkImport: {
    title: string;
    description: string;
    stixTab: string;
    csvTab: string;
    manualTab: string;
    stixBundleLabel: string;
    conflictResolution: string;
    skipDuplicates: string;
    updateExisting: string;
    failOnDuplicate: string;
    conflictHelp: string;
    previewCount: (count: number) => string;
    stixPreviewDesc: string;
    csvSourceLabel: string;
    valueColumn: string;
    typeColumn: string;
    severityColumn: string;
    sourceColumn: string;
    defaultSeverity: string;
    defaultSource: string;
    defaultConfidence: (value: number) => string;
    csvPreview: string;
    csvPreviewDesc: string;
    colType: string;
    colValue: string;
    colSeverity: string;
    colSource: string;
    colStatus: string;
    colNote: string;
    ready: string;
    indicatorsLabel: string;
    severityLabel: string;
    sourceLabel: string;
    confidenceLabel: (value: number) => string;
    commonTags: string;
    commonTagsPlaceholder: string;
    manualPreviewDesc: string;
    nothingToPreview: string;
    optional: string;
    notMapped: string;
    importSummary: string;
    parsed: (count: number) => string;
    imported: (count: number) => string;
    skipped: (count: number) => string;
    failed: (count: number) => string;
    close: string;
    importing: string;
    importIndicators: string;
    uploadStixFirst: string;
    importFailed: string;
    unableToInferType: string;
  };
  detail: {
    fallbackTitle: string;
    fallbackDescription: string;
    typeIndicator: (type: string) => string;
    selectPrompt: string;
    active: string;
    inactive: string;
    source: string;
    editIndicator: string;
    openThreat: string;
    lifecycle: string;
    firstSeen: string;
    lastSeen: string;
    expiresAt: string;
    noExpiration: string;
    confidence: string;
    linkedThreat: string;
    threat: string;
    notLinked: string;
    enrichment: string;
    loadingEnrichment: string;
    dns: string;
    noDns: string;
    geolocation: string;
    noGeo: string;
    cveAssociations: string;
    noCves: string;
    reputationWhois: string;
    reputationScore: string;
    unavailable: string;
    noWhois: string;
    detectionHistory: string;
    loadingMatches: string;
    noDetections: string;
    tagsMetadata: string;
    noTags: string;
    asset: (name: string) => string;
  };
}

export const indicatorLabels: CyberBilingual<IndicatorLabels> = {
  en: {
    page: {
      eyebrow: 'Cyber Defense',
      title: 'IOC Management',
      description:
        'Validate, enrich, and operationalize indicators across threat hunting, detections, and threat intelligence feed ingestion.',
      indicatorsTag: (count) => `${count} indicators`,
      activeTag: (count) => `${count} active`,
      checkIndicators: 'Check Indicators',
      bulkImport: 'Bulk Import',
      addIndicator: 'Add Indicator',
      searchPlaceholder: 'Search IOC values, tags, or linked threat context…',
      emptyTitle: 'No indicators found',
      emptyDescription: 'No indicators match the current filters.',
      deleteTitle: 'Delete indicator?',
      deleteDescription:
        'This removes the indicator from the tenant and stops future matches against it.',
      deleteConfirm: 'Delete',
      indicatorDeleted: 'Indicator deleted',
    },
    filters: {
      type: 'Type',
      source: 'Source',
      severity: 'Severity',
      active: 'Active',
      threatLink: 'Threat Link',
      confidence: 'Confidence',
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      activeOnly: 'Active Only',
      inactiveOnly: 'Inactive Only',
      linked: 'Linked',
      unlinked: 'Unlinked',
    },
    bulk: {
      activateSelected: 'Activate Selected',
      deactivateSelected: 'Deactivate Selected',
      exportCsv: 'Export CSV',
      exportJson: 'Export JSON',
      exportStix: 'Export STIX',
      deleteSelected: 'Delete Selected',
      indicatorActivated: 'Indicator activated',
      indicatorDeactivated: 'Indicator deactivated',
      updateFailed: 'Unable to update indicator',
      activated: (count) => `${count} indicators activated`,
      deactivated: (count) => `${count} indicators deactivated`,
      deleted: (count) => `${count} indicators deleted`,
    },
    columns: {
      type: 'Type',
      value: 'Value',
      severity: 'Severity',
      source: 'Source',
      confidence: 'Confidence',
      signal: 'Signal',
      linkedThreat: 'Linked Threat',
      unlinked: 'Unlinked',
      active: 'Active',
      enabled: 'Enabled',
      disabled: 'Disabled',
      firstSeen: 'First Seen',
      lastSeen: 'Last Seen',
      expiresAt: 'Expires At',
      activateIndicator: 'Activate indicator',
      deactivateIndicator: 'Deactivate indicator',
      indicatorActions: 'Indicator actions',
      viewDetails: 'View details',
      editIndicator: 'Edit indicator',
      deleteIndicator: 'Delete indicator',
    },
    stats: {
      totalIocs: 'Total IOCs',
      totalIocsDesc: 'Across all sources & types',
      activeIocs: 'Active IOCs',
      activeIocsDesc: (percent) => `${percent}% detection rate`,
      monitoring: 'Monitoring',
      expiringSoon: 'Expiring Soon',
      expiringSoonDesc: 'Within next 7 days',
      sourceMix: 'Source Mix',
      noSourceTelemetry: 'No source telemetry yet.',
    },
    editor: {
      editTitle: 'Edit Indicator',
      addTitle: 'Add Indicator',
      description:
        'Validate the IOC before saving it so noisy data does not enter the detection pipeline.',
      typeLabel: 'Type',
      severityLabel: 'Severity',
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      valueLabel: 'Value',
      valuePlaceholder: '203.0.113.50 or login-reset.example',
      valueRequired: 'Value is required',
      sourceLabel: 'Source',
      linkedThreatLabel: 'Linked Threat',
      optionalThreatLink: 'Optional threat link',
      noLinkedThreat: 'No linked threat',
      confidenceLabel: (value) => `Confidence (${value}%)`,
      confidenceHelp: 'Manual indicators default to 80% confidence.',
      expiresAtLabel: 'Expires At',
      tagsLabel: 'Tags',
      tagsPlaceholder: 'credential theft, external, finance',
      descriptionLabel: 'Description',
      descriptionPlaceholder: 'Analyst note, campaign context, or handling guidance.',
      cancel: 'Cancel',
      saving: 'Saving…',
      saveChanges: 'Save Changes',
      createIndicator: 'Create Indicator',
      created: 'Indicator created',
      updated: 'Indicator updated',
    },
    bulkImport: {
      title: 'Bulk Import Indicators',
      description:
        'Preview the incoming IOCs before import so malformed or low-signal data does not reach the matcher.',
      stixTab: 'STIX Bundle',
      csvTab: 'CSV Import',
      manualTab: 'Manual Paste',
      stixBundleLabel: 'STIX 2 bundle',
      conflictResolution: 'Conflict Resolution',
      skipDuplicates: 'Skip duplicates',
      updateExisting: 'Update existing',
      failOnDuplicate: 'Fail on duplicate',
      conflictHelp:
        'The current backend importer stores STIX IOCs and skips preview-only updates. This selector preserves the analyst intent for future importer revisions.',
      previewCount: (count) => `Preview (${count})`,
      stixPreviewDesc: 'Common STIX observable patterns extracted from the bundle.',
      csvSourceLabel: 'CSV source',
      valueColumn: 'Value Column',
      typeColumn: 'Type Column',
      severityColumn: 'Severity Column',
      sourceColumn: 'Source Column',
      defaultSeverity: 'Default Severity',
      defaultSource: 'Default Source',
      defaultConfidence: (value) => `Default Confidence (${value}%)`,
      csvPreview: 'CSV Preview',
      csvPreviewDesc: 'Invalid rows are highlighted and excluded from import.',
      colType: 'Type',
      colValue: 'Value',
      colSeverity: 'Severity',
      colSource: 'Source',
      colStatus: 'Status',
      colNote: 'Note',
      ready: 'Ready',
      indicatorsLabel: 'Indicators (one per line)',
      severityLabel: 'Severity',
      sourceLabel: 'Source',
      confidenceLabel: (value) => `Confidence (${value}%)`,
      commonTags: 'Common Tags',
      commonTagsPlaceholder: 'phishing, watchlist, external',
      manualPreviewDesc: 'Types are auto-detected from the pasted values.',
      nothingToPreview: 'Nothing to preview yet.',
      optional: 'Optional',
      notMapped: 'Not mapped',
      importSummary: 'Import Summary',
      parsed: (count) => `Parsed: ${count}`,
      imported: (count) => `Imported: ${count}`,
      skipped: (count) => `Skipped: ${count}`,
      failed: (count) => `Failed: ${count}`,
      close: 'Close',
      importing: 'Importing…',
      unableToInferType: 'Unable to infer indicator type',
      importIndicators: 'Import Indicators',
      uploadStixFirst: 'Upload a STIX bundle first',
      importFailed: 'Import failed',
    },
    detail: {
      fallbackTitle: 'Indicator Detail',
      fallbackDescription: 'Indicator enrichment and detection history',
      typeIndicator: (type) => `${type} indicator`,
      selectPrompt: 'Select an indicator to inspect its context.',
      active: 'Active',
      inactive: 'Inactive',
      source: 'Source',
      editIndicator: 'Edit Indicator',
      openThreat: 'Open Threat',
      lifecycle: 'Lifecycle',
      firstSeen: 'First Seen',
      lastSeen: 'Last Seen',
      expiresAt: 'Expires At',
      noExpiration: 'No expiration',
      confidence: 'Confidence',
      linkedThreat: 'Linked Threat',
      threat: 'Threat',
      notLinked: 'This IOC is not linked to a named threat yet.',
      enrichment: 'Enrichment',
      loadingEnrichment: 'Loading enrichment…',
      dns: 'DNS',
      noDns: 'No DNS enrichment',
      geolocation: 'Geolocation',
      noGeo: 'No geolocation data',
      cveAssociations: 'CVE Associations',
      noCves: 'No CVE associations recorded.',
      reputationWhois: 'Reputation / WHOIS',
      reputationScore: 'Reputation score:',
      unavailable: 'Unavailable',
      noWhois: 'No WHOIS payload available.',
      detectionHistory: 'Detection History',
      loadingMatches: 'Loading recent matches…',
      noDetections: 'No recent detections matched this indicator.',
      tagsMetadata: 'Tags & Metadata',
      noTags: 'No analyst tags applied.',
      asset: (name) => `asset ${name}`,
    },
  },
  ar: {
    page: {
      eyebrow: 'الدفاع السيبراني',
      title: 'إدارة مؤشرات الاختراق',
      description:
        'تحقّق من المؤشرات وأثرِها وفعّلها تشغيليًا عبر صيد التهديدات وعمليات الكشف واستيعاب موجزات الاستخبارات التهديدية.',
      indicatorsTag: (count) => `${count} مؤشر`,
      activeTag: (count) => `${count} نشط`,
      checkIndicators: 'فحص المؤشرات',
      bulkImport: 'استيراد مجمّع',
      addIndicator: 'إضافة مؤشر',
      searchPlaceholder: 'ابحث في قيم مؤشرات الاختراق أو الوسوم أو سياق التهديد المرتبط…',
      emptyTitle: 'لا توجد مؤشرات',
      emptyDescription: 'لا توجد مؤشرات مطابقة لعوامل التصفية الحالية.',
      deleteTitle: 'حذف المؤشر؟',
      deleteDescription:
        'يؤدي هذا إلى إزالة المؤشر من المستأجر وإيقاف المطابقات المستقبلية معه.',
      deleteConfirm: 'حذف',
      indicatorDeleted: 'تم حذف المؤشر',
    },
    filters: {
      type: 'النوع',
      source: 'المصدر',
      severity: 'الخطورة',
      active: 'نشط',
      threatLink: 'ارتباط التهديد',
      confidence: 'الثقة',
      critical: 'حرج',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      activeOnly: 'النشط فقط',
      inactiveOnly: 'غير النشط فقط',
      linked: 'مرتبط',
      unlinked: 'غير مرتبط',
    },
    bulk: {
      activateSelected: 'تفعيل المحدد',
      deactivateSelected: 'تعطيل المحدد',
      exportCsv: 'تصدير CSV',
      exportJson: 'تصدير JSON',
      exportStix: 'تصدير STIX',
      deleteSelected: 'حذف المحدد',
      indicatorActivated: 'تم تفعيل المؤشر',
      indicatorDeactivated: 'تم تعطيل المؤشر',
      updateFailed: 'تعذّر تحديث المؤشر',
      activated: (count) => `تم تفعيل ${count} مؤشر`,
      deactivated: (count) => `تم تعطيل ${count} مؤشر`,
      deleted: (count) => `تم حذف ${count} مؤشر`,
    },
    columns: {
      type: 'النوع',
      value: 'القيمة',
      severity: 'الخطورة',
      source: 'المصدر',
      confidence: 'الثقة',
      signal: 'الإشارة',
      linkedThreat: 'التهديد المرتبط',
      unlinked: 'غير مرتبط',
      active: 'نشط',
      enabled: 'مُفعَّل',
      disabled: 'مُعطَّل',
      firstSeen: 'أول ظهور',
      lastSeen: 'آخر ظهور',
      expiresAt: 'ينتهي في',
      activateIndicator: 'تفعيل المؤشر',
      deactivateIndicator: 'تعطيل المؤشر',
      indicatorActions: 'إجراءات المؤشر',
      viewDetails: 'عرض التفاصيل',
      editIndicator: 'تعديل المؤشر',
      deleteIndicator: 'حذف المؤشر',
    },
    stats: {
      totalIocs: 'إجمالي مؤشرات الاختراق',
      totalIocsDesc: 'عبر جميع المصادر والأنواع',
      activeIocs: 'مؤشرات الاختراق النشطة',
      activeIocsDesc: (percent) => `معدل كشف ${percent}%`,
      monitoring: 'مراقبة',
      expiringSoon: 'قريبة الانتهاء',
      expiringSoonDesc: 'خلال الأيام السبعة القادمة',
      sourceMix: 'مزيج المصادر',
      noSourceTelemetry: 'لا توجد قياسات مصادر بعد.',
    },
    editor: {
      editTitle: 'تعديل المؤشر',
      addTitle: 'إضافة مؤشر',
      description:
        'تحقّق من مؤشر الاختراق قبل حفظه حتى لا تدخل البيانات المُشوِّشة إلى مسار الكشف.',
      typeLabel: 'النوع',
      severityLabel: 'الخطورة',
      critical: 'حرج',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      valueLabel: 'القيمة',
      valuePlaceholder: '203.0.113.50 أو login-reset.example',
      valueRequired: 'القيمة مطلوبة',
      sourceLabel: 'المصدر',
      linkedThreatLabel: 'التهديد المرتبط',
      optionalThreatLink: 'ارتباط تهديد اختياري',
      noLinkedThreat: 'لا يوجد تهديد مرتبط',
      confidenceLabel: (value) => `الثقة (${value}%)`,
      confidenceHelp: 'تبلغ ثقة المؤشرات اليدوية 80% افتراضيًا.',
      expiresAtLabel: 'ينتهي في',
      tagsLabel: 'الوسوم',
      tagsPlaceholder: 'سرقة بيانات اعتماد، خارجي، مالية',
      descriptionLabel: 'الوصف',
      descriptionPlaceholder: 'ملاحظة المحلل أو سياق الحملة أو إرشادات التعامل.',
      cancel: 'إلغاء',
      saving: 'جارٍ الحفظ…',
      saveChanges: 'حفظ التغييرات',
      createIndicator: 'إنشاء مؤشر',
      created: 'تم إنشاء المؤشر',
      updated: 'تم تحديث المؤشر',
    },
    bulkImport: {
      title: 'استيراد المؤشرات بشكل مجمّع',
      description:
        'عاين مؤشرات الاختراق الواردة قبل الاستيراد حتى لا تصل البيانات المُشوَّهة أو الضعيفة الإشارة إلى المُطابِق.',
      stixTab: 'حزمة STIX',
      csvTab: 'استيراد CSV',
      manualTab: 'لصق يدوي',
      stixBundleLabel: 'حزمة STIX 2',
      conflictResolution: 'حل التعارض',
      skipDuplicates: 'تخطّي المكررات',
      updateExisting: 'تحديث الموجود',
      failOnDuplicate: 'الفشل عند التكرار',
      conflictHelp:
        'يخزّن المُستورِد الحالي في الخادم مؤشرات STIX ويتخطّى التحديثات التي للمعاينة فقط. يحافظ هذا الخيار على نية المحلل لمراجعات المُستورِد المستقبلية.',
      previewCount: (count) => `المعاينة (${count})`,
      stixPreviewDesc: 'أنماط المُلاحظات الشائعة في STIX المستخرجة من الحزمة.',
      csvSourceLabel: 'مصدر CSV',
      valueColumn: 'عمود القيمة',
      typeColumn: 'عمود النوع',
      severityColumn: 'عمود الخطورة',
      sourceColumn: 'عمود المصدر',
      defaultSeverity: 'الخطورة الافتراضية',
      defaultSource: 'المصدر الافتراضي',
      defaultConfidence: (value) => `الثقة الافتراضية (${value}%)`,
      csvPreview: 'معاينة CSV',
      csvPreviewDesc: 'تُميَّز الصفوف غير الصالحة وتُستبعد من الاستيراد.',
      colType: 'النوع',
      colValue: 'القيمة',
      colSeverity: 'الخطورة',
      colSource: 'المصدر',
      colStatus: 'الحالة',
      colNote: 'ملاحظة',
      ready: 'جاهز',
      indicatorsLabel: 'المؤشرات (واحد في كل سطر)',
      severityLabel: 'الخطورة',
      sourceLabel: 'المصدر',
      confidenceLabel: (value) => `الثقة (${value}%)`,
      commonTags: 'وسوم مشتركة',
      commonTagsPlaceholder: 'تصيّد، قائمة مراقبة، خارجي',
      manualPreviewDesc: 'تُكتشف الأنواع تلقائيًا من القيم الملصوقة.',
      nothingToPreview: 'لا شيء للمعاينة بعد.',
      optional: 'اختياري',
      notMapped: 'غير مُعيَّن',
      importSummary: 'ملخص الاستيراد',
      parsed: (count) => `المُحلَّل: ${count}`,
      imported: (count) => `المُستورَد: ${count}`,
      skipped: (count) => `المُتخطَّى: ${count}`,
      failed: (count) => `الفاشل: ${count}`,
      close: 'إغلاق',
      importing: 'جارٍ الاستيراد…',
      unableToInferType: 'تعذّر استنتاج نوع المؤشر',
      importIndicators: 'استيراد المؤشرات',
      uploadStixFirst: 'حمّل حزمة STIX أولًا',
      importFailed: 'فشل الاستيراد',
    },
    detail: {
      fallbackTitle: 'تفاصيل المؤشر',
      fallbackDescription: 'إثراء المؤشر وسجل عمليات الكشف',
      typeIndicator: (type) => `مؤشر ${type}`,
      selectPrompt: 'اختر مؤشرًا لفحص سياقه.',
      active: 'نشط',
      inactive: 'غير نشط',
      source: 'المصدر',
      editIndicator: 'تعديل المؤشر',
      openThreat: 'فتح التهديد',
      lifecycle: 'دورة الحياة',
      firstSeen: 'أول ظهور',
      lastSeen: 'آخر ظهور',
      expiresAt: 'ينتهي في',
      noExpiration: 'لا انتهاء',
      confidence: 'الثقة',
      linkedThreat: 'التهديد المرتبط',
      threat: 'تهديد',
      notLinked: 'هذا المؤشر غير مرتبط بتهديد مُسمّى بعد.',
      enrichment: 'الإثراء',
      loadingEnrichment: 'جارٍ تحميل الإثراء…',
      dns: 'DNS',
      noDns: 'لا يوجد إثراء DNS',
      geolocation: 'الموقع الجغرافي',
      noGeo: 'لا توجد بيانات موقع جغرافي',
      cveAssociations: 'ارتباطات CVE',
      noCves: 'لم تُسجَّل أي ارتباطات CVE.',
      reputationWhois: 'السمعة / WHOIS',
      reputationScore: 'درجة السمعة:',
      unavailable: 'غير متاح',
      noWhois: 'لا توجد حمولة WHOIS متاحة.',
      detectionHistory: 'سجل الكشف',
      loadingMatches: 'جارٍ تحميل المطابقات الأخيرة…',
      noDetections: 'لم تطابق أي عمليات كشف أخيرة هذا المؤشر.',
      tagsMetadata: 'الوسوم والبيانات الوصفية',
      noTags: 'لم تُطبَّق وسوم محلل.',
      asset: (name) => `الأصل ${name}`,
    },
  },
};

export function useIndicatorLabels(): IndicatorLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(indicatorLabels, locale), [locale]);
}
