import type { AppLocale } from '@/lib/i18n';
import type {
  AIArtifactType,
  AIDriftLevel,
  AIExplainabilityType,
  AIModelStatus,
  AIModelSuite,
  AIModelType,
  AIRiskTier,
  AIValidationDatasetType,
  AIValidationRecommendation,
  AIVersionStatus,
  ComputeBackendType,
  InferenceServerStatus,
} from '@/types/ai-governance';

type LocaleKey = 'en' | 'ar';

type EnumLabelMap<T extends string> = Record<LocaleKey, Record<T, string>>;

type ValidationMetricKey = 'precision' | 'recall' | 'f1Score' | 'falsePositiveRate';

function localeKey(locale: AppLocale): LocaleKey {
  return locale === 'ar' ? 'ar' : 'en';
}

function fallbackLabel(value: string | null | undefined) {
  return value?.replaceAll('_', ' ') ?? '';
}

function labelFromMap<T extends string>(
  value: T | string | null | undefined,
  locale: AppLocale,
  labels: EnumLabelMap<T>,
) {
  if (!value) {
    return '';
  }
  return labels[localeKey(locale)][value as T] ?? fallbackLabel(value);
}

const modelTypeLabels: EnumLabelMap<AIModelType> = {
  en: {
    rule_based: 'Rule-based',
    statistical: 'Statistical',
    ml_classifier: 'ML classifier',
    ml_regressor: 'ML regressor',
    nlp_extractor: 'NLP extractor',
    anomaly_detector: 'Anomaly detector',
    scorer: 'Scorer',
    recommender: 'Recommender',
    llm_agentic: 'LLM agentic',
  },
  ar: {
    rule_based: 'قائم على القواعد',
    statistical: 'إحصائي',
    ml_classifier: 'مصنّف ML',
    ml_regressor: 'انحدار ML',
    nlp_extractor: 'مستخرج NLP',
    anomaly_detector: 'كاشف الشذوذ',
    scorer: 'مُسجّل نقاط',
    recommender: 'مُوصي',
    llm_agentic: 'وكيل LLM',
  },
};

const modelSuiteLabels: EnumLabelMap<AIModelSuite> = {
  en: {
    cyber: 'Cyber',
    data: 'Data',
    acta: 'Acta',
    lex: 'Lex',
    visus: 'Visus',
    platform: 'Platform',
  },
  ar: {
    cyber: 'Cyber',
    data: 'Data',
    acta: 'Acta',
    lex: 'Lex',
    visus: 'Visus',
    platform: 'Platform',
  },
};

const riskTierLabels: EnumLabelMap<AIRiskTier> = {
  en: {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    critical: 'Critical',
  },
  ar: {
    low: 'منخفض',
    medium: 'متوسط',
    high: 'عالٍ',
    critical: 'حرج',
  },
};

const modelStatusLabels: EnumLabelMap<AIModelStatus> = {
  en: {
    active: 'Active',
    deprecated: 'Deprecated',
    retired: 'Retired',
  },
  ar: {
    active: 'نشط',
    deprecated: 'مهمل',
    retired: 'مسحوب',
  },
};

const driftLevelLabels: EnumLabelMap<AIDriftLevel> = {
  en: {
    none: 'None',
    low: 'Low',
    moderate: 'Moderate',
    significant: 'Significant',
  },
  ar: {
    none: 'لا يوجد',
    low: 'منخفض',
    moderate: 'متوسط',
    significant: 'كبير',
  },
};

const versionStatusLabels: EnumLabelMap<AIVersionStatus | 'unknown'> = {
  en: {
    development: 'Development',
    staging: 'Staging',
    shadow: 'Shadow',
    production: 'Production',
    retired: 'Retired',
    failed: 'Failed',
    rolled_back: 'Rolled back',
    unknown: 'Unknown',
  },
  ar: {
    development: 'التطوير',
    staging: 'التهيئة',
    shadow: 'الظل',
    production: 'الإنتاج',
    retired: 'مسحوب',
    failed: 'فاشل',
    rolled_back: 'تم التراجع عنه',
    unknown: 'غير معروف',
  },
};

const artifactTypeLabels: EnumLabelMap<AIArtifactType> = {
  en: {
    go_function: 'Go function',
    rule_set: 'Rule set',
    statistical_config: 'Statistical config',
    template_config: 'Template config',
    serialized_model: 'Serialized model',
    gguf_model: 'GGUF model',
    bitnet_model: 'BitNet model',
    onnx_model: 'ONNX model',
  },
  ar: {
    go_function: 'دالة Go',
    rule_set: 'مجموعة قواعد',
    statistical_config: 'إعداد إحصائي',
    template_config: 'إعداد قالب',
    serialized_model: 'نموذج مُسلسل',
    gguf_model: 'نموذج GGUF',
    bitnet_model: 'نموذج BitNet',
    onnx_model: 'نموذج ONNX',
  },
};

