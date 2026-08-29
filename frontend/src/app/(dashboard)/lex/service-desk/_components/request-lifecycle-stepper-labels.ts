'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the
 * *timing* enrichments the lifecycle stepper adds on top of the pre-existing
 * `useDetailExtraLabels().stepper` copy (title / stage names / terminal strings,
 * which stay in `detail-extra-labels.ts`).
 *
 * This file holds ONLY the NEW strings introduced by the audit-driven timing
 * layer: "entered {rel}", the absolute + duration tooltip lines, and the
 * duration unit words. Follows the canonical lex i18n contract
 * (`../../_lib/lex-i18n`): a `LexBilingual<T> = { en, ar }` bundle with two FULL
 * same-shaped copies, resolved per locale by {@link useLifecycleStepperLabels}.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface LifecycleStepperTimingLabels {
  /** Inline caption under the CURRENT stage, e.g. "Entered 3 hours ago". */
  entered: (relative: string) => string;
  /** Tooltip line — absolute dual date a stage was entered on. */
  enteredOn: (dual: string) => string;
  /** Tooltip line — how long the request sat in a (completed) stage. */
  timeInStage: (duration: string) => string;
  /** Tooltip for a stage not yet reached. */
  notReached: string;
  /** Duration unit words (used to humanize a stage's dwell time). */
  units: {
    day: string;
    days: string;
    hour: string;
    hours: string;
    minute: string;
    minutes: string;
    lessThanMinute: string;
  };
}

const bundle: LexBilingual<LifecycleStepperTimingLabels> = {
  en: {
    entered: (relative) => `Entered ${relative}`,
    enteredOn: (dual) => `Entered ${dual}`,
    timeInStage: (duration) => `In this stage for ${duration}`,
    notReached: 'Not reached yet',
    units: {
      day: 'day',
      days: 'days',
      hour: 'hour',
      hours: 'hours',
      minute: 'minute',
      minutes: 'minutes',
      lessThanMinute: 'less than a minute',
    },
  },
  ar: {
    entered: (relative) => `دخلها ${relative}`,
    enteredOn: (dual) => `دخلها ${dual}`,
    timeInStage: (duration) => `في هذه المرحلة منذ ${duration}`,
    notReached: 'لم تُبلغ بعد',
    units: {
      day: 'يوم',
      days: 'أيام',
      hour: 'ساعة',
      hours: 'ساعات',
      minute: 'دقيقة',
      minutes: 'دقائق',
      lessThanMinute: 'أقل من دقيقة',
    },
  },
};

export function resolveLifecycleStepperLabels(
  locale: AppLocale = 'en',
): LifecycleStepperTimingLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useLifecycleStepperLabels(): LifecycleStepperTimingLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLifecycleStepperLabels(locale), [locale]);
}
