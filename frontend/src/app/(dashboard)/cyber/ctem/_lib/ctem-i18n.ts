/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber *CTEM* (Continuous Threat Exposure Management) area
 * (`/cyber/ctem/**`).
 *
 * Mirrors the shared `cyber-i18n.ts` `{ en, ar }` bundle pattern. Components read
 * the resolved `T` from `useCtemLabels()`; the `en` side equals the pre-existing
 * English strings exactly. Acronyms / product names stay as-is across both
 * locales: CTEM, CVE, CVSS, PDF, DOCX.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { registerMessages } from '@/lib/i18n/registry';
import {
  resolveCyberBilingual,
  type CyberBilingual,
} from '../../_lib/cyber-i18n';

// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).

export interface CtemLabels {
  // ---- list page ----
  list: {
    title: string;
    description: string;
    newAssessment: string;
    statExposureScore: string;
    statAssessments: string;
    statCriticalExposures: string;
    loadError: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  // ---- dashboard page ----
  dashboard: {
    title: string;
    description: string;
    viewAssessments: string;
    kpiExposureScore: string;
    kpiGrade: (grade: string) => string;
    kpiTrend: string;
    kpiTrendPts: (delta: string) => string;
    kpiLastCalculated: string;
    trendChartTitle: string;
    trendSeriesLabel: string;
    runNewTitle: string;
    runNewBody: string;
    goToAssessments: string;
    methodologyTitle: string;
    methodologyBody: string;
  };
  // ---- assessment card ----
  card: {
    criticalSuffix: (count: number) => string;
    highSuffix: (count: number) => string;
    totalFindings: (count: number) => string;
    exposureScore: string;
  };
  // ---- create assessment dialog ----
  create: {
    title: string;
    description: string;
    name: string;
    nameRequired: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    assetTagFilter: string;
    namePlaceholder: string;
    assetTagPlaceholder: string;
    cancel: string;
    starting: string;
    startAssessment: string;
    createdToast: string;
  };
  // ---- exposure score gauge ----
  gauge: {
    title: string;
    pts: (value: string) => string;
  };
  // ---- detail page ----
  detail: {
    loadError: string;
    started: (when: string) => string;
    exporting: string;
    export: string;
    exportPdf: string;
    exportDocx: string;
    cancel: string;
    delete: string;
    statCritical: string;
    statHigh: string;
    statMedium: string;
    statLow: string;
    statTotal: string;
    progressTitle: string;
    findingsTitle: string;
    reportExportStarted: (format: string) => string;
    exportFailed: string;
    cancelledToast: string;
    cancelFailed: string;
    deletedToast: string;
    deleteFailed: string;
    cancelDialogTitle: string;
    cancelDialogDescription: string;
    cancelDialogConfirm: string;
    deleteDialogTitle: string;
    deleteDialogDescription: string;
    deleteDialogConfirm: string;
  };
  // ---- assessment status enum ----
  status: Record<string, string>;
  // ---- phase stepper ----
  phases: {
    scoping: { label: string; description: string };
    discovery: { label: string; description: string };
    prioritization: { label: string; description: string };
    validation: { label: string; description: string };
    mobilization: { label: string; description: string };
  };
  // ---- finding table ----
  findingTable: {
    empty: string;
    colSeverity: string;
    colFinding: string;
    colAssets: string;
    colStatus: string;
    colPriority: string;
    highExploitability: string;
    assetsCount: (count: number) => string;
  };
  // ---- finding status enum ----
  findingStatus: Record<string, string>;
  // ---- finding detail panel ----
  findingPanel: {
    highExploitRisk: string;
    exploitability: string;
    impact: string;
    priorityScore: string;
    affectedAssets: string;
    otherAssets: (count: number) => string;
    assetsAffected: (count: number) => string;
    cves: string;
    attackPath: string;
    remediation: string;
    effortSuffix: (effort: string) => string;
    daysSuffix: (days: number) => string;
    status: string;
    update: string;
  };
  // ---- finding status dialog ----
  findingStatusDialog: {
    title: string;
    statusLabel: string;
    selectStatus: string;
    notesLabel: string;
    notesPlaceholder: string;
    cancel: string;
    updating: string;
    updateStatus: string;
    updatedToast: string;
    failedToast: string;
  };
  // ---- remediation groups ----
  remediationGroups: {
    title: string;
    empty: string;
    findingsCount: (count: number) => string;
    assetsCount: (count: number) => string;
    type: string;
    effort: string;
    priorityGroup: string;
    maxPriority: string;
    estimated: (days: number) => string;
    scoreReduction: string;
    execute: string;
    statusUpdatedToast: string;
    statusUpdateFailed: string;
    executeStartedToast: string;
    executeFailed: string;
    groupStatus: Record<string, string>;
  };
  // ---- assessment comparison ----
  comparison: {
    title: string;
    selectPlaceholder: string;
    newFindings: string;
    resolved: string;
    unchanged: string;
    worsened: string;
    current: string;
    previous: string;
    exposureScore: string;
    newFindingsTitle: string;
    resolvedFindingsTitle: string;
    noOther: string;
  };
  // ---- assessment report view ----
  report: {
    notCompleted: string;
    reportLabel: string;
    executiveSummary: string;
    exposureScore: string;
    outOf: string;
    colSeverity: string;
    colCount: string;
    total: string;
    findingsBySeverity: string;
    colFinding: string;
    colStatus: string;
    colPriority: string;
    statusLabel: Record<string, string>;
  };
  // ---- attack path visualization ----
  attackPath: {
    empty: string;
    assetsSuffix: (count: number) => string;
  };
}

export const ctemLabels: CyberBilingual<CtemLabels> = {
  en: {
    list: {
      title: 'CTEM Assessments',
      description: 'Continuous Threat Exposure Management — quantify and reduce your attack surface',
      newAssessment: 'New Assessment',
      statExposureScore: 'Exposure Score',
      statAssessments: 'Assessments',
      statCriticalExposures: 'Critical Exposures',
      loadError: 'Failed to load assessments',
      emptyTitle: 'No assessments',
      emptyDescription: 'Launch your first CTEM assessment to quantify your threat exposure.',
    },
    dashboard: {
      title: 'CTEM Dashboard',
      description: "Continuous Threat Exposure Management — track your organization's exposure score and remediation progress.",
      viewAssessments: 'View Assessments',
      kpiExposureScore: 'Exposure Score',
      kpiGrade: (grade) => `Grade: ${grade}`,
      kpiTrend: 'Trend',
      kpiTrendPts: (delta) => `${delta} pts`,
      kpiLastCalculated: 'Last Calculated',
      trendChartTitle: 'Exposure Score Trend (90 Days)',
      trendSeriesLabel: 'Exposure Score',
      runNewTitle: 'Run New Assessment',
      runNewBody: 'Start a new CTEM assessment to discover exposures, prioritize risks, and create remediation plans.',
      goToAssessments: 'Go to Assessments',
      methodologyTitle: 'Exposure Score Methodology',
      methodologyBody: 'Score = 35% Vulnerability + 25% Attack Surface + 25% Threat Activity + 15% Velocity. Graded A (≤20) through F (>80).',
    },
    card: {
      criticalSuffix: (count) => `${count} critical`,
      highSuffix: (count) => `${count} high`,
      totalFindings: (count) => `${count} total findings`,
      exposureScore: 'Exposure score: ',
    },
    create: {
      title: 'New CTEM Assessment',
      description: 'Launch a Continuous Threat Exposure Management assessment across your asset inventory.',
      name: 'Assessment Name',
      nameRequired: 'Name is required',
      descriptionLabel: 'Description',
      descriptionPlaceholder: 'Scope, goals, or notes…',
      assetTagFilter: 'Asset Tag Filter (comma separated)',
      namePlaceholder: 'Q1 2025 Full Scope Assessment',
      assetTagPlaceholder: 'production, internet-facing',
      cancel: 'Cancel',
      starting: 'Starting…',
      startAssessment: 'Start Assessment',
      createdToast: 'Assessment created and started',
    },
    gauge: {
      title: 'Exposure Score',
      pts: (value) => `${value} pts`,
    },
    detail: {
      loadError: 'Failed to load assessment',
      started: (when) => `Started ${when}`,
      exporting: 'Exporting...',
      export: 'Export',
      exportPdf: 'Export as PDF',
      exportDocx: 'Export as DOCX',
      cancel: 'Cancel',
      delete: 'Delete',
      statCritical: 'Critical',
      statHigh: 'High',
      statMedium: 'Medium',
      statLow: 'Low',
      statTotal: 'Total',
      progressTitle: 'Assessment Progress',
      findingsTitle: 'Findings',
      reportExportStarted: (format) => `Report export started (${format})`,
      exportFailed: 'Failed to export report',
      cancelledToast: 'Assessment cancelled',
      cancelFailed: 'Failed to cancel assessment',
      deletedToast: 'Assessment deleted',
      deleteFailed: 'Failed to delete assessment',
      cancelDialogTitle: 'Cancel Assessment',
      cancelDialogDescription: 'Are you sure you want to cancel this running assessment? This action cannot be undone.',
      cancelDialogConfirm: 'Cancel Assessment',
      deleteDialogTitle: 'Delete Assessment',
      deleteDialogDescription: 'Are you sure you want to delete this assessment? All findings and data will be permanently removed.',
      deleteDialogConfirm: 'Delete',
    },
    status: {
      created: 'Created',
      scoping: 'Scoping',
      discovery: 'Discovery',
      prioritizing: 'Prioritizing',
      validating: 'Validating',
      mobilizing: 'Mobilizing',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    phases: {
      scoping: { label: 'Scoping', description: 'Define assessment boundaries' },
      discovery: { label: 'Discovery', description: 'Enumerate assets and vulnerabilities' },
      prioritization: { label: 'Prioritization', description: 'Rank findings by business risk' },
      validation: { label: 'Validation', description: 'Verify exploitability and impact' },
      mobilization: { label: 'Mobilization', description: 'Generate remediation guidance' },
    },
    findingTable: {
      empty: 'No findings in this assessment.',
      colSeverity: 'Severity',
      colFinding: 'Finding',
      colAssets: 'Assets',
      colStatus: 'Status',
      colPriority: 'Priority',
      highExploitability: 'High exploitability',
      assetsCount: (count) => `${count} asset${count > 1 ? 's' : ''}`,
    },
    findingStatus: {
      open: 'Open',
      in_remediation: 'In Remediation',
      remediated: 'Remediated',
      accepted_risk: 'Accepted Risk',
      false_positive: 'False Positive',
      deferred: 'Deferred',
    },
    findingPanel: {
      highExploitRisk: 'High Exploit Risk',
      exploitability: 'Exploitability',
      impact: 'Impact',
      priorityScore: 'Priority Score',
      affectedAssets: 'Affected Assets',
      otherAssets: (count) => `+${count} other asset${count > 1 ? 's' : ''}`,
      assetsAffected: (count) => `${count} asset${count > 1 ? 's' : ''} affected`,
      cves: 'CVEs',
      attackPath: 'Attack Path',
      remediation: 'Remediation',
      effortSuffix: (effort) => `${effort} effort`,
      daysSuffix: (days) => `~${days}d`,
      status: 'Status',
      update: 'Update',
    },
    findingStatusDialog: {
      title: 'Update Finding Status',
      statusLabel: 'Status',
      selectStatus: 'Select status',
      notesLabel: 'Notes (optional)',
      notesPlaceholder: 'Reason for status change...',
      cancel: 'Cancel',
      updating: 'Updating...',
      updateStatus: 'Update Status',
      updatedToast: 'Finding status updated',
      failedToast: 'Failed to update finding status',
    },
    remediationGroups: {
      title: 'Remediation Groups',
      empty: 'No remediation groups available. Groups are generated during the mobilization phase.',
      findingsCount: (count) => `${count} finding${count !== 1 ? 's' : ''}`,
      assetsCount: (count) => `${count} asset${count !== 1 ? 's' : ''}`,
      type: 'Type',
      effort: 'Effort',
      priorityGroup: 'Priority Group',
      maxPriority: 'Max Priority',
      estimated: (days) => `Estimated: ~${days} day${days !== 1 ? 's' : ''}`,
      scoreReduction: 'Score reduction: ',
      execute: 'Execute',
      statusUpdatedToast: 'Group status updated',
      statusUpdateFailed: 'Failed to update group status',
      executeStartedToast: 'Remediation group execution started',
      executeFailed: 'Failed to execute remediation group',
      groupStatus: {
        planned: 'Planned',
        in_progress: 'In Progress',
        completed: 'Completed',
        deferred: 'Deferred',
        accepted: 'Accepted',
      },
    },
    comparison: {
      title: 'Compare with Previous Assessment',
      selectPlaceholder: 'Select an assessment to compare',
      newFindings: 'New Findings',
      resolved: 'Resolved',
      unchanged: 'Unchanged',
      worsened: 'Worsened',
      current: 'Current',
      previous: 'Previous',
      exposureScore: 'Exposure Score',
      newFindingsTitle: 'New Findings',
      resolvedFindingsTitle: 'Resolved Findings',
      noOther: 'No other completed assessments available for comparison.',
    },
    report: {
      notCompleted: 'Report available once assessment is completed',
      reportLabel: 'Assessment Report',
      executiveSummary: 'Executive Summary',
      exposureScore: 'Exposure Score',
      outOf: '/ 100',
      colSeverity: 'Severity',
      colCount: 'Count',
      total: 'Total',
      findingsBySeverity: 'Findings by Severity',
      colFinding: 'Finding',
      colStatus: 'Status',
      colPriority: 'Priority',
      statusLabel: {
        open: 'Open',
        in_remediation: 'In Remediation',
        remediated: 'Remediated',
        accepted_risk: 'Accepted Risk',
        false_positive: 'False Positive',
        deferred: 'Deferred',
      },
    },
    attackPath: {
      empty: 'No attack path data available',
      assetsSuffix: (count) => `— ${count} asset${count > 1 ? 's' : ''}`,
    },
  },
  ar: {
    list: {
      title: 'تقييمات CTEM',
      description: 'الإدارة المستمرة للتعرّض للتهديدات — قياس سطح الهجوم وتقليصه',
      newAssessment: 'تقييم جديد',
      statExposureScore: 'درجة التعرّض',
      statAssessments: 'التقييمات',
      statCriticalExposures: 'التعرّضات الحرجة',
      loadError: 'تعذّر تحميل التقييمات',
      emptyTitle: 'لا توجد تقييمات',
      emptyDescription: 'أطلق أول تقييم CTEM لقياس تعرّضك للتهديدات.',
    },
    dashboard: {
      title: 'لوحة تحكم CTEM',
      description: 'الإدارة المستمرة للتعرّض للتهديدات — تتبّع درجة تعرّض مؤسستك وتقدّم المعالجة.',
      viewAssessments: 'عرض التقييمات',
      kpiExposureScore: 'درجة التعرّض',
      kpiGrade: (grade) => `التقدير: ${grade}`,
      kpiTrend: 'الاتجاه',
      kpiTrendPts: (delta) => `${delta} نقطة`,
      kpiLastCalculated: 'آخر احتساب',
      trendChartTitle: 'اتجاه درجة التعرّض (٩٠ يومًا)',
      trendSeriesLabel: 'درجة التعرّض',
      runNewTitle: 'تشغيل تقييم جديد',
      runNewBody: 'ابدأ تقييم CTEM جديدًا لاكتشاف التعرّضات وترتيب المخاطر وإنشاء خطط المعالجة.',
      goToAssessments: 'الانتقال إلى التقييمات',
      methodologyTitle: 'منهجية درجة التعرّض',
      methodologyBody: 'الدرجة = ٣٥٪ ثغرات + ٢٥٪ سطح هجوم + ٢٥٪ نشاط تهديدي + ١٥٪ سرعة. مُقدَّرة من A (≤٢٠) إلى F (>٨٠).',
    },
    card: {
      criticalSuffix: (count) => `${count} حرج`,
      highSuffix: (count) => `${count} عالٍ`,
      totalFindings: (count) => `${count} نتيجة إجمالًا`,
      exposureScore: 'درجة التعرّض: ',
    },
    create: {
      title: 'تقييم CTEM جديد',
      description: 'أطلق تقييمًا للإدارة المستمرة للتعرّض للتهديدات عبر سجل أصولك.',
      name: 'اسم التقييم',
      nameRequired: 'الاسم مطلوب',
      descriptionLabel: 'الوصف',
      descriptionPlaceholder: 'النطاق أو الأهداف أو الملاحظات…',
      assetTagFilter: 'تصفية وسوم الأصول (مفصولة بفواصل)',
      namePlaceholder: 'تقييم النطاق الكامل للربع الأول ٢٠٢٥',
      assetTagPlaceholder: 'production، internet-facing',
      cancel: 'إلغاء',
      starting: 'جارٍ البدء…',
      startAssessment: 'بدء التقييم',
      createdToast: 'تم إنشاء التقييم وبدؤه',
    },
    gauge: {
      title: 'درجة التعرّض',
      pts: (value) => `${value} نقطة`,
    },
    detail: {
      loadError: 'تعذّر تحميل التقييم',
      started: (when) => `بدأ ${when}`,
      exporting: 'جارٍ التصدير...',
      export: 'تصدير',
      exportPdf: 'تصدير كـ PDF',
      exportDocx: 'تصدير كـ DOCX',
      cancel: 'إلغاء',
      delete: 'حذف',
      statCritical: 'حرج',
      statHigh: 'عالٍ',
      statMedium: 'متوسط',
      statLow: 'منخفض',
      statTotal: 'الإجمالي',
      progressTitle: 'تقدّم التقييم',
      findingsTitle: 'النتائج',
      reportExportStarted: (format) => `بدأ تصدير التقرير (${format})`,
      exportFailed: 'تعذّر تصدير التقرير',
      cancelledToast: 'تم إلغاء التقييم',
      cancelFailed: 'تعذّر إلغاء التقييم',
      deletedToast: 'تم حذف التقييم',
      deleteFailed: 'تعذّر حذف التقييم',
      cancelDialogTitle: 'إلغاء التقييم',
      cancelDialogDescription: 'هل أنت متأكد من إلغاء هذا التقييم الجاري؟ لا يمكن التراجع عن هذا الإجراء.',
      cancelDialogConfirm: 'إلغاء التقييم',
      deleteDialogTitle: 'حذف التقييم',
      deleteDialogDescription: 'هل أنت متأكد من حذف هذا التقييم؟ ستُزال جميع النتائج والبيانات نهائيًا.',
      deleteDialogConfirm: 'حذف',
    },
    status: {
      created: 'تم الإنشاء',
      scoping: 'تحديد النطاق',
      discovery: 'الاكتشاف',
      prioritizing: 'ترتيب الأولويات',
      validating: 'التحقق',
      mobilizing: 'التعبئة',
      completed: 'مكتمل',
      failed: 'فشل',
      cancelled: 'ملغى',
    },
    phases: {
      scoping: { label: 'تحديد النطاق', description: 'تحديد حدود التقييم' },
      discovery: { label: 'الاكتشاف', description: 'تعداد الأصول والثغرات' },
      prioritization: { label: 'ترتيب الأولويات', description: 'ترتيب النتائج حسب مخاطر الأعمال' },
      validation: { label: 'التحقق', description: 'التحقق من قابلية الاستغلال والأثر' },
      mobilization: { label: 'التعبئة', description: 'توليد إرشادات المعالجة' },
    },
    findingTable: {
      empty: 'لا توجد نتائج في هذا التقييم.',
      colSeverity: 'الخطورة',
      colFinding: 'النتيجة',
      colAssets: 'الأصول',
      colStatus: 'الحالة',
      colPriority: 'الأولوية',
      highExploitability: 'قابلية استغلال عالية',
      assetsCount: (count) => `${count} أصل`,
    },
    findingStatus: {
      open: 'مفتوح',
      in_remediation: 'قيد المعالجة',
      remediated: 'تمت المعالجة',
      accepted_risk: 'مخاطرة مقبولة',
      false_positive: 'إنذار كاذب',
      deferred: 'مؤجَّل',
    },
    findingPanel: {
      highExploitRisk: 'مخاطرة استغلال عالية',
      exploitability: 'قابلية الاستغلال',
      impact: 'الأثر',
      priorityScore: 'درجة الأولوية',
      affectedAssets: 'الأصول المتأثرة',
      otherAssets: (count) => `+${count} أصل آخر`,
      assetsAffected: (count) => `${count} أصل متأثر`,
      cves: 'CVEs',
      attackPath: 'مسار الهجوم',
      remediation: 'المعالجة',
      effortSuffix: (effort) => `جهد ${effort}`,
      daysSuffix: (days) => `~${days} يوم`,
      status: 'الحالة',
      update: 'تحديث',
    },
    findingStatusDialog: {
      title: 'تحديث حالة النتيجة',
      statusLabel: 'الحالة',
      selectStatus: 'اختر الحالة',
      notesLabel: 'ملاحظات (اختياري)',
      notesPlaceholder: 'سبب تغيير الحالة...',
      cancel: 'إلغاء',
      updating: 'جارٍ التحديث...',
      updateStatus: 'تحديث الحالة',
      updatedToast: 'تم تحديث حالة النتيجة',
      failedToast: 'تعذّر تحديث حالة النتيجة',
    },
    remediationGroups: {
      title: 'مجموعات المعالجة',
      empty: 'لا توجد مجموعات معالجة متاحة. تُولَّد المجموعات أثناء مرحلة التعبئة.',
      findingsCount: (count) => `${count} نتيجة`,
      assetsCount: (count) => `${count} أصل`,
      type: 'النوع',
      effort: 'الجهد',
      priorityGroup: 'مجموعة الأولوية',
      maxPriority: 'أقصى أولوية',
      estimated: (days) => `التقدير: ~${days} يوم`,
      scoreReduction: 'خفض الدرجة: ',
      execute: 'تنفيذ',
      statusUpdatedToast: 'تم تحديث حالة المجموعة',
      statusUpdateFailed: 'تعذّر تحديث حالة المجموعة',
      executeStartedToast: 'بدأ تنفيذ مجموعة المعالجة',
      executeFailed: 'تعذّر تنفيذ مجموعة المعالجة',
      groupStatus: {
        planned: 'مخطَّط',
        in_progress: 'قيد التنفيذ',
        completed: 'مكتمل',
        deferred: 'مؤجَّل',
        accepted: 'مقبول',
      },
    },
    comparison: {
      title: 'المقارنة مع التقييم السابق',
      selectPlaceholder: 'اختر تقييمًا للمقارنة',
      newFindings: 'نتائج جديدة',
      resolved: 'تمت معالجتها',
      unchanged: 'دون تغيير',
      worsened: 'تفاقمت',
      current: 'الحالي',
      previous: 'السابق',
      exposureScore: 'درجة التعرّض',
      newFindingsTitle: 'النتائج الجديدة',
      resolvedFindingsTitle: 'النتائج المُعالَجة',
      noOther: 'لا توجد تقييمات مكتملة أخرى متاحة للمقارنة.',
    },
    report: {
      notCompleted: 'يتوفر التقرير بمجرد اكتمال التقييم',
      reportLabel: 'تقرير التقييم',
      executiveSummary: 'الملخص التنفيذي',
      exposureScore: 'درجة التعرّض',
      outOf: '/ ١٠٠',
      colSeverity: 'الخطورة',
      colCount: 'العدد',
      total: 'الإجمالي',
      findingsBySeverity: 'النتائج حسب الخطورة',
      colFinding: 'النتيجة',
      colStatus: 'الحالة',
      colPriority: 'الأولوية',
      statusLabel: {
        open: 'مفتوح',
        in_remediation: 'قيد المعالجة',
        remediated: 'تمت المعالجة',
        accepted_risk: 'مخاطرة مقبولة',
        false_positive: 'إنذار كاذب',
        deferred: 'مؤجَّل',
      },
    },
    attackPath: {
      empty: 'لا تتوفر بيانات مسار الهجوم',
      assetsSuffix: (count) => `— ${count} أصل`,
    },
  },
};

export function useCtemLabels(): CtemLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(ctemLabels, locale), [locale]);
}

registerMessages('cyberCtem', ctemLabels);
