/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the Clario
 * Cyber Detection Rules console (`/cyber/rules`, re-exported at
 * `/cyber/detection-rules`) including the rule list, rule detail tabs, the
 * Sigma / threshold / correlation / anomaly editors, the rule wizard, the test
 * dialog, and the template gallery.
 *
 * Mirrors the lex i18n contract: a label group is a `RulesBilingual<T> =
 * { en: T; ar: T }` bundle (two full, same-shaped copies of the label object),
 * resolved against the active locale by {@link useRulesLabels} (React hook) or
 * {@link resolveRulesBilingual} (pure resolver). Resolution defaults to English
 * when no `LocaleProvider` is mounted (via `useLocaleOrDefault`), so isolated
 * unit tests keep rendering the English surface unchanged.
 *
 * Components NEVER receive the bundle — they read the resolved `T` and use it as
 * a plain label object. Interpolation params and Western digits are preserved
 * across both locales. Product names / acronyms (Sigma, MITRE ATT&CK, YAML,
 * Monaco, JSON, CIDR, regex, FP, TP) stay as-is. Code-identifier field names,
 * operators, and enum tokens (event_type, |contains, count, etc.) are NOT
 * translated.
 */

'use client';

import { useMemo } from 'react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

export type RulesBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveRulesBilingual<T>(bundle: RulesBilingual<T>, locale: AppLocale): T {
  return locale === 'ar' ? bundle.ar : bundle.en;
}

