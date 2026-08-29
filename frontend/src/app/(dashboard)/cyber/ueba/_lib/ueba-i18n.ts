/**
 * Bilingual (English + Modern Standard Arabic) labels for the UEBA console
 * (`/cyber/ueba`). Follows the `{ en, ar }` bundle + hook pattern of
 * `../../_lib/cyber-i18n`.
 *
 * Acronyms / product names stay as-is across both locales: UEBA, IP.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { registerMessages } from '@/lib/i18n/registry';
import {
  type CyberBilingual,
  resolveCyberBilingual,
} from '../../_lib/cyber-i18n';

// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).

export interface UebaLabels {
  // dashboard page
  title: string;
  descriptionLoading: string;
  description: string;
  loadError: string;
  alertsButton: string;
  heroTitle: string;
  heroBody: string;
  kpiActiveProfiles: string;
  kpiHighRiskEntities: string;
  kpiAlerts7d: string;
  kpiAvgRiskScore: string;
  cardRiskRanking: string;
  cardAlertTypeDistribution: string;
  cardAlertTrend: string;
  cardProfileRanking: string;
  // risk ranking chart
  rankingEntityMeta: (entityType: string, alertCount: number) => string;
  rankingEmpty: string;
  // alert type distribution
  distributionEmpty: string;
  // alert trend chart
  trendEmpty: string;
  // profile table
  colEntity: string;
  colRisk: string;
  colMaturity: string;
  colAlerts: string;
  colLastSeen: string;
  profileTableEmpty: string;
  // alerts list page
  alertsTitle: string;
  alertsDescriptionLoading: string;
  alertsDescription: string;
  alertsLoadError: string;
  selectAllAria: string;
  selectAll: string;
  filterByStatus: string;
  allStatuses: string;
  alertsCount: (count: number) => string;
  selectAlertAria: (title: string) => string;
  confidenceBadge: (percent: string) => string;
  riskImpact: string;
  triggeredBy: (signals: number, events: number) => string;
  alertsEmpty: string;
  alertsEmptyWithStatus: (status: string) => string;
  previous: string;
  next: string;
  pageOf: (page: number, totalPages: number) => string;
  // alert actions
  actionsButton: string;
  markFalsePositive: string;
  falsePositiveDialogTitle: string;
  falsePositiveDialogDescription: string;
  falsePositivePlaceholder: string;
  cancel: string;
  processing: string;
  confirmFalsePositive: string;
  statusUpdatedToast: (status: string) => string;
  statusUpdateFailed: string;
  falsePositiveToast: string;
  falsePositiveFailed: string;
  // bulk actions
  selectedCount: (count: number) => string;
  bulkActions: string;
  updating: string;
  bulkAcknowledge: string;
  bulkInvestigate: string;
  bulkResolve: string;
  bulkFalsePositiveDialogTitle: string;
  bulkFalsePositiveDialogDescription: (count: number) => string;
  confirmCount: (count: number) => string;
  bulkUpdatedToast: (count: number) => string;
  bulkPartialToast: (updated: number, failed: number) => string;
  bulkUpdateFailed: string;
  bulkFalsePositiveToast: (count: number) => string;
  bulkFalsePositivePartialToast: (updated: number, failed: number) => string;
  bulkFalsePositiveFailed: string;
  bulkScheduled: (count: number, label: string) => string;
  bulkUndoHint: string;
  // profile actions
  changeStatus: string;
  changeStatusDialogTitle: string;
  changeStatusSuppressed: string;
  changeStatusWhitelisted: string;
  changeStatusInactive: string;
  changeStatusActive: string;
  reasonPlaceholder: string;
  setStatus: (status: string) => string;
  profileStatusUpdatedToast: (status: string) => string;
  profileStatusUpdateFailed: string;
  // signal evidence viewer
  expected: string;
  actual: string;
  confidence: string;
  eventId: string;
  evidenceEmpty: string;
  // profile detail page
  profileBaselineSubtitle: (entityType: string) => string;
  riskBadge: (score: string, level: string) => string;
  profileLoadError: string;
  tabActivity: string;
  tabAlerts: string;
  tabBaseline: string;
  tabRisk: string;
  cardAccessHeatmap: string;
  cardRecentSourceIps: string;
  cardVolumeTimeline: string;
  cardRecentTableAccess: string;
  entityAlertsEmpty: string;
  baselineAccessTime: string;
  baselineVolume: string;
  baselineAccessPattern: string;
  baselineFailureRate: string;
  cardRiskScoreHistory: string;
  // activity heatmap
  dayMon: string;
  dayTue: string;
  dayWed: string;
  dayThu: string;
  dayFri: string;
  daySat: string;
  daySun: string;
  heatmapCellTooltip: (day: string, hour: number, value: number) => string;
  // volume timeline
  expectedDailyMean: (bytes: string, rows: string) => string;
  volumeEmpty: string;
  // table access list
  tableKnown: string;
  tableNew: string;
  tableAccessEmpty: string;
  // source ip list
  ipKnown: string;
  ipUnknown: string;
  sourceIpEmpty: string;
  // baseline comparison card
  comparisonExpected: string;
  comparisonActual: string;
  // risk score history
  riskHistoryEmpty: string;
  // entity-type and status display maps
  statusActive: string;
  statusInactive: string;
  statusSuppressed: string;
  statusWhitelisted: string;
  statusNew: string;
  statusAcknowledged: string;
  statusInvestigating: string;
  statusResolved: string;
  statusFalsePositive: string;
  // config page
  config: {
    eyebrow: string;
    title: string;
    description: string;
    save: string;
    updatedToast: string;
    runtimeCadenceTitle: string;
    runtimeCadenceDescription: string;
    fields: {
      cycle_interval: string;
      max_processing_time: string;
      min_maturity_for_alert: string;
      correlation_window: string;
      max_events_per_cycle: string;
      batch_size: string;
      ema_alpha: string;
      risk_decay_rate_per_day: string;
      unusual_time_mature_high_prob: string;
      unusual_time_mature_medium_prob: string;
      unusual_time_base_high_prob: string;
      unusual_time_base_medium_prob: string;
      unusual_volume_medium_z: string;
      unusual_volume_high_z: string;
      unusual_volume_critical_z: string;
      unusual_volume_stddev_min: string;
      failure_spike_medium_z: string;
      failure_spike_high_z: string;
      failure_spike_critical_z: string;
      failure_stddev_min: string;
      failure_critical_count: string;
      bulk_rows_medium_multiplier: string;
      bulk_rows_high_multiplier: string;
      ddl_unusual_threshold: string;
    };
    groups: {
      processing: { title: string; description: string };
      unusualTime: { title: string; description: string };
      volumeFailures: { title: string; description: string };
      bulkDdl: { title: string; description: string };
    };
  };
}

export const uebaLabels: CyberBilingual<UebaLabels> = {
  en: {
    title: 'UEBA',
    descriptionLoading: 'Behavioral analytics for users, services, and applications.',
    description: 'Persistent baseline learning, anomaly correlation, and risk-ranked entity exposure.',
    loadError: 'Failed to load the UEBA dashboard.',
    alertsButton: 'Alerts',
    heroTitle: 'Precision-first behavioral detection',
    heroBody:
      'Learning profiles do not alert until they have enough evidence. Mature entities are ranked by decayed risk, not permanent historical stigma.',
    kpiActiveProfiles: 'Active Profiles',
    kpiHighRiskEntities: 'High Risk Entities',
    kpiAlerts7d: 'Alerts (7d)',
    kpiAvgRiskScore: 'Avg Risk Score',
    cardRiskRanking: 'Risk Ranking',
    cardAlertTypeDistribution: 'Alert Type Distribution',
    cardAlertTrend: 'Alert Trend',
    cardProfileRanking: 'Profile Ranking',
    rankingEntityMeta: (entityType, alertCount) => `${entityType} · ${alertCount} alerts in 7d`,
    rankingEmpty: 'No ranked entities yet.',
    distributionEmpty: 'No alert distribution data yet.',
    trendEmpty: 'No trend data yet.',
    colEntity: 'Entity',
    colRisk: 'Risk',
    colMaturity: 'Maturity',
    colAlerts: 'Alerts',
    colLastSeen: 'Last Seen',
    profileTableEmpty: 'No UEBA profiles available.',
    alertsTitle: 'UEBA Alerts',
    alertsDescriptionLoading: 'Correlated behavioral findings with event-level evidence.',
    alertsDescription: 'Multi-signal behavioral alerts linked back to their raw triggering events.',
    alertsLoadError: 'Failed to load UEBA alerts.',
    selectAllAria: 'Select all alerts',
    selectAll: 'Select all',
    filterByStatus: 'Filter by status',
    allStatuses: 'All Statuses',
    alertsCount: (count) => `${count} alert${count !== 1 ? 's' : ''}`,
    selectAlertAria: (title) => `Select alert ${title}`,
    confidenceBadge: (percent) => `${percent}% confidence`,
    riskImpact: 'Risk Impact',
    triggeredBy: (signals, events) =>
      `Triggered by ${signals} signals across ${events} events.`,
    alertsEmpty: 'No UEBA alerts.',
    alertsEmptyWithStatus: (status) => `No UEBA alerts with status "${status}".`,
    previous: 'Previous',
    next: 'Next',
    pageOf: (page, totalPages) => `Page ${page} of ${totalPages}`,
    actionsButton: 'Actions',
    markFalsePositive: 'Mark as False Positive',
    falsePositiveDialogTitle: 'Mark as False Positive',
    falsePositiveDialogDescription:
      "This will mark the alert as a false positive and retrain the entity's behavioral baseline to prevent similar alerts in the future.",
    falsePositivePlaceholder: 'Reason for marking as false positive (optional)',
    cancel: 'Cancel',
    processing: 'Processing...',
    confirmFalsePositive: 'Confirm False Positive',
    statusUpdatedToast: (status) => `Alert status updated to ${status}`,
    statusUpdateFailed: 'Failed to update alert status',
    falsePositiveToast: 'Alert marked as false positive and profile baseline retrained',
    falsePositiveFailed: 'Failed to mark alert as false positive',
    selectedCount: (count) => `${count} selected`,
    bulkActions: 'Bulk Actions',
    updating: 'Updating...',
    bulkAcknowledge: 'Acknowledge',
    bulkInvestigate: 'Investigate',
    bulkResolve: 'Resolve',
    bulkFalsePositiveDialogTitle: 'Bulk Mark as False Positive',
    bulkFalsePositiveDialogDescription: (count) =>
      `This will mark ${count} alert${count !== 1 ? 's' : ''} as false positive and retrain affected entity baselines.`,
    confirmCount: (count) => `Confirm (${count})`,
    bulkUpdatedToast: (count) => `${count} alert${count !== 1 ? 's' : ''} updated`,
    bulkPartialToast: (updated, failed) => `${updated} updated, ${failed} failed`,
    bulkUpdateFailed: 'Bulk update failed',
    bulkFalsePositiveToast: (count) =>
      `${count} alert${count !== 1 ? 's' : ''} marked as false positive`,
    bulkFalsePositivePartialToast: (updated, failed) =>
      `${updated} marked false positive, ${failed} failed`,
    bulkFalsePositiveFailed: 'Bulk false positive failed',
    bulkScheduled: (count, label) =>
      `“${label}” will apply to ${count} alert${count === 1 ? '' : 's'}.`,
    bulkUndoHint: 'You can undo before it runs.',
    changeStatus: 'Change Status',
    changeStatusDialogTitle: 'Change Profile Status',
    changeStatusSuppressed:
      'Suppressing this profile will stop alerting for 30 days. The profile will continue learning in the background.',
    changeStatusWhitelisted:
      'Whitelisting this profile will permanently suppress all alerts for this entity until reactivated.',
    changeStatusInactive:
      'Marking inactive stops detection for this entity. Reactivate to resume monitoring.',
    changeStatusActive: 'Reactivating will resume normal detection and alerting for this entity.',
    reasonPlaceholder: 'Reason for status change (optional)',
    setStatus: (status) => `Set ${status}`,
    profileStatusUpdatedToast: (status) => `Profile status updated to ${status}`,
    profileStatusUpdateFailed: 'Failed to update profile status',
    expected: 'Expected',
    actual: 'Actual',
    confidence: 'Confidence',
    eventId: 'Event ID',
    evidenceEmpty: 'No structured evidence attached.',
    profileBaselineSubtitle: (entityType) => `${entityType} behavioral baseline`,
    riskBadge: (score, level) => `Risk ${score} · ${level}`,
    profileLoadError: 'Failed to load the UEBA profile.',
    tabActivity: 'Activity',
    tabAlerts: 'Alerts',
    tabBaseline: 'Baseline',
    tabRisk: 'Risk History',
    cardAccessHeatmap: 'Access Heatmap',
    cardRecentSourceIps: 'Recent Source IPs',
    cardVolumeTimeline: 'Volume Timeline',
    cardRecentTableAccess: 'Recent Table Access',
    entityAlertsEmpty: 'No entity alerts found.',
    baselineAccessTime: 'Access Time Comparison',
    baselineVolume: 'Volume Comparison',
    baselineAccessPattern: 'Access Pattern Comparison',
    baselineFailureRate: 'Failure Rate Comparison',
    cardRiskScoreHistory: 'Risk Score History',
    dayMon: 'Mon',
    dayTue: 'Tue',
    dayWed: 'Wed',
    dayThu: 'Thu',
    dayFri: 'Fri',
    daySat: 'Sat',
    daySun: 'Sun',
    heatmapCellTooltip: (day, hour, value) => `${day} ${hour}:00 — ${value} events`,
    expectedDailyMean: (bytes, rows) => `Expected daily mean: ${bytes} bytes · ${rows} rows`,
    volumeEmpty: 'No volume history available.',
    tableKnown: 'known',
    tableNew: 'new',
    tableAccessEmpty: 'No recent table access found.',
    ipKnown: 'known',
    ipUnknown: 'unknown',
    sourceIpEmpty: 'No recent source IP data found.',
    comparisonExpected: 'Expected',
    comparisonActual: 'Actual',
    riskHistoryEmpty: 'Risk history is not available yet.',
    statusActive: 'Active',
    statusInactive: 'Inactive',
    statusSuppressed: 'Suppressed',
    statusWhitelisted: 'Whitelisted',
    statusNew: 'New',
    statusAcknowledged: 'Acknowledged',
    statusInvestigating: 'Investigating',
    statusResolved: 'Resolved',
    statusFalsePositive: 'False Positive',
    config: {
      eyebrow: 'Cyber analytics',
      title: 'UEBA Configuration',
      description: 'Tune behavioral baselines, anomaly thresholds, correlation windows, and processing limits.',
      save: 'Save configuration',
      updatedToast: 'UEBA configuration updated',
      runtimeCadenceTitle: 'Runtime Cadence',
      runtimeCadenceDescription: 'Durations use the Go-style values accepted by the backend, such as 5m, 30s, or 1h.',
      fields: {
        cycle_interval: 'Cycle interval',
        max_processing_time: 'Max processing time',
        min_maturity_for_alert: 'Minimum maturity for alert',
        correlation_window: 'Correlation window',
        max_events_per_cycle: 'Max events per cycle',
        batch_size: 'Batch size',
        ema_alpha: 'EMA alpha',
        risk_decay_rate_per_day: 'Risk decay per day',
        unusual_time_mature_high_prob: 'Mature high probability',
        unusual_time_mature_medium_prob: 'Mature medium probability',
        unusual_time_base_high_prob: 'Base high probability',
        unusual_time_base_medium_prob: 'Base medium probability',
        unusual_volume_medium_z: 'Volume medium Z',
        unusual_volume_high_z: 'Volume high Z',
        unusual_volume_critical_z: 'Volume critical Z',
        unusual_volume_stddev_min: 'Volume stddev min',
        failure_spike_medium_z: 'Failure medium Z',
        failure_spike_high_z: 'Failure high Z',
        failure_spike_critical_z: 'Failure critical Z',
        failure_stddev_min: 'Failure stddev min',
        failure_critical_count: 'Failure critical count',
        bulk_rows_medium_multiplier: 'Bulk rows medium multiplier',
        bulk_rows_high_multiplier: 'Bulk rows high multiplier',
        ddl_unusual_threshold: 'DDL unusual threshold',
      },
      groups: {
        processing: {
          title: 'Processing',
          description: 'Batch sizes, event caps, smoothing, and decay controls.',
        },
        unusualTime: {
          title: 'Unusual Time',
          description: 'Probability thresholds for time-of-day anomaly severity.',
        },
        volumeFailures: {
          title: 'Volume & Failures',
          description: 'Z-score and minimum variance thresholds for event volume and failures.',
        },
        bulkDdl: {
          title: 'Bulk Data & DDL',
          description: 'Multipliers for row access and schema-change anomaly detection.',
        },
      },
    },
  },
  ar: {
    title: 'تحليلات سلوك المستخدمين والكيانات (UEBA)',
    descriptionLoading: 'تحليلات سلوكية للمستخدمين والخدمات والتطبيقات.',
    description: 'تعلّم خط أساس مستمر، وربط الحالات الشاذة، وترتيب تعرّض الكيانات حسب المخاطر.',
    loadError: 'تعذّر تحميل لوحة UEBA.',
    alertsButton: 'التنبيهات',
    heroTitle: 'كشف سلوكي يضع الدقة أولًا',
    heroBody:
      'لا تُصدِر ملفات التعلّم تنبيهات حتى تتوفّر لديها أدلة كافية. تُرتَّب الكيانات الناضجة حسب المخاطر المتناقصة، لا حسب وصمة تاريخية دائمة.',
    kpiActiveProfiles: 'الملفات النشطة',
    kpiHighRiskEntities: 'الكيانات عالية المخاطر',
    kpiAlerts7d: 'التنبيهات (٧ أيام)',
    kpiAvgRiskScore: 'متوسط درجة المخاطر',
    cardRiskRanking: 'ترتيب المخاطر',
    cardAlertTypeDistribution: 'توزيع أنواع التنبيهات',
    cardAlertTrend: 'اتجاه التنبيهات',
    cardProfileRanking: 'ترتيب الملفات',
    rankingEntityMeta: (entityType, alertCount) => `${entityType} · ${alertCount} تنبيه خلال ٧ أيام`,
    rankingEmpty: 'لا توجد كيانات مُرتَّبة حتى الآن.',
    distributionEmpty: 'لا توجد بيانات عن توزيع التنبيهات حتى الآن.',
    trendEmpty: 'لا توجد بيانات عن الاتجاه حتى الآن.',
    colEntity: 'الكيان',
    colRisk: 'المخاطر',
    colMaturity: 'النضج',
    colAlerts: 'التنبيهات',
    colLastSeen: 'آخر ظهور',
    profileTableEmpty: 'لا تتوفّر ملفات UEBA.',
    alertsTitle: 'تنبيهات UEBA',
    alertsDescriptionLoading: 'نتائج سلوكية مترابطة مع أدلة على مستوى الأحداث.',
    alertsDescription: 'تنبيهات سلوكية متعددة الإشارات مرتبطة بأحداثها الخام المُحفِّزة.',
    alertsLoadError: 'تعذّر تحميل تنبيهات UEBA.',
    selectAllAria: 'تحديد كل التنبيهات',
    selectAll: 'تحديد الكل',
    filterByStatus: 'التصفية حسب الحالة',
    allStatuses: 'كل الحالات',
    alertsCount: (count) => `${count} تنبيه`,
    selectAlertAria: (title) => `تحديد التنبيه ${title}`,
    confidenceBadge: (percent) => `ثقة ${percent}%`,
    riskImpact: 'أثر المخاطر',
    triggeredBy: (signals, events) => `مُحفَّز بـ ${signals} إشارة عبر ${events} حدثًا.`,
    alertsEmpty: 'لا توجد تنبيهات UEBA.',
    alertsEmptyWithStatus: (status) => `لا توجد تنبيهات UEBA بالحالة "${status}".`,
    previous: 'السابق',
    next: 'التالي',
    pageOf: (page, totalPages) => `الصفحة ${page} من ${totalPages}`,
    actionsButton: 'إجراءات',
    markFalsePositive: 'تعليم كإنذار كاذب',
    falsePositiveDialogTitle: 'تعليم كإنذار كاذب',
    falsePositiveDialogDescription:
      'سيؤدي هذا إلى تعليم التنبيه كإنذار كاذب وإعادة تدريب خط الأساس السلوكي للكيان لمنع تنبيهات مماثلة مستقبلًا.',
    falsePositivePlaceholder: 'سبب التعليم كإنذار كاذب (اختياري)',
    cancel: 'إلغاء',
    processing: 'جارٍ المعالجة...',
    confirmFalsePositive: 'تأكيد الإنذار الكاذب',
    statusUpdatedToast: (status) => `تم تحديث حالة التنبيه إلى ${status}`,
    statusUpdateFailed: 'تعذّر تحديث حالة التنبيه',
    falsePositiveToast: 'تم تعليم التنبيه كإنذار كاذب وإعادة تدريب خط أساس الملف',
    falsePositiveFailed: 'تعذّر تعليم التنبيه كإنذار كاذب',
    selectedCount: (count) => `${count} مُحدَّد`,
    bulkActions: 'إجراءات جماعية',
    updating: 'جارٍ التحديث...',
    bulkAcknowledge: 'إقرار',
    bulkInvestigate: 'تحقيق',
    bulkResolve: 'حل',
    bulkFalsePositiveDialogTitle: 'تعليم جماعي كإنذار كاذب',
    bulkFalsePositiveDialogDescription: (count) =>
      `سيؤدي هذا إلى تعليم ${count} تنبيه كإنذار كاذب وإعادة تدريب خطوط أساس الكيانات المتأثرة.`,
    confirmCount: (count) => `تأكيد (${count})`,
    bulkUpdatedToast: (count) => `تم تحديث ${count} تنبيه`,
    bulkPartialToast: (updated, failed) => `تم تحديث ${updated}، وفشل ${failed}`,
    bulkUpdateFailed: 'فشل التحديث الجماعي',
    bulkFalsePositiveToast: (count) => `تم تعليم ${count} تنبيه كإنذار كاذب`,
    bulkFalsePositivePartialToast: (updated, failed) =>
      `تم تعليم ${updated} كإنذار كاذب، وفشل ${failed}`,
    bulkFalsePositiveFailed: 'فشل تعليم الإنذار الكاذب الجماعي',
    bulkScheduled: (count, label) => `سيُطبَّق «${label}» على ${count} تنبيه.`,
    bulkUndoHint: 'يمكنك التراجع قبل التنفيذ.',
    changeStatus: 'تغيير الحالة',
    changeStatusDialogTitle: 'تغيير حالة الملف',
    changeStatusSuppressed:
      'سيؤدي كبح هذا الملف إلى إيقاف التنبيهات لمدة ٣٠ يومًا. وسيستمر الملف في التعلّم في الخلفية.',
    changeStatusWhitelisted:
      'سيؤدي إدراج هذا الملف في القائمة البيضاء إلى كبح جميع التنبيهات لهذا الكيان نهائيًا حتى إعادة تفعيله.',
    changeStatusInactive:
      'يؤدي تعليمه كغير نشط إلى إيقاف الكشف لهذا الكيان. أعد تفعيله لاستئناف المراقبة.',
    changeStatusActive: 'ستؤدي إعادة التفعيل إلى استئناف الكشف والتنبيه الطبيعي لهذا الكيان.',
    reasonPlaceholder: 'سبب تغيير الحالة (اختياري)',
    setStatus: (status) => `تعيين ${status}`,
    profileStatusUpdatedToast: (status) => `تم تحديث حالة الملف إلى ${status}`,
    profileStatusUpdateFailed: 'تعذّر تحديث حالة الملف',
    expected: 'المتوقَّع',
    actual: 'الفعلي',
    confidence: 'الثقة',
    eventId: 'معرّف الحدث',
    evidenceEmpty: 'لا توجد أدلة مُهيكَلة مرفقة.',
    profileBaselineSubtitle: (entityType) => `خط الأساس السلوكي لـ ${entityType}`,
    riskBadge: (score, level) => `المخاطر ${score} · ${level}`,
    profileLoadError: 'تعذّر تحميل ملف UEBA.',
    tabActivity: 'النشاط',
    tabAlerts: 'التنبيهات',
    tabBaseline: 'خط الأساس',
    tabRisk: 'سجل المخاطر',
    cardAccessHeatmap: 'خريطة الوصول الحرارية',
    cardRecentSourceIps: 'عناوين IP المصدر الحديثة',
    cardVolumeTimeline: 'الخط الزمني للحجم',
    cardRecentTableAccess: 'الوصول الحديث للجداول',
    entityAlertsEmpty: 'لم يُعثر على تنبيهات لهذا الكيان.',
    baselineAccessTime: 'مقارنة أوقات الوصول',
    baselineVolume: 'مقارنة الحجم',
    baselineAccessPattern: 'مقارنة أنماط الوصول',
    baselineFailureRate: 'مقارنة معدل الإخفاق',
    cardRiskScoreHistory: 'سجل درجة المخاطر',
    dayMon: 'الإثنين',
    dayTue: 'الثلاثاء',
    dayWed: 'الأربعاء',
    dayThu: 'الخميس',
    dayFri: 'الجمعة',
    daySat: 'السبت',
    daySun: 'الأحد',
    heatmapCellTooltip: (day, hour, value) => `${day} ${hour}:00 — ${value} حدثًا`,
    expectedDailyMean: (bytes, rows) => `المتوسط اليومي المتوقَّع: ${bytes} بايت · ${rows} صفًا`,
    volumeEmpty: 'لا يتوفّر سجل للحجم.',
    tableKnown: 'معروف',
    tableNew: 'جديد',
    tableAccessEmpty: 'لم يُعثر على وصول حديث للجداول.',
    ipKnown: 'معروف',
    ipUnknown: 'مجهول',
    sourceIpEmpty: 'لم يُعثر على بيانات حديثة لعناوين IP المصدر.',
    comparisonExpected: 'المتوقَّع',
    comparisonActual: 'الفعلي',
    riskHistoryEmpty: 'سجل المخاطر غير متوفّر حتى الآن.',
    statusActive: 'نشط',
    statusInactive: 'غير نشط',
    statusSuppressed: 'مكبوح',
    statusWhitelisted: 'مُدرَج في القائمة البيضاء',
    statusNew: 'جديد',
    statusAcknowledged: 'مُقَر',
    statusInvestigating: 'قيد التحقيق',
    statusResolved: 'تم الحل',
    statusFalsePositive: 'إنذار كاذب',
    config: {
      eyebrow: 'التحليلات السيبرانية',
      title: 'تهيئة UEBA',
      description: 'اضبط خطوط الأساس السلوكية وعتبات الحالات الشاذة ونوافذ الربط وحدود المعالجة.',
      save: 'حفظ التهيئة',
      updatedToast: 'تم تحديث تهيئة UEBA',
      runtimeCadenceTitle: 'إيقاع التشغيل',
      runtimeCadenceDescription: 'تستخدم المدد قيمًا بنمط Go يقبلها الخادم الخلفي، مثل 5m أو 30s أو 1h.',
      fields: {
        cycle_interval: 'فاصل الدورة',
        max_processing_time: 'أقصى زمن للمعالجة',
        min_maturity_for_alert: 'أدنى نضج للتنبيه',
        correlation_window: 'نافذة الربط',
        max_events_per_cycle: 'أقصى عدد أحداث لكل دورة',
        batch_size: 'حجم الدُفعة',
        ema_alpha: 'ألفا EMA',
        risk_decay_rate_per_day: 'تناقص المخاطر يوميًا',
        unusual_time_mature_high_prob: 'احتمال مرتفع للناضج',
        unusual_time_mature_medium_prob: 'احتمال متوسط للناضج',
        unusual_time_base_high_prob: 'احتمال مرتفع للأساس',
        unusual_time_base_medium_prob: 'احتمال متوسط للأساس',
        unusual_volume_medium_z: 'درجة Z متوسطة للحجم',
        unusual_volume_high_z: 'درجة Z مرتفعة للحجم',
        unusual_volume_critical_z: 'درجة Z حرجة للحجم',
        unusual_volume_stddev_min: 'أدنى انحراف معياري للحجم',
        failure_spike_medium_z: 'درجة Z متوسطة للإخفاق',
        failure_spike_high_z: 'درجة Z مرتفعة للإخفاق',
        failure_spike_critical_z: 'درجة Z حرجة للإخفاق',
        failure_stddev_min: 'أدنى انحراف معياري للإخفاق',
        failure_critical_count: 'عدد الإخفاقات الحرج',
        bulk_rows_medium_multiplier: 'مضاعِف متوسط للصفوف المجمّعة',
        bulk_rows_high_multiplier: 'مضاعِف مرتفع للصفوف المجمّعة',
        ddl_unusual_threshold: 'عتبة DDL غير المعتادة',
      },
      groups: {
        processing: {
          title: 'المعالجة',
          description: 'أحجام الدُفعات وحدود الأحداث والتنعيم وضوابط التناقص.',
        },
        unusualTime: {
          title: 'التوقيت غير المعتاد',
          description: 'عتبات الاحتمال لخطورة شذوذ وقت اليوم.',
        },
        volumeFailures: {
          title: 'الحجم والإخفاقات',
          description: 'عتبات درجة Z والحد الأدنى للتباين لحجم الأحداث والإخفاقات.',
        },
        bulkDdl: {
          title: 'البيانات المجمّعة وDDL',
          description: 'مضاعِفات لكشف شذوذ الوصول إلى الصفوف وتغيّر المخطط.',
        },
      },
    },
  },
};

export function useUebaLabels(): UebaLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(uebaLabels, locale), [locale]);
}

registerMessages('cyberUeba', uebaLabels);

/** UEBA alert status enum keys → localized display label. */
export function uebaAlertStatusLabel(status: string, t: UebaLabels): string {
  switch (status) {
    case 'new':
      return t.statusNew;
    case 'acknowledged':
      return t.statusAcknowledged;
    case 'investigating':
      return t.statusInvestigating;
    case 'resolved':
      return t.statusResolved;
    case 'false_positive':
      return t.statusFalsePositive;
    default:
      return status.replace(/_/g, ' ');
  }
}

/** UEBA profile status enum keys → localized display label. */
export function uebaProfileStatusLabel(status: string, t: UebaLabels): string {
  switch (status) {
    case 'active':
      return t.statusActive;
    case 'inactive':
      return t.statusInactive;
    case 'suppressed':
      return t.statusSuppressed;
    case 'whitelisted':
      return t.statusWhitelisted;
    default:
      return status.replace(/_/g, ' ');
  }
}
