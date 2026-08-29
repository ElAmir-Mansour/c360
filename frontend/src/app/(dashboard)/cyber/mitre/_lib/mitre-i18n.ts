/**
 * Bilingual (English + Modern Standard Arabic) label foundation for the Clario
 * Cyber MITRE ATT&CK coverage console (`/cyber/mitre`, re-exported at
 * `/cyber/mitre-attack`).
 *
 * Mirrors the lex i18n contract: a label group is a `MitreBilingual<T> =
 * { en: T; ar: T }` bundle (two full, same-shaped copies of the label object),
 * resolved against the active locale by {@link useMitreLabels} (React hook) or
 * {@link resolveMitreLabels} (pure resolver). Resolution defaults to English
 * when no `LocaleProvider` is mounted (via `useLocaleOrDefault`), so isolated
 * unit tests keep rendering the English surface unchanged.
 *
 * Components NEVER receive the bundle — they read the resolved `T` and use it as
 * a plain label object. Interpolation params and Western digits are preserved
 * across both locales. Product names / acronyms (MITRE ATT&CK, CTI, IOC, CVE)
 * stay as-is.
 */

'use client';

import { useMemo } from 'react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';

export type MitreBilingual<T> = { readonly en: T; readonly ar: T };

export function resolveMitreBilingual<T>(bundle: MitreBilingual<T>, locale: AppLocale): T {
  return locale === 'ar' ? bundle.ar : bundle.en;
}

interface MitreLabels {
  page: {
    eyebrow: string;
    title: string;
    description: string;
    coverageTag: (percent: string) => string;
    criticalGapsTag: (count: number) => string;
    matrixTag: string;
    loadError: string;
    staleBanner: (version: string, updatedAt: string, days: number) => string;
  };
  stats: {
    coverage: string;
    coverageDescription: (percent: string) => string;
    activeTechniques: string;
    activeDescription: string;
    passiveTechniques: string;
    passiveDescription: string;
    criticalGaps: string;
    criticalGapsDescription: string;
    overallCoverage: string;
    overallDescription: string;
    coverageLabel: string;
    coveredSeries: string;
    totalSeries: string;
    coverageByTactic: string;
  };
  filters: {
    all: string;
    covered: string;
    gapsOnly: string;
    withAlerts: string;
    searchPlaceholder: string;
  };
  legend: {
    covered: string;
    noisy: string;
    gap: string;
    idle: string;
  };
  matrix: {
    noMatch: string;
  };
  tacticHeader: {
    coverageTooltip: (covered: number, total: number, pct: number) => string;
  };
  cell: {
    ruleCount: (count: number) => string;
    alertCount: (count: number) => string;
    activeThreatCount: (count: number) => string;
    rules: (names: string, extra: number) => string;
    lastAlert: (ago: string) => string;
    noRecentAlerts: string;
  };
  panel: {
    fallbackTitle: string;
    description: string;
    viewOnMitre: string;
    rules: string;
    alerts: string;
    activeThreats: string;
    associatedRules: string;
    createRule: string;
    enable: string;
    disable: string;
    ruleEnabledToast: string;
    ruleDisabledToast: string;
    toggleErrorToast: string;
    noRulesCover: string;
    associatedThreats: string;
    noThreatContext: string;
    recentAlerts: string;
    noRecentAlerts: string;
  };
}