const explainabilityTypeLabels: EnumLabelMap<AIExplainabilityType> = {
  en: {
    rule_trace: 'Rule trace',
    feature_importance: 'Feature importance',
    statistical_deviation: 'Statistical deviation',
    template_based: 'Template-based',
    reasoning_trace: 'Reasoning trace',
  },
  ar: {
    rule_trace: 'تتبّع القاعدة',
    feature_importance: 'أهمية السمة',
    statistical_deviation: 'انحراف إحصائي',
    template_based: 'قائم على قالب',
    reasoning_trace: 'تتبّع الاستدلال',
  },
};

const computeBackendLabels: EnumLabelMap<ComputeBackendType> = {
  en: {
    inline_go: 'Inline Go',
    vllm_gpu: 'vLLM GPU',
    vllm_cpu: 'vLLM CPU',
    llamacpp_cpu: 'llama.cpp CPU',
    llamacpp_gpu: 'llama.cpp GPU',
    bitnet_cpu: 'BitNet CPU',
    onnx_cpu: 'ONNX CPU',
    onnx_gpu: 'ONNX GPU',
  },
  ar: {
    inline_go: 'Go مضمّن',
    vllm_gpu: 'vLLM GPU',
    vllm_cpu: 'vLLM CPU',
    llamacpp_cpu: 'llama.cpp CPU',
    llamacpp_gpu: 'llama.cpp GPU',
    bitnet_cpu: 'BitNet CPU',
    onnx_cpu: 'ONNX CPU',
    onnx_gpu: 'ONNX GPU',
  },
};

const inferenceServerStatusLabels: EnumLabelMap<InferenceServerStatus> = {
  en: {
    provisioning: 'Provisioning',
    healthy: 'Healthy',
    degraded: 'Degraded',
    offline: 'Offline',
    decommissioned: 'Decommissioned',
  },
  ar: {
    provisioning: 'قيد التجهيز',
    healthy: 'سليم',
    degraded: 'متدهور',
    offline: 'غير متصل',
    decommissioned: 'موقوف',
  },
};

const validationDatasetTypeLabels: EnumLabelMap<AIValidationDatasetType> = {
  en: {
    historical: 'Historical',
    custom: 'Custom',
    live_replay: 'Live replay',
  },
  ar: {
    historical: 'تاريخي',
    custom: 'مخصص',
    live_replay: 'إعادة عرض مباشرة',
  },
};

const validationRecommendationLabels: EnumLabelMap<AIValidationRecommendation> = {
  en: {
    promote: 'Promote',
    keep_testing: 'Keep testing',
    reject: 'Reject',
  },
  ar: {
    promote: 'ترقية',
    keep_testing: 'مواصلة الاختبار',
    reject: 'رفض',
  },
};

const validationMetricLabels: Record<LocaleKey, Record<ValidationMetricKey, string>> = {
  en: {
    precision: 'Precision',
    recall: 'Recall',
    f1Score: 'F1 Score',
    falsePositiveRate: 'FP Rate',
  },
  ar: {
    precision: 'الإحكام',
    recall: 'الاستدعاء',
    f1Score: 'مقياس F1',
    falsePositiveRate: 'معدل FP',
  },
};

export function modelTypeLabel(value: AIModelType | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, modelTypeLabels);
}

export function modelSuiteLabel(value: AIModelSuite | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, modelSuiteLabels);
}

export function riskTierLabel(value: AIRiskTier | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, riskTierLabels);
}

export function modelStatusLabel(value: AIModelStatus | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, modelStatusLabels);
}

export function driftLevelLabel(value: AIDriftLevel | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, driftLevelLabels);
}

export function versionStatusLabel(value: AIVersionStatus | 'unknown' | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, versionStatusLabels);
}

export function artifactTypeLabel(value: AIArtifactType | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, artifactTypeLabels);
}

export function explainabilityTypeLabel(value: AIExplainabilityType | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, explainabilityTypeLabels);
}

export function computeBackendLabel(value: ComputeBackendType | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, computeBackendLabels);
}

export function inferenceServerStatusLabel(value: InferenceServerStatus | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, inferenceServerStatusLabels);
}

export function validationDatasetTypeLabel(value: AIValidationDatasetType | string | null | undefined, locale: AppLocale) {
  return labelFromMap(value, locale, validationDatasetTypeLabels);
}

export function validationRecommendationLabel(
  value: AIValidationRecommendation | string | null | undefined,
  locale: AppLocale,
) {
  return labelFromMap(value, locale, validationRecommendationLabels);
}

export function validationMetricLabel(value: ValidationMetricKey, locale: AppLocale) {
  return validationMetricLabels[localeKey(locale)][value];
}

