/**
 * Feature-local bilingual label bundle for the Rehearse route page chrome
 * (header copy and the two write-gate descriptions).
 *
 * Adopts the foundation bilingual contract: a `DRBilingual<RehearsePageLabels>`
 * bundle of two FULL, identically-shaped copies — the original English in `en`
 * (unchanged so English-asserting tests stay green) and professional Modern
 * Standard Arabic in `ar`. Resolved against the active locale via
 * {@link useRehearsePageLabels} (English under the `renderWithQuery` `en`
 * default). Domain terms follow the shared DR glossary (drill = تمرين,
 * game day = يوم محاكاة, agent = وكيل).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../_lib/dr-i18n';

export interface RehearsePageLabels {
  title: string;
  description: string;
  enrollmentGateDescription: string;
  actionsGateDescription: string;
  /** Inline gate-notice reasons (no group selected / no write permission). */
  noGroupReason: string;
  noWriteReason: string;
}

export const rehearsePageLabels: DRBilingual<RehearsePageLabels> = {
  en: {
    title: 'Rehearse',
    description:
      'Enroll DR agents, schedule isolated drills, run non-production game-day fault injection, and seal application-consistent points so recovery is proven before you need it.',
    enrollmentGateDescription:
      'Agent creation and enrollment-token minting require the dr:write permission. You can still review the agent fleet and certificate posture below.',
    actionsGateDescription:
      'Triggering app-consistent points, creating drill schedules, and running game-day scenarios require the dr:write permission. The catalog and recent outputs below remain visible.',
    noGroupReason: 'Select a protection group first',
    noWriteReason: 'Requires the dr:write permission',
  },
  ar: {
    title: 'التمرين',
    description:
      'سجّل وكلاء التعافي من الكوارث، وجدوِل تمارين معزولة، وشغّل حقن أعطال يوم المحاكاة في بيئة غير إنتاجية، واختم نقاطًا متّسقة على مستوى التطبيق ليكون التعافي مُثبَتًا قبل الحاجة إليه.',
    enrollmentGateDescription:
      'يتطلب إنشاء الوكلاء وإصدار رموز التسجيل صلاحية dr:write. وبإمكانك مع ذلك مراجعة أسطول الوكلاء وحالة الشهادات أدناه.',
    actionsGateDescription:
      'يتطلب تشغيل النقاط المتّسقة على مستوى التطبيق وإنشاء جداول التمارين وتشغيل سيناريوهات يوم المحاكاة صلاحية dr:write. ويبقى الدليل والمخرجات الأخيرة أدناه ظاهرَين.',
    noGroupReason: 'اختَر مجموعة حماية أولًا',
    noWriteReason: 'يتطلّب صلاحية الكتابة (dr:write)',
  },
};

/**
 * useRehearsePageLabels resolves the Rehearse page-chrome labels against the
 * active locale (English fallback / default), mirroring the shared `useDRLabels`
 * hook.
 */
export function useRehearsePageLabels(): RehearsePageLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(rehearsePageLabels, locale), [locale]);
}