const mitreLabels: MitreBilingual<MitreLabels> = {
  en: {
    page: {
      eyebrow: 'Cyber Defense',
      title: 'MITRE ATT&CK',
      description: 'Track detection coverage, noisy techniques, and active gaps across the ATT&CK matrix.',
      coverageTag: (percent) => `${percent}% coverage`,
      criticalGapsTag: (count) => `${count} critical gaps`,
      matrixTag: 'ATT&CK matrix',
      loadError: 'Failed to load MITRE coverage.',
      staleBanner: (version, updatedAt, days) =>
        `The embedded MITRE ATT&CK catalog (v${version}, updated ${updatedAt}) is ${days} days old. New techniques may be missing.`,
    },
    stats: {
      coverage: 'Coverage',
      coverageDescription: (percent) => `${percent}% of techniques covered`,
      activeTechniques: 'Active Techniques',
      activeDescription: 'Covered techniques with recent alert activity',
      passiveTechniques: 'Passive Techniques',
      passiveDescription: 'Covered techniques without recent alert activity',
      criticalGaps: 'Critical Gaps',
      criticalGapsDescription: 'Active threat techniques with no rule coverage',
      overallCoverage: 'Overall Coverage',
      overallDescription: 'Percentage of ATT&CK techniques currently covered by active detection content.',
      coverageLabel: 'Coverage',
      coveredSeries: 'Covered',
      totalSeries: 'Total',
      coverageByTactic: 'Coverage By Tactic',
    },
    filters: {
      all: 'All',
      covered: 'Covered ✓',
      gapsOnly: 'Gaps Only ⚠',
      withAlerts: 'With Alerts',
      searchPlaceholder: 'Search T1059, PowerShell…',
    },
    legend: {
      covered: 'Covered by active rules',
      noisy: 'Covered, but noisy',
      gap: 'Threat-backed gap',
      idle: 'Idle / not covered',
    },
    matrix: {
      noMatch: 'No techniques match the current filter.',
    },
    tacticHeader: {
      coverageTooltip: (covered, total, pct) => `${covered} of ${total} techniques covered (${pct}%)`,
    },
    cell: {
      ruleCount: (count) => `${count} rule${count === 1 ? '' : 's'}`,
      alertCount: (count) => `${count} alert${count === 1 ? '' : 's'}`,
      activeThreatCount: (count) => `${count} active threat${count === 1 ? '' : 's'}`,
      rules: (names, extra) => `Rules: ${names}${extra > 0 ? ` +${extra} more` : ''}`,
      lastAlert: (ago) => `Last alert ${ago}`,
      noRecentAlerts: 'No recent alerts',
    },
    panel: {
      fallbackTitle: 'Technique detail',
      description: 'Description',
      viewOnMitre: 'View on MITRE ATT&CK',
      rules: 'Rules',
      alerts: 'Alerts',
      activeThreats: 'Active Threats',
      associatedRules: 'Associated Detection Rules',
      createRule: 'Create Rule',
      enable: 'Enable',
      disable: 'Disable',
      ruleEnabledToast: 'Rule enabled',
      ruleDisabledToast: 'Rule disabled',
      toggleErrorToast: 'Failed to toggle rule',
      noRulesCover: 'No detection rules cover this technique yet.',
      associatedThreats: 'Associated Threats',
      noThreatContext: 'No active threat context is mapped to this technique.',
      recentAlerts: 'Recent Alerts',
      noRecentAlerts: 'No recent alerts are mapped to this technique.',
    },
  },
  ar: {
    page: {
      eyebrow: 'الدفاع السيبراني',
      title: 'MITRE ATT&CK',
      description: 'تتبّع تغطية الكشف والتقنيات كثيرة الضوضاء والفجوات النشطة عبر مصفوفة ATT&CK.',
      coverageTag: (percent) => `${percent}% تغطية`,
      criticalGapsTag: (count) => `${count} فجوة حرجة`,
      matrixTag: 'مصفوفة ATT&CK',
      loadError: 'تعذّر تحميل تغطية MITRE.',
      staleBanner: (version, updatedAt, days) =>
        `كتالوج MITRE ATT&CK المضمَّن (الإصدار ${version}، محدَّث في ${updatedAt}) مضى عليه ${days} يومًا. قد تكون هناك تقنيات جديدة مفقودة.`,
    },
    stats: {
      coverage: 'التغطية',
      coverageDescription: (percent) => `${percent}% من التقنيات مغطّاة`,
      activeTechniques: 'التقنيات النشطة',
      activeDescription: 'التقنيات المغطّاة ذات نشاط تنبيهات حديث',
      passiveTechniques: 'التقنيات الخاملة',
      passiveDescription: 'التقنيات المغطّاة دون نشاط تنبيهات حديث',
      criticalGaps: 'الفجوات الحرجة',
      criticalGapsDescription: 'تقنيات التهديد النشطة دون تغطية بأي قاعدة',
      overallCoverage: 'التغطية الإجمالية',
      overallDescription: 'نسبة تقنيات ATT&CK المغطّاة حاليًا بمحتوى كشف نشط.',
      coverageLabel: 'التغطية',
      coveredSeries: 'مغطّاة',
      totalSeries: 'الإجمالي',
      coverageByTactic: 'التغطية حسب التكتيك',
    },
    filters: {
      all: 'الكل',
      covered: 'مغطّاة ✓',
      gapsOnly: 'الفجوات فقط ⚠',
      withAlerts: 'ذات تنبيهات',
      searchPlaceholder: 'ابحث T1059، PowerShell…',
    },
    legend: {
      covered: 'مغطّاة بقواعد نشطة',
      noisy: 'مغطّاة لكنها كثيرة الضوضاء',
      gap: 'فجوة مدعومة بتهديد',
      idle: 'خاملة / غير مغطّاة',
    },
    matrix: {
      noMatch: 'لا توجد تقنيات مطابقة للتصفية الحالية.',
    },
    tacticHeader: {
      coverageTooltip: (covered, total, pct) => `${covered} من ${total} تقنية مغطّاة (${pct}%)`,
    },
    cell: {
      ruleCount: (count) => `${count} قاعدة`,
      alertCount: (count) => `${count} تنبيه`,
      activeThreatCount: (count) => `${count} تهديد نشط`,
      rules: (names, extra) => `القواعد: ${names}${extra > 0 ? ` +${extra} إضافية` : ''}`,
      lastAlert: (ago) => `آخر تنبيه ${ago}`,
      noRecentAlerts: 'لا توجد تنبيهات حديثة',
    },
    panel: {
      fallbackTitle: 'تفاصيل التقنية',
      description: 'الوصف',
      viewOnMitre: 'عرض على MITRE ATT&CK',
      rules: 'القواعد',
      alerts: 'التنبيهات',
      activeThreats: 'التهديدات النشطة',
      associatedRules: 'قواعد الكشف المرتبطة',
      createRule: 'إنشاء قاعدة',
      enable: 'تفعيل',
      disable: 'تعطيل',
      ruleEnabledToast: 'تم تفعيل القاعدة',
      ruleDisabledToast: 'تم تعطيل القاعدة',
      toggleErrorToast: 'تعذّر تبديل حالة القاعدة',
      noRulesCover: 'لا توجد قواعد كشف تغطّي هذه التقنية بعد.',
      associatedThreats: 'التهديدات المرتبطة',
      noThreatContext: 'لا يوجد سياق تهديد نشط مرتبط بهذه التقنية.',
      recentAlerts: 'التنبيهات الأحدث',
      noRecentAlerts: 'لا توجد تنبيهات حديثة مرتبطة بهذه التقنية.',
    },
  },
};

export function useMitreLabels(): MitreLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveMitreBilingual(mitreLabels, locale), [locale]);
}

export type { MitreLabels };