export function validationCopy(locale: AppLocale) {
  if (localeKey(locale) === 'ar') {
    return {
      fallbackModel: 'النموذج',
      customDataArray: 'يجب أن تكون البيانات المخصصة مصفوفة JSON.',
      rowInputHash: (row: number) => `يجب أن يتضمن الصف ${row} قيمة غير فارغة للحقل input_hash.`,
      rowExpectedLabel: (row: number) =>
        `يجب أن تكون قيمة expected_label في الصف ${row} إما "threat" أو "benign".`,
      invalidJson: 'JSON غير صالح.',
      selectVersionForValidation: 'اختر إصدار نموذج قبل تشغيل التحقق.',
      liveReplayUnavailable:
        'إعادة العرض المباشر غير متاحة في هذا النشر لأن تشغيل إعادة العرض لإصدارات النماذج غير مهيأ.',
      provideCustomData: 'وفّر بيانات مخصصة موسومة قبل تشغيل التحقق.',
      previewLoading: 'ما زالت معاينة مجموعة البيانات قيد التحميل.',
      previewUnavailable: 'معاينة مجموعة البيانات غير متاحة بعد.',
      insufficientData: 'البيانات الموسومة غير كافية. يلزم 50 عينة على الأقل.',
      selectVersionForRejection: 'اختر إصدار نموذج قبل رفضه.',
      productionRejectBlocked: 'يجب التراجع عن إصدارات الإنتاج أو سحبها بدلًا من تحديدها كفاشلة.',
      alreadyFailed: 'هذا الإصدار محدد كفاشل بالفعل.',
      alreadyStatus: (status: string) => `هذا الإصدار في حالة ${status} بالفعل.`,
      selectVersionForPromotion: 'اختر إصدار نموذج قبل ترقيته.',
      runValidationBeforePromotion: 'شغّل التحقق قبل الترقية إلى وضع الظل.',
      promoteRecommendationRequired: 'لا يمكن نقل إلا الإصدارات ذات توصية الترقية إلى وضع الظل.',
      alreadyShadow: 'هذا الإصدار يعمل بالفعل في وضع الظل.',
      alreadyProduction: 'هذا الإصدار في الإنتاج بالفعل.',
      statusCannotEnterShadow: (status: string) => `لا يمكن للإصدارات في حالة ${status} الدخول إلى وضع الظل.`,
      validationCompletedDetail: (model: string, version: string | number) =>
        `تتوفر الآن نتائج تحقق جديدة لـ ${model} v${version}.`,
      shadowStartedDetail: 'الإصدار المتحقق منه يعمل الآن في وضع الظل.',
      versionFailedDetail: 'تم تحديث حالة الإصدار وحفظ ملاحظات الرفض.',
      shadowPromotionPrefix: 'ترقية الظل:',
      rejectionFlowPrefix: 'مسار الرفض:',
      previousComparison: (date: string) => `تجري المقارنة مع تحقق مسجّل في ${date}.`,
    };
  }

  return {
    fallbackModel: 'Model',
    customDataArray: 'Custom data must be a JSON array.',
    rowInputHash: (row: number) => `Row ${row} must include a non-empty input_hash.`,
    rowExpectedLabel: (row: number) => `Row ${row} expected_label must be "threat" or "benign".`,
    invalidJson: 'Invalid JSON.',
    selectVersionForValidation: 'Select a model version before running validation.',
    liveReplayUnavailable:
      'Live replay is unavailable in the current deployment because model-version replay execution is not configured.',
    provideCustomData: 'Provide custom labeled data before running validation.',
    previewLoading: 'Dataset preview is still loading.',
    previewUnavailable: 'Dataset preview is not available yet.',
    insufficientData: 'Insufficient labeled data. Need at least 50 samples.',
    selectVersionForRejection: 'Select a model version before rejecting it.',
    productionRejectBlocked: 'Production versions must be rolled back or retired instead of marked failed.',
    alreadyFailed: 'This version is already marked failed.',
    alreadyStatus: (status: string) => `This version is already ${status}.`,
    selectVersionForPromotion: 'Select a model version before promoting it.',
    runValidationBeforePromotion: 'Run validation before promoting to shadow mode.',
    promoteRecommendationRequired: 'Only versions with a promote recommendation can move into shadow mode.',
    alreadyShadow: 'This version is already running in shadow mode.',
    alreadyProduction: 'This version is already in production.',
    statusCannotEnterShadow: (status: string) => `Versions in ${status} state cannot enter shadow mode.`,
    validationCompletedDetail: (model: string, version: string | number) =>
      `${model} v${version} has new validation results.`,
    shadowStartedDetail: 'The validated version is now running in shadow mode.',
    versionFailedDetail: 'The version status has been updated and the rejection notes were saved.',
    shadowPromotionPrefix: 'Shadow promotion:',
    rejectionFlowPrefix: 'Rejection flow:',
    previousComparison: (date: string) => `Comparing against validation from ${date}.`,
  };
}
