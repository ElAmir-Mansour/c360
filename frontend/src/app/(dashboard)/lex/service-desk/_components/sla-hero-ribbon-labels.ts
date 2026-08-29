'use client';

/**
 * Co-located bilingual (English + Modern Standard Arabic) labels for the Legal
 * Service Desk *SLA hero ribbon* ({@link SlaHeroRibbon}) — the compact,
 * live-ticking SLA status strip promoted into the request-detail hero/right-rail.
 *
 * Follows the canonical lex i18n contract (`../../_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useSlaHeroRibbonLabels}. JSX only ever touches
 * the resolved `T`. Function-valued fields take PRE-FORMATTED string params
 * (already numeral-localized via the formatter) so the same `{placeholder}`
 * shape holds on both sides.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface SlaHeroRibbonLabels {
  /** Eyebrow / section label shown above the ribbon body. */
  eyebrow: string;
  /** Accessible group label for the whole ribbon. */
  ariaLabel: string;
  /** Breach-risk badge copy. */
  status: {
    onTrack: string;
    atRisk: string;
    breached: string;
  };
  /** Prefix for the turnaround relative time when still due (e.g. "Due in 3 days"). */
  duePrefix: string;
  /** Prefix for the turnaround relative time once overdue (e.g. "Overdue · 3 days ago"). */
  overduePrefix: string;
  /** Caption/sr-only word describing the ring's elapsed percentage. */
  elapsedSuffix: string;
  /** Acknowledgement sub-line. */
  ack: {
    done: string;
    duePrefix: string;
  };
  /** Escalation sub-line, e.g. "Escalated · L2" (level is pre-formatted). */
  escalationLevel: (level: string) => string;
  /** Pre-execution informative state (no clock yet — BY DESIGN, not an error). */
  pending: {
    title: string;
    body: string;
    targetHours: (n: string) => string;
    targetDays: (n: string) => string;
  };
}

const bundle: LexBilingual<SlaHeroRibbonLabels> = {
  en: {
    eyebrow: 'SLA turnaround',
    ariaLabel: 'SLA status',
    status: {
      onTrack: 'On track',
      atRisk: 'At risk',
      breached: 'Breached',
    },
    duePrefix: 'Due',
    overduePrefix: 'Overdue',
    elapsedSuffix: 'elapsed',
    ack: {
      done: 'Acknowledged',
      duePrefix: 'Ack due',
    },
    escalationLevel: (level) => `Escalated · L${level}`,
    pending: {
      title: 'SLA clock not started',
      body: 'The SLA clock starts once completeness is confirmed.',
      targetHours: (n) => `Target: ${n} working hours`,
      targetDays: (n) => `Target: ${n} working days`,
    },
  },
  ar: {
    eyebrow: 'مهلة مستوى الخدمة',
    ariaLabel: 'حالة مستوى الخدمة',
    status: {
      onTrack: 'ضمن المهلة',
      atRisk: 'مهلة وشيكة',
      breached: 'تجاوز المهلة',
    },
    duePrefix: 'الاستحقاق',
    overduePrefix: 'متجاوز',
    elapsedSuffix: 'منقضٍ',
    ack: {
      done: 'تم الإقرار',
      duePrefix: 'استحقاق الإقرار',
    },
    escalationLevel: (level) => `تصعيد · مستوى ${level}`,
    pending: {
      title: 'لم يبدأ مؤقّت مستوى الخدمة',
      body: 'يبدأ مؤقّت مستوى الخدمة بمجرد تأكيد اكتمال الطلب.',
      targetHours: (n) => `المستهدف: ${n} ساعة عمل`,
      targetDays: (n) => `المستهدف: ${n} يوم عمل`,
    },
  },
};

export function resolveSlaHeroRibbonLabels(locale: AppLocale = 'en'): SlaHeroRibbonLabels {
  return resolveLexBilingual(bundle, locale);
}

export function useSlaHeroRibbonLabels(): SlaHeroRibbonLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveSlaHeroRibbonLabels(locale), [locale]);
}
