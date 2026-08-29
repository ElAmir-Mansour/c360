/**
 * Co-located bilingual labels for the SLA panel's NEW (feature #13) strings:
 * the named escalation chain and the manual "Escalate now" action.
 *
 * Follows the suite bilingual contract (see `../../_lib/lex-i18n`): a single
 * `LexBilingual<T>` bundle with two full, same-shaped copies — natural English
 * in `en`, professional MSA in `ar` — resolved against the active locale by the
 * thin `useSlaExtraLabels()` hook below. The existing `useServiceDeskLabels().sla`
 * strings stay in `_components/labels.ts`; this file ONLY carries the additions.
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface SlaExtraLabels {
  /** Heading shown above the resolved L1/L2/L3 recipient chain. */
  chainTitle: string;
  /** Rendered when a rung has no resolvable recipient (no entity / coverage gap). */
  noRecipient: string;
  /** Rendered when the clock carries no beneficiary entity to resolve a chain. */
  noChain: string;
  /** Manual escalate button label. */
  escalateNow: string;
  /** Manual escalate button label while the mutation is pending. */
  escalating: string;
  /** Caption describing the current escalation level and the next level. */
  advancesTo: (current: number, next: number) => string;
  /** Caption when the clock is already at the top rung (no further escalation). */
  atTopLevel: string;
  /** Success toast after a manual escalation. */
  escalateSuccess: string;
}

export const slaExtraLabels: LexBilingual<SlaExtraLabels> = {
  en: {
    chainTitle: 'Escalation recipients',
    noRecipient: 'No recipient resolved',
    noChain: 'No escalation chain configured for this beneficiary.',
    escalateNow: 'Escalate now',
    escalating: 'Escalating...',
    advancesTo: (current, next) => `Currently at level ${current} · advances to level ${next}`,
    atTopLevel: 'Already at the highest escalation level.',
    escalateSuccess: 'Escalation advanced.',
  },
  ar: {
    chainTitle: 'مستلمو التصعيد',
    noRecipient: 'لم يُحدَّد مستلم',
    noChain: 'لا توجد سلسلة تصعيد مُهيّأة لهذا المستفيد.',
    escalateNow: 'تصعيد الآن',
    escalating: 'جارٍ التصعيد...',
    advancesTo: (current, next) => `المستوى الحالي ${current} · يرتقي إلى المستوى ${next}`,
    atTopLevel: 'بلغ أعلى مستوى تصعيد بالفعل.',
    escalateSuccess: 'تم رفع مستوى التصعيد.',
  },
};

/**
 * useSlaExtraLabels resolves the feature-#13 SLA additions for the active locale
 * (English fallback outside a LocaleProvider), memoized on locale — mirroring the
 * suite's `use<Feature>Labels()` convention.
 */
export function useSlaExtraLabels(): SlaExtraLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(slaExtraLabels, locale), [locale]);
}
