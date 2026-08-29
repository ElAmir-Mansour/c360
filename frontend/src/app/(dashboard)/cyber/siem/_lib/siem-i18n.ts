/**
 * Bilingual (English + Modern Standard Arabic) label bundle for the Clario360
 * Cyber *SIEM Operations* console (`/cyber/siem`).
 *
 * Follows the shared cyber/onboarding i18n contract: a single typed shape
 * `SiemLabels`, two FULL same-shaped copies `{ en, ar }` (`ar` typed as
 * `typeof en` for compile-time key parity), a module-scope
 * {@link registerMessages}('cyber-siem', ...) call, and a thin
 * {@link useSiemLabels} hook that resolves against the active locale (falling
 * back to English when no LocaleProvider is mounted). The `en` side equals the
 * pre-existing English strings VERBATIM so the no-provider fallback is a no-op.
 *
 * Acronyms stay verbatim in Latin and are glossed once per surface: SIEM, EPS,
 * ECS, HSM, CI, JSON. Numeric values keep Western digits.
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 */

'use client';

import { useBilingual } from '@/components/providers/locale-provider';
import { registerMessages } from '@/lib/i18n/registry';

export interface SiemLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
  };
  stats: {
    sources: string;
    sourcesHelper: (count: number) => string;
    expectedEps: string;
    expectedEpsHelper: string;
    parsers: string;
    parsersHelper: (count: number) => string;
    runtime: string;
    runtimeLoading: string;
    runtimeOnline: string;
    metaLoading: string;
    metaUnknown: string;
  };
  tabs: {
    sources: string;
    parsers: string;
    settings: string;
  };
  source: {
    onboardTitle: string;
    onboardDescription: string;
    name: string;
    type: string;
    transport: string;
    expectedEps: string;
    address: string;
    timezone: string;
    tags: string;
    tagsDescription: string;
    addTag: string;
    submitIdle: string;
    fleetTitle: string;
    fleetDescription: string;
    emptyTitle: string;
    emptyDescription: string;
    noAddress: string;
    health: string;
    enable: string;
    disable: string;
    rotateCert: string;
    onboardedToast: string;
    updatedToast: string;
    tokenRotatedToast: string;
    disableReason: string;
    tokenTitle: string;
    tokenDescription: string;
    tokenExpires: (when: string) => string;
    healthTitle: string;
    healthDescription: string;
    healthStatus: string;
    healthEps: string;
    healthBaseline: (value: number) => string;
    healthParserErrors: string;
    healthLastHour: string;
    healthCertExpiry: string;
    healthCertExpiryValue: (days: number) => string;
    healthDaysRemaining: string;
  };
  parser: {
    createTitle: string;
    createDescription: string;
    name: string;
    sourceType: string;
    version: string;
    ecsVersion: string;
    config: string;
    configDescription: string;
    fixtures: string;
    fixturesDescription: string;
    submitIdle: string;
    registryTitle: string;
    registryDescription: string;
    emptyTitle: string;
    emptyDescription: string;
    versionLine: (version: string, ecs: string) => string;
    promote: string;
    retire: string;
    createdToast: string;
    lifecycleToast: string;
  };
  settings: {
    title: string;
    description: string;
    retentionDays: string;
    warmTierDays: string;
    parserCiRequired: string;
    hsmRequired: string;
    coldTierEnabled: string;
    submitIdle: string;
    savedToast: string;
  };
  validation: {
    nameRequired: string;
    typeRequired: string;
    addressRequired: string;
    enterNumber: string;
    wholeNumber: string;
    minZero: string;
    timezoneRequired: string;
    sourceTypeRequired: string;
    versionRequired: string;
    ecsVersionRequired: string;
    minOne: string;
    jsonObject: string;
    invalidJson: string;
  };
  fields: {
    format: string;
    keyPlaceholder: string;
    valuePlaceholder: string;
    removeEntry: string;
  };
}

// AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
const siemLabels: { readonly en: SiemLabels; readonly ar: SiemLabels } = {
  en: {
    page: {
      eyebrow: 'Security operations',
      title: 'SIEM Operations',
      description: 'Onboard log sources, manage parser lifecycle, and tune tenant-level SIEM controls.',
    },
    stats: {
      sources: 'Sources',
      sourcesHelper: (count) => `${count} active`,
      expectedEps: 'Expected EPS',
      expectedEpsHelper: 'Declared source throughput',
      parsers: 'Parsers',
      parsersHelper: (count) => `${count} active`,
      runtime: 'Runtime',
      runtimeLoading: 'Loading',
      runtimeOnline: 'Online',
      metaLoading: 'SIEM service metadata is loading.',
      metaUnknown: 'unknown',
    },
    tabs: {
      sources: 'Sources',
      parsers: 'Parsers',
      settings: 'Settings',
    },
    source: {
      onboardTitle: 'Onboard Source',
      onboardDescription: 'Create a source and capture the enrollment token immediately.',
      name: 'Name',
      type: 'Type',
      transport: 'Transport',
      expectedEps: 'Expected EPS',
      address: 'Address',
      timezone: 'Timezone',
      tags: 'Tags',
      tagsDescription: 'Key/value labels attached to ingested events.',
      addTag: 'Add tag',
      submitIdle: 'Onboard source',
      fleetTitle: 'Source Fleet',
      fleetDescription: 'Health and certificate controls use source version preconditions.',
      emptyTitle: 'No sources onboarded',
      emptyDescription: 'Onboard a log source to begin ingesting and normalizing events.',
      noAddress: 'No address',
      health: 'Health',
      enable: 'Enable',
      disable: 'Disable',
      rotateCert: 'Rotate cert',
      onboardedToast: 'SIEM source onboarded',
      updatedToast: 'Source updated',
      tokenRotatedToast: 'Enrollment token rotated',
      disableReason: 'Disabled from SIEM operations console',
      tokenTitle: 'Enrollment Token',
      tokenDescription: 'Copy this value into the collector enrollment step. It is only shown after creation or rotation.',
      tokenExpires: (when) => `expires ${when}`,
      healthTitle: 'Source Health',
      healthDescription: 'Latest collector heartbeat, parser errors, and drift indicators.',
      healthStatus: 'Status',
      healthEps: 'EPS 1m / 5m',
      healthBaseline: (value) => `Baseline ${value}`,
      healthParserErrors: 'Parser errors',
      healthLastHour: 'Last hour',
      healthCertExpiry: 'Cert expiry',
      healthCertExpiryValue: (days) => `${days}d`,
      healthDaysRemaining: 'Days remaining',
    },
    parser: {
      createTitle: 'Create Parser',
      createDescription: 'Register tenant parser definitions and fixtures for CI promotion.',
      name: 'Name',
      sourceType: 'Source type',
      version: 'Version',
      ecsVersion: 'ECS version',
      config: 'Config',
      configDescription: 'Parser definition as a JSON object.',
      fixtures: 'Fixtures',
      fixturesDescription: 'Sample events for CI validation, as a JSON object.',
      submitIdle: 'Create parser',
      registryTitle: 'Parser Registry',
      registryDescription: 'Promote draft parsers after fixtures pass, or retire superseded definitions.',
      emptyTitle: 'No parsers defined',
      emptyDescription: 'Create a parser definition to normalize source events into ECS fields.',
      versionLine: (version, ecs) => `Version ${version} · ECS ${ecs}`,
      promote: 'Promote',
      retire: 'Retire',
      createdToast: 'Parser created',
      lifecycleToast: 'Parser lifecycle updated',
    },
    settings: {
      title: 'Tenant SIEM Settings',
      description: 'Retention, parser CI, HSM, and warm/cold tier controls.',
      retentionDays: 'Retention days',
      warmTierDays: 'Warm tier days',
      parserCiRequired: 'Parser CI required',
      hsmRequired: 'HSM required',
      coldTierEnabled: 'Cold tier enabled',
      submitIdle: 'Save settings',
      savedToast: 'SIEM settings updated',
    },
    validation: {
      nameRequired: 'Name is required',
      typeRequired: 'Type is required',
      addressRequired: 'Address is required',
      enterNumber: 'Enter a number',
      wholeNumber: 'Whole number',
      minZero: 'Must be ≥ 0',
      timezoneRequired: 'Timezone is required',
      sourceTypeRequired: 'Source type is required',
      versionRequired: 'Version is required',
      ecsVersionRequired: 'ECS version is required',
      minOne: 'Must be ≥ 1',
      jsonObject: 'Must be a JSON object',
      invalidJson: 'Invalid JSON',
    },
    fields: {
      format: 'Format',
      keyPlaceholder: 'key',
      valuePlaceholder: 'value',
      removeEntry: 'Remove entry',
    },
  },
  ar: {
    page: {
      eyebrow: 'العمليات الأمنية',
      title: 'عمليات SIEM',
      description:
        'ألحِق مصادر السجلّات، وأدِر دورة حياة المُحلِّلات، واضبط عناصر تحكّم SIEM على مستوى المستأجر.',
    },
    stats: {
      sources: 'المصادر',
      sourcesHelper: (count) => `${count} نشط`,
      expectedEps: 'EPS المتوقّع',
      expectedEpsHelper: 'الإنتاجية المُعلَنة للمصدر',
      parsers: 'المُحلِّلات',
      parsersHelper: (count) => `${count} نشط`,
      runtime: 'بيئة التشغيل',
      runtimeLoading: 'جارٍ التحميل',
      runtimeOnline: 'متصل',
      metaLoading: 'جارٍ تحميل البيانات الوصفية لخدمة SIEM.',
      metaUnknown: 'غير معروف',
    },
    tabs: {
      sources: 'المصادر',
      parsers: 'المُحلِّلات',
      settings: 'الإعدادات',
    },
    source: {
      onboardTitle: 'إلحاق مصدر',
      onboardDescription: 'أنشئ مصدرًا واحفظ رمز التسجيل فورًا.',
      name: 'الاسم',
      type: 'النوع',
      transport: 'النقل',
      expectedEps: 'EPS المتوقّع',
      address: 'العنوان',
      timezone: 'المنطقة الزمنية',
      tags: 'الوسوم',
      tagsDescription: 'تسميات مفتاح/قيمة تُرفَق بالأحداث المُستوعَبة.',
      addTag: 'إضافة وسم',
      submitIdle: 'إلحاق المصدر',
      fleetTitle: 'أسطول المصادر',
      fleetDescription: 'تعتمد عناصر تحكّم الصحة والشهادات على شروط إصدار المصدر المسبقة.',
      emptyTitle: 'لا توجد مصادر مُلحَقة',
      emptyDescription: 'ألحِق مصدر سجلّات لبدء استيعاب الأحداث وتطبيعها.',
      noAddress: 'لا يوجد عنوان',
      health: 'الصحة',
      enable: 'تفعيل',
      disable: 'تعطيل',
      rotateCert: 'تدوير الشهادة',
      onboardedToast: 'تم إلحاق مصدر SIEM',
      updatedToast: 'تم تحديث المصدر',
      tokenRotatedToast: 'تم تدوير رمز التسجيل',
      disableReason: 'مُعطَّل من وحدة عمليات SIEM',
      tokenTitle: 'رمز التسجيل',
      tokenDescription: 'انسخ هذه القيمة إلى خطوة تسجيل المُجمِّع. تظهر فقط بعد الإنشاء أو التدوير.',
      tokenExpires: (when) => `تنتهي في ${when}`,
      healthTitle: 'صحة المصدر',
      healthDescription: 'أحدث نبضة للمُجمِّع، وأخطاء المُحلِّل، ومؤشرات الانحراف.',
      healthStatus: 'الحالة',
      healthEps: 'EPS لدقيقة / ٥ دقائق',
      healthBaseline: (value) => `خط الأساس ${value}`,
      healthParserErrors: 'أخطاء المُحلِّل',
      healthLastHour: 'آخر ساعة',
      healthCertExpiry: 'انتهاء الشهادة',
      healthCertExpiryValue: (days) => `${days} يوم`,
      healthDaysRemaining: 'الأيام المتبقّية',
    },
    parser: {
      createTitle: 'إنشاء مُحلِّل',
      createDescription: 'سجّل تعريفات مُحلِّلات المستأجر وعيّناته لترقية CI.',
      name: 'الاسم',
      sourceType: 'نوع المصدر',
      version: 'الإصدار',
      ecsVersion: 'إصدار ECS',
      config: 'التهيئة',
      configDescription: 'تعريف المُحلِّل ككائن JSON.',
      fixtures: 'العيّنات',
      fixturesDescription: 'أحداث نموذجية للتحقّق عبر CI، ككائن JSON.',
      submitIdle: 'إنشاء المُحلِّل',
      registryTitle: 'سجلّ المُحلِّلات',
      registryDescription: 'رقِّ المُحلِّلات المسودة بعد اجتياز العيّنات، أو اسحب التعريفات المُستبدَلة.',
      emptyTitle: 'لا توجد مُحلِّلات مُعرَّفة',
      emptyDescription: 'أنشئ تعريف مُحلِّل لتطبيع أحداث المصدر إلى حقول ECS.',
      versionLine: (version, ecs) => `الإصدار ${version} · ECS ${ecs}`,
      promote: 'ترقية',
      retire: 'سحب',
      createdToast: 'تم إنشاء المُحلِّل',
      lifecycleToast: 'تم تحديث دورة حياة المُحلِّل',
    },
    settings: {
      title: 'إعدادات SIEM للمستأجر',
      description: 'عناصر تحكّم الاحتفاظ وCI للمُحلِّل وHSM والطبقتين الدافئة/الباردة.',
      retentionDays: 'أيام الاحتفاظ',
      warmTierDays: 'أيام الطبقة الدافئة',
      parserCiRequired: 'CI للمُحلِّل مطلوب',
      hsmRequired: 'HSM مطلوب',
      coldTierEnabled: 'الطبقة الباردة مُفعّلة',
      submitIdle: 'حفظ الإعدادات',
      savedToast: 'تم تحديث إعدادات SIEM',
    },
    validation: {
      nameRequired: 'الاسم مطلوب',
      typeRequired: 'النوع مطلوب',
      addressRequired: 'العنوان مطلوب',
      enterNumber: 'أدخل رقمًا',
      wholeNumber: 'رقم صحيح',
      minZero: 'يجب أن يكون ≥ 0',
      timezoneRequired: 'المنطقة الزمنية مطلوبة',
      sourceTypeRequired: 'نوع المصدر مطلوب',
      versionRequired: 'الإصدار مطلوب',
      ecsVersionRequired: 'إصدار ECS مطلوب',
      minOne: 'يجب أن يكون ≥ 1',
      jsonObject: 'يجب أن يكون كائن JSON',
      invalidJson: 'JSON غير صالح',
    },
    fields: {
      format: 'تنسيق',
      keyPlaceholder: 'المفتاح',
      valuePlaceholder: 'القيمة',
      removeEntry: 'إزالة الإدخال',
    },
  },
};

export function useSiemLabels(): SiemLabels {
  return useBilingual(siemLabels);
}

registerMessages('cyber-siem', siemLabels);