interface RulesLabels {
  list: {
    eyebrow: string;
    title: string;
    description: string;
    rulesTag: (count: string) => string;
    activeTag: (count: string) => string;
    templates: string;
    createRule: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
    filterType: string;
    filterSeverity: string;
    filterMitreTactic: string;
    filterStatus: string;
    filterEnabled: string;
    filterDisabled: string;
    toastStatusUpdated: string;
    toastDeleted: string;
    copyOf: (name: string) => string;
  };
  filterOptions: {
    sigma: string;
    threshold: string;
    correlation: string;
    anomaly: string;
    critical: string;
    high: string;
    medium: string;
    low: string;
    info: string;
  };
  stats: {
    totalRules: string;
    totalDescription: string;
    activeRules: string;
    enabledChange: string;
    typeMix: string;
    typeMixDescription: string;
    truePositiveRate: string;
    truePositiveDescription: (count: number) => string;
  };
  columns: {
    ruleName: string;
    noDescription: string;
    type: string;
    severity: string;
    mitreTechnique: string;
    unmapped: string;
    status: string;
    enabled: string;
    disabled: string;
    enableRuleAria: string;
    disableRuleAria: string;
    tpFp: string;
    alertsGenerated: string;
    lastTriggered: string;
    never: string;
    ruleActionsAria: string;
    viewDetails: string;
    edit: string;
    duplicate: string;
    testRule: string;
    delete: string;
    deleteTitle: string;
    deleteDescription: (name: string) => string;
    deleteConfirm: string;
  };
  performanceCard: {
    triggers: (count: string) => string;
    fpSuffix: string;
    highFp: string;
    truePositives: (value: string) => string;
    falsePositives: (value: string) => string;
    autoDisableRisk: string;
  };
  detail: {
    eyebrow: string;
    loadError: string;
    enabled: string;
    disabled: string;
    techniquesTag: (count: number) => string;
    description: string;
    editRule: string;
    testRule: string;
    enable: string;
    disable: string;
    delete: string;
    toastStatusUpdated: string;
    toastDeleted: string;
    deleteTitle: string;
    deleteDescription: (name: string) => string;
    deleteConfirm: string;
    tabOverview: string;
    tabLogic: string;
    tabPerformance: string;
    tabAlerts: string;
  };
  overview: {
    ruleType: string;
    triggerCount: string;
    mappedTechniques: string;
    confidence: string;
    description: string;
    noDescription: string;
    created: string;
    lastUpdated: string;
    createdBy: string;
    lastTriggered: string;
    unknown: string;
    never: string;
    system: string;
    mitreMapping: string;
    noTactics: string;
    noTechniques: string;
    tags: string;
    noTags: string;
  };
  logic: {
    sigmaYaml: string;
    sigmaReadonly: string;
    rawPayload: string;
  };
  performance: {
    triggers: string;
    alerts30d: string;
    truePositiveRate: string;
    falsePositiveRate: string;
    alertsSeries: string;
    alertTrendTitle: string;
    severityDistribution: string;
    alertsCenter: string;
    topTriggeredAssets: string;
  };
  alertsTab: {
    alert: string;
    severity: string;
    status: string;
    confidence: string;
    asset: string;
    created: string;
    unknownAsset: string;
    searchPlaceholder: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  wizard: {
    editTitle: string;
    createTitle: string;
    steps: { basics: string; logic: string; mitre: string; review: string };
    stepLabel: (index: number) => string;
    ruleName: string;
    ruleNamePlaceholder: string;
    description: string;
    descriptionPlaceholder: string;
    tags: string;
    tagsPlaceholder: string;
    ruleType: string;
    ruleTypeLocked: string;
    severity: string;
    baseConfidence: string;
    ruleEnabled: string;
    ruleEnabledHint: string;
    sigmaYaml: string;
    sigmaHint: string;
    monaco: string;
    minFirstEventMatches: string;
    tactics: string;
    tacticsHint: string;
    techniques: string;
    techniquesHint: string;
    configSummary: string;
    basics: string;
    untitledRule: string;
    noDescription: string;
    type: string;
    severityLabel: string;
    confidenceLabel: string;
    mitreMapping: string;
    noTechniquesSelected: string;
    logicPreview: string;
    cancel: string;
    back: string;
    next: string;
    saving: string;
    updateRule: string;
    createRule: string;
    errNameLength: string;
    errInvalidSigma: string;
    errBuildPayload: string;
    toastUpdated: string;
    toastCreated: string;
  };
  sigmaEditor: {
    selections: string;
    addSelection: string;
    selection: string;
    filters: string;
    addFilter: string;
    filter: string;
    addCondition: string;
    selectionNamePlaceholder: string;
    valuePlaceholder: string;
    removeConditionAria: string;
    removeSelectionAria: string;
    conditionExpression: string;
    conditionTooltip: string;
    conditionPlaceholder: string;
    timeframeOptional: string;
    timeframePlaceholder: string;
    countThresholdOptional: string;
    countThresholdPlaceholder: string;
  };
  thresholdEditor: {
    filterConditions: string;
    addCondition: string;
    valuePlaceholder: string;
    groupByField: string;
    none: string;
    metric: string;
    metricField: string;
    selectField: string;
    thresholdValue: string;
    thresholdPlaceholder: string;
    timeWindow: string;
    windowPlaceholder: string;
  };
  anomalyEditor: {
    metric: string;
    groupByField: string;
    none: string;
    timeWindow: string;
    windowPlaceholder: string;
    zScoreThreshold: string;
    minBaselineSamples: string;
    direction: string;
    directionAbove: string;
    directionBelow: string;
    directionBoth: string;
  };
  correlationEditor: {
    eventTypes: string;
    addEventType: string;
    eventNamePlaceholder: string;
    valuePlaceholder: string;
    addCondition: string;
    sequenceOrdered: string;
    groupBy: string;
    none: string;
    timeWindow: string;
    windowPlaceholder: string;
  };
  mitreSelector: {
    addTechnique: string;
    searchPlaceholder: string;
    noTechniques: string;
    removeAria: (id: string) => string;
  };
  formDialog: {
    editTitle: string;
    createTitle: string;
    ruleName: string;
    ruleNamePlaceholder: string;
    description: string;
    descriptionPlaceholder: string;
    ruleType: string;
    severity: string;
    baseConfidence: string;
    mitreTechniques: string;
    configSuffix: string;
    previewJson: string;
    cancel: string;
    saving: string;
    saveChanges: string;
    createRule: string;
  };
  templateGallery: {
    title: string;
    loadError: string;
    noTemplates: string;
    active: string;
    activate: string;
  };
  testDialog: {
    title: string;
    description: (name: string) => string;
    fallbackRuleName: string;
    eventLimit: string;
    backendHint: (date: string) => string;
    running: string;
    runTest: string;
    results: string;
    matchesFound: (count: number) => string;
    runToPreview: string;
    matchesBadge: (count: number) => string;
    match: (index: number) => string;
    noMatches: string;
    close: string;
  };
}

const rulesLabels: RulesBilingual<RulesLabels> = {
  en: {
    list: {
      eyebrow: 'Cyber Defense',
      title: 'Detection Rules',
      description: 'Manage Sigma, threshold, correlation, and anomaly rules against the live MITRE coverage model.',
      rulesTag: (count) => `${count} rules`,
      activeTag: (count) => `${count} active`,
      templates: 'Templates',
      createRule: 'Create Rule',
      searchPlaceholder: 'Search rules by name or description',
      emptyTitle: 'No detection rules',
      emptyDescription: 'Create a rule or activate a template to start detecting activity.',
      filterType: 'Type',
      filterSeverity: 'Severity',
      filterMitreTactic: 'MITRE Tactic',
      filterStatus: 'Status',
      filterEnabled: 'Enabled',
      filterDisabled: 'Disabled',
      toastStatusUpdated: 'Rule status updated',
      toastDeleted: 'Detection rule deleted',
      copyOf: (name) => `Copy of ${name}`,
    },
    filterOptions: {
      sigma: 'Sigma',
      threshold: 'Threshold',
      correlation: 'Correlation',
      anomaly: 'Anomaly',
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      info: 'Info',
    },
    stats: {
      totalRules: 'Total Rules',
      totalDescription: 'All tenant-scoped detection rules.',
      activeRules: 'Active Rules',
      enabledChange: 'enabled',
      typeMix: 'Type Mix',
      typeMixDescription: 'Sigma / Threshold / Correlation / Anomaly',
      truePositiveRate: 'True Positive Rate',
      truePositiveDescription: (count) => `${count} alerts in the last 30 days`,
    },
    columns: {
      ruleName: 'Rule Name',
      noDescription: 'No description provided.',
      type: 'Type',
      severity: 'Severity',
      mitreTechnique: 'MITRE Technique',
      unmapped: 'Unmapped',
      status: 'Status',
      enabled: 'Enabled',
      disabled: 'Disabled',
      enableRuleAria: 'Enable rule',
      disableRuleAria: 'Disable rule',
      tpFp: 'TP / FP',
      alertsGenerated: 'Alerts Generated',
      lastTriggered: 'Last Triggered',
      never: 'Never',
      ruleActionsAria: 'Rule actions',
      viewDetails: 'View Details',
      edit: 'Edit',
      duplicate: 'Duplicate',
      testRule: 'Test Rule',
      delete: 'Delete',
      deleteTitle: 'Delete detection rule',
      deleteDescription: (name) =>
        `Delete "${name}"? The rule will be soft-deleted and no longer available in the detection engine.`,
      deleteConfirm: 'Delete',
    },
    performanceCard: {
      triggers: (count) => `${count} triggers`,
      fpSuffix: '% FP',
      highFp: 'High FP',
      truePositives: (value) => `True Positives: ${value}`,
      falsePositives: (value) => `False Positives: ${value}`,
      autoDisableRisk: 'Auto-disable risk at current FP rate',
    },
    detail: {
      eyebrow: 'Cyber Defense',
      loadError: 'Unable to load detection rule.',
      enabled: 'Enabled',
      disabled: 'Disabled',
      techniquesTag: (count) => `${count} ATT&CK techniques`,
      description: 'Inspect detection logic, operational performance, and the alerts generated by this rule.',
      editRule: 'Edit Rule',
      testRule: 'Test Rule',
      enable: 'Enable',
      disable: 'Disable',
      delete: 'Delete',
      toastStatusUpdated: 'Rule status updated',
      toastDeleted: 'Detection rule deleted',
      deleteTitle: 'Delete detection rule',
      deleteDescription: (name) =>
        `Delete "${name}"? The rule will be soft-deleted and no longer available in the detection engine.`,
      deleteConfirm: 'Delete',
      tabOverview: 'Overview',
      tabLogic: 'Detection Logic',
      tabPerformance: 'Performance',
      tabAlerts: 'Recent Alerts',
    },
    overview: {
      ruleType: 'Rule Type',
      triggerCount: 'Trigger Count',
      mappedTechniques: 'Mapped Techniques',
      confidence: 'Confidence',
      description: 'Description',
      noDescription: 'No description provided for this rule.',
      created: 'Created',
      lastUpdated: 'Last Updated',
      createdBy: 'Created By',
      lastTriggered: 'Last Triggered',
      unknown: 'Unknown',
      never: 'Never',
      system: 'System',
      mitreMapping: 'MITRE Mapping',
      noTactics: 'No tactics mapped.',
      noTechniques: 'No techniques mapped.',
      tags: 'Tags',
      noTags: 'No tags applied.',
    },
    logic: {
      sigmaYaml: 'Sigma YAML',
      sigmaReadonly: 'Read-only detection definition rendered through the Sigma Monaco editor.',
      rawPayload: 'Raw detection payload',
    },
    performance: {
      triggers: 'Triggers',
      alerts30d: 'Alerts 30d',
      truePositiveRate: 'True Positive Rate',
      falsePositiveRate: 'False Positive Rate',
      alertsSeries: 'Alerts',
      alertTrendTitle: 'Alert Trend (90 days)',
      severityDistribution: 'Alert Severity Distribution',
      alertsCenter: 'Alerts',
      topTriggeredAssets: 'Top Triggered Assets',
    },
    alertsTab: {
      alert: 'Alert',
      severity: 'Severity',
      status: 'Status',
      confidence: 'Confidence',
      asset: 'Asset',
      created: 'Created',
      unknownAsset: 'Unknown asset',
      searchPlaceholder: 'Search related alerts',
      emptyTitle: 'No related alerts',
      emptyDescription: 'This rule has not generated any alerts yet.',
    },
    wizard: {
      editTitle: 'Edit Detection Rule',
      createTitle: 'Create Detection Rule',
      steps: { basics: 'Basics', logic: 'Detection Logic', mitre: 'MITRE Mapping', review: 'Review' },
      stepLabel: (index) => `Step ${index}`,
      ruleName: 'Rule name',
      ruleNamePlaceholder: 'Suspicious PowerShell execution',
      description: 'Description',
      descriptionPlaceholder: 'Explain what the rule detects and why it matters.',
      tags: 'Tags',
      tagsPlaceholder: 'powershell, credential-access, endpoint',
      ruleType: 'Rule type',
      ruleTypeLocked: 'Rule type cannot be changed after creation.',
      severity: 'Severity',
      baseConfidence: 'Base confidence',
      ruleEnabled: 'Rule enabled',
      ruleEnabledHint: 'Inactive rules stay available without generating detections.',
      sigmaYaml: 'Sigma YAML',
      sigmaHint: 'Write a Sigma-style detection block. The wizard validates the YAML before saving.',
      monaco: 'Monaco',
      minFirstEventMatches: 'Minimum first-event matches',
      tactics: 'Tactics',
      tacticsHint: 'Select the ATT&CK tactics this rule is designed to cover.',
      techniques: 'Techniques',
      techniquesHint: 'Choose techniques from the selected tactics.',
      configSummary: 'Configuration summary',
      basics: 'Basics',
      untitledRule: 'Untitled rule',
      noDescription: 'No description provided.',
      type: 'Type',
      severityLabel: 'Severity',
      confidenceLabel: 'Confidence',
      mitreMapping: 'MITRE Mapping',
      noTechniquesSelected: 'No techniques selected.',
      logicPreview: 'Detection logic preview',
      cancel: 'Cancel',
      back: 'Back',
      next: 'Next',
      saving: 'Saving…',
      updateRule: 'Update Rule',
      createRule: 'Create Rule',
      errNameLength: 'Rule name must be at least 3 characters.',
      errInvalidSigma: 'Invalid Sigma YAML',
      errBuildPayload: 'Unable to build rule payload',
      toastUpdated: 'Detection rule updated',
      toastCreated: 'Detection rule created',
    },
    sigmaEditor: {
      selections: 'Selections',
      addSelection: 'Add Selection',
      selection: 'Selection',
      filters: 'Filters (exclusions)',
      addFilter: 'Add Filter',
      filter: 'Filter',
      addCondition: 'Add Condition',
      selectionNamePlaceholder: 'selection_name',
      valuePlaceholder: 'value',
      removeConditionAria: 'Remove condition',
      removeSelectionAria: 'Remove selection',
      conditionExpression: 'Condition Expression',
      conditionTooltip: 'Boolean expression: e.g. (selection_main or selection_alt) and not filter_exclude',
      conditionPlaceholder: 'e.g. selection_main and not filter_exclude',
      timeframeOptional: 'Timeframe (optional)',
      timeframePlaceholder: '5m, 1h, 24h',
      countThresholdOptional: 'Count Threshold (optional)',
      countThresholdPlaceholder: 'e.g. 3',
    },
    thresholdEditor: {
      filterConditions: 'Filter Conditions',
      addCondition: 'Add Condition',
      valuePlaceholder: 'value',
      groupByField: 'Group By Field',
      none: '(none)',
      metric: 'Metric',
      metricField: 'Metric Field',
      selectField: 'Select field',
      thresholdValue: 'Threshold Value',
      thresholdPlaceholder: 'e.g. 5',
      timeWindow: 'Time Window',
      windowPlaceholder: '5m, 1h, 24h',
    },
    anomalyEditor: {
      metric: 'Metric',
      groupByField: 'Group By Field',
      none: '(none)',
      timeWindow: 'Time Window',
      windowPlaceholder: '5m, 1h, 24h',
      zScoreThreshold: 'Z-Score Threshold',
      minBaselineSamples: 'Min Baseline Samples',
      direction: 'Direction',
      directionAbove: 'above (spike)',
      directionBelow: 'below (drop)',
      directionBoth: 'both (any deviation)',
    },
    correlationEditor: {
      eventTypes: 'Event Types',
      addEventType: 'Add Event Type',
      eventNamePlaceholder: 'event_name',
      valuePlaceholder: 'value',
      addCondition: 'Add Condition',
      sequenceOrdered: 'Sequence (ordered)',
      groupBy: 'Group By',
      none: '(none)',
      timeWindow: 'Time Window',
      windowPlaceholder: '5m, 1h, 24h',
    },
    mitreSelector: {
      addTechnique: 'Add MITRE Technique',
      searchPlaceholder: 'Search T1059, PowerShell…',
      noTechniques: 'No techniques found',
      removeAria: (id) => `Remove ${id}`,
    },
    formDialog: {
      editTitle: 'Edit Detection Rule',
      createTitle: 'Create Detection Rule',
      ruleName: 'Rule Name',
      ruleNamePlaceholder: 'Suspicious PowerShell Execution',
      description: 'Description',
      descriptionPlaceholder: 'Describe what this rule detects…',
      ruleType: 'Rule Type',
      severity: 'Severity',
      baseConfidence: 'Base Confidence (0–1)',
      mitreTechniques: 'MITRE Techniques',
      configSuffix: 'Rule Configuration',
      previewJson: 'Preview Rule JSON',
      cancel: 'Cancel',
      saving: 'Saving…',
      saveChanges: 'Save Changes',
      createRule: 'Create Rule',
    },
    templateGallery: {
      title: 'Rule Template Gallery',
      loadError: 'Failed to load templates',
      noTemplates: 'No templates available',
      active: 'Active ✓',
      activate: 'Activate',
    },
    testDialog: {
      title: 'Test Rule',
      description: (name) => `Dry-run ${name} against recent security events.`,
      fallbackRuleName: 'this rule',
      eventLimit: 'Event limit',
      backendHint: (date) => `The backend evaluates the rule against the latest events since ${date}.`,
      running: 'Running…',
      runTest: 'Run Test',
      results: 'Results',
      matchesFound: (count) => `${count} match${count === 1 ? '' : 'es'} found`,
      runToPreview: 'Run the test to preview matches.',
      matchesBadge: (count) => `${count} matches`,
      match: (index) => `Match #${index}`,
      noMatches: 'No matches to preview.',
      close: 'Close',
    },
  },
  ar: {
    list: {
      eyebrow: 'الدفاع السيبراني',
      title: 'قواعد الكشف',
      description: 'أدِر قواعد Sigma والعتبة والارتباط والشذوذ مقابل نموذج تغطية MITRE الحي.',
      rulesTag: (count) => `${count} قاعدة`,
      activeTag: (count) => `${count} نشطة`,
      templates: 'القوالب',
      createRule: 'إنشاء قاعدة',
      searchPlaceholder: 'ابحث في القواعد بالاسم أو الوصف',
      emptyTitle: 'لا توجد قواعد كشف',
      emptyDescription: 'أنشئ قاعدة أو فعّل قالبًا لبدء كشف النشاط.',
      filterType: 'النوع',
      filterSeverity: 'الخطورة',
      filterMitreTactic: 'تكتيك MITRE',
      filterStatus: 'الحالة',
      filterEnabled: 'مفعّلة',
      filterDisabled: 'معطّلة',
      toastStatusUpdated: 'تم تحديث حالة القاعدة',
      toastDeleted: 'تم حذف قاعدة الكشف',
      copyOf: (name) => `نسخة من ${name}`,
    },
    filterOptions: {
      sigma: 'Sigma',
      threshold: 'عتبة',
      correlation: 'ارتباط',
      anomaly: 'شذوذ',
      critical: 'حرج',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      info: 'معلوماتي',
    },
    stats: {
      totalRules: 'إجمالي القواعد',
      totalDescription: 'جميع قواعد الكشف ضمن نطاق المستأجر.',
      activeRules: 'القواعد النشطة',
      enabledChange: 'مفعّلة',
      typeMix: 'مزيج الأنواع',
      typeMixDescription: 'Sigma / عتبة / ارتباط / شذوذ',
      truePositiveRate: 'معدل الإيجابيات الصحيحة',
      truePositiveDescription: (count) => `${count} تنبيه خلال آخر 30 يومًا`,
    },
    columns: {
      ruleName: 'اسم القاعدة',
      noDescription: 'لا يوجد وصف.',
      type: 'النوع',
      severity: 'الخطورة',
      mitreTechnique: 'تقنية MITRE',
      unmapped: 'غير مرتبطة',
      status: 'الحالة',
      enabled: 'مفعّلة',
      disabled: 'معطّلة',
      enableRuleAria: 'تفعيل القاعدة',
      disableRuleAria: 'تعطيل القاعدة',
      tpFp: 'إيجابي صحيح / إيجابي خاطئ',
      alertsGenerated: 'التنبيهات المُولَّدة',
      lastTriggered: 'آخر تشغيل',
      never: 'مطلقًا',
      ruleActionsAria: 'إجراءات القاعدة',
      viewDetails: 'عرض التفاصيل',
      edit: 'تعديل',
      duplicate: 'تكرار',
      testRule: 'اختبار القاعدة',
      delete: 'حذف',
      deleteTitle: 'حذف قاعدة الكشف',
      deleteDescription: (name) =>
        `حذف "${name}"؟ سيتم حذف القاعدة حذفًا ناعمًا ولن تعود متاحة في محرك الكشف.`,
      deleteConfirm: 'حذف',
    },
    performanceCard: {
      triggers: (count) => `${count} تشغيل`,
      fpSuffix: '% إيجابي خاطئ',
      highFp: 'إيجابيات خاطئة مرتفعة',
      truePositives: (value) => `الإيجابيات الصحيحة: ${value}`,
      falsePositives: (value) => `الإيجابيات الخاطئة: ${value}`,
      autoDisableRisk: 'خطر التعطيل التلقائي عند معدل الإيجابيات الخاطئة الحالي',
    },
    detail: {
      eyebrow: 'الدفاع السيبراني',
      loadError: 'تعذّر تحميل قاعدة الكشف.',
      enabled: 'مفعّلة',
      disabled: 'معطّلة',
      techniquesTag: (count) => `${count} تقنية ATT&CK`,
      description: 'افحص منطق الكشف والأداء التشغيلي والتنبيهات التي ولّدتها هذه القاعدة.',
      editRule: 'تعديل القاعدة',
      testRule: 'اختبار القاعدة',
      enable: 'تفعيل',
      disable: 'تعطيل',
      delete: 'حذف',
      toastStatusUpdated: 'تم تحديث حالة القاعدة',
      toastDeleted: 'تم حذف قاعدة الكشف',
      deleteTitle: 'حذف قاعدة الكشف',
      deleteDescription: (name) =>
        `حذف "${name}"؟ سيتم حذف القاعدة حذفًا ناعمًا ولن تعود متاحة في محرك الكشف.`,
      deleteConfirm: 'حذف',
      tabOverview: 'نظرة عامة',
      tabLogic: 'منطق الكشف',
      tabPerformance: 'الأداء',
      tabAlerts: 'التنبيهات الأحدث',
    },
    overview: {
      ruleType: 'نوع القاعدة',
      triggerCount: 'عدد مرات التشغيل',
      mappedTechniques: 'التقنيات المرتبطة',
      confidence: 'الثقة',
      description: 'الوصف',
      noDescription: 'لا يوجد وصف لهذه القاعدة.',
      created: 'أُنشئ في',
      lastUpdated: 'آخر تحديث',
      createdBy: 'أنشأها',
      lastTriggered: 'آخر تشغيل',
      unknown: 'غير معروف',
      never: 'مطلقًا',
      system: 'النظام',
      mitreMapping: 'ربط MITRE',
      noTactics: 'لا توجد تكتيكات مرتبطة.',
      noTechniques: 'لا توجد تقنيات مرتبطة.',
      tags: 'الوسوم',
      noTags: 'لا توجد وسوم مطبّقة.',
    },
    logic: {
      sigmaYaml: 'Sigma YAML',
      sigmaReadonly: 'تعريف كشف للقراءة فقط معروض عبر محرر Sigma Monaco.',
      rawPayload: 'حمولة الكشف الخام',
    },
    performance: {
      triggers: 'مرات التشغيل',
      alerts30d: 'تنبيهات 30 يومًا',
      truePositiveRate: 'معدل الإيجابيات الصحيحة',
      falsePositiveRate: 'معدل الإيجابيات الخاطئة',
      alertsSeries: 'التنبيهات',
      alertTrendTitle: 'اتجاه التنبيهات (90 يومًا)',
      severityDistribution: 'توزيع خطورة التنبيهات',
      alertsCenter: 'التنبيهات',
      topTriggeredAssets: 'أكثر الأصول استهدافًا',
    },
    alertsTab: {
      alert: 'التنبيه',
      severity: 'الخطورة',
      status: 'الحالة',
      confidence: 'الثقة',
      asset: 'الأصل',
      created: 'أُنشئ في',
      unknownAsset: 'أصل غير معروف',
      searchPlaceholder: 'ابحث في التنبيهات ذات الصلة',
      emptyTitle: 'لا توجد تنبيهات ذات صلة',
      emptyDescription: 'لم تولّد هذه القاعدة أي تنبيهات بعد.',
    },
    wizard: {
      editTitle: 'تعديل قاعدة الكشف',
      createTitle: 'إنشاء قاعدة الكشف',
      steps: { basics: 'الأساسيات', logic: 'منطق الكشف', mitre: 'ربط MITRE', review: 'المراجعة' },
      stepLabel: (index) => `الخطوة ${index}`,
      ruleName: 'اسم القاعدة',
      ruleNamePlaceholder: 'تنفيذ PowerShell مشبوه',
      description: 'الوصف',
      descriptionPlaceholder: 'اشرح ما تكشفه القاعدة ولماذا يهم ذلك.',
      tags: 'الوسوم',
      tagsPlaceholder: 'powershell, credential-access, endpoint',
      ruleType: 'نوع القاعدة',
      ruleTypeLocked: 'لا يمكن تغيير نوع القاعدة بعد إنشائها.',
      severity: 'الخطورة',
      baseConfidence: 'الثقة الأساسية',
      ruleEnabled: 'القاعدة مفعّلة',
      ruleEnabledHint: 'تبقى القواعد غير النشطة متاحة دون توليد عمليات كشف.',
      sigmaYaml: 'Sigma YAML',
      sigmaHint: 'اكتب كتلة كشف بأسلوب Sigma. يتحقق المعالج من صحة YAML قبل الحفظ.',
      monaco: 'Monaco',
      minFirstEventMatches: 'الحد الأدنى لمطابقات الحدث الأول',
      tactics: 'التكتيكات',
      tacticsHint: 'اختر تكتيكات ATT&CK التي صُمِّمت هذه القاعدة لتغطيتها.',
      techniques: 'التقنيات',
      techniquesHint: 'اختر تقنيات من التكتيكات المحددة.',
      configSummary: 'ملخص الإعداد',
      basics: 'الأساسيات',
      untitledRule: 'قاعدة بلا عنوان',
      noDescription: 'لا يوجد وصف.',
      type: 'النوع',
      severityLabel: 'الخطورة',
      confidenceLabel: 'الثقة',
      mitreMapping: 'ربط MITRE',
      noTechniquesSelected: 'لم يتم اختيار تقنيات.',
      logicPreview: 'معاينة منطق الكشف',
      cancel: 'إلغاء',
      back: 'رجوع',
      next: 'التالي',
      saving: 'جارٍ الحفظ…',
      updateRule: 'تحديث القاعدة',
      createRule: 'إنشاء القاعدة',
      errNameLength: 'يجب ألا يقل اسم القاعدة عن 3 أحرف.',
      errInvalidSigma: 'صيغة Sigma YAML غير صالحة',
      errBuildPayload: 'تعذّر بناء حمولة القاعدة',
      toastUpdated: 'تم تحديث قاعدة الكشف',
      toastCreated: 'تم إنشاء قاعدة الكشف',
    },
    sigmaEditor: {
      selections: 'التحديدات',
      addSelection: 'إضافة تحديد',
      selection: 'تحديد',
      filters: 'المرشّحات (الاستثناءات)',
      addFilter: 'إضافة مرشّح',
      filter: 'مرشّح',
      addCondition: 'إضافة شرط',
      selectionNamePlaceholder: 'selection_name',
      valuePlaceholder: 'القيمة',
      removeConditionAria: 'إزالة الشرط',
      removeSelectionAria: 'إزالة التحديد',
      conditionExpression: 'تعبير الشرط',
      conditionTooltip: 'تعبير منطقي: مثال (selection_main or selection_alt) and not filter_exclude',
      conditionPlaceholder: 'مثال selection_main and not filter_exclude',
      timeframeOptional: 'الإطار الزمني (اختياري)',
      timeframePlaceholder: '5m، 1h، 24h',
      countThresholdOptional: 'عتبة العدد (اختياري)',
      countThresholdPlaceholder: 'مثال 3',
    },
    thresholdEditor: {
      filterConditions: 'شروط التصفية',
      addCondition: 'إضافة شرط',
      valuePlaceholder: 'القيمة',
      groupByField: 'التجميع حسب الحقل',
      none: '(بلا)',
      metric: 'المقياس',
      metricField: 'حقل المقياس',
      selectField: 'اختر الحقل',
      thresholdValue: 'قيمة العتبة',
      thresholdPlaceholder: 'مثال 5',
      timeWindow: 'النافذة الزمنية',
      windowPlaceholder: '5m، 1h، 24h',
    },
    anomalyEditor: {
      metric: 'المقياس',
      groupByField: 'التجميع حسب الحقل',
      none: '(بلا)',
      timeWindow: 'النافذة الزمنية',
      windowPlaceholder: '5m، 1h، 24h',
      zScoreThreshold: 'عتبة درجة Z',
      minBaselineSamples: 'الحد الأدنى لعينات الأساس',
      direction: 'الاتجاه',
      directionAbove: 'أعلى (ارتفاع مفاجئ)',
      directionBelow: 'أدنى (انخفاض)',
      directionBoth: 'كلاهما (أي انحراف)',
    },
    correlationEditor: {
      eventTypes: 'أنواع الأحداث',
      addEventType: 'إضافة نوع حدث',
      eventNamePlaceholder: 'event_name',
      valuePlaceholder: 'القيمة',
      addCondition: 'إضافة شرط',
      sequenceOrdered: 'التسلسل (مرتَّب)',
      groupBy: 'التجميع حسب',
      none: '(بلا)',
      timeWindow: 'النافذة الزمنية',
      windowPlaceholder: '5m، 1h، 24h',
    },
    mitreSelector: {
      addTechnique: 'إضافة تقنية MITRE',
      searchPlaceholder: 'ابحث T1059، PowerShell…',
      noTechniques: 'لم يُعثر على تقنيات',
      removeAria: (id) => `إزالة ${id}`,
    },
    formDialog: {
      editTitle: 'تعديل قاعدة الكشف',
      createTitle: 'إنشاء قاعدة الكشف',
      ruleName: 'اسم القاعدة',
      ruleNamePlaceholder: 'تنفيذ PowerShell مشبوه',
      description: 'الوصف',
      descriptionPlaceholder: 'صِف ما تكشفه هذه القاعدة…',
      ruleType: 'نوع القاعدة',
      severity: 'الخطورة',
      baseConfidence: 'الثقة الأساسية (0–1)',
      mitreTechniques: 'تقنيات MITRE',
      configSuffix: 'إعداد القاعدة',
      previewJson: 'معاينة JSON للقاعدة',
      cancel: 'إلغاء',
      saving: 'جارٍ الحفظ…',
      saveChanges: 'حفظ التغييرات',
      createRule: 'إنشاء القاعدة',
    },
    templateGallery: {
      title: 'معرض قوالب القواعد',
      loadError: 'تعذّر تحميل القوالب',
      noTemplates: 'لا توجد قوالب متاحة',
      active: 'نشط ✓',
      activate: 'تفعيل',
    },
    testDialog: {
      title: 'اختبار القاعدة',
      description: (name) => `تشغيل تجريبي لـ ${name} مقابل الأحداث الأمنية الأخيرة.`,
      fallbackRuleName: 'هذه القاعدة',
      eventLimit: 'حد الأحداث',
      backendHint: (date) => `تقيّم الخدمة الخلفية القاعدة مقابل أحدث الأحداث منذ ${date}.`,
      running: 'جارٍ التشغيل…',
      runTest: 'تشغيل الاختبار',
      results: 'النتائج',
      matchesFound: (count) => `${count} مطابقة`,
      runToPreview: 'شغّل الاختبار لمعاينة المطابقات.',
      matchesBadge: (count) => `${count} مطابقة`,
      match: (index) => `مطابقة رقم ${index}`,
      noMatches: 'لا توجد مطابقات للمعاينة.',
      close: 'إغلاق',
    },
  },
};

export function useRulesLabels(): RulesLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveRulesBilingual(rulesLabels, locale), [locale]);
}

export type { RulesLabels };
