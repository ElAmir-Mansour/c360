/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber *Threats* area (`/cyber/threats/**`).
 *
 * Same `{ en, ar }` bundle pattern as the alerts/events bundles: components read
 * the resolved `T` from `useThreatLabels()`, which falls back to English when no
 * LocaleProvider is mounted. The `en` side equals the pre-existing English
 * strings VERBATIM.
 *
 * Acronyms / product names stay as-is across both locales: MITRE ATT&CK, IOC,
 * CVE, CSV.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveCyberBilingual, type CyberBilingual } from '../../_lib/cyber-i18n';

interface ThreatLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
    tagActive: (count: number) => string;
    tagIocs: (count: number) => string;
    checkIndicators: string;
    newThreat: string;
    kpiActiveThreats: string;
    kpiActiveChange: string;
    kpiCriticalHigh: string;
    kpiIocsTracked: string;
    kpiContainedThisMonth: string;
    chartThreatsByType: string;
    chartThreatsBySeverity: string;
    chartThreatsSeriesLabel: string;
    chartSeverityCenter: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  filters: {
    severity: string;
    status: string;
    type: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    statusActive: string;
    statusContained: string;
    statusEradicated: string;
    statusMonitoring: string;
    statusClosed: string;
  };
  columns: {
    severity: string;
    threat: string;
    status: string;
    indicators: string;
    affectedAssets: string;
    tags: string;
    lastSeen: string;
    viewDetails: string;
  };
  detailPanel: {
    indicators: (count: number) => string;
    affectedAssets: (count: number) => string;
    firstSeen: string;
    lastSeen: string;
    tags: string;
    threatIndicators: (count: number) => string;
  };
  detail: {
    failedToLoad: string;
    refresh: string;
    updateStatus: string;
    moveTo: (status: string) => string;
    editThreat: string;
    deleteThreat: string;
    tabOverview: string;
    tabIndicators: string;
    tabRelatedAlerts: string;
    tabTimeline: string;
    tabMitre: string;
    updateStatusTitle: string;
    updateStatusDescription: (from: string, to: string) => string;
    confirm: string;
    deleteThreatTitle: string;
    deleteThreatDescription: string;
    deleteThreatConfirm: string;
    statusUpdated: string;
    threatDeleted: string;
  };
  overview: {
    noDescription: string;
    lifecycle: string;
    firstSeen: string;
    lastSeen: string;
    containedAt: string;
    daysActive: string;
    indicators: string;
    affectedAssets: string;
    linkedAlerts: string;
    mitreTechniques: string;
  };
  indicatorsTab: {
    colType: string;
    colValue: string;
    colSeverity: string;
    colSource: string;
    colConfidence: string;
    colFirstSeen: string;
    colLastSeen: string;
    colActive: string;
    colExpires: string;
    toggleAria: (value: string) => string;
    addIndicator: string;
    deactivate: string;
    exportCsv: string;
    deactivateConfirm: string;
    emptyTitle: string;
    emptyDescription: string;
    failedToLoad: string;
    indicatorActivated: string;
    indicatorDeactivated: string;
    failedToUpdateState: string;
    selectedDeactivated: string;
    valueRequired: string;
    existingUpdated: string;
    indicatorAdded: string;
    failedToAdd: string;
    dialogTitle: string;
    dialogDescription: string;
    type: string;
    severity: string;
    value: string;
    description: string;
    confidence: string;
    valuePlaceholder: string;
    descriptionPlaceholder: string;
    cancel: string;
    severityCritical: string;
    severityHigh: string;
    severityMedium: string;
    severityLow: string;
  };
  alertsTab: {
    colAlert: string;
    colSeverity: string;
    colStatus: string;
    colConfidence: string;
    colMitreTechnique: string;
    colCreated: string;
    failedToLoad: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  timelineTab: {
    failedToLoad: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  mitreTab: {
    failedToLoad: string;
    emptyTitle: string;
    emptyDescription: string;
    matrixSlice: string;
    matrixSliceDescription: string;
    techniquesCount: (count: number) => string;
    noTechniquesForTactic: string;
    platforms: string;
  };
  createDialog: {
    editTitle: string;
    createTitle: string;
    editDescription: string;
    createDescription: string;
    name: string;
    type: string;
    severity: string;
    tags: string;
    description: string;
    threatActor: string;
    campaign: string;
    mitreTactics: string;
    mitreTechniques: string;
    namePlaceholder: string;
    tagsPlaceholder: string;
    descriptionPlaceholder: string;
    threatActorPlaceholder: string;
    campaignPlaceholder: string;
    selectTactics: string;
    selectTechniques: string;
    selectTacticsFirst: string;
    initialIndicators: string;
    initialIndicatorsHint: string;
    addIndicator: string;
    noIndicatorsYet: string;
    indicatorN: (n: number) => string;
    remove: string;
    indType: string;
    indSeverity: string;
    indValue: string;
    indDescription: string;
    indConfidence: string;
    indValuePlaceholder: string;
    indDescriptionPlaceholder: string;
    analystConfidence: string;
    cancel: string;
    saving: string;
    creating: string;
    saveChanges: string;
    createThreat: string;
    severityCritical: string;
    severityHigh: string;
    severityMedium: string;
    severityLow: string;
    threatCreated: string;
    threatUpdated: string;
    nameRequired: string;
    indicatorValueRequired: string;
  };
  indicatorCheck: {
    title: string;
    description: string;
    label: string;
    placeholder: string;
    maliciousCount: (count: number) => string;
    cleanCount: (count: number) => string;
    close: string;
    check: string;
    checking: string;
    checkFailed: string;
  };
}

export const threatLabels: CyberBilingual<ThreatLabels> = {
  en: {
    page: {
      eyebrow: 'Cyber Defense',
      title: 'Threat Intelligence',
      description:
        'Track active threats, manage their lifecycle, and pivot from threat campaigns into indicators and related alerts.',
      tagActive: (count) => `${count} active`,
      tagIocs: (count) => `${count} IOCs`,
      checkIndicators: 'Check Indicators',
      newThreat: 'New Threat',
      kpiActiveThreats: 'Active Threats',
      kpiActiveChange: 'vs 7d',
      kpiCriticalHigh: 'Critical / High',
      kpiIocsTracked: 'IOCs Tracked',
      kpiContainedThisMonth: 'Contained This Month',
      chartThreatsByType: 'Threats by Type',
      chartThreatsBySeverity: 'Threats by Severity',
      chartThreatsSeriesLabel: 'Threats',
      chartSeverityCenter: 'threats',
      searchPlaceholder: 'Search threats…',
      emptyTitle: 'No threats found',
      emptyDescription: 'No threats match the current filters.',
    },
    filters: {
      severity: 'Severity',
      status: 'Status',
      type: 'Type',
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      statusActive: 'Active',
      statusContained: 'Contained',
      statusEradicated: 'Eradicated',
      statusMonitoring: 'Monitoring',
      statusClosed: 'Closed',
    },
    columns: {
      severity: 'Severity',
      threat: 'Threat',
      status: 'Status',
      indicators: 'Indicators',
      affectedAssets: 'Affected Assets',
      tags: 'Tags',
      lastSeen: 'Last Seen',
      viewDetails: 'View Details',
    },
    detailPanel: {
      indicators: (count) => `${count} indicators`,
      affectedAssets: (count) => `${count} affected assets`,
      firstSeen: 'First Seen',
      lastSeen: 'Last Seen',
      tags: 'Tags',
      threatIndicators: (count) => `Threat Indicators (${count})`,
    },
    detail: {
      failedToLoad: 'Failed to load threat',
      refresh: 'Refresh',
      updateStatus: 'Update Status',
      moveTo: (status) => `Move to ${status}`,
      editThreat: 'Edit Threat',
      deleteThreat: 'Delete Threat',
      tabOverview: 'Overview',
      tabIndicators: 'Indicators',
      tabRelatedAlerts: 'Related Alerts',
      tabTimeline: 'Activity Timeline',
      tabMitre: 'MITRE Mapping',
      updateStatusTitle: 'Update threat status',
      updateStatusDescription: (from, to) => `Move this threat from ${from} to ${to}?`,
      confirm: 'Confirm',
      deleteThreatTitle: 'Delete threat',
      deleteThreatDescription:
        'This will remove the threat from active views while preserving historical records.',
      deleteThreatConfirm: 'Delete Threat',
      statusUpdated: 'Threat status updated',
      threatDeleted: 'Threat deleted',
    },
    overview: {
      noDescription: 'No description provided.',
      lifecycle: 'Lifecycle',
      firstSeen: 'First Seen',
      lastSeen: 'Last Seen',
      containedAt: 'Contained At',
      daysActive: 'Days Active',
      indicators: 'Indicators',
      affectedAssets: 'Affected Assets',
      linkedAlerts: 'Linked Alerts',
      mitreTechniques: 'MITRE Techniques',
    },
    indicatorsTab: {
      colType: 'Type',
      colValue: 'Value',
      colSeverity: 'Severity',
      colSource: 'Source',
      colConfidence: 'Confidence',
      colFirstSeen: 'First Seen',
      colLastSeen: 'Last Seen',
      colActive: 'Active',
      colExpires: 'Expires',
      toggleAria: (value) => `Toggle ${value}`,
      addIndicator: 'Add Indicator',
      deactivate: 'Deactivate',
      exportCsv: 'Export CSV',
      deactivateConfirm: 'Deactivate the selected indicators?',
      emptyTitle: 'No indicators linked',
      emptyDescription: 'This threat does not have any indicators yet.',
      failedToLoad: 'Failed to load indicators',
      indicatorActivated: 'Indicator activated',
      indicatorDeactivated: 'Indicator deactivated',
      failedToUpdateState: 'Failed to update indicator state',
      selectedDeactivated: 'Selected indicators deactivated',
      valueRequired: 'Indicator value is required',
      existingUpdated: 'Existing indicator updated',
      indicatorAdded: 'Indicator added',
      failedToAdd: 'Failed to add indicator',
      dialogTitle: 'Add Indicator',
      dialogDescription:
        'Add an IOC to this threat so it can be matched against detections and analyst lookups. If an indicator with the same type and value already exists, it will be updated.',
      type: 'Type',
      severity: 'Severity',
      value: 'Value',
      description: 'Description',
      confidence: 'Confidence',
      valuePlaceholder: '203.0.113.24 or malicious-domain.example',
      descriptionPlaceholder: 'Observed from email gateway sandbox detonation',
      cancel: 'Cancel',
      severityCritical: 'Critical',
      severityHigh: 'High',
      severityMedium: 'Medium',
      severityLow: 'Low',
    },
    alertsTab: {
      colAlert: 'Alert',
      colSeverity: 'Severity',
      colStatus: 'Status',
      colConfidence: 'Confidence',
      colMitreTechnique: 'MITRE Technique',
      colCreated: 'Created',
      failedToLoad: 'Failed to load related alerts',
      emptyTitle: 'No related alerts',
      emptyDescription: 'No alerts currently map back to this threat’s indicators or MITRE techniques.',
    },
    timelineTab: {
      failedToLoad: 'Failed to load timeline',
      emptyTitle: 'No timeline events',
      emptyDescription: 'This threat does not have any recorded lifecycle events yet.',
    },
    mitreTab: {
      failedToLoad: 'Failed to load MITRE mapping',
      emptyTitle: 'No MITRE mapping',
      emptyDescription: 'This threat has not been mapped to ATT&CK tactics or techniques yet.',
      matrixSlice: 'ATT&CK Matrix Slice',
      matrixSliceDescription:
        'Tactics highlighted for this threat and the techniques currently mapped beneath them.',
      techniquesCount: (count) => `${count} techniques`,
      noTechniquesForTactic: 'No techniques mapped for this tactic yet.',
      platforms: 'Platforms',
    },
    createDialog: {
      editTitle: 'Edit Threat',
      createTitle: 'Create Threat',
      editDescription: 'Update the lifecycle, MITRE mapping, and analyst context for this threat.',
      createDescription: 'Capture a new threat, classify it, and attach the first indicators of compromise.',
      name: 'Name',
      type: 'Type',
      severity: 'Severity',
      tags: 'Tags',
      description: 'Description',
      threatActor: 'Threat Actor',
      campaign: 'Campaign',
      mitreTactics: 'MITRE Tactics',
      mitreTechniques: 'MITRE Techniques',
      namePlaceholder: 'APT29 credential harvesting cluster',
      tagsPlaceholder: 'apt29, oauth, credential-access',
      descriptionPlaceholder: 'Summarize the campaign, suspected intent, and observed behavior.',
      threatActorPlaceholder: 'APT29',
      campaignPlaceholder: 'winter-oauth-spray',
      selectTactics: 'Select tactics',
      selectTechniques: 'Select techniques',
      selectTacticsFirst: 'Select tactics first',
      initialIndicators: 'Initial Indicators',
      initialIndicatorsHint: 'Seed the threat with the IOCs analysts already have. You can add more later.',
      addIndicator: 'Add Indicator',
      noIndicatorsYet: 'No indicators added yet.',
      indicatorN: (n) => `Indicator ${n}`,
      remove: 'Remove',
      indType: 'Type',
      indSeverity: 'Severity',
      indValue: 'Value',
      indDescription: 'Description',
      indConfidence: 'Confidence',
      indValuePlaceholder: '198.51.100.24 or auth-portal.example.com',
      indDescriptionPlaceholder: 'Observed in phishing callback infrastructure',
      analystConfidence: 'Analyst confidence',
      cancel: 'Cancel',
      saving: 'Saving…',
      creating: 'Creating…',
      saveChanges: 'Save Changes',
      createThreat: 'Create Threat',
      severityCritical: 'Critical',
      severityHigh: 'High',
      severityMedium: 'Medium',
      severityLow: 'Low',
      threatCreated: 'Threat created',
      threatUpdated: 'Threat updated',
      nameRequired: 'Name is required',
      indicatorValueRequired: 'Indicator value is required',
    },
    indicatorCheck: {
      title: 'Indicator Check',
      description:
        'Paste IPs, domains, hashes, or URLs (one per line) to check against the threat intelligence database.',
      label: 'Indicators (one per line)',
      placeholder: '8.8.8.8\nmalicious-domain.com\nd41d8cd98f00b204e9800998ecf8427e',
      maliciousCount: (count) => `${count} Malicious Indicator${count !== 1 ? 's' : ''}`,
      cleanCount: (count) => `${count} Clean`,
      close: 'Close',
      check: 'Check Indicators',
      checking: 'Checking…',
      checkFailed: 'Indicator check failed',
    },
  },
  ar: {
    page: {
      eyebrow: 'الدفاع السيبراني',
      title: 'الاستخبارات التهديدية',
      description:
        'تتبّع التهديدات النشطة، وأدِر دورة حياتها، وانتقل من حملات التهديد إلى المؤشرات والتنبيهات المرتبطة.',
      tagActive: (count) => `${count} نشط`,
      tagIocs: (count) => `${count} مؤشر اختراق`,
      checkIndicators: 'فحص المؤشرات',
      newThreat: 'تهديد جديد',
      kpiActiveThreats: 'التهديدات النشطة',
      kpiActiveChange: 'مقارنةً بـ ٧ أيام',
      kpiCriticalHigh: 'حرج / عالٍ',
      kpiIocsTracked: 'مؤشرات الاختراق المتتبَّعة',
      kpiContainedThisMonth: 'المحتواة هذا الشهر',
      chartThreatsByType: 'التهديدات حسب النوع',
      chartThreatsBySeverity: 'التهديدات حسب الخطورة',
      chartThreatsSeriesLabel: 'التهديدات',
      chartSeverityCenter: 'تهديد',
      searchPlaceholder: 'ابحث في التهديدات…',
      emptyTitle: 'لا توجد تهديدات',
      emptyDescription: 'لا توجد تهديدات مطابقة لعوامل التصفية الحالية.',
    },
    filters: {
      severity: 'الخطورة',
      status: 'الحالة',
      type: 'النوع',
      critical: 'حرج',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      statusActive: 'نشط',
      statusContained: 'محتوى',
      statusEradicated: 'مُستأصَل',
      statusMonitoring: 'قيد المراقبة',
      statusClosed: 'مُغلق',
    },
    columns: {
      severity: 'الخطورة',
      threat: 'التهديد',
      status: 'الحالة',
      indicators: 'المؤشرات',
      affectedAssets: 'الأصول المتأثرة',
      tags: 'الوسوم',
      lastSeen: 'آخر ظهور',
      viewDetails: 'عرض التفاصيل',
    },
    detailPanel: {
      indicators: (count) => `${count} مؤشر`,
      affectedAssets: (count) => `${count} أصل متأثر`,
      firstSeen: 'أول ظهور',
      lastSeen: 'آخر ظهور',
      tags: 'الوسوم',
      threatIndicators: (count) => `مؤشرات التهديد (${count})`,
    },
    detail: {
      failedToLoad: 'تعذّر تحميل التهديد',
      refresh: 'تحديث',
      updateStatus: 'تحديث الحالة',
      moveTo: (status) => `الانتقال إلى ${status}`,
      editThreat: 'تعديل التهديد',
      deleteThreat: 'حذف التهديد',
      tabOverview: 'نظرة عامة',
      tabIndicators: 'المؤشرات',
      tabRelatedAlerts: 'التنبيهات المرتبطة',
      tabTimeline: 'الخط الزمني للنشاط',
      tabMitre: 'تخطيط MITRE',
      updateStatusTitle: 'تحديث حالة التهديد',
      updateStatusDescription: (from, to) => `نقل هذا التهديد من ${from} إلى ${to}؟`,
      confirm: 'تأكيد',
      deleteThreatTitle: 'حذف التهديد',
      deleteThreatDescription: 'سيؤدي ذلك إلى إزالة التهديد من العروض النشطة مع الحفاظ على السجلات التاريخية.',
      deleteThreatConfirm: 'حذف التهديد',
      statusUpdated: 'تم تحديث حالة التهديد',
      threatDeleted: 'تم حذف التهديد',
    },
    overview: {
      noDescription: 'لا يوجد وصف.',
      lifecycle: 'دورة الحياة',
      firstSeen: 'أول ظهور',
      lastSeen: 'آخر ظهور',
      containedAt: 'تم الاحتواء في',
      daysActive: 'أيام النشاط',
      indicators: 'المؤشرات',
      affectedAssets: 'الأصول المتأثرة',
      linkedAlerts: 'التنبيهات المرتبطة',
      mitreTechniques: 'أساليب MITRE',
    },
    indicatorsTab: {
      colType: 'النوع',
      colValue: 'القيمة',
      colSeverity: 'الخطورة',
      colSource: 'المصدر',
      colConfidence: 'الثقة',
      colFirstSeen: 'أول ظهور',
      colLastSeen: 'آخر ظهور',
      colActive: 'نشط',
      colExpires: 'تنتهي الصلاحية',
      toggleAria: (value) => `تبديل ${value}`,
      addIndicator: 'إضافة مؤشر',
      deactivate: 'إلغاء التنشيط',
      exportCsv: 'تصدير CSV',
      deactivateConfirm: 'إلغاء تنشيط المؤشرات المحددة؟',
      emptyTitle: 'لا توجد مؤشرات مرتبطة',
      emptyDescription: 'لا يحتوي هذا التهديد على أي مؤشرات بعد.',
      failedToLoad: 'تعذّر تحميل المؤشرات',
      indicatorActivated: 'تم تنشيط المؤشر',
      indicatorDeactivated: 'تم إلغاء تنشيط المؤشر',
      failedToUpdateState: 'تعذّر تحديث حالة المؤشر',
      selectedDeactivated: 'تم إلغاء تنشيط المؤشرات المحددة',
      valueRequired: 'قيمة المؤشر مطلوبة',
      existingUpdated: 'تم تحديث المؤشر الموجود',
      indicatorAdded: 'تمت إضافة المؤشر',
      failedToAdd: 'تعذّرت إضافة المؤشر',
      dialogTitle: 'إضافة مؤشر',
      dialogDescription:
        'أضِف مؤشر اختراق إلى هذا التهديد ليُطابَق مع عمليات الكشف وعمليات بحث المحللين. إذا كان هناك مؤشر بالنوع والقيمة نفسهما موجودًا مسبقًا، فسيُحدَّث.',
      type: 'النوع',
      severity: 'الخطورة',
      value: 'القيمة',
      description: 'الوصف',
      confidence: 'الثقة',
      valuePlaceholder: '203.0.113.24 أو malicious-domain.example',
      descriptionPlaceholder: 'رُصد من تفجير صندوق الرمل في بوابة البريد الإلكتروني',
      cancel: 'إلغاء',
      severityCritical: 'حرج',
      severityHigh: 'عالٍ',
      severityMedium: 'متوسط',
      severityLow: 'منخفض',
    },
    alertsTab: {
      colAlert: 'التنبيه',
      colSeverity: 'الخطورة',
      colStatus: 'الحالة',
      colConfidence: 'الثقة',
      colMitreTechnique: 'أسلوب MITRE',
      colCreated: 'أُنشئ في',
      failedToLoad: 'تعذّر تحميل التنبيهات المرتبطة',
      emptyTitle: 'لا توجد تنبيهات مرتبطة',
      emptyDescription: 'لا توجد تنبيهات مرتبطة حاليًا بمؤشرات هذا التهديد أو أساليب MITRE الخاصة به.',
    },
    timelineTab: {
      failedToLoad: 'تعذّر تحميل الخط الزمني',
      emptyTitle: 'لا توجد أحداث في الخط الزمني',
      emptyDescription: 'لا يحتوي هذا التهديد على أي أحداث دورة حياة مسجَّلة بعد.',
    },
    mitreTab: {
      failedToLoad: 'تعذّر تحميل تخطيط MITRE',
      emptyTitle: 'لا يوجد تخطيط MITRE',
      emptyDescription: 'لم يُربط هذا التهديد بأي تكتيكات أو أساليب ATT&CK بعد.',
      matrixSlice: 'شريحة مصفوفة ATT&CK',
      matrixSliceDescription: 'التكتيكات المميَّزة لهذا التهديد والأساليب المرتبطة بها حاليًا.',
      techniquesCount: (count) => `${count} أسلوب`,
      noTechniquesForTactic: 'لا توجد أساليب مرتبطة بهذا التكتيك بعد.',
      platforms: 'المنصات',
    },
    createDialog: {
      editTitle: 'تعديل التهديد',
      createTitle: 'إنشاء تهديد',
      editDescription: 'حدّث دورة الحياة وتخطيط MITRE وسياق المحلل لهذا التهديد.',
      createDescription: 'سجّل تهديدًا جديدًا، وصنّفه، وأرفق أول مؤشرات الاختراق.',
      name: 'الاسم',
      type: 'النوع',
      severity: 'الخطورة',
      tags: 'الوسوم',
      description: 'الوصف',
      threatActor: 'جهة التهديد',
      campaign: 'الحملة',
      mitreTactics: 'تكتيكات MITRE',
      mitreTechniques: 'أساليب MITRE',
      namePlaceholder: 'APT29 credential harvesting cluster',
      tagsPlaceholder: 'apt29, oauth, credential-access',
      descriptionPlaceholder: 'لخّص الحملة والنية المشتبهة والسلوك المرصود.',
      threatActorPlaceholder: 'APT29',
      campaignPlaceholder: 'winter-oauth-spray',
      selectTactics: 'اختر التكتيكات',
      selectTechniques: 'اختر الأساليب',
      selectTacticsFirst: 'اختر التكتيكات أولًا',
      initialIndicators: 'المؤشرات الأولية',
      initialIndicatorsHint: 'ابدأ التهديد بمؤشرات الاختراق التي يملكها المحللون بالفعل. يمكنك إضافة المزيد لاحقًا.',
      addIndicator: 'إضافة مؤشر',
      noIndicatorsYet: 'لم تُضَف أي مؤشرات بعد.',
      indicatorN: (n) => `المؤشر ${n}`,
      remove: 'إزالة',
      indType: 'النوع',
      indSeverity: 'الخطورة',
      indValue: 'القيمة',
      indDescription: 'الوصف',
      indConfidence: 'الثقة',
      indValuePlaceholder: '198.51.100.24 أو auth-portal.example.com',
      indDescriptionPlaceholder: 'رُصد في البنية التحتية لرجوع نداء التصيّد',
      analystConfidence: 'ثقة المحلل',
      cancel: 'إلغاء',
      saving: 'جارٍ الحفظ…',
      creating: 'جارٍ الإنشاء…',
      saveChanges: 'حفظ التغييرات',
      createThreat: 'إنشاء التهديد',
      severityCritical: 'حرج',
      severityHigh: 'عالٍ',
      severityMedium: 'متوسط',
      severityLow: 'منخفض',
      threatCreated: 'تم إنشاء التهديد',
      threatUpdated: 'تم تحديث التهديد',
      nameRequired: 'الاسم مطلوب',
      indicatorValueRequired: 'قيمة المؤشر مطلوبة',
    },
    indicatorCheck: {
      title: 'فحص المؤشرات',
      description:
        'الصق عناوين IP أو النطاقات أو البصمات أو الروابط (واحدًا في كل سطر) للتحقق منها مقابل قاعدة بيانات الاستخبارات التهديدية.',
      label: 'المؤشرات (واحد في كل سطر)',
      placeholder: '8.8.8.8\nmalicious-domain.com\nd41d8cd98f00b204e9800998ecf8427e',
      maliciousCount: (count) => `${count} مؤشر خبيث`,
      cleanCount: (count) => `${count} سليم`,
      close: 'إغلاق',
      check: 'فحص المؤشرات',
      checking: 'جارٍ الفحص…',
      checkFailed: 'فشل فحص المؤشرات',
    },
  },
};

export function useThreatLabels(): ThreatLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(threatLabels, locale), [locale]);
}
