/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the
 * Clario360 Cyber *Alerts* area (`/cyber/alerts/**`).
 *
 * Mirrors the lex/dr `{ en, ar }` bundle pattern: every label group is a
 * `CyberBilingual<T> = { en: T; ar: T }` carrying two full, same-shaped copies
 * of the label object — English in `en`, professional Saudi-register MSA in
 * `ar`. Components never receive the bundle; they read the resolved `T` from the
 * `useAlertLabels()` hook (which resolves against the active locale, falling
 * back to English when no LocaleProvider is mounted, matching the lex/dr
 * precedent). The `en` side MUST equal the pre-existing English strings exactly.
 *
 * Interpolation params and Western digits are preserved across both locales:
 * `(count) => ...` is a function on BOTH sides.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

export type CyberBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveCyberBilingual<T>(bundle: CyberBilingual<T>, locale: AppLocale): T {
  return locale === 'ar' ? bundle.ar : bundle.en;
}

interface AlertLabels {
  // Alerts list page
  list: {
    eyebrow: string;
    title: string;
    description: string;
    tagSocTriage: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  // Bulk actions + toasts (list page)
  bulk: {
    acknowledgeSelected: string;
    assignToAnalyst: string;
    markFalsePositive: string;
    mergeSelectedAlerts: string;
    selectAtLeastOne: string;
    selectAtLeastTwo: string;
    acknowledged: (count: number) => string;
    alertAcknowledged: string;
  };
  // Acknowledge confirm dialog (list page)
  ackDialog: {
    title: string;
    description: (title: string) => string;
    confirm: string;
  };
  // Stat bar
  stats: {
    newAlerts: string;
    newAlertsSub: string;
    investigating: string;
    investigatingSub: string;
    falsePositiveRate: string;
    falsePositiveRateSub: string;
    mtta: string;
    mttaSub: string;
    mttr: string;
    mttrSub: string;
  };
  // Severity stat bar (alert-stat-bar)
  severityBar: {
    critical: string;
    high: string;
    medium: string;
    low: string;
    open: string;
    resolved: string;
  };
  // Table columns
  columns: {
    severity: string;
    alertTitle: string;
    status: string;
    confidence: string;
    mitreTechnique: string;
    asset: string;
    rule: string;
    createdAt: string;
    actions: string;
    noDescription: string;
    detectionPipeline: string;
    open: string;
    acknowledge: string;
    assign: string;
    escalate: string;
    alertActions: string;
  };
  // Filters
  filters: {
    severity: string;
    status: string;
    mitreTactic: string;
    confidence: string;
    dateRange: string;
    ruleType: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    info: string;
  };
  // Assign dialog
  assign: {
    titleSingle: string;
    titleBulk: (count: number) => string;
    thisAlert: string;
    descriptionSingle: (title: string) => string;
    descriptionBulk: string;
    analystLabel: string;
    analystHelp: string;
    loadingAnalysts: string;
    selectAnalyst: string;
    searchAnalysts: string;
    noAlertsSelected: string;
    assignedSingle: string;
    assignedBulk: (count: number) => string;
    cancel: string;
    submitIdle: string;
    submitting: string;
    selectAnalystError: string;
  };
  // Escalate dialog
  escalate: {
    title: string;
    description: (title: string) => string;
    escalateToLabel: string;
    loadingAnalysts: string;
    selectTarget: string;
    searchAnalysts: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    escalated: string;
    cancel: string;
    submitIdle: string;
    submitting: string;
    // zod messages
    selectTargetError: string;
    reasonError: string;
  };
  // False positive dialog
  falsePositive: {
    title: string;
    descriptionSingle: (title: string) => string;
    descriptionBulk: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    noAlertsSelected: string;
    markedSingle: string;
    markedBulk: (count: number) => string;
    cancel: string;
    submitIdle: string;
    submitting: string;
    reasonError: string;
  };
  // Merge dialog
  merge: {
    title: string;
    description: string;
    primaryLabel: string;
    primaryPlaceholder: string;
    mergeSet: string;
    selectAtLeastTwo: string;
    merged: (count: number) => string;
    cancel: string;
    submitIdle: string;
    submitting: string;
    primaryError: string;
  };
  // Status dialog
  statusDialog: {
    title: string;
    description: (title: string) => string;
    newStatusLabel: string;
    selectStatus: string;
    resolutionSummary: string;
    analystNotes: string;
    resolvedPlaceholder: string;
    transitionPlaceholder: string;
    fpReasonLabel: string;
    fpReasonPlaceholder: string;
    movedTo: (status: string) => string;
    cancel: string;
    submitIdle: string;
    submitting: string;
    resolutionNotesError: string;
    fpReasonError: string;
  };
  // Detail page
  detail: {
    title: string;
    description: string;
    backToAlerts: string;
    refresh: string;
    loadError: string;
    tabExplanation: string;
    tabEvidence: string;
    tabComments: string;
    tabTimeline: string;
    tabRelated: string;
  };
  // Detail header
  header: {
    eventsCorrelated: string;
    source: (source: string) => string;
    firstSeen: string;
    lastSeen: (when: string) => string;
    affectedAsset: string;
    noLinkedAsset: string;
    criticality: (value: string) => string;
    assetContextUnavailable: string;
    assignedAnalyst: string;
    unassigned: string;
    noAnalystAttached: string;
    analystActions: string;
    noDescription: string;
  };
  // Confidence gauge labels
  gauge: {
    veryHigh: string;
    high: string;
    medium: string;
    low: string;
    confidenceSuffix: string;
  };
  // Detail actions (alert-actions.tsx)
  actions: {
    readOnly: string;
    acknowledge: string;
    startInvestigation: string;
    reopen: string;
    resolve: string;
    close: string;
    escalate: string;
    markFalsePositive: string;
    confirmTruePositive: string;
    assign: string;
    changeStatus: string;
    truePositiveSubmitted: string;
    truePositiveFailed: string;
    confirmTpTitle: string;
    confirmTpDescription: (title: string) => string;
    submitting: string;
    confirm: string;
    confirmTitleAck: string;
    confirmTitleInvestigate: string;
    confirmTitleClose: string;
    confirmTitleDefault: string;
    confirmLabelAck: string;
    confirmLabelInvestigate: string;
    confirmLabelClose: string;
    confirmLabelDefault: string;
    confirmDescAck: (title: string) => string;
    confirmDescInvestigate: (title: string) => string;
    confirmDescClose: (title: string) => string;
    confirmDescDefault: (title: string) => string;
  };
  // Comments tab
  comments: {
    eyebrow: string;
    heading: string;
    placeholder: string;
    addIdle: string;
    addBusy: string;
    added: string;
    addFailed: string;
    loadError: string;
    empty: string;
    system: string;
  };
  // Explanation tab
  explanation: {
    eyebrow: string;
    summary: string;
    noSummary: string;
    whyMatters: string;
    noReason: string;
    matchedConditions: string;
    noMatchedConditions: string;
    confidenceFactors: string;
    noConfidenceFactors: string;
    recommendedActions: string;
    noRecommendedActions: string;
    falsePositiveIndicators: string;
    noFalsePositiveIndicators: string;
    indicatorMatches: string;
    noIndicatorMatches: string;
    matchedField: string;
  };
  // Evidence tab
  evidence: {
    eyebrow: string;
    structuredEvidence: string;
    colLabel: string;
    colValue: string;
    colDescription: string;
    noStructuredEvidence: string;
    networkContext: string;
    noNetworkPivots: string;
    assetContext: string;
    asset: string;
    hostname: string;
    ipAddress: string;
    operatingSystem: string;
    owner: string;
    criticality: string;
    firstEvent: string;
    lastEvent: string;
    unknown: string;
    indicatorMatches: string;
    noThreatIntelMatches: string;
    detectionPayload: string;
    explanationDetails: string;
    alertMetadata: string;
  };
  // Related tab
  related: {
    loadError: string;
    empty: string;
    noDescription: string;
    rule: (value: string) => string;
    asset: (value: string) => string;
    technique: (value: string) => string;
    unknown: string;
    unmapped: string;
    detectionPipeline: string;
    relSameRule: string;
    relSameAsset: string;
    relSameTechnique: string;
    relSameSource: string;
    relCorrelated: string;
  };
  // Timeline tab
  timeline: {
    loadError: string;
    empty: string;
    actor: (name: string) => string;
    change: (from: string, to: string) => string;
  };
}

export const alertLabels: CyberBilingual<AlertLabels> = {
  en: {
    list: {
      eyebrow: 'Cyber Defense',
      title: 'Alert Management',
      description:
        'Triages new detections, route investigations to analysts, and pivot from MITRE techniques into evidence, comments, and correlated alerts.',
      tagSocTriage: 'SOC triage',
      searchPlaceholder: 'Search alerts, rules, assets, or investigation context…',
      emptyTitle: 'No alerts found',
      emptyDescription: 'No alerts match the current filters.',
    },
    bulk: {
      acknowledgeSelected: 'Acknowledge Selected',
      assignToAnalyst: 'Assign to Analyst',
      markFalsePositive: 'Mark False Positive',
      mergeSelectedAlerts: 'Merge Selected Alerts',
      selectAtLeastOne: 'Select at least one alert',
      selectAtLeastTwo: 'Select at least two alerts to merge',
      acknowledged: (count) => `${count} alerts acknowledged`,
      alertAcknowledged: 'Alert acknowledged',
    },
    ackDialog: {
      title: 'Acknowledge Alert',
      description: (title) =>
        `This will move ${title} into the acknowledged state and auto-assign it to you if it is currently unowned.`,
      confirm: 'Acknowledge',
    },
    stats: {
      newAlerts: 'New Alerts',
      newAlertsSub: 'Awaiting triage',
      investigating: 'Investigating',
      investigatingSub: 'Active analyst workload',
      falsePositiveRate: 'False Positive Rate',
      falsePositiveRateSub: 'Rule feedback quality',
      mtta: 'Mean Time to Acknowledge',
      mttaSub: 'Average first response',
      mttr: 'Mean Time to Resolve',
      mttrSub: 'Average containment cycle',
    },
    severityBar: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      open: 'Open',
      resolved: 'Resolved',
    },
    columns: {
      severity: 'Severity',
      alertTitle: 'Alert Title',
      status: 'Status',
      confidence: 'Confidence',
      mitreTechnique: 'MITRE Technique',
      asset: 'Asset',
      rule: 'Rule',
      createdAt: 'Created At',
      actions: 'Actions',
      noDescription: 'No analyst description provided.',
      detectionPipeline: 'Detection pipeline',
      open: 'Open',
      acknowledge: 'Acknowledge',
      assign: 'Assign',
      escalate: 'Escalate',
      alertActions: 'Alert actions',
    },
    filters: {
      severity: 'Severity',
      status: 'Status',
      mitreTactic: 'MITRE Tactic',
      confidence: 'Confidence',
      dateRange: 'Date Range',
      ruleType: 'Rule Type',
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      info: 'Info',
    },
    assign: {
      titleSingle: 'Assign Alert',
      titleBulk: (count) => `Assign ${count} alerts`,
      thisAlert: 'this alert',
      descriptionSingle: (title) => `Route ${title} to an analyst for investigation.`,
      descriptionBulk: 'Route the selected alerts to an analyst for investigation.',
      analystLabel: 'Analyst',
      analystHelp:
        'Acknowledging an alert will auto-assign it to the acting analyst if it is still unowned.',
      loadingAnalysts: 'Loading analysts…',
      selectAnalyst: 'Select an analyst',
      searchAnalysts: 'Search analysts',
      noAlertsSelected: 'No alerts selected',
      assignedSingle: 'Alert assigned successfully',
      assignedBulk: (count) => `${count} alerts assigned`,
      cancel: 'Cancel',
      submitIdle: 'Assign',
      submitting: 'Assigning…',
      selectAnalystError: 'Select an analyst',
    },
    escalate: {
      title: 'Escalate Alert',
      description: (title) =>
        `Escalate ${title} to a higher-tier analyst with a documented reason.`,
      escalateToLabel: 'Escalate To',
      loadingAnalysts: 'Loading analysts…',
      selectTarget: 'Select escalation target',
      searchAnalysts: 'Search analysts',
      reasonLabel: 'Reason',
      reasonPlaceholder: 'Explain why this alert needs to be escalated.',
      escalated: 'Alert escalated',
      cancel: 'Cancel',
      submitIdle: 'Escalate',
      submitting: 'Escalating…',
      selectTargetError: 'Select an escalation target',
      reasonError: 'Provide a clear escalation reason',
    },
    falsePositive: {
      title: 'Mark False Positive',
      descriptionSingle: (title) => `Document why ${title} is benign.`,
      descriptionBulk:
        'Document why the selected alerts are benign so rule feedback stays accurate.',
      reasonLabel: 'Reason',
      reasonPlaceholder: 'Explain why this activity should not be treated as malicious.',
      noAlertsSelected: 'No alerts selected',
      markedSingle: 'Alert marked as false positive',
      markedBulk: (count) => `${count} alerts marked as false positive`,
      cancel: 'Cancel',
      submitIdle: 'Confirm',
      submitting: 'Updating…',
      reasonError: 'Provide a clear reason',
    },
    merge: {
      title: 'Merge Alerts',
      description:
        'Choose which alert remains open. The others will be merged into it and marked accordingly.',
      primaryLabel: 'Primary Alert',
      primaryPlaceholder: 'Choose primary alert',
      mergeSet: 'Merge Set',
      selectAtLeastTwo: 'Select at least two alerts to merge',
      merged: (count) => `Merged ${count} related alerts`,
      cancel: 'Cancel',
      submitIdle: 'Merge Alerts',
      submitting: 'Merging…',
      primaryError: 'Select the primary alert',
    },
    statusDialog: {
      title: 'Update Alert Status',
      description: (title) =>
        `Move ${title} to the next lifecycle stage. Only valid backend transitions are shown.`,
      newStatusLabel: 'New Status',
      selectStatus: 'Select status',
      resolutionSummary: 'Resolution Summary',
      analystNotes: 'Analyst Notes',
      resolvedPlaceholder: 'Document how the alert was resolved.',
      transitionPlaceholder: 'Add context for this transition.',
      fpReasonLabel: 'False Positive Reason',
      fpReasonPlaceholder: 'Describe why this alert is benign.',
      movedTo: (status) => `Alert moved to ${status}`,
      cancel: 'Cancel',
      submitIdle: 'Update Status',
      submitting: 'Updating…',
      resolutionNotesError: 'Resolution notes are required',
      fpReasonError: 'A false-positive reason is required',
    },
    detail: {
      title: 'Alert Investigation Workspace',
      description:
        'Inspect the explanation payload, review supporting evidence, collaborate with analysts, and pivot into related detections.',
      backToAlerts: 'Back to Alerts',
      refresh: 'Refresh',
      loadError: 'Failed to load alert details',
      tabExplanation: 'AI Explanation',
      tabEvidence: 'Evidence',
      tabComments: 'Comments',
      tabTimeline: 'Timeline',
      tabRelated: 'Related Alerts',
    },
    header: {
      eventsCorrelated: 'Events Correlated',
      source: (source) => `Source: ${source}`,
      firstSeen: 'First Seen',
      lastSeen: (when) => `Last seen ${when}`,
      affectedAsset: 'Affected Asset',
      noLinkedAsset: 'No linked asset',
      criticality: (value) => `Criticality: ${value}`,
      assetContextUnavailable: 'Asset context unavailable',
      assignedAnalyst: 'Assigned Analyst',
      unassigned: 'Unassigned',
      noAnalystAttached: 'No analyst attached yet',
      analystActions: 'Analyst Actions',
      noDescription: 'No analyst description was provided for this alert.',
    },
    gauge: {
      veryHigh: 'Very High',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      confidenceSuffix: 'Confidence',
    },
    actions: {
      readOnly: 'You have read-only access to this alert.',
      acknowledge: 'Acknowledge',
      startInvestigation: 'Start Investigation',
      reopen: 'Reopen',
      resolve: 'Resolve',
      close: 'Close',
      escalate: 'Escalate',
      markFalsePositive: 'Mark False Positive',
      confirmTruePositive: 'Confirm True Positive',
      assign: 'Assign',
      changeStatus: 'Change Status',
      truePositiveSubmitted: 'Rule feedback submitted — confirmed true positive',
      truePositiveFailed: 'Failed to submit rule feedback',
      confirmTpTitle: 'Confirm True Positive',
      confirmTpDescription: (title) =>
        `Submit feedback that "${title}" is a genuine threat. This helps tune the detection rule's accuracy.`,
      submitting: 'Submitting…',
      confirm: 'Confirm',
      confirmTitleAck: 'Acknowledge Alert',
      confirmTitleInvestigate: 'Move To Investigation',
      confirmTitleClose: 'Close Alert',
      confirmTitleDefault: 'Confirm Status Change',
      confirmLabelAck: 'Acknowledge',
      confirmLabelInvestigate: 'Start Investigation',
      confirmLabelClose: 'Close Alert',
      confirmLabelDefault: 'Continue',
      confirmDescAck: (title) =>
        `This will acknowledge ${title} and auto-assign it to you if it is still unowned.`,
      confirmDescInvestigate: (title) =>
        `This will move ${title} into the investigating state so analysts can continue the case.`,
      confirmDescClose: (title) =>
        `This will close ${title} and end the active investigation workflow.`,
      confirmDescDefault: (title) => `Update ${title}.`,
    },
    comments: {
      eyebrow: 'Investigation Comments',
      heading: 'Analyst Collaboration',
      placeholder: 'Document findings, note pivots, or mention a teammate with @name.',
      addIdle: 'Add Comment',
      addBusy: 'Posting…',
      added: 'Comment added',
      addFailed: 'Failed to add comment',
      loadError: 'Failed to load comments',
      empty: 'No investigation comments yet.',
      system: 'System',
    },
    explanation: {
      eyebrow: 'AI Explanation',
      summary: 'Summary',
      noSummary: 'No AI summary was generated for this alert.',
      whyMatters: 'Why This Matters',
      noReason: 'No reason was supplied.',
      matchedConditions: 'Matched Conditions',
      noMatchedConditions: 'No matched conditions were recorded.',
      confidenceFactors: 'Confidence Factors',
      noConfidenceFactors: 'No confidence factors were supplied.',
      recommendedActions: 'Recommended Actions',
      noRecommendedActions: 'No recommended actions were generated.',
      falsePositiveIndicators: 'False Positive Indicators',
      noFalsePositiveIndicators: 'No false-positive indicators were recorded.',
      indicatorMatches: 'Indicator Matches',
      noIndicatorMatches: 'No supporting indicator matches were attached to this alert.',
      matchedField: 'Matched field:',
    },
    evidence: {
      eyebrow: 'Investigation',
      structuredEvidence: 'Structured Evidence',
      colLabel: 'Label',
      colValue: 'Value',
      colDescription: 'Description',
      noStructuredEvidence: 'No structured evidence was attached to this alert.',
      networkContext: 'Network Context',
      noNetworkPivots: 'No explicit network pivots were recorded.',
      assetContext: 'Asset Context',
      asset: 'Asset',
      hostname: 'Hostname',
      ipAddress: 'IP Address',
      operatingSystem: 'Operating System',
      owner: 'Owner',
      criticality: 'Criticality',
      firstEvent: 'First Event',
      lastEvent: 'Last Event',
      unknown: 'Unknown',
      indicatorMatches: 'Indicator Matches',
      noThreatIntelMatches: 'No threat intelligence matches were attached.',
      detectionPayload: 'Detection Payload',
      explanationDetails: 'Explanation Details',
      alertMetadata: 'Alert Metadata',
    },
    related: {
      loadError: 'Failed to load related alerts',
      empty: 'No related alerts were found for this case.',
      noDescription: 'No description was supplied.',
      rule: (value) => `Rule: ${value}`,
      asset: (value) => `Asset: ${value}`,
      technique: (value) => `Technique: ${value}`,
      unknown: 'Unknown',
      unmapped: 'Unmapped',
      detectionPipeline: 'Detection pipeline',
      relSameRule: 'Same Rule',
      relSameAsset: 'Same Asset',
      relSameTechnique: 'Same Technique',
      relSameSource: 'Same Source',
      relCorrelated: 'Correlated',
    },
    timeline: {
      loadError: 'Failed to load alert timeline',
      empty: 'No activity has been recorded for this alert yet.',
      actor: (name) => `Actor: ${name}`,
      change: (from, to) => `Change: ${from} -> ${to}`,
    },
  },
  ar: {
    list: {
      eyebrow: 'الدفاع السيبراني',
      title: 'إدارة التنبيهات',
      description:
        'فرز عمليات الكشف الجديدة، وتوجيه التحقيقات إلى المحللين، والانتقال من تقنيات MITRE إلى الأدلة والتعليقات والتنبيهات المترابطة.',
      tagSocTriage: 'فرز مركز العمليات الأمنية',
      searchPlaceholder: 'ابحث في التنبيهات أو القواعد أو الأصول أو سياق التحقيق…',
      emptyTitle: 'لا توجد تنبيهات',
      emptyDescription: 'لا توجد تنبيهات مطابقة لعوامل التصفية الحالية.',
    },
    bulk: {
      acknowledgeSelected: 'الإقرار بالمحدد',
      assignToAnalyst: 'إسناد إلى محلل',
      markFalsePositive: 'وسم كإيجابية كاذبة',
      mergeSelectedAlerts: 'دمج التنبيهات المحددة',
      selectAtLeastOne: 'اختر تنبيهًا واحدًا على الأقل',
      selectAtLeastTwo: 'اختر تنبيهين على الأقل للدمج',
      acknowledged: (count) => `تم الإقرار بـ ${count} تنبيه`,
      alertAcknowledged: 'تم الإقرار بالتنبيه',
    },
    ackDialog: {
      title: 'الإقرار بالتنبيه',
      description: (title) =>
        `سيؤدي هذا إلى نقل ${title} إلى حالة الإقرار وإسناده إليك تلقائيًا إن لم يكن لديه مسؤول حاليًا.`,
      confirm: 'إقرار',
    },
    stats: {
      newAlerts: 'تنبيهات جديدة',
      newAlertsSub: 'بانتظار الفرز',
      investigating: 'قيد التحقيق',
      investigatingSub: 'عبء العمل النشط للمحللين',
      falsePositiveRate: 'معدل الإيجابيات الكاذبة',
      falsePositiveRateSub: 'جودة تغذية القواعد الراجعة',
      mtta: 'متوسط زمن الإقرار',
      mttaSub: 'متوسط الاستجابة الأولى',
      mttr: 'متوسط زمن المعالجة',
      mttrSub: 'متوسط دورة الاحتواء',
    },
    severityBar: {
      critical: 'حرج',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      open: 'مفتوح',
      resolved: 'مُعالَج',
    },
    columns: {
      severity: 'الخطورة',
      alertTitle: 'عنوان التنبيه',
      status: 'الحالة',
      confidence: 'الثقة',
      mitreTechnique: 'تقنية MITRE',
      asset: 'الأصل',
      rule: 'القاعدة',
      createdAt: 'أُنشئ في',
      actions: 'إجراءات',
      noDescription: 'لم يُقدَّم وصف من المحلل.',
      detectionPipeline: 'مسار الكشف',
      open: 'فتح',
      acknowledge: 'إقرار',
      assign: 'إسناد',
      escalate: 'تصعيد',
      alertActions: 'إجراءات التنبيه',
    },
    filters: {
      severity: 'الخطورة',
      status: 'الحالة',
      mitreTactic: 'تكتيك MITRE',
      confidence: 'الثقة',
      dateRange: 'النطاق الزمني',
      ruleType: 'نوع القاعدة',
      critical: 'حرج',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      info: 'معلوماتي',
    },
    assign: {
      titleSingle: 'إسناد التنبيه',
      titleBulk: (count) => `إسناد ${count} تنبيه`,
      thisAlert: 'هذا التنبيه',
      descriptionSingle: (title) => `توجيه ${title} إلى محلل للتحقيق.`,
      descriptionBulk: 'توجيه التنبيهات المحددة إلى محلل للتحقيق.',
      analystLabel: 'المحلل',
      analystHelp:
        'سيؤدي الإقرار بالتنبيه إلى إسناده تلقائيًا إلى المحلل المنفِّذ إن لم يكن له مسؤول بعد.',
      loadingAnalysts: 'جارٍ تحميل المحللين…',
      selectAnalyst: 'اختر محللًا',
      searchAnalysts: 'ابحث عن المحللين',
      noAlertsSelected: 'لم يُحدَّد أي تنبيه',
      assignedSingle: 'تم إسناد التنبيه بنجاح',
      assignedBulk: (count) => `تم إسناد ${count} تنبيه`,
      cancel: 'إلغاء',
      submitIdle: 'إسناد',
      submitting: 'جارٍ الإسناد…',
      selectAnalystError: 'اختر محللًا',
    },
    escalate: {
      title: 'تصعيد التنبيه',
      description: (title) => `تصعيد ${title} إلى محلل من مستوى أعلى مع سبب موثَّق.`,
      escalateToLabel: 'تصعيد إلى',
      loadingAnalysts: 'جارٍ تحميل المحللين…',
      selectTarget: 'اختر جهة التصعيد',
      searchAnalysts: 'ابحث عن المحللين',
      reasonLabel: 'السبب',
      reasonPlaceholder: 'اشرح سبب الحاجة إلى تصعيد هذا التنبيه.',
      escalated: 'تم تصعيد التنبيه',
      cancel: 'إلغاء',
      submitIdle: 'تصعيد',
      submitting: 'جارٍ التصعيد…',
      selectTargetError: 'اختر جهة التصعيد',
      reasonError: 'قدّم سببًا واضحًا للتصعيد',
    },
    falsePositive: {
      title: 'وسم كإيجابية كاذبة',
      descriptionSingle: (title) => `وثّق سبب اعتبار ${title} غير ضار.`,
      descriptionBulk:
        'وثّق سبب اعتبار التنبيهات المحددة غير ضارة لتبقى التغذية الراجعة للقواعد دقيقة.',
      reasonLabel: 'السبب',
      reasonPlaceholder: 'اشرح لماذا لا ينبغي معاملة هذا النشاط كنشاط خبيث.',
      noAlertsSelected: 'لم يُحدَّد أي تنبيه',
      markedSingle: 'تم وسم التنبيه كإيجابية كاذبة',
      markedBulk: (count) => `تم وسم ${count} تنبيه كإيجابية كاذبة`,
      cancel: 'إلغاء',
      submitIdle: 'تأكيد',
      submitting: 'جارٍ التحديث…',
      reasonError: 'قدّم سببًا واضحًا',
    },
    merge: {
      title: 'دمج التنبيهات',
      description:
        'اختر التنبيه الذي يبقى مفتوحًا. ستُدمَج التنبيهات الأخرى فيه ويُوسَم بناءً على ذلك.',
      primaryLabel: 'التنبيه الأساسي',
      primaryPlaceholder: 'اختر التنبيه الأساسي',
      mergeSet: 'مجموعة الدمج',
      selectAtLeastTwo: 'اختر تنبيهين على الأقل للدمج',
      merged: (count) => `تم دمج ${count} تنبيه مترابط`,
      cancel: 'إلغاء',
      submitIdle: 'دمج التنبيهات',
      submitting: 'جارٍ الدمج…',
      primaryError: 'اختر التنبيه الأساسي',
    },
    statusDialog: {
      title: 'تحديث حالة التنبيه',
      description: (title) =>
        `نقل ${title} إلى المرحلة التالية من دورة الحياة. تُعرض فقط التحولات الصحيحة المدعومة من الخادم.`,
      newStatusLabel: 'الحالة الجديدة',
      selectStatus: 'اختر الحالة',
      resolutionSummary: 'ملخص المعالجة',
      analystNotes: 'ملاحظات المحلل',
      resolvedPlaceholder: 'وثّق كيفية معالجة التنبيه.',
      transitionPlaceholder: 'أضف سياقًا لهذا التحول.',
      fpReasonLabel: 'سبب الإيجابية الكاذبة',
      fpReasonPlaceholder: 'بيّن لماذا يُعد هذا التنبيه غير ضار.',
      movedTo: (status) => `نُقل التنبيه إلى ${status}`,
      cancel: 'إلغاء',
      submitIdle: 'تحديث الحالة',
      submitting: 'جارٍ التحديث…',
      resolutionNotesError: 'ملاحظات المعالجة مطلوبة',
      fpReasonError: 'سبب الإيجابية الكاذبة مطلوب',
    },
    detail: {
      title: 'مساحة عمل التحقيق في التنبيه',
      description:
        'افحص حمولة التفسير، وراجع الأدلة الداعمة، وتعاون مع المحللين، وانتقل إلى عمليات الكشف المرتبطة.',
      backToAlerts: 'العودة إلى التنبيهات',
      refresh: 'تحديث',
      loadError: 'تعذّر تحميل تفاصيل التنبيه',
      tabExplanation: 'تفسير الذكاء الاصطناعي',
      tabEvidence: 'الأدلة',
      tabComments: 'التعليقات',
      tabTimeline: 'الخط الزمني',
      tabRelated: 'التنبيهات المرتبطة',
    },
    header: {
      eventsCorrelated: 'الأحداث المترابطة',
      source: (source) => `المصدر: ${source}`,
      firstSeen: 'أول ظهور',
      lastSeen: (when) => `آخر ظهور ${when}`,
      affectedAsset: 'الأصل المتأثر',
      noLinkedAsset: 'لا يوجد أصل مرتبط',
      criticality: (value) => `الأهمية: ${value}`,
      assetContextUnavailable: 'سياق الأصل غير متاح',
      assignedAnalyst: 'المحلل المُسنَد',
      unassigned: 'غير مُسنَد',
      noAnalystAttached: 'لم يُرفَق محلل بعد',
      analystActions: 'إجراءات المحلل',
      noDescription: 'لم يُقدَّم وصف من المحلل لهذا التنبيه.',
    },
    gauge: {
      veryHigh: 'عالية جدًا',
      high: 'عالية',
      medium: 'متوسطة',
      low: 'منخفضة',
      confidenceSuffix: 'ثقة',
    },
    actions: {
      readOnly: 'لديك صلاحية قراءة فقط لهذا التنبيه.',
      acknowledge: 'إقرار',
      startInvestigation: 'بدء التحقيق',
      reopen: 'إعادة فتح',
      resolve: 'معالجة',
      close: 'إغلاق',
      escalate: 'تصعيد',
      markFalsePositive: 'وسم كإيجابية كاذبة',
      confirmTruePositive: 'تأكيد كإيجابية صحيحة',
      assign: 'إسناد',
      changeStatus: 'تغيير الحالة',
      truePositiveSubmitted: 'تم إرسال التغذية الراجعة للقاعدة — أُكِّدت كإيجابية صحيحة',
      truePositiveFailed: 'تعذّر إرسال التغذية الراجعة للقاعدة',
      confirmTpTitle: 'تأكيد كإيجابية صحيحة',
      confirmTpDescription: (title) =>
        `أرسل تغذية راجعة بأن "${title}" تهديد حقيقي. يساعد ذلك في ضبط دقة قاعدة الكشف.`,
      submitting: 'جارٍ الإرسال…',
      confirm: 'تأكيد',
      confirmTitleAck: 'الإقرار بالتنبيه',
      confirmTitleInvestigate: 'الانتقال إلى التحقيق',
      confirmTitleClose: 'إغلاق التنبيه',
      confirmTitleDefault: 'تأكيد تغيير الحالة',
      confirmLabelAck: 'إقرار',
      confirmLabelInvestigate: 'بدء التحقيق',
      confirmLabelClose: 'إغلاق التنبيه',
      confirmLabelDefault: 'متابعة',
      confirmDescAck: (title) =>
        `سيؤدي هذا إلى الإقرار بـ ${title} وإسناده إليك تلقائيًا إن لم يكن له مسؤول بعد.`,
      confirmDescInvestigate: (title) =>
        `سيؤدي هذا إلى نقل ${title} إلى حالة قيد التحقيق ليتمكن المحللون من متابعة القضية.`,
      confirmDescClose: (title) =>
        `سيؤدي هذا إلى إغلاق ${title} وإنهاء سير عمل التحقيق النشط.`,
      confirmDescDefault: (title) => `تحديث ${title}.`,
    },
    comments: {
      eyebrow: 'تعليقات التحقيق',
      heading: 'تعاون المحللين',
      placeholder: 'وثّق النتائج، أو سجّل نقاط الانتقال، أو أشِر إلى زميل باستخدام @الاسم.',
      addIdle: 'إضافة تعليق',
      addBusy: 'جارٍ النشر…',
      added: 'تمت إضافة التعليق',
      addFailed: 'تعذّرت إضافة التعليق',
      loadError: 'تعذّر تحميل التعليقات',
      empty: 'لا توجد تعليقات تحقيق بعد.',
      system: 'النظام',
    },
    explanation: {
      eyebrow: 'تفسير الذكاء الاصطناعي',
      summary: 'الملخص',
      noSummary: 'لم يُولَّد ملخص بالذكاء الاصطناعي لهذا التنبيه.',
      whyMatters: 'لماذا هذا مهم',
      noReason: 'لم يُقدَّم سبب.',
      matchedConditions: 'الشروط المطابِقة',
      noMatchedConditions: 'لم تُسجَّل أي شروط مطابِقة.',
      confidenceFactors: 'عوامل الثقة',
      noConfidenceFactors: 'لم تُقدَّم أي عوامل ثقة.',
      recommendedActions: 'الإجراءات الموصى بها',
      noRecommendedActions: 'لم تُولَّد أي إجراءات موصى بها.',
      falsePositiveIndicators: 'مؤشرات الإيجابية الكاذبة',
      noFalsePositiveIndicators: 'لم تُسجَّل أي مؤشرات إيجابية كاذبة.',
      indicatorMatches: 'مطابقات المؤشرات',
      noIndicatorMatches: 'لم تُرفَق مطابقات مؤشرات داعمة بهذا التنبيه.',
      matchedField: 'الحقل المطابِق:',
    },
    evidence: {
      eyebrow: 'التحقيق',
      structuredEvidence: 'الأدلة المُهيكلة',
      colLabel: 'التسمية',
      colValue: 'القيمة',
      colDescription: 'الوصف',
      noStructuredEvidence: 'لم تُرفَق أدلة مُهيكلة بهذا التنبيه.',
      networkContext: 'سياق الشبكة',
      noNetworkPivots: 'لم تُسجَّل أي نقاط انتقال شبكية صريحة.',
      assetContext: 'سياق الأصل',
      asset: 'الأصل',
      hostname: 'اسم المضيف',
      ipAddress: 'عنوان IP',
      operatingSystem: 'نظام التشغيل',
      owner: 'المسؤول',
      criticality: 'الأهمية',
      firstEvent: 'أول حدث',
      lastEvent: 'آخر حدث',
      unknown: 'غير معروف',
      indicatorMatches: 'مطابقات المؤشرات',
      noThreatIntelMatches: 'لم تُرفَق مطابقات استخبارات تهديدية.',
      detectionPayload: 'حمولة الكشف',
      explanationDetails: 'تفاصيل التفسير',
      alertMetadata: 'بيانات التنبيه الوصفية',
    },
    related: {
      loadError: 'تعذّر تحميل التنبيهات المرتبطة',
      empty: 'لم يُعثَر على تنبيهات مرتبطة لهذه القضية.',
      noDescription: 'لم يُقدَّم وصف.',
      rule: (value) => `القاعدة: ${value}`,
      asset: (value) => `الأصل: ${value}`,
      technique: (value) => `التقنية: ${value}`,
      unknown: 'غير معروف',
      unmapped: 'غير مرتبط',
      detectionPipeline: 'مسار الكشف',
      relSameRule: 'القاعدة ذاتها',
      relSameAsset: 'الأصل ذاته',
      relSameTechnique: 'التقنية ذاتها',
      relSameSource: 'المصدر ذاته',
      relCorrelated: 'مترابط',
    },
    timeline: {
      loadError: 'تعذّر تحميل الخط الزمني للتنبيه',
      empty: 'لم يُسجَّل أي نشاط لهذا التنبيه بعد.',
      actor: (name) => `الفاعل: ${name}`,
      change: (from, to) => `التغيير: ${from} -> ${to}`,
    },
  },
};

export function useAlertLabels(): AlertLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveCyberBilingual(alertLabels, locale), [locale]);
}
